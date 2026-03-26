# PR 自动化流程

## 架构说明

moongpt-harness 是**通用 CI/CD 自动化仓库**，可对接多个项目。

Issue 跟踪在各**项目仓库**（如 `chainupcloud/dex-ui`），moongpt-harness 只负责流水线。

---

## 完整流水线

```
moongpt-harness 发现问题 → 在项目仓库开 Issue
    ↓
Claude Code 定位修复，在项目仓库创建 PR（关联项目 Issue）
    ↓
PR 页面 → Reviewers → 选择 Copilot
    ↓
Copilot 完成 review（COMMENTED 即视为通过）
    ↓
dex-ui dispatch.yml → repository_dispatch → moongpt-harness pipeline.yml
    ↓
自动 squash merge ✓ → Vercel 部署 → commit SHA 验证 ✓
```

---

## Workflow 配置（两层架构）

### 第一层：项目仓库 dispatcher

**文件位置**：`chainupcloud/dex-ui` → `.github/workflows/dispatch.yml`

**职责**：收到 `pull_request_review` 事件 → 转发 `repository_dispatch` 到 moongpt-harness

**所需 Secret**：`HARNESS_DISPATCH_TOKEN`（有 moongpt-harness dispatch 权限的 PAT）

### 第二层：moongpt-harness pipeline

**文件位置**：`chainupcloud/moongpt-harness` → `.github/workflows/pipeline.yml`

**职责**：
1. 判断触发条件（Copilot review 或 APPROVED）
2. Squash merge 项目 PR
3. Vercel API 触发 production 部署
4. 轮询验证 commit SHA 已上线

**所需 Secrets**：`DEX_UI_TOKEN`、`VERCEL_TOKEN`

**触发条件**：
- 任意 reviewer `APPROVED`
- `copilot-pull-request-reviewer[bot]` 提交任意 review（含 COMMENTED）

---

## PR 命名规范

| 类型 | 标题格式 | 示例 |
|------|----------|------|
| Bug 修复 | `fix: {描述} (#{issue-id})` | `fix: redirect /app to /trade (#7)` |
| CI/工具 | `ci: {描述}` | `ci: dispatch to harness pipeline` |
| 功能 | `feat: {描述}` | `feat: add market filter` |

## 关联 Issue 格式

PR body 中写（Issue 在**项目仓库**，不在 moongpt-harness）：

```
closes chainupcloud/dex-ui#{issue-number}
```

合并后自动关闭项目仓库对应的 Issue。

---

## 注意事项

1. **dispatch.yml 必须在 base 分支（main）上**才能对 PR 生效
2. **分支冲突**：若 PR 分支与 main 有冲突，先 `git rebase origin/main` 再 push
3. **Copilot review 触发**：每个 PR 需手动在 Reviewers 选择 Copilot，暂不支持全自动请求
4. **合并后**：删除 fix 分支，项目仓库对应 Issue 通过 `closes` 关键字自动关闭

---

## dex-ui Issue 跟踪

| Issue | PR | 状态 |
|-------|----|------|
| dex-ui#1 /app 路径 404 | dex-ui#3 | ✅ 已合并 |
| dex-ui#7 多页面同标题 SEO | - | 🔴 待修复 |
| dex-ui#8 /dashboard 页面空白 | - | 🔴 待修复 |
| dex-ui#9 测试网仅 1 个市场 | - | 🟡 P4 待观察 |
