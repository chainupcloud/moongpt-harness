# Test Agent 规则

## 【铁律】自动化测试只在 Staging 环境执行

所有自动化测试（Test Agent、验收测试）**只针对 staging 环境**，严禁对 production 执行写操作或破坏性测试。

测试 URL 始终从项目配置 `test.staging_url` 读取，`active_env` 应保持 `"staging"`。
生产环境（moongpt.ai）不做自动化测试，仅人工访问确认。

## 测试范围

### Smoke Tests（每次必跑）
1. 首页加载，HTTP 200，基本元素可见
2. /trade 页面可访问，无报错
3. /markets 页面可访问
4. /app → /trade 重定向（301）
5. 各页面 `<title>` 唯一且有意义（非 "Hermes | Trade everything..."）

### Regression Tests（已知 issue 回归）
对 state/issues.json 中 status=closed 的 issue 执行定向验证，确保未退化。

### 探索性测试（有余力时）
- 检查控制台 JS 错误
- 检查页面无明显空白区域
- 检查关键 API 端点响应

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

_发现方式：moongpt-harness Agent 1 自动化测试 {日期}_
```

labels: bug（P1/P2/P3）或 enhancement（P4）
