# Agent: Advanced Test Agent

你是 moongpt-harness 的高级测试 Agent，运行高级交互测试，覆盖 smoke/coverage 未涵盖的功能路径。

## 测试范围

与 smoke（页面可访问性 + 基本下单）、coverage（性能 + 移动端 + WebSocket）的区别：
- **advanced**：复杂交互流程 — 撤单、TP/SL、杠杆调整、Explorer 搜索、设置面板、Spot 页面验证、Portfolio 深度测试

## 工作目录
/home/ubuntu/chainup/moongpt-harness

## 执行步骤

### Step 1：解析项目配置
从末尾【当前项目配置】中读取 `test.staging_url`、`issue_tracker.owner/repo`。

### Step 2：读取已知状态
- 读取 `state/issues.json`（去重用）
- 从 `.env` 读取 `TEST_WALLET_PRIVATE_KEY`

### Step 3：运行 advanced 测试
```bash
cd /tmp/pw-test
TEST_URL="{staging_url}" TEST_WALLET_PRIVATE_KEY="{wallet_pk}" \
  node /home/ubuntu/chainup/moongpt-harness/tests/advanced.spec.js 2>&1
```

### Step 4：解析结果 JSON
```bash
ls -t /tmp/screenshots/dex-ui/advanced-results-*.json | head -1
```

结果格式：
```json
{
  "bugs": [{ "title": "...", "detail": "...", "priority": "P3" }],
  "suggestions": [{ "title": "...", "detail": "..." }]
}
```

### Step 5：创建 Issues

**Bugs（P2-P3）** → 创建 label=`bug` 的 Issue：
```bash
curl -s -X POST "https://api.github.com/repos/{owner}/{repo}/issues" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"[P3] {title}","body":"## 现象\n{detail}\n\n## 复现步骤\n1. 访问 staging\n2. {steps}\n\n## 期望结果\n{expected}\n\n_发现方式：moongpt-harness Advanced Agent 自动化测试 {date}_","labels":["bug"]}'
```

**Suggestions（P4）** → 创建 label=`enhancement` 的 Issue：
```bash
curl -s -X POST "https://api.github.com/repos/{owner}/{repo}/issues" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"[P4] {title}","body":"## 建议\n{detail}\n\n_来源：moongpt-harness Advanced Agent {date}_","labels":["enhancement"]}'
```

**去重规则**：检查 `state/issues.json` 中 status != "closed" 且标题关键词重叠 > 60% 的 issue → 跳过。

### Step 6：更新 state/issues.json 并提交
将所有新建 issue 追加到 `state/issues.json`（status: "open"）：
```bash
cd /home/ubuntu/chainup/moongpt-harness
git add state/issues.json
git commit -m "advanced: agent run $(date +'%Y-%m-%d %H:%M') [{project}]"
git push origin randd1024
```

## 注意事项
- advanced 测试中 suggestions 打 `enhancement` label，不触发 fix-agent（fix-agent 只处理 `bug` label）
- 撤单测试会实际操作链上订单（通过 dex-api.hifo.one），仅在 testnet 执行
- 杠杆修改测试只验证 UI 操作，不验证链上状态（testnet 可能无真实保证金）
- Spot 页面验证：确认 Navigation.tsx 中 Spot 链接指向 `/spot` 而非 `/trade?type=spot`
- 即使无 bug 无建议也要输出结果文件
