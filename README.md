# moongpt-harness

通用 AI 驱动的 CI/CD 自动化流水线，对接多个前端项目，实现从测试发现到自动修复上线的闭环。

## 架构

```
Agent: scheduler  每 1h    轮转执行测试模块（smoke → coverage → ...）
Agent: smoke      轮转中   Playwright 快速测试（P1/P2）→ 发现阻断性 bug → 开 Issue
Agent: coverage   轮转中   Playwright 深度测试（P3/P4）→ 开 bug/enhancement Issue
Agent: fix        每 30min 读取 open bug issue → Claude Code 修复 → 提 PR → 请 Copilot review
Agent: Copilot               GitHub Copilot PR review（自动触发）
Agent: master     每 15min PR review 通过 → merge → Vercel 部署 → 验收 → 关闭 Issue
```

Issue 跟踪在**项目仓库**（如 chainupcloud/dex-ui），harness 只负责自动化流程。

### 测试模块轮转机制

`state/test-schedule.json` 记录模块列表、当前轮转位置和每模块执行次数。`run-scheduler.sh` 每小时被 cron 调用，读取当前模块 → 执行 → 推进到下一模块。

```
state/test-schedule.json:
{
  "modules": ["smoke", "coverage"],   ← 按此顺序轮转
  "current_index": 0,
  "run_counts": { "smoke": 5, "coverage": 5 },
  "last_runs": { "smoke": "2026-03-26T08:00:00Z", ... }
}
```

每个模块作为独立的 `run-agent.sh` 调用执行，拥有独立的 Claude 上下文，避免 session 溢出。

## 快速上手

```bash
# 手动触发 Agent
bash run-agent.sh smoke dex-ui      # 快速 smoke 测试
bash run-agent.sh coverage dex-ui   # 深度 coverage 测试
bash run-agent.sh fix dex-ui
bash run-agent.sh master dex-ui

# 运行所有测试模块（顺序执行）
bash run-all.sh dex-ui

# 手动触发一次轮转调度
bash run-scheduler.sh dex-ui

# 查看日志
tail -f logs/test-smoke.log
tail -f logs/test-coverage.log
tail -f logs/fix-agent.log
```

## 接入新项目

1. 复制 `projects/template.json` → `projects/{project-name}.json`，填写各字段
2. 在 `state/test-schedule.json` 的 `modules` 数组和 `run_counts` 对象中添加新模块名
3. 创建 `tests/{module}.spec.js` 和 `agents/{module}-agent.md`

无需修改 crontab 或 `run-scheduler.sh`。

## 添加新测试模块

1. `state/test-schedule.json` → `modules` 数组末尾追加模块名，`run_counts` 中补 `"新模块": 0`
2. `tests/{模块名}.spec.js` → 编写 Playwright 测试，参考 `smoke.spec.js`
3. `agents/{模块名}-agent.md` → 编写 Agent 执行 prompt，参考 `coverage-agent.md`

## 目录

```
projects/              项目配置文件
agents/                Agent 执行 prompt（Claude Code CLI 读取）
  test-agent.md        → smoke 测试（已重命名为 smoke-agent.md 别名）
  smoke-agent.md       → 快速测试，P1/P2 bug
  coverage-agent.md    → 深度测试，P3/P4 bug + enhancement 建议
  fix-agent.md         → 自动修复 open bug issue
  master-agent.md      → PR merge / 部署 / 验收
rules/                 测试、修复、验收规则
state/                 流水线状态
  issues.json          → issue 去重和状态跟踪
  prs.json             → PR 跟踪
  test-schedule.json   → 测试模块轮转调度状态
tests/                 Playwright 测试脚本
  smoke.spec.js        → 18 个 smoke 测试（~2min）
  coverage.spec.js     → 深度测试，输出 JSON 结果（~3min）
design/                架构设计文档
logs/                  运行日志（gitignored）
.env                   密钥（gitignored，参考 .env.example）
.env.example           密钥模板
run-agent.sh           单次 Agent 启动脚本
run-all.sh             顺序运行所有测试模块
run-scheduler.sh       轮转调度脚本（cron 每小时调用）
```

### 密钥配置

复制 `.env.example` 为 `.env` 并填入真实值：
```bash
cp .env.example .env
# 编辑 .env，填入 GH_TOKEN 和 VERCEL_TOKEN
```

**注意：`.env` 已加入 `.gitignore`，严禁提交真实 token 到 GitHub。**

## 当前接入项目

| 项目 | 仓库 | 生产域名 | Staging |
|------|------|----------|---------|
| dex-ui | chainupcloud/dex-ui | moongpt.ai | hermes-testnet-git-dev-chainupclouds-projects.vercel.app |

## 状态说明

issue 状态：`open` → `fixing` → `closed`（失败超 3 次变为 `needs-human`）

## 人工操作手册

### 日常无需操作
所有 Agent 定时自动运行，正常情况下全流程无人工干预。

### 需要人工介入的场景

#### 1. issue 变为 `needs-human`（修复失败 3 次）
打开 dex-ui GitHub Issues，查看具体 issue，人工修复后：
```bash
# 将 state 中对应 issue 重置为 open
vim /home/ubuntu/chainup/moongpt-harness/state/issues.json
# 修改 status 为 "open"，fix_attempts 清零
git add state/ && git commit -m "state: manual reset issue #N" && git push origin randd1024
```

#### 2. 手动触发某个 Agent
```bash
cd /home/ubuntu/chainup/moongpt-harness
bash run-agent.sh smoke dex-ui    # 立即跑一次 smoke 测试
bash run-agent.sh coverage dex-ui # 立即跑一次 coverage 测试
bash run-agent.sh fix dex-ui      # 立即跑一次修复
bash run-agent.sh master dex-ui   # 立即跑一次 merge/部署/验收
bash run-scheduler.sh dex-ui      # 手动触发一次轮转（跑当前模块并推进）
```

#### 3. 查看实时日志
```bash
tail -f /home/ubuntu/chainup/moongpt-harness/logs/fix-agent.log
tail -f /home/ubuntu/chainup/moongpt-harness/logs/master-agent.log
```

#### 4. 查看任务面板（Web UI）
访问 `http://{服务器IP}:5050`（IP 见内部文档，不提交到 GitHub）

#### 5. Vercel staging 说明
- Staging 域名：`hermes-testnet-git-dev-chainupclouds-projects.vercel.app`
- Vercel Authentication 已**关闭**（公开可访问，Playwright 可直接测试）
- staging 基于 `dev` 分支，所有修复 PR 合并到 `dev` 后自动触发 staging 部署

#### 6. Copilot review 说明
- 仓库已开启 "Automated code reviews on push"
- fix-agent 创建 PR 后 Copilot 自动触发 review，无需手动点击
- Master agent 识别 Copilot COMMENTED 即视为 review 通过，执行 merge
