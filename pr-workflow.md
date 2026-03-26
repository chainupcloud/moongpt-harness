# PR 自动化流程

## 完整流水线

```
Claude Code 发现/修复 bug
    ↓
git push origin fix/{issue-id}
    ↓
创建 PR（关联 moongpt-harness Issue）
    ↓
PR 页面 → Reviewers → 选择 Copilot
    ↓
Copilot 完成 review（COMMENTED 即视为通过）
    ↓
GitHub Actions 自动 squash merge ✓
```

## Auto-merge Workflow 配置

**文件位置**：`chainupcloud/dex-ui` → `.github/workflows/auto-merge.yml`

**触发条件**：
- 任意 reviewer `APPROVED`
- `copilot-pull-request-reviewer[bot]` 提交任意 review（含 COMMENTED）

**合并方式**：squash merge

**所需权限**：`contents: write`、`pull-requests: write`（使用 `GITHUB_TOKEN`，无需额外配置）

## PR 命名规范

| 类型 | 标题格式 | 示例 |
|------|----------|------|
| Bug 修复 | `fix: {描述} (#{issue-id})` | `fix: redirect /app to /trade (#3)` |
| CI/工具 | `ci: {描述}` | `ci: add auto-merge workflow` |
| 功能 | `feat: {描述}` | `feat: add market filter` |

## 关联 Issue 格式

PR body 中写：

```
closes chainupcloud/moongpt-harness#{issue-number}
```

合并后自动关闭 moongpt-harness 中对应的 Issue。

## 注意事项

1. **workflow 必须在 base 分支（main）上**才能对 PR 生效，首次需手动合并 workflow PR
2. **分支冲突**：若 PR 分支与 main 有冲突，先 `git rebase origin/main` 再 push
3. **Copilot review 触发**：每个 PR 需手动在 Reviewers 选择 Copilot，暂不支持全自动请求
4. **合并后**：删除 fix 分支，更新 moongpt-harness 对应 Issue 状态

## 已处理的 Issue

| Issue | PR | 状态 |
|-------|----|------|
| moongpt-harness#1 /app 路径 404 | dex-ui#3 | ✅ 已合并 |
