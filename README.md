# moongpt-harness

通用 AI 驱动的 CI/CD 自动化流水线，对接多个前端/后端项目，实现从测试发现到自动修复上线的闭环。

## 架构

```
plan-agent    每周一   扫描前端组件 + 后端 API，分析覆盖缺口，生成 10-20 条新测试场景
explore-agent 每 2h    从背板取 4 条 pending 场景执行，发现 bug 开 Issue，自动扩充背板 3-5 条
fix-agent     每 2h    读取最高优先级 open issue → Claude Code 修复 → 提 PR → 请 Copilot review
master-agent  每 1h    PR review 通过 → squash merge → Vercel 部署 → Playwright 验收 → 关闭 Issue
```

测试分两个 track：
- `frontend`：Playwright UI 测试，issue 提到 `chainupcloud/dex-ui`
- `backend`：dex-cli 命令行测试，issue 提到 `chainupcloud/dex-sui`

## 目录结构

```
agents/                  Agent 执行 prompt（Claude Code CLI 读取）
  explore-agent.md       → 探索测试，背板驱动，自动扩充
  plan-agent.md          → 覆盖分析，生成新测试场景
  fix-agent.md           → 自动修复 open issue
  master-agent.md        → PR merge / 部署 / 验收
projects/                项目配置
  dex-ui.json            → dex-ui 项目（GitHub / Vercel / issue tracker / backend 配置）
state/{project}/         每项目独立状态
  issues.json            → issue 去重和状态跟踪
  prs.json               → PR 跟踪
  backlog.json           → 测试场景背板（E=前端, B=后端）
  schedule.json          → explore 轮转调度状态
rules/                   agent 行为规则（test / fix / acceptance）
scripts/                 Shell 入口
  run-agent.sh           单次 Agent 启动（含 master 预检同步）
  run-scheduler.sh       轮转调度（cron 每 2h 调用）
  run-all.sh             顺序运行所有 Agent
dashboard/               Web 状态面板（Flask，端口 5050）
docs/                    架构文档和搭建指南
logs/                    运行日志（gitignored）
.env                     密钥（gitignored，参考 .env.example）
```

## 快速上手

```bash
# 手动触发 Agent
bash scripts/run-agent.sh explore dex-ui   # 探索测试（4 个场景）
bash scripts/run-agent.sh plan dex-ui      # 覆盖分析 + 生成新场景
bash scripts/run-agent.sh fix dex-ui       # 修复最高优先级 issue
bash scripts/run-agent.sh master dex-ui    # merge / 部署 / 验收

# 手动触发一次轮转调度
bash scripts/run-scheduler.sh dex-ui

# 查看日志
tail -f logs/scheduler.log
tail -f logs/fix-agent.log
tail -f logs/master-agent.log
```

## Crontab

```
0 */2 * * *                scripts/run-scheduler.sh dex-ui    # explore 每 2h
0 1,3,5,7,9,11,...,23 * *  scripts/run-agent.sh fix dex-ui    # fix 每 2h（奇数时）
30 * * * *                 scripts/run-agent.sh master dex-ui  # master 每 1h
0 3 * * 1                  scripts/run-agent.sh plan dex-ui    # plan 每周一
```

## 接入新项目

1. 复制 `projects/dex-ui.json` → `projects/{project}.json`，填写各字段
2. 创建 `state/{project}/` 目录，初始化 `issues.json`、`prs.json`、`backlog.json`、`schedule.json`
3. 向 crontab 添加对应行，传入新的 `{project}` 参数

## 当前接入项目

| 项目 | 仓库 | Staging |
|------|------|---------|
| dex-ui | chainupcloud/dex-ui | hermes-testnet-git-dev-chainupclouds-projects.vercel.app |

## 密钥配置

```bash
cp .env.example .env
# 填入 GH_TOKEN 和 VERCEL_TOKEN
```

`.env` 已加入 `.gitignore`，严禁提交真实 token。

## 状态说明

issue 状态：`open` → `fixing` → `closed`（修复失败 ≥3 次变为 `needs-human`）

backlog 场景状态：`pending` → `tested` / `failed` / `skipped`（issue closed 后 failed 重置为 pending）

## 人工操作手册

### 需要人工介入的场景

**1. issue 变为 `needs-human`（修复失败 3 次）**
```bash
# 将 state 中对应 issue 重置为 open
vim /home/ubuntu/chainup/moongpt-harness/state/dex-ui/issues.json
# 修改 status 为 "open"，fix_attempts 清零
git add state/ && git commit -m "state: manual reset issue #N" && git push origin randd1024
```

**2. 查看实时日志**
```bash
tail -f /home/ubuntu/chainup/moongpt-harness/logs/fix-agent.log
tail -f /home/ubuntu/chainup/moongpt-harness/logs/master-agent.log
```

**3. 查看任务面板**
访问 `http://{服务器IP}:5050`

**4. Vercel staging 说明**
- Staging 基于 `dev` 分支，修复 PR 合并到 `dev` 后自动触发部署
- Vercel Authentication 已关闭（公开可访问，Playwright 可直接测试）

**5. Copilot review 说明**
- fix-agent 创建 PR 后 Copilot 自动触发 review
- master-agent 识别 Copilot COMMENTED 即视为通过，执行 merge
