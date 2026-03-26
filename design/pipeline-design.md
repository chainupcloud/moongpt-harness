# 四 Agent 自动化流水线设计

## 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  Agent 1: UI Test Agent                                          │
│  运行位置：moongpt-harness GitHub Actions (cron 定时)             │
│  工具：Playwright headless Chromium                               │
│  产出：dex-ui 中创建 Issue（带截图、复现步骤、优先级）              │
└────────────────────┬─────────────────────────────────────────────┘
                     │ issue_opened → webhook → dispatch
┌────────────────────▼─────────────────────────────────────────────┐
│  Agent 2: Fix Agent                                              │
│  运行位置：moongpt-harness GitHub Actions (on: issues)            │
│  工具：Claude Code CLI（需 ANTHROPIC_API_KEY）                    │
│  产出：dex-ui 中创建 PR，自动请求 Copilot review                   │
└────────────────────┬─────────────────────────────────────────────┘
                     │ pull_request_review (Copilot COMMENTED)
┌────────────────────▼─────────────────────────────────────────────┐
│  Agent 3: PR Review (Copilot)                                    │
│  运行位置：GitHub Copilot（自动请求，无需人工）                     │
│  触发方式：Agent 2 创建 PR 时 API 自动 request review              │
└────────────────────┬─────────────────────────────────────────────┘
                     │ dex-ui dispatch.yml → repository_dispatch
┌────────────────────▼─────────────────────────────────────────────┐
│  Agent 4: Master Control                                         │
│  运行位置：moongpt-harness pipeline.yml                           │
│  步骤：squash merge → Vercel deploy → 验证 commit SHA             │
│        → Playwright 页面验收 → 关闭 dex-ui Issue                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Agent 1：UI Test Agent

**文件**：`.github/workflows/test-agent.yml`

**触发方式**：
- 定时：每 6 小时（`cron: '0 */6 * * *'`）
- 手动：`workflow_dispatch`

**执行逻辑**：
```
1. 启动 Playwright headless Chromium
2. 访问 moongpt.ai，执行测试用例集（tests/ 目录）
3. 收集失败项（截图 + 错误信息）
4. 去重检查：查询 dex-ui open issues，标题相同则跳过
5. 新失败项 → 调用 GitHub API 在 dex-ui 创建 Issue
   - title: [P{级别}] {问题描述}
   - body: 现象 + 截图 + 复现步骤 + 测试用例 ID
   - labels: bug, automated
```

**测试用例结构**（`tests/` 目录）：
```
tests/
  smoke/
    home-load.spec.js       # 首页加载、标题、基本元素
    navigation.spec.js      # 主要页面路由可访问性
    trade-ui.spec.js        # 交易界面基础元素
  regression/
    app-redirect.spec.js    # /app → /trade 重定向
    page-titles.spec.js     # 各页面独立 title
    dashboard.spec.js       # /dashboard 页面内容
```

**所需 Secrets**：`DEX_UI_TOKEN`（创建 issue 权限）

---

## Agent 2：Fix Agent

**文件**：`.github/workflows/fix-agent.yml`

**触发方式**：
```yaml
on:
  issues:
    types: [opened]
    # 仅处理 dex-ui 的 issues（通过 repository_dispatch 转发）
```

实际触发链路：dex-ui issue_opened → dispatch to moongpt-harness（需在 dex-ui 加 issue-dispatch.yml）

**执行逻辑**：
```
1. 接收 issue 信息（title + body + number）
2. git clone chainupcloud/dex-ui
3. 运行 claude code CLI：
   claude --print -p "Fix issue #N: {title}\n\n{body}" \
     --allowedTools "Read,Write,Edit,Bash(git:*)" \
     --max-turns 20
4. git push origin fix/issue-{N}
5. 创建 PR：
   - title: fix: {issue title} (#{N})
   - body: closes chainupcloud/dex-ui#{N}
6. API 请求 Copilot review
```

**所需 Secrets**：
- `ANTHROPIC_API_KEY`（Claude Code CLI）
- `DEX_UI_TOKEN`（clone + push + PR 权限）

---

## Agent 3：PR Review（Copilot）

**无需新 workflow**，由 Agent 2 创建 PR 时自动触发：

```bash
# Agent 2 创建 PR 后，立即调用：
curl -X POST \
  "https://api.github.com/repos/chainupcloud/dex-ui/pulls/{PR_NUMBER}/requested_reviewers" \
  -H "Authorization: token $DEX_UI_TOKEN" \
  -d '{"reviewers": ["copilot-pull-request-reviewer[bot]"]}'
```

Copilot 完成 review（COMMENTED 视为通过）→ 触发 dex-ui dispatch.yml

---

## Agent 4：Master Control（扩展现有 pipeline.yml）

在现有 merge + deploy + verify 基础上，新增两步：

**步骤 4a：Playwright 页面验收**
```
- 针对当前 Issue 的修复点执行定向验收
- 例如 Issue #7（page title）→ 验证各页面 title 已正确
- 验收通过 → 继续
- 验收失败 → PR 作者（Claude Code）收到通知，重新触发 Fix Agent
```

**步骤 4b：关闭 Issue**
```
- PR 的 closes 关键字已在 squash merge 时自动关闭 Issue
- 额外：添加验收通过评论：
  "✅ 已验证线上 commit {sha[:7]}，页面验收通过，Issue 关闭。"
```

---

## 各 Agent 当前状态

| Agent | 状态 | 缺少 |
|-------|------|------|
| Agent 1: UI Test | ❌ 未建 | test-agent.yml，tests/ 用例集 |
| Agent 2: Fix | ❌ 未建 | fix-agent.yml，ANTHROPIC_API_KEY |
| Agent 3: Copilot | 🟡 手动 | Agent 2 自动请求 review |
| Agent 4: Master | 🟡 部分 | 验收测试步骤，issue 评论 |

---

## 实施顺序

### Phase 1（当前可做）
1. 补全 `tests/` 测试用例（smoke + regression）
2. 建 `test-agent.yml`（cron 触发，跑测试，自动开 issue）
3. 扩展 `pipeline.yml`：加验收测试 + issue 评论

### Phase 2（需要 ANTHROPIC_API_KEY）
4. 建 `fix-agent.yml`（Claude Code 自动 fix）
5. 建 `dex-ui/issue-dispatch.yml`（issue 事件转发到 moongpt-harness）
6. Agent 2 自动请求 Copilot review

### Phase 3（完整闭环验证）
7. 端到端测试：人为注入 bug → Agent 1 发现 → Agent 2 修 → Agent 3/4 上线 → 验收关闭

---

## 关键约束

- **Claude Code CLI in CI**：需要 `ANTHROPIC_API_KEY`，月用量按 token 计费
- **Copilot bot reviewer**：API 方式请求 review 需确认 bot 账号名称（当前已知：`copilot-pull-request-reviewer[bot]`）
- **Fix Agent 安全边界**：只允许修改 `dex-ui` 仓库，限制 `--allowedTools`，禁止 `Bash(rm:*)` 等危险操作
- **无限循环防护**：Fix Agent 修复失败不应重试超过 3 次，否则标记 issue 为 `needs-human`
