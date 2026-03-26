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
.env               密钥（gitignored，参考 .env.example）
.env.example       密钥模板
run-agent.sh       Agent 启动脚本
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
bash run-agent.sh test dex-ui    # 立即跑一次 UI 测试
bash run-agent.sh fix dex-ui     # 立即跑一次修复
bash run-agent.sh master dex-ui  # 立即跑一次 merge/部署/验收
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
