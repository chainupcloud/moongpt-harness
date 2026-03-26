# Fix Agent 规则

## 工作目录
- dex-ui 本地路径: /home/ubuntu/chainup/dex-ui
- 仓库: chainupcloud/dex-ui
- 目标分支: main（PR base）
- 工作分支命名: fix/issue-{github_number}

## Issue 优先级处理顺序
P1 > P2 > P3 > P4

每次运行只处理**一个** issue，优先级最高的 status="open" issue。

## Fix 流程

```
1. 读取 state/issues.json，选取优先级最高的 open issue
2. 检查是否已存在同名分支（避免重复工作）
3. cd /home/ubuntu/chainup/dex-ui
4. git fetch origin && git checkout main && git pull origin main
5. git checkout -b fix/issue-{github_number}
6. 读取 GitHub issue 内容（通过 curl GitHub API）
7. 分析问题，定位相关代码文件，实施修复
8. git add <changed files> && git commit -m "fix: {描述} (#{ github_number})"
9. git push origin fix/issue-{github_number}
10. 创建 PR（curl GitHub API）
    - title: fix: {issue title} (#{github_number})
    - body: "closes chainupcloud/dex-ui#{github_number}"
    - base: main, head: fix/issue-{github_number}
11. 请求 Copilot review（curl GitHub API）
12. 更新 state/issues.json: status → "fixing", pr_number → {new_pr_number}
13. 更新 state/prs.json: 添加新 PR 记录
14. cd /home/ubuntu/chainup/moongpt-harness
15. git add state/ && git commit -m "state: issue #{github_number} → fixing" && git push origin randd1024
```

## 代码规范（dex-ui）
- 语言：TypeScript + Next.js 14 App Router
- 注释：中文
- 不引入新依赖，优先使用已有组件
- 修改后不运行 build（CI 验证），但可运行 lint：`yarn lint`

## 安全约束
- 只修改 /home/ubuntu/chainup/dex-ui 下的文件
- 禁止修改 .github/workflows/
- 禁止 git push --force
- fix_attempts 达到 3 次仍失败 → 将 status 改为 "needs-human"，停止尝试

## GitHub API（使用 GH_TOKEN 环境变量）

```bash
# 读取 issue
curl -s "https://api.github.com/repos/chainupcloud/dex-ui/issues/{number}" \
  -H "Authorization: token $GH_TOKEN"

# 创建 PR
curl -s -X POST "https://api.github.com/repos/chainupcloud/dex-ui/pulls" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"...","body":"...","head":"fix/issue-N","base":"main"}'

# 请求 Copilot review
curl -s -X POST "https://api.github.com/repos/chainupcloud/dex-ui/pulls/{pr}/requested_reviewers" \
  -H "Authorization: token $GH_TOKEN" \
  -d '{"reviewers":["copilot-pull-request-reviewer[bot]"]}'
```
