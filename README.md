# moongpt-harness

moongpt.ai（Hermes DEX）AI 自动化测试与修复流水线。

## 项目定位

全流程 AI 驱动的质量保障体系：

```
用户维度测试 → 发现问题 → Claude Code Fix → Review 发布 → 线上验证
```

## 目录结构

| 目录/文件 | 说明 |
|-----------|------|
| `explore-*.md` | 界面探索报告 |
| `issues-*.md` | 问题跟踪记录 |
| `test-*.md` | 自动化测试报告 |
| `tests/` | Playwright 测试脚本 |
| `fixes/` | Claude Code 修复记录 |
