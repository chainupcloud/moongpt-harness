#!/usr/bin/env -S uv run
"""
moongpt-harness 任务面板
用法: python3 dashboard.py [--port 8080]
"""

import json
import os
import glob
import argparse
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, render_template_string

app = Flask(__name__)
BASE = Path(__file__).parent

HTML = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>moongpt-harness 任务面板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; }
  .header { padding: 20px 32px; border-bottom: 1px solid #21262d;
            display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .updated { font-size: 12px; color: #7d8590; }
  .refresh-btn { background: #21262d; border: 1px solid #30363d; color: #e6edf3;
                 padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .refresh-btn:hover { background: #30363d; }
  .container { padding: 24px 32px; max-width: 1200px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .stat-card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 18px 20px; }
  .stat-card .label { font-size: 12px; color: #7d8590; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px; }
  .stat-card .value { font-size: 28px; font-weight: 700; }
  .stat-card .value.green { color: #3fb950; }
  .stat-card .value.yellow { color: #d29922; }
  .stat-card .value.red { color: #f85149; }
  .stat-card .value.blue { color: #58a6ff; }
  .section { background: #161b22; border: 1px solid #21262d; border-radius: 10px;
             padding: 20px; margin-bottom: 20px; }
  .section h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px;
                padding-bottom: 12px; border-bottom: 1px solid #21262d; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #7d8590; font-weight: 500;
       font-size: 12px; border-bottom: 1px solid #21262d; }
  td { padding: 10px 12px; border-bottom: 1px solid #161b22; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px;
           font-size: 11px; font-weight: 600; }
  .badge-open      { background: #388bfd26; color: #58a6ff; }
  .badge-fixing    { background: #d2992226; color: #d29922; }
  .badge-closed    { background: #3fb95026; color: #3fb950; }
  .badge-needs-human { background: #f8514926; color: #f85149; }
  .badge-merged    { background: #8957e526; color: #bc8cff; }
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
  .project-card .kv .v { color: #e6edf3; max-width: 200px; overflow: hidden;
                          text-overflow: ellipsis; white-space: nowrap; }
  .log-box { background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
             padding: 12px; font-family: monospace; font-size: 12px; color: #7d8590;
             max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
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
<div class="container">
  <!-- Stats -->
  <div class="grid" id="stats"></div>
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
  <!-- Projects -->
  <div class="section">
    <h2>项目配置</h2>
    <div class="project-grid" id="projects-wrap"></div>
  </div>
  <!-- Logs -->
  <div class="section">
    <h2>Agent 日志（最近 30 行）</h2>
    <div class="log-tabs">
      <button class="log-tab active" onclick="showLog('test')">test</button>
      <button class="log-tab" onclick="showLog('fix')">fix</button>
      <button class="log-tab" onclick="showLog('master')">master</button>
    </div>
    <div class="log-box" id="log-box">加载中...</div>
  </div>
</div>

<script>
let currentLog = 'test';

async function loadAll() {
  document.getElementById('ts').textContent = '更新于 ' + new Date().toLocaleTimeString('zh');
  const [state, projects, logs] = await Promise.all([
    fetch('/api/state').then(r=>r.json()),
    fetch('/api/projects').then(r=>r.json()),
    fetch('/api/logs?agent=' + currentLog).then(r=>r.json()),
  ]);
  renderStats(state);
  renderIssues(state.issues || []);
  renderPRs(state.prs || []);
  renderProjects(projects);
  document.getElementById('log-box').textContent = logs.content || '（无日志）';
}

function showLog(agent) {
  currentLog = agent;
  document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  fetch('/api/logs?agent=' + agent).then(r=>r.json()).then(d => {
    document.getElementById('log-box').textContent = d.content || '（无日志）';
  });
}

function badge(cls, text) {
  return `<span class="badge badge-${cls}">${text}</span>`;
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
    <div class="stat-card"><div class="label">上次测试</div><div class="value" style="font-size:14px;padding-top:6px;">${lastRun}</div></div>
  `;
}

function renderIssues(issues) {
  if (!issues.length) { document.getElementById('issues-wrap').innerHTML = '<p class="none-tip">暂无 issue</p>'; return; }
  const rows = issues.map(i => `
    <tr>
      <td><a href="https://github.com/chainupcloud/dex-ui/issues/${i.github_number}" target="_blank">#${i.github_number}</a></td>
      <td>${i.title}</td>
      <td>${badge('p'+i.priority.toLowerCase(), i.priority)}</td>
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
  if (!projects.length) { document.getElementById('projects-wrap').innerHTML = '<p class="none-tip">无项目配置</p>'; return; }
  document.getElementById('projects-wrap').innerHTML = projects.map(p => `
    <div class="project-card">
      <div class="name">${p.name}</div>
      <div class="kv"><span class="k">仓库</span><span class="v">${p.github?.owner}/${p.github?.repo}</span></div>
      <div class="kv"><span class="k">fix 分支</span><span class="v">${p.github?.fix_base_branch}</span></div>
      <div class="kv"><span class="k">生产域名</span><span class="v"><a href="https://${p.vercel?.production_domain}" target="_blank">${p.vercel?.production_domain}</a></span></div>
      <div class="kv"><span class="k">Staging</span><span class="v">${p.vercel?.staging_domain ? `<a href="https://${p.vercel.staging_domain}" target="_blank">${p.vercel.staging_domain.split('.')[0]}...</a>` : '待配置'}</span></div>
      <div class="kv"><span class="k">激活环境</span><span class="v">${p.test?.active_env}</span></div>
    </div>`).join('');
}

loadAll();
setInterval(loadAll, 30000);
</script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML)

@app.route('/api/state')
def api_state():
    issues_file = BASE / 'state' / 'issues.json'
    prs_file = BASE / 'state' / 'prs.json'
    data = {}
    if issues_file.exists():
        d = json.loads(issues_file.read_text())
        data['issues'] = d.get('issues', [])
        data['last_test_run'] = d.get('last_test_run')
    if prs_file.exists():
        data['prs'] = json.loads(prs_file.read_text()).get('prs', [])
    return jsonify(data)

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
    from flask import request
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
