# moongpt-harness

通用 AI 驱动的 CI/CD 自动化流水线，对接多个前端项目，实现从测试发现到自动修复上线的闭环。

## 架构

```
Agent 1 (test)    每 6h    Playwright 测试 → 发现 bug → 开 Issue
Agent 2 (fix)     每 30min 读取 open issue → Claude Code 修复 → 提 PR → 请 Copilot review
Agent 3 (Copilot)          GitHub Copilot PR review（自动触发）
Agent 4 (master)  每 15min PR review 通过 → merge → Vercel 部署 → 验收 → 关闭 Issue
```

Issue 跟踪在**项目仓库**（如 chainupcloud/dex-ui），harness 只负责自动化流程。

## 快速上手

```bash
# 手动触发 Agent
bash run-agent.sh test dex-ui
bash run-agent.sh fix dex-ui
bash run-agent.sh master dex-ui

# 查看日志
tail -f logs/fix-agent.log
```

## 接入新项目

1. 复制 `projects/template.json` → `projects/{project-name}.json`
2. 填写 github / vercel / test / issue_tracker 字段
3. 更新 crontab：`crontab -e`，添加三条 Agent 定时任务

## 目录

```
projects/          项目配置文件
agents/            Agent 执行 prompt（Claude Code CLI 读取）
rules/             测试、修复、验收规则
state/             流水线状态（issues.json / prs.json）
tests/             Playwright 测试脚本
design/            架构设计文档
logs/              运行日志（gitignored）
.env               密钥（gitignored）
run-agent.sh       Agent 启动脚本
```

## 当前接入项目

| 项目 | 仓库 | 生产域名 | Staging |
|------|------|----------|---------|
| dex-ui | chainupcloud/dex-ui | moongpt.ai | 待配置 |

## 状态说明

issue 状态：`open` → `fixing` → `closed`（失败超 3 次变为 `needs-human`）
