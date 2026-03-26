# CLAUDE.md

## 概述

moongpt.ai（Hermes DEX）AI 自动化测试与修复流水线。

全流程：**用户维度测试 → 发现问题 → Claude Code Fix → Review 发布 → 线上验证**

## 文件命名规范

- 探索报告：`explore-{YYYYMMDD}.md`
- 测试报告：`test-{模块}-{YYYYMMDD}.md`
- 问题记录：`issues-{YYYYMMDD}.md`
- 修复记录：`fixes/fix-{issue-id}-{YYYYMMDD}.md`
- 测试脚本：`tests/{模块}-{场景}.spec.js`

## 文档结构

- 探索报告：概述 → 网络/钱包配置 → 页面结构 → 交易流程 → 发现问题
- 测试报告：测试目标 → 环境 → 用例 → 结果 → 截图 → 结论
- 问题记录：优先级 → 现象 → 复现步骤 → 根因 → 修复状态

## 流水线说明

1. **测试**：Playwright headless / Synpress（含钱包）自动化测试
2. **问题**：记录到 issues-{date}.md，标注优先级 P1~P4
3. **修复**：Claude Code 定位并修复，记录到 fixes/ 目录
4. **Review**：PR 到 randd1024 分支，人工 review 后合并
5. **验证**：线上回归，截图存档
