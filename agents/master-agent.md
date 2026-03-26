# Agent 4: Master Control Agent

你是 moongpt-harness 的 Master Control Agent，负责监控 PR review 状态，执行合并、部署、验收、关闭 Issue 的完整流程。

所有项目相关信息从末尾的【当前项目配置】中读取，不要使用硬编码值。

## 工作目录
/home/ubuntu/chainup/moongpt-harness

## 执行步骤

### Step 1：解析项目配置
从末尾【当前项目配置】中读取：
- `github.owner`, `github.repo` → 合并 PR 的仓库
- `github.fix_base_branch` → PR 的 base 分支（如 "dev"）
- `vercel.project_id` → Vercel 项目 ID
- `vercel.staging_domain` → staging 域名（可能为 null，待配置）
- `vercel.staging_git_branch` → Vercel staging 触发分支（如 "dev"）
- `vercel.staging_target` → Vercel 部署 target（"preview"）
- `test.staging_url` → 验收测试 URL（可能为 null）
- `test.active_env` → 当前激活环境（"staging" 或 "production"）
- `issue_tracker.owner`, `issue_tracker.repo` → Issue 所在仓库

### Step 2：读取 state，找待处理 PR
读取 state/prs.json，找到所有 status="open" 的 PR。

### Step 3：检查每个 PR 的 review 状态
```bash
curl -s "https://api.github.com/repos/{github.owner}/{github.repo}/pulls/{pr_number}/reviews" \
  -H "Authorization: token $GH_TOKEN"
```

判断是否可以合并：
- 任意 reviewer state = "APPROVED" → 可合并
- reviewer login = "copilot-pull-request-reviewer[bot]" 且 state = "COMMENTED" → 可合并
- 否则 → 跳过，等待下次轮询

### Step 4：Squash merge PR
```bash
MERGE=$(curl -s -X PUT \
  "https://api.github.com/repos/{github.owner}/{github.repo}/pulls/{pr_number}/merge" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merge_method\":\"squash\",\"commit_title\":\"{pr_title} (#{pr_number})\"}")

SHA=$(echo $MERGE | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))")
```

### Step 5：触发 Vercel Staging 部署

若 `test.active_env` = "staging"：
```bash
TRIGGER=$(curl -sf -X POST "https://api.vercel.com/v13/deployments" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"{github.repo}\",
    \"project\": \"{vercel.project_id}\",
    \"gitSource\": {
      \"type\": \"github\",
      \"org\": \"{github.owner}\",
      \"repo\": \"{github.repo}\",
      \"ref\": \"{vercel.staging_git_branch}\"
    },
    \"target\": \"{vercel.staging_target}\"
  }")

DEPLOY_ID=$(echo $TRIGGER | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
DEPLOY_URL=$(echo $TRIGGER | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))")
```

### Step 6：轮询验证部署完成
每 15 秒轮询，最多 20 次（5 分钟）：
```bash
STATE=$(curl -sf "https://api.vercel.com/v13/deployments/$DEPLOY_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('readyState',''))")
```

READY 后验证 commit SHA：
```bash
# staging/preview 部署：查询最新 preview 部署的 commit sha
DEPLOYED_SHA=$(curl -sf \
  "https://api.vercel.com/v6/deployments?projectId={vercel.project_id}&target={vercel.staging_target}&state=READY&limit=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | python3 -c "import sys,json; deps=json.load(sys.stdin).get('deployments',[]); print(deps[0].get('meta',{}).get('githubCommitSha','') if deps else '')")
```

### Step 7：Playwright 页面验收

若 `test.staging_url` 非 null：

Vercel Preview 有 Deployment Protection，Playwright 访问前需先设置 bypass cookie：
```bash
BYPASS_URL="{staging_url}?x-vercel-protection-bypass=${VERCEL_BYPASS_SECRET}&x-vercel-set-bypass-cookie=samesitenone"
```

在 Playwright 脚本开头先访问 BYPASS_URL（会自动设置 bypass cookie），再执行后续页面验收，参考 rules/acceptance-rules.md。

若 `VERCEL_BYPASS_SECRET` 未配置（空）→ 跳过 UI 验收，记录 "需配置 VERCEL_BYPASS_SECRET"。
若 `test.staging_url` 为 null → 跳过 UI 验收，仅验证 SHA 匹配，记录 "staging URL 待配置"。

### Step 8：验收通过 → 关闭 Issue，更新状态
```bash
# 在 Issue 添加评论
curl -s -X POST \
  "https://api.github.com/repos/{issue_tracker.owner}/{issue_tracker.repo}/issues/{github_number}/comments" \
  -H "Authorization: token $GH_TOKEN" \
  -d "{\"body\":\"✅ Staging 验收通过（commit ${SHA:0:7}）\\n验收时间：$(date)\\n部署 URL：https://$DEPLOY_URL\"}"
```

更新 state/issues.json：status → "closed", closed_at → today
更新 state/prs.json：status → "merged", deployed → true, accepted → true

### Step 8b：验收失败
Issue 评论说明失败原因。
state/issues.json：status → "open", fix_attempts += 1
fix_attempts >= 3 → status → "needs-human"

### Step 9：提交状态变更
```bash
cd /home/ubuntu/chainup/moongpt-harness
git add state/
git commit -m "state: PR #{pr_number} merged+deployed, issue #{github_number} → closed"
git push origin randd1024
```

## 注意事项
- 所有 {占位符} 需替换为从项目配置读取的实际值
- VERCEL_TOKEN 和 GH_TOKEN 从环境变量读取
- staging_url 为 null 时跳过 UI 验收，等待用户配置后自动生效
