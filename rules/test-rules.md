# Test Agent 规则

## 【铁律】自动化测试只在 Staging 环境执行

所有自动化测试（Test Agent、验收测试）**只针对 staging 环境**，严禁对 production 执行写操作或破坏性测试。

测试 URL 始终从项目配置 `test.staging_url` 读取，`active_env` 应保持 `"staging"`。
生产环境（moongpt.ai）不做自动化测试，仅人工访问确认。

## 测试分层

### Smoke Tests（`smoke` 模块，每次约 2 分钟）
目标：快速通过/失败，只报 P1/P2 阻断性 bug。

**A 组 — 页面可访问性（9 项）**
1. 首页加载，HTTP 200，基本元素可见
2. /trade 页面可访问，无报错
3. /markets 页面可访问
4. /portfolio 页面可访问
5. /explorer 页面可访问
6. /spot 页面可访问
7. /app → /trade 重定向
8. 各页面 `<title>` 唯一且有意义
9. 无 JS 控制台错误

**B 组 — 实时数据（2 项）**
10. Order book 有价格数据
11. Markets 页面有市场数据

**C 组 — 钱包与交易（7 项）**
12. 钱包通过 EIP-6963 连接，账户地址可见
13. 账户余额可见
14. BTC Long 订单成功提交
15. Open Orders 标签页有记录
16. BTC Short 订单成功提交
17. Watchlist 显示市场列表
18. 订单金额小于 $10 时表单验证报错

### Coverage Tests（`coverage` 模块，每次约 3 分钟）
目标：深度测试，发现 P3/P4 问题，输出 enhancement 建议。

**性能**
- /trade、/portfolio、/explorer 页面加载时间（> 3000ms 记为 suggestion，> 5000ms 记为 P4 issue）

**附加页面**
- /api-keys、/terms、/privacy 可访问
- /404 返回友好错误页
- /spot 禁用提示可见

**移动端（390px 视口）**
- /trade、/markets 无横向溢出

**功能深度**
- Explorer 有区块/交易数据
- Market order 类型可切换
- Leverage 弹窗可打开
- 百分比按钮（25%）填充 size 输入
- Deposit/Withdraw 按钮可见
- WebSocket 实时价格存在

### Regression Tests（已知 issue 回归）
对 state/issues.json 中 status=closed 的 issue 执行定向验证，确保未退化。

## 优先级分类规则

| 优先级 | 标准 |
|--------|------|
| P1 | 核心功能不可用（页面 404/500、主交易流程中断） |
| P2 | 影响用户体验但不阻断核心流程（SEO、标题错误、内容异常） |
| P3 | 功能缺失或内容为空（dashboard 空白、功能按钮无效） |
| P4 | 改进建议、测试覆盖不足、非阻断性问题 |

## 去重规则

创建 issue 前检查 state/issues.json：
- 若存在 status != "closed" 且标题相似的 issue → 跳过，不重复创建
- 标题相似 = 关键词重叠超过 60%

## Issue 格式

### Bug Issue（P1/P2/P3，label: `bug`）
```
title: [P{级别}] {简短描述}
body:
## 现象
{具体描述}

## 复现步骤
1. ...
2. ...

## 期望结果
{应该是什么}

_发现方式：moongpt-harness {模块名} Agent 自动化测试 {日期}_
```

### Enhancement Issue（P4，label: `enhancement`）
```
title: [P4] {简短描述}
body:
## 建议
{detail}

_来源：moongpt-harness Coverage Agent {日期}_
```

**注意：** enhancement issue 仅由 coverage agent 创建，fix-agent 只处理 `bug` label 的 issue，不会自动修复 enhancement。
