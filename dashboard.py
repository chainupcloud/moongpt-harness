#!/usr/bin/env -S uv run
"""
moongpt-harness 任务面板
用法: uv run dashboard.py [--port 8080]
"""

import json
import re
import subprocess
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from flask import Flask, jsonify, request, Response

app = Flask(__name__)
BASE = Path(__file__).parent

# cron 调度（分钟间隔）
AGENT_SCHEDULE = {
    'test':   {'interval_min': 360,  'cron': '23 */6 * * *',  'label': '每 6h'},
    'fix':    {'interval_min': 30,   'cron': '17,47 * * * *', 'label': '每 30min'},
    'master': {'interval_min': 15,   'cron': '7,22,37,52 * * * *', 'label': '每 15min'},
}

HTML = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>moongpt-harness 任务面板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; flex-direction: column; }

  /* ── Header ── */
  .header { padding: 14px 28px; border-bottom: 1px solid #21262d; flex-shrink: 0;
            display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header .updated { font-size: 12px; color: #7d8590; }
  .refresh-btn { background: #21262d; border: 1px solid #30363d; color: #e6edf3;
                 padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .refresh-btn:hover { background: #30363d; }

  /* ── Stats bar (top, full width) ── */
  .stats-bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;
               padding: 16px 28px; border-bottom: 1px solid #21262d; flex-shrink: 0; }
  .stat-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px 16px; }
  .stat-card .label { font-size: 11px; color: #7d8590; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
  .stat-card .value { font-size: 24px; font-weight: 700; }
  .stat-card .value.green  { color: #3fb950; }
  .stat-card .value.yellow { color: #d29922; }
  .stat-card .value.red    { color: #f85149; }
  .stat-card .value.blue   { color: #58a6ff; }
  .stat-card .value.muted  { font-size: 13px; color: #7d8590; padding-top: 4px; }

  /* ── Main two-column layout ── */
  .main { display: flex; flex: 1; overflow: hidden; }

  /* ── Sidebar ── */
  .sidebar { width: 320px; flex-shrink: 0; border-right: 1px solid #21262d;
             overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }

  /* ── Content area ── */
  .content { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }

  /* ── Shared section ── */
  .section { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .section h2 { font-size: 13px; font-weight: 600; margin-bottom: 12px;
                padding-bottom: 10px; border-bottom: 1px solid #21262d;
                text-transform: uppercase; letter-spacing: .5px; color: #7d8590; }

  /* ── Agent cards (sidebar, stacked) ── */
  .agent-card { background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
                padding: 12px; margin-bottom: 8px; }
  .agent-card:last-child { margin-bottom: 0; }
  .agent-card.running { border-color: #3fb950; }
  .agent-card.error   { border-color: #f85149; }
  .agent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .agent-name { font-size: 13px; font-weight: 600; }
  .agent-dot { width: 7px; height: 7px; border-radius: 50%; }
  .agent-dot.running { background: #3fb950; box-shadow: 0 0 5px #3fb950; animation: pulse 1.5s infinite; }
  .agent-dot.idle    { background: #7d8590; }
  .agent-dot.error   { background: #f85149; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .agent-kv { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; border-bottom: 1px solid #21262d; }
  .agent-kv:last-child { border-bottom: none; }
  .agent-kv .k { color: #7d8590; }
  .agent-kv .v { color: #e6edf3; }
  .agent-kv .v.green  { color: #3fb950; }
  .agent-kv .v.yellow { color: #d29922; }
  .agent-kv .v.red    { color: #f85149; }
  .progress-bar { height: 2px; background: #21262d; border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .progress-fill { height: 100%; background: #388bfd; border-radius: 2px; transition: width .3s; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #7d8590; font-weight: 500;
       font-size: 12px; border-bottom: 1px solid #21262d; }
  td { padding: 10px 12px; border-bottom: 1px solid #161b22; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-open        { background: #388bfd26; color: #58a6ff; }
  .badge-fixing      { background: #d2992226; color: #d29922; }
  .badge-closed      { background: #3fb95026; color: #3fb950; }
  .badge-needs-human { background: #f8514926; color: #f85149; }
  .badge-merged      { background: #8957e526; color: #bc8cff; }
  .badge-p1 { background: #f8514926; color: #f85149; }
  .badge-p2 { background: #d2992226; color: #d29922; }
  .badge-p3 { background: #388bfd26; color: #58a6ff; }
  .badge-p4 { background: #21262d; color: #7d8590; }
  .project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .project-card { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .project-card .name { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #58a6ff; }
  .project-card .kv { display: flex; justify-content: space-between; font-size: 12px;
                      padding: 4px 0; border-bottom: 1px solid #21262d; }
  .project-card .kv:last-child { border-bottom: none; }
  .project-card .kv .k { color: #7d8590; }
  .project-card .kv .v { color: #e6edf3; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-box { background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
             padding: 12px; font-family: monospace; font-size: 12px; color: #7d8590;
             max-height: 220px; overflow-y: auto; white-space: pre-wrap; }
  .log-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
  .log-tab { padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
             background: #21262d; color: #7d8590; border: 1px solid #30363d; }
  .log-tab.active { background: #388bfd26; color: #58a6ff; border-color: #388bfd; }
  .none-tip { color: #7d8590; font-size: 13px; text-align: center; padding: 24px; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="header">
  <h1>🤖 moongpt-harness 任务面板</h1>
  <div style="display:flex;align-items:center;gap:12px;">
    <span class="updated" id="ts"></span>
    <button class="refresh-btn" onclick="loadAll()">↻ 刷新</button>
  </div>
</div>
<div class="stats-bar" id="stats"></div>
<div class="main">
  <div class="sidebar">
    <!-- Agent Status -->
    <div class="section">
      <h2>Agent 状态</h2>
      <div id="agents-wrap"></div>
    </div>
    <!-- Projects -->
    <div class="section">
      <h2>项目配置</h2>
      <div id="projects-wrap"></div>
    </div>
  </div>
  <div class="content">
    <!-- Issues -->
    <div class="section">
      <h2>Issues</h2>
      <div id="issues-wrap"></div>
    </div>
    <!-- PRs -->
    <div class="section">
      <h2>Pull Requests</h2>
      <div id="prs-wrap"></div>
    </div>
    <!-- Logs -->
    <div class="section">
      <h2>Agent 日志（最近 30 行）</h2>
      <div class="log-tabs">
        <button class="log-tab active" onclick="showLog('test',event)">test</button>
        <button class="log-tab" onclick="showLog('fix',event)">fix</button>
        <button class="log-tab" onclick="showLog('master',event)">master</button>
      </div>
      <div class="log-box" id="log-box">加载中...</div>
    </div>
  </div>
</div>

<script>
let currentLog = 'test';

async function loadAll() {
  document.getElementById('ts').textContent = '更新于 ' + new Date().toLocaleTimeString('zh');
  const [state, projects, agents, logs] = await Promise.all([
    fetch('/api/state').then(r=>r.json()),
    fetch('/api/projects').then(r=>r.json()),
    fetch('/api/agents').then(r=>r.json()),
    fetch('/api/logs?agent=' + currentLog).then(r=>r.json()),
  ]);
  renderStats(state);
  renderAgents(agents);
  renderIssues(state.issues || []);
  renderPRs(state.prs || []);
  renderProjects(projects);
  document.getElementById('log-box').textContent = logs.content || '（无日志）';
}

function showLog(agent, e) {
  currentLog = agent;
  document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  fetch('/api/logs?agent=' + agent).then(r=>r.json()).then(d => {
    document.getElementById('log-box').textContent = d.content || '（无日志）';
  });
}

const AGENT_LABELS = {test:'🔍 Test Agent', fix:'🔧 Fix Agent', master:'🎛 Master Agent'};
function agentLabel(name) { return AGENT_LABELS[name] || name; }

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function badge(cls, text) {
  return `<span class="badge badge-${cls}">${esc(text)}</span>`;
}

function renderStats(state) {
  const issues = state.issues || [];
  const prs = state.prs || [];
  const counts = { open:0, fixing:0, closed:0, 'needs-human':0 };
  issues.forEach(i => { if (counts[i.status] !== undefined) counts[i.status]++; });
  const lastRun = state.last_test_run || '未运行';
  document.getElementById('stats').innerHTML = `
    <div class="stat-card"><div class="label">Open Issues</div><div class="value blue">${counts.open}</div></div>
    <div class="stat-card"><div class="label">Fixing</div><div class="value yellow">${counts.fixing}</div></div>
    <div class="stat-card"><div class="label">Closed</div><div class="value green">${counts.closed}</div></div>
    <div class="stat-card"><div class="label">需人工</div><div class="value red">${counts['needs-human']}</div></div>
    <div class="stat-card"><div class="label">PRs Open</div><div class="value blue">${prs.filter(p=>p.status==='open').length}</div></div>
    <div class="stat-card"><div class="label">上次测试</div><div class="value" style="font-size:14px;padding-top:6px">${lastRun}</div></div>
  `;
}

function renderAgents(agents) {
  document.getElementById('agents-wrap').innerHTML = agents.map(a => {
    const dotCls = a.running ? 'running' : (a.last_status === 'error' ? 'error' : 'idle');
    const cardCls = a.running ? 'running' : (a.last_status === 'error' ? 'error' : '');
    const statusText = a.running ? '运行中' : (a.last_status === 'error' ? '错误' : '空闲');
    const statusColor = a.running ? 'green' : (a.last_status === 'error' ? 'red' : '');
    const pct = a.next_run_pct ?? 0;
    return `
    <div class="agent-card ${cardCls}">
      <div class="agent-header">
        <span class="agent-name">${agentLabel(a.name)}</span>
        <span class="agent-dot ${dotCls}"></span>
      </div>
      <div class="agent-kv"><span class="k">状态</span><span class="v ${statusColor}">${statusText}</span></div>
      <div class="agent-kv"><span class="k">调度</span><span class="v">${a.schedule_label}</span></div>
      <div class="agent-kv"><span class="k">上次运行</span><span class="v">${a.last_run || '—'}</span></div>
      <div class="agent-kv"><span class="k">运行时长</span><span class="v">${a.last_duration || '—'}</span></div>
      <div class="agent-kv"><span class="k">下次运行</span><span class="v">${a.next_run || '—'}</span></div>
      <div class="progress-bar" title="距下次运行进度">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}

function renderIssues(issues) {
  if (!issues.length) { document.getElementById('issues-wrap').innerHTML = '<p class="none-tip">暂无 issue</p>'; return; }
  const rows = issues.map(i => `
    <tr>
      <td><a href="https://github.com/chainupcloud/dex-ui/issues/${i.github_number}" target="_blank">#${i.github_number}</a></td>
      <td>${esc(i.title)}</td>
      <td>${badge(i.priority.toLowerCase(), i.priority)}</td>
      <td>${badge(i.status, i.status)}</td>
      <td>${i.pr_number ? `<a href="https://github.com/chainupcloud/dex-ui/pull/${i.pr_number}" target="_blank">PR #${i.pr_number}</a>` : '—'}</td>
      <td>${i.fix_attempts || 0}</td>
      <td>${i.resolution || '—'}</td>
    </tr>`).join('');
  document.getElementById('issues-wrap').innerHTML = `
    <table><thead><tr>
      <th>#</th><th>标题</th><th>优先级</th><th>状态</th><th>PR</th><th>尝试次数</th><th>备注</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPRs(prs) {
  if (!prs.length) { document.getElementById('prs-wrap').innerHTML = '<p class="none-tip">暂无 PR</p>'; return; }
  const rows = prs.map(p => `
    <tr>
      <td><a href="https://github.com/chainupcloud/dex-ui/pull/${p.pr_number}" target="_blank">#${p.pr_number}</a></td>
      <td>${badge(p.status, p.status)}</td>
      <td><code style="font-size:11px;color:#7d8590">${(p.commit_sha||'—').slice(0,7)}</code></td>
      <td>${p.deployed ? '✅' : '—'}</td>
      <td>${p.accepted ? '✅' : '—'}</td>
      <td>${p.merged_at || '—'}</td>
    </tr>`).join('');
  document.getElementById('prs-wrap').innerHTML = `
    <table><thead><tr>
      <th>PR</th><th>状态</th><th>commit</th><th>已部署</th><th>已验收</th><th>合并日期</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderProjects(projects) {
  const wrap = document.getElementById('projects-wrap');
  if (!projects.length) { wrap.innerHTML = '<p class="none-tip">无项目配置</p>'; return; }
  wrap.innerHTML = projects.map(p => `
    <div class="project-card">
      <div class="name">${p.name}</div>
      <div class="kv"><span class="k">仓库</span><span class="v">${p.github?.owner}/${p.github?.repo}</span></div>
      <div class="kv"><span class="k">fix 分支</span><span class="v">${p.github?.fix_base_branch}</span></div>
      <div class="kv"><span class="k">生产域名</span><span class="v"><a href="https://${p.vercel?.production_domain}" target="_blank">${p.vercel?.production_domain}</a></span></div>
      <div class="kv"><span class="k">Staging</span><span class="v">${p.vercel?.staging_domain
        ? `<a href="https://${p.vercel.staging_domain}" target="_blank">${p.vercel.staging_domain.split('.')[0]}...</a>`
        : '待配置'}</span></div>
      <div class="kv"><span class="k">激活环境</span><span class="v">${p.test?.active_env}</span></div>
    </div>`).join('');
}


loadAll();
setInterval(loadAll, 15000);
</script>
</body>
</html>
"""

def parse_log_times(agent: str):
    """从日志文件解析最后一次运行的开始时间、结束时间、状态。"""
    log_file = BASE / 'logs' / f'{agent}-agent.log'
    if not log_file.exists():
        return None, None, None

    lines = log_file.read_text().splitlines()
    start_re = re.compile(r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] Starting')
    end_re   = re.compile(r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \S+ agent completed')

    starts, ends = [], []
    for line in lines:
        m = start_re.search(line)
        if m: starts.append(datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S'))
        m = end_re.search(line)
        if m: ends.append(datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S'))

    last_start = starts[-1] if starts else None
    last_end   = ends[-1]   if ends   else None
    # 判断是否异常结束（有 start 但无对应 end，或最后一行是 error）
    status = 'ok'
    if last_start and (not last_end or last_end < last_start):
        status = 'error'
    return last_start, last_end, status

def is_agent_running(agent: str) -> bool:
    try:
        out = subprocess.check_output(
            ['pgrep', '-fa', f'run-agent.sh {agent}'], text=True
        )
        return bool(out.strip())
    except subprocess.CalledProcessError:
        return False

def next_run_info(agent: str, last_start):
    cfg = AGENT_SCHEDULE[agent]
    now = datetime.now()
    if last_start:
        nxt = last_start + timedelta(minutes=cfg['interval_min'])
        if nxt < now:
            nxt = now + timedelta(minutes=1)
    else:
        nxt = now + timedelta(minutes=cfg['interval_min'])

    delta = nxt - now
    total_sec = cfg['interval_min'] * 60
    elapsed_sec = total_sec - delta.total_seconds()
    pct = max(0, min(100, int(elapsed_sec / total_sec * 100)))

    mins = int(delta.total_seconds() // 60)
    secs = int(delta.total_seconds() % 60)
    if mins > 0:
        label = f'{mins}m {secs}s 后'
    else:
        label = f'{secs}s 后'
    return label, pct

@app.route('/')
def index():
    return Response(HTML, mimetype='text/html')

@app.route('/api/state')
def api_state():
    issues_file = BASE / 'state' / 'issues.json'
    prs_file    = BASE / 'state' / 'prs.json'
    data = {}
    if issues_file.exists():
        d = json.loads(issues_file.read_text())
        data['issues'] = d.get('issues', [])
        data['last_test_run'] = d.get('last_test_run')
    if prs_file.exists():
        data['prs'] = json.loads(prs_file.read_text()).get('prs', [])
    return jsonify(data)

@app.route('/api/agents')
def api_agents():
    result = []
    for name in ('test', 'fix', 'master'):
        last_start, last_end, status = parse_log_times(name)
        running = is_agent_running(name)
        nxt_label, pct = next_run_info(name, last_start)

        duration = None
        if last_start and last_end and last_end >= last_start:
            secs = int((last_end - last_start).total_seconds())
            duration = f'{secs // 60}m {secs % 60}s' if secs >= 60 else f'{secs}s'

        result.append({
            'name': name,
            'running': running,
            'last_status': status,
            'last_run': last_start.strftime('%m-%d %H:%M') if last_start else None,
            'last_duration': duration,
            'next_run': nxt_label,
            'next_run_pct': pct,
            'schedule_label': AGENT_SCHEDULE[name]['label'],
        })
    return jsonify(result)

@app.route('/api/projects')
def api_projects():
    projects = []
    for f in sorted((BASE / 'projects').glob('*.json')):
        if f.stem == 'template':
            continue
        try:
            projects.append(json.loads(f.read_text()))
        except Exception:
            pass
    return jsonify(projects)

@app.route('/api/logs')
def api_logs():
    agent = request.args.get('agent', 'test')
    log_file = BASE / 'logs' / f'{agent}-agent.log'
    if not log_file.exists():
        return jsonify({'content': f'日志文件不存在：logs/{agent}-agent.log'})
    lines = log_file.read_text().splitlines()
    return jsonify({'content': '\n'.join(lines[-30:])})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()
    print(f'Dashboard: http://{args.host}:{args.port}')
    app.run(host=args.host, port=args.port, debug=False)
