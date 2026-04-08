# CLAUDE.md

## 你是谁

你是 moongpt-harness 的执行 Agent，通过 `scripts/run-agent.sh` 以 Claude Code CLI 方式被调用。

---

## 必读：当前运行上下文

每次被调用时，`scripts/run-agent.sh` 会在 prompt 末尾附加当前项目配置（JSON）。**所有项目相关值必须从该配置读取，禁止使用硬编码值。**

关键配置字段速查：
- `github.owner` / `github.repo` — 目标仓库
- `github.fix_base_branch` — PR base 分支（dex-ui = "dev"）
- `vercel.project_id` / `vercel.staging_target` — Vercel 部署参数
- `test.staging_url` — 验收 URL（null 则跳过 UI 验收）
- `issue_tracker.owner` / `issue_tracker.repo` — Issue 所在仓库
- `local_path` — 本地代码路径

---

## 状态文件操作规范

`state/{project}/issues.json` 和 `state/{project}/prs.json` 是唯一数据源（每个项目独立子目录，如 `state/dex-ui/`）。

**每次修改 state 后必须立即提交：**
```bash
cd /home/ubuntu/chainup/moongpt-harness
git add state/{project}/
git commit -m "state: <描述变更>"
git push origin randd1024
```

issue 状态只能按以下方向流转：
```
open → fixing → closed
fixing → needs-human（fix_attempts >= 3 时）
closed → open（验收失败时回滚，fix_attempts += 1）
```

---

## Git 操作约束

| 操作 | 规则 |
|------|------|
| harness 自身变更 | 提交到 `randd1024` 分支 |
| 项目修复分支 | 基于 `fix_base_branch`（读配置），前缀 `fix/issue-{N}` |
| push | 禁止 `--force`，禁止推送 `main/master` |
| 修改范围 | 禁止修改 `.github/workflows/` |

---

## 【铁律】自动化只在 Staging 执行

所有自动化测试和验收**只针对 staging 环境**（`test.staging_url`），严禁对 production 执行自动化操作。
生产环境仅人工访问，不做任何自动化写操作或验收。

---

## 环境变量

- `GH_TOKEN` — GitHub API（来自 .env）
- `VERCEL_TOKEN` — Vercel API（来自 .env）

---

## 关键路径

- harness 根目录：`/home/ubuntu/chainup/moongpt-harness`
- Playwright：`/tmp/pw-test/node_modules/playwright`
- 截图输出：`/tmp/screenshots/{project}/`
- Agent prompt：`agents/{name}-agent.md`
- 状态文件：`state/{project}/issues.json`, `state/{project}/prs.json`, `state/{project}/backlog.json`
- スケジュール：`state/{project}/schedule.json`
- 规则文件：`rules/{test,fix,acceptance}-rules.md`
- Shell 入口：`scripts/run-agent.sh`, `scripts/run-scheduler.sh`, `scripts/run-all.sh`
- 面板：`dashboard/app.py`
- 文档：`docs/architecture.md`, `docs/setup.md`

---

## 各 Agent 入口

被调用时读取对应 prompt 文件并执行：
- `explore-agent.md` — 探索测试，从背板取 pending 场景执行，发现 bug，开 Issue
- `plan-agent.md` — 分析功能覆盖，生成新测试场景写入背板
- `fix-agent.md` — 选取最高优先级 open issue，实施修复，提 PR
- `master-agent.md` — 检查 PR review，merge，部署，验收，关闭 Issue

---

## 系统 Crontab 调度

所有 agent 调度通过系统 crontab 管理，**不使用 Claude session cron**，重启后自动恢复。

### dex-ui

| Agent | 频率 | cron 表达式 |
|-------|------|-------------|
| explore | 每10分钟 | `*/10 * * * *` |
| fix | 每30分钟 | `*/30 * * * *` |
| master | 每10分钟（:05偏移） | `5,15,25,35,45,55 * * * *` |
| plan | 每周一 03:00 | `0 3 * * 1` |

### pm-cup2026

| Agent | 频率 | cron 表达式 |
|-------|------|-------------|
| fix | 每30分钟 | `*/30 * * * *` |
| master | 每30分钟（:15偏移） | `15,45 * * * *` |

修改调度频率请直接编辑系统 crontab（`crontab -e`），并同步更新此表。
