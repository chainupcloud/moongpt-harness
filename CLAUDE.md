# CLAUDE.md — moongpt-harness

## 定位

**通用 AI 驱动 CI/CD 流水线仓库**，与具体项目解耦。

当前接入项目：`dex-ui`（chainupcloud/dex-ui，Hermes DEX，moongpt.ai）

---

## 四 Agent 流水线

```
Agent 1: test-agent   → 每 6h，Playwright 测试，发现 bug → 项目仓库开 Issue
Agent 2: fix-agent    → 每 30min，读 state/issues.json，自动 fix → PR + 请 Copilot review
Agent 3: Copilot      → GitHub PR review（由 Agent 2 自动 request）
Agent 4: master-agent → 每 15min，检查 review → merge → Vercel 部署 → 验收 → 关闭 Issue
```

**Issue 跟踪在项目仓库**（如 chainupcloud/dex-ui），moongpt-harness 只管流水线。

---

## 目录结构

```
projects/          # 项目配置（每个项目一个 JSON 文件）
  dex-ui.json      # dex-ui 配置（仓库、分支、Vercel、测试 URL）
  template.json    # 新项目接入模板

agents/            # Claude Code CLI prompt（各 Agent 的执行指令）
  test-agent.md
  fix-agent.md
  master-agent.md

rules/             # 规则定义（测试范围、修复约束、验收标准）
  test-rules.md
  fix-rules.md
  acceptance-rules.md

state/             # 流水线状态（单一数据源，每次运行后提交到 randd1024）
  issues.json      # issue 状态：open / fixing / closed / needs-human
  prs.json         # PR 状态：open / merged，含 SHA、是否 deployed/accepted

tests/             # Playwright 测试脚本
  smoke.spec.js    # 基础 smoke 测试
  acceptance.spec.js # 验收测试（Master Agent 调用）

design/            # 设计文档
  pipeline-design.md

logs/              # 运行日志（gitignored）
.env               # 密钥（gitignored）：GH_TOKEN, VERCEL_TOKEN
run-agent.sh       # Agent 统一启动脚本
```

---

## 运行方式

```bash
# 手动触发
bash run-agent.sh test dex-ui
bash run-agent.sh fix dex-ui
bash run-agent.sh master dex-ui

# 日志查看
tail -f logs/fix-agent.log
```

系统 crontab 已配置自动运行（test: 6h / fix: 30min / master: 15min）。

---

## 项目配置文件（projects/{name}.json）

所有 Agent prompt 从项目配置文件读取，不使用硬编码值。关键字段：

| 字段 | 说明 |
|------|------|
| `github.fix_base_branch` | PR base 分支（dex-ui 为 dev） |
| `vercel.project_id` | Vercel 项目 ID |
| `vercel.staging_domain` | Staging 域名（null = 待配置） |
| `test.staging_url` | 测试目标 URL（null 时用 production_url） |
| `test.active_env` | 当前激活环境（staging / production） |

**新增项目**：复制 `projects/template.json`，填写配置，无需修改 agent 代码。

---

## State 文件规范

`state/issues.json` 的 issue 状态流转：

```
open → fixing → closed
          ↓（fix_attempts >= 3）
       needs-human
```

每次 Agent 修改 state 后必须 git commit + push 到 randd1024。

---

## Git 规范

- harness 自身变更提交到 `randd1024` 分支
- dex-ui 修复分支基于 `dev`，前缀 `fix/issue-{N}`
- 禁止直接推送 main/master
