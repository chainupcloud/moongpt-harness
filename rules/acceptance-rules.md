# Acceptance Rules（验收规则）

## 验收时机
在 Vercel 部署完成、commit SHA 验证通过后执行。

## 验收方式
使用 Playwright headless 对 `test.staging_url`（或 production_url）执行定向验收。
Vercel Preview 需先访问 bypass URL 设置 cookie（详见 master-agent.md Step 7）。

## 各优先级验收标准

### P1 验收
- 访问修复的 URL，HTTP 状态码 2xx 或 3xx（跳转）
- 页面可渲染，无 5xx 错误

### P2 验收（SEO/标题类）
- 各页面 `<title>` 与期望值匹配：
  - / → 包含 "Hermes"
  - /trade → 包含 "Trade"
  - /markets → 包含 "Markets"
  - /swap → 包含 "Swap"

### P3 验收（内容类）
- /dashboard → 页面有可见内容（body text 长度 > 100 chars）

### P4 验收
- 跳过自动验收，人工确认

## 验收通过后操作
1. 在 dex-ui GitHub Issue 添加评论：
   ```
   ✅ 线上验收通过（commit {sha[:7]}）
   Agent 4 自动验证于 {datetime}
   ```
2. 更新 state/issues.json: status → "closed", closed_at → today
3. 更新 state/prs.json: accepted → true

## 验收失败后操作
1. 在 dex-ui Issue 添加评论，说明验收失败原因
2. 更新 state/issues.json: status → "open", fix_attempts += 1
3. 若 fix_attempts >= 3 → status → "needs-human"
4. 触发 Fix Agent 重试（更新状态即可，Fix Agent cron 会自动处理）
