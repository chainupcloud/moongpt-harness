---
slug: moongpt-harness
source: 原创
created: 2026-04-16
---

# moongpt-harness 深度分析报告

> 主题 slug: `moongpt-harness`

## 背景与目标

moongpt-harness 是一个 AI 驱动的全自动 CI/CD 流水线系统，使用 4 个 AI Agent（基于 Claude Code CLI）实现"发现 bug → 自动修复 → 代码审查 → 部署验收 → 关闭 Issue"的完整闭环。项目始于 2026-03-26，至今运行约 3 周。

**核心目标**：用 AI Agent 替代人工 QA + 初级开发的 bug-fix 循环，实现 7x24 不间断的质量保障。

**当前接入项目**：
| 项目 | 状态 | Issues | PRs | 场景数 |
|------|------|--------|-----|--------|
| dex-ui (Next.js 前端) | 活跃运行 | 189 | 146 | 1,434 |
| dex-sui (Rust 后端) | 只读/fix_disabled | 0 | 0 | 15 |
| pm-cup2026 (Go 后端) | 起步 | 1 | 0 | 0 |

---

## 追问框架

### 必答 1：失败模式

**最可能的失败模式按概率排序：**

1. **状态文件膨胀与数据一致性（高概率 × 高影响）**
   - `backlog.json` 已达 789KB / 16,766 行 / 1,434 条场景，且以每次 explore 追加 3-5 条的速度持续增长。按当前频率（每 10 分钟），每天追加 ~720 条，一个月后将超过 2 万条，JSON 文件将达数 MB。
   - 所有 Agent 通过 `python3 json.load()` → 修改 → `json.dump()` 操作状态文件，无事务保护。虽有 flock 文件锁（`scripts/run-agent.sh:39-53`），但锁的粒度是"同类 Agent 互斥"，explore 和 master 可同时写 `issues.json`（explore 写 issues 开新 issue，master 写 issues 关闭 issue），存在 read-modify-write 竞态。
   - 事实支撑：explore 锁 `backlog.json.lock`（`run-agent.sh:42`），master 锁 `prs.json.lock`（`run-agent.sh:41`），但两者都可能修改 `issues.json`。

2. **场景质量退化（高概率 × 中影响）**
   - explore-agent 每次自动追加 3-5 条新场景（`explore-agent.md:137-178`），这些场景由 Sonnet 4.6 生成，无人工审核。1,434 条场景中 1,404 条由 explore-agent 生成，30 条来源不明。
   - 当前 409 条 pending、135 条 failed、202 条 skipped。skipped 占比 14%，说明相当一部分场景受环境限制无法执行，属于"无效库存"。
   - 场景 ID 已用到 E999（`backlog.json` 分析结果），存在 ID 空间管理隐患。

3. **Claude API 成本失控（中概率 × 高影响）**
   - fix-agent 使用 Opus 4.6（`run-agent.sh:60`），max-turns=60；master-agent max-turns=80。单次 Opus 调用的 token 消耗显著。
   - 按当前调度：explore 每 10 分钟（Sonnet）、fix 每 30 分钟（Opus）、master 每 10 分钟（默认模型）。虽然 run-agent.sh 有前置检查（fix 无 open issue 则跳过、master 无 open PR 则跳过），但 explore 无跳过机制，每次必定消耗 tokens。
   - 本周 master 跑了 688 次，大部分应为"无 open PR → 0 tokens"的快速退出，但仍有 shell 层面的 GitHub API 调用开销。

4. **安全边界不完整（低概率 × 高影响）**
   - fix-agent 的 `--allowedTools "Bash,Read,Write,Edit,Glob,Grep"`（`run-agent.sh:218`）允许 Bash 执行任意命令。虽然 `fix-rules.md` 声明"禁止修改 .github/workflows/"和"禁止 force push"，但这依赖 AI 遵守 prompt 指令而非技术强制。
   - `.env` 中包含 `GH_TOKEN` 和 `VERCEL_TOKEN`，通过 `export $(grep -v '^#' .env | xargs)` 注入所有 Agent 环境（`run-agent.sh:66-67`），任何 Agent 均可读取。

### 必答 2：6 个月后评价

**乐观场景**（如果持续投入）：
- 这是一个高度前瞻性的实践。Anthropic 在 2026-03-20 发布了 Claude Code Remote Tasks，行业正在向"AI Agent 即服务"方向演进。moongpt-harness 提前 1 周就实现了类似的自托管方案，且已跑出 189 个 issue / 143 个合并 PR 的实绩。6 个月后回看，这将是团队积累 AI DevOps 经验的宝贵起点。

**悲观场景**（如果不改进基建）：
- JSON 文件状态管理将成为明显债务。backlog.json 可能膨胀到数十 MB，每次 Agent 运行都要解析全量 JSON，拖慢响应。
- 场景无限增长但质量未经治理，"测试噪音"将淹没真实发现。135 条 failed 场景 + 202 条 skipped 场景 = 337 条"死库存"，占比 23.5%。
- "早知道就该在第 1 个月加入场景过期/归档机制和结构化数据库"——这是最可能的回顾遗憾。

---

## 1. 架构成熟度评估

### 当前阶段：**成熟 PoC → 早期 MVP**

| 维度 | PoC 特征 | MVP 要求 | 当前状态 |
|------|----------|----------|----------|
| 状态存储 | JSON 文件 | 数据库（SQLite 起步） | JSON 文件 (PoC) |
| 并发控制 | 无 | 文件锁或数据库事务 | flock 文件锁，粒度不足 (PoC→MVP) |
| 可观测性 | tail -f 日志 | 结构化日志 + 面板 | Flask dashboard + 原始日志 (MVP) |
| 调度 | crontab | 调度器 + 重试 + 熔断 | crontab + shell 前置检查 (PoC→MVP) |
| 多项目支持 | 硬编码 | 配置驱动 | JSON 配置驱动 (MVP) |
| 安全边界 | prompt 约束 | 技术强制 | prompt 约束 (PoC) |
| 错误恢复 | 手动 | 自动重试 + 告警 | 3 次失败 → needs-human (MVP) |
| 测试自身 | 无 | 有 | 无 (PoC) |

**具体差距**：

**从 PoC 到 MVP 需要解决的**：
- 状态从 JSON 迁移到 SQLite（消除并发竞态、支持查询）
- backlog 场景的生命周期管理（过期、归档、质量评分）
- 结构化日志 + 告警（当前只有原始日志文件）
- Agent 运行的成本追踪（每次记录 token 用量）

**从 MVP 到 Production 需要解决的**：
- 真正的任务队列替代 crontab
- Agent Bash 权限的技术隔离（sandbox/container）
- 自动化的回归测试覆盖 harness 本身
- 多实例部署 + HA
- secrets 管理（非 .env 文件 export）

### 架构亮点（事实陈述）

1. **多项目配置化**（`projects/*.json`）：接入新项目只需复制配置文件，不改代码。已实际接入 3 个项目。
2. **前置检查节省成本**（`run-agent.sh:83-202`）：fix 和 master agent 在 shell 层面先检查是否有工作要做，无则跳过 Claude 调用（"0 tokens used"）。
3. **锁机制防重入**（`run-agent.sh:34-53`）：同类 Agent 不会并发运行。
4. **场景自增长**：explore-agent 每次执行后自动补充新场景，实现了测试覆盖的"自我复制"。从初始几十条增长到 1,434 条。
5. **状态机清晰**：issue 状态流转 open → fixing → closed / needs-human，有明确的回退路径。

---

## 2. ROI 量化分析

### 投入估算

**Claude API 成本**（基于调度频率和模型推算）：

| Agent | 模型 | 频率 | 每次估算 tokens | 日调用次数 | 日成本估算 |
|-------|------|------|----------------|-----------|-----------|
| explore | Sonnet 4.6 | 每 10 分钟 | ~50K input + 10K output | 144 | ~$14.4 |
| fix | Opus 4.6 | 每 30 分钟 | ~100K input + 20K output (有工作时) | ~3-5 次有效 | ~$15-25 |
| master | 默认模型 | 每 10 分钟 | ~30K (有工作时) | ~3-5 次有效 | ~$3-5 |
| plan | Sonnet 4.6 | 每周一次 | ~80K | 0.14/天 | ~$0.1 |

**估算日均 API 成本**：$32-44/天，月均 $960-1,320。

注：explore 无"无工作则跳过"的前置检查，每次必跑。fix/master 大部分调用被 shell 前置检查拦截（0 tokens）。实际成本高度依赖 open issue 数量。

**基建成本**：
- 服务器：1 台 Ubuntu 机器（已有）
- 人力：项目搭建约 1 人周，日常维护极低（needs-human 仅 2 个）

### 产出量化

| 指标 | 数值 | 说明 |
|------|------|------|
| Issue 发现 | 189 个（21 天） | 9 个/天 |
| Issue 自动关闭 | 168 个 (88.9%) | |
| PR 合并 | 143 个 (97.9%) | |
| 需人工介入 | 2 个 (1.06%) | |
| 平均修复时间 | 0.4 天（中位数 0 天） | 当日发现当日修复 |
| 测试场景增长 | ~30 → 1,434 | 自动增长 47x |

**等效人力**：
- 若由人工 QA + 初级开发完成同等工作量（189 个 bug 发现 + 143 个 PR 提交 + 验收），保守估算需 1 名全职 QA + 0.5 名开发，月薪合计约 $8,000-12,000。
- API 成本 $960-1,320/月 vs 人力 $8,000-12,000/月 = **成本节省约 85-90%**。

**但需注意**：
- 189 个 issue 中 P3 占 144 个 (76.2%)，P4 占 29 个 (15.3%)。真正的高优先级 bug（P1+P2）仅 16 个 (8.5%)。
- P3 以下问题在人工 QA 流程中通常不会单独建 issue，存在"过度 issue 化"的倾向。
- 当前配置已调整为仅 P1/P2 建 issue（`explore-agent.md:108-109`），但历史 P3/P4 issue 已存在于系统中。

### ROI 结论

以 3 周运行数据看，**投入产出比为正**，但绝对值取决于对 P3/P4 issue 的价值判断。如果只计 P1/P2 的 16 个高价值 issue，ROI 会显著降低。

---

## 3. 演进路线图

### Phase 1（1 个月内）— 稳固基建

| 优先级 | 改进项 | 理由 | 工作量估算 |
|--------|--------|------|-----------|
| P0 | backlog 场景归档/过期机制 | 789KB JSON 持续膨胀，每天 +700 条场景不可持续 | 2 天 |
| P0 | explore 添加"空闲则跳过"前置检查 | 当前每 10 分钟必跑 Sonnet，pending < 5 条时应跳过 | 0.5 天 |
| P1 | 状态迁移到 SQLite | 消除 JSON 竞态，支持查询，降低 IO | 3 天 |
| P1 | 每次 Agent 运行记录 token 用量 | 无法量化成本就无法优化 | 1 天 |
| P2 | 场景去重/质量清理 | 202 条 skipped + 135 条 failed 需要治理 | 1 天 |

### Phase 2（3 个月内）— 能力扩展

| 优先级 | 改进项 | 理由 |
|--------|--------|------|
| P1 | dex-sui 后端测试全面启用 | 当前 15 个场景 + fix_disabled，后端覆盖为零 |
| P1 | 告警通知（Telegram/Slack） | needs-human 或 fix 连续失败时应主动通知 |
| P2 | 评估迁移到 Claude Code Remote Tasks | Anthropic 官方方案，消除自托管维护负担 |
| P2 | Agent 运行 sandbox 化 | 用 Docker 或 nsjail 隔离 Bash 执行 |
| P3 | CI 测试覆盖 harness 自身 | 当前 harness 无任何自测 |

### Phase 3（6 个月内）— 规模化

| 优先级 | 改进项 | 理由 |
|--------|--------|------|
| P1 | 从 crontab 迁移到任务队列 | 支持动态调度、重试、优先级排队 |
| P2 | 多机分布式运行 | 当前单机，Agent 排队等待 |
| P3 | 场景智能裁剪 | 基于历史 pass rate 自动降低低价值场景的优先级 |
| P3 | 开源/产品化评估 | 如果 3 个月后运行稳定，考虑是否对外输出 |

---

## 4. 风险矩阵

### 概率 × 影响 2x2 矩阵

```
            影响：低                    影响：高
概率高  ┌──────────────────────┬─────────────────────────────┐
        │ [4] 场景质量退化      │ [1] 状态文件膨胀/竞态        │
        │     (噪音增多)        │     (数据丢失/不一致)        │
        │ 缓解：过期+归档机制   │ 缓解：迁移 SQLite            │
        │                      │                             │
        │ [5] explore 空转消耗  │ [2] API 成本超预期           │
        │     (浪费 tokens)     │     (Opus 调用累积)          │
        │ 缓解：空闲跳过检查    │ 缓解：token 计量 + 预算告警   │
        ├──────────────────────┼─────────────────────────────┤
概率低  │ [6] 场景 ID 空间耗尽  │ [3] Agent 执行越权操作       │
        │     (E999 后需新规则) │     (误删代码/泄露 token)    │
        │ 缓解：改用递增数字 ID │ 缓解：sandbox + 最小权限     │
        │                      │                             │
        │                      │ [7] Copilot review 形同虚设  │
        │                      │     (COMMENTED=通过，无实质审查│)
        │                      │ 缓解：增加静态分析 gate       │
        └──────────────────────┴─────────────────────────────┘
```

**各风险详情**：

| # | 风险 | 概率 | 影响 | 缓解措施 | 相关文件 |
|---|------|------|------|----------|----------|
| 1 | JSON 状态文件并发写入导致数据不一致 | 高 | 高 | 迁移到 SQLite 或添加全局写锁 | `run-agent.sh:34-53` |
| 2 | Claude API 月账单超 $2,000 | 中 | 高 | 添加 token 计量，设预算告警 | `run-agent.sh:57-62` |
| 3 | Agent 通过 Bash 执行危险操作 | 低 | 高 | sandbox 隔离，收紧 allowedTools | `run-agent.sh:218` |
| 4 | 自动生成场景重复/低质量 | 高 | 低 | 场景过期机制 + 质量评分 | `explore-agent.md:137-178` |
| 5 | explore 在无 pending 场景时仍消耗 tokens | 高 | 低 | 添加 shell 前置检查 | `run-agent.sh`（无检查） |
| 6 | 场景 ID 用尽 E999 | 低 | 低 | 改用 E+4 位数或递增数字 | backlog.json 分析 |
| 7 | Copilot review 缺乏实质审查能力 | 中 | 中 | 增加 lint/type-check/build CI gate | `master-agent.md:149` |

---

## 5. 与行业趋势的对齐

### 行业现状（2026 Q1-Q2）

1. **Anthropic Claude Code Remote Tasks**（2026-03-20 发布）：官方支持"定义 repo + prompt + schedule → 云端自动运行"，与 moongpt-harness 的自托管方案直接对标。moongpt-harness 实际上在 Remote Tasks 发布前 6 天就开始了类似实践。

2. **AI Agent in CI/CD 已成主流趋势**：Fortune 500 企业开始将 AI Agent 嵌入 CI/CD 流水线，用于自动 triage、自动 fix、自动 review。moongpt-harness 的四 Agent 闭环与行业方向一致。

3. **竞品对比**：

| 维度 | moongpt-harness | Claude Code Remote Tasks | GitHub Copilot Autofix |
|------|----------------|------------------------|----------------------|
| 托管方式 | 自托管 (crontab + bash) | Anthropic 云托管 | GitHub 云托管 |
| 覆盖范围 | 发现 + 修复 + 审查 + 部署 + 验收 | 单任务执行 | 仅修复 |
| 测试生成 | 自动生成 + 自增长 | 需手动定义 | 不支持 |
| 多项目 | 支持 | 支持 | 按 repo |
| 成本控制 | 自行管理 | Anthropic 定价 | GitHub 定价 |
| 成熟度 | PoC/早期 MVP | 正式产品 | 正式产品 |

### 独特价值

moongpt-harness 的**独特价值在于"测试场景自增长"机制**——explore-agent 每次运行后自动追加新场景，实现了测试覆盖的指数级增长。这在行业现有方案中尚不多见。从 30 条初始场景增长到 1,434 条，是一个值得关注的能力。

### 对齐度评价

与 AI-native DevOps 趋势**高度对齐**。方向正确，执行节奏领先行业平均水平。主要差距在工程化成熟度（状态管理、安全隔离、可观测性），而非方向性。

---

## 6. 决策建议

### 建议：**继续投入，同时优先加固基建**

**理由**：

1. **方向正确且有实绩**：3 周内跑出 189 issue / 143 合并 PR / 88.9% 自动闭合率，证明了可行性。需人工介入仅 2 个 (1.06%)。

2. **成本效率高**：估算月 API 成本 $960-1,320 vs 等效人力 $8,000-12,000，节省 ~85%。

3. **先发优势**：在 Claude Code Remote Tasks 发布前就已实现类似能力，团队已积累了 3 周的 AI Agent 运维经验，这些经验在行业中属于稀缺资产。

4. **边际投入递减**：核心框架已建成，后续改进（SQLite 迁移、告警、token 计量）属于工程优化，投入产出比高。

**附加条件**：
- Phase 1 的 P0 项（backlog 归档 + explore 空闲跳过）应在 1 周内完成，否则运行成本将不可控
- 建立月度 API 成本审计机制，设 $1,500/月 预算红线
- pm-cup2026 接入应在 dex-ui 稳定运行 1 个月后再推进，避免分散精力

---

## 开放问题清单（事实层）

1. **explore 和 master 对 `issues.json` 的写入是否存在并发冲突** — explore 锁 `backlog.json.lock`，master 锁 `prs.json.lock`，两者均可能修改 `issues.json`（explore 开新 issue，master 关闭 issue），无共享锁保护：`run-agent.sh:39-43`
2. **backlog.json 场景 ID 已用到 E999，超过后的 ID 分配规则未定义** — 当前代码 `explore-agent.md:157` 用 `f"E{max_id+1:03d}"` 格式化，E1000+ 将变为 4 位数，与现有 3 位格式不一致
3. **早期 126 个 issue 缺少 `created_at` 字段**（189 个 issue 中仅 63 个有 created_at），导致修复时间统计样本偏小：`state/dex-ui/issues.json`
4. **Copilot COMMENTED 被视为"通过"（`master-agent.md:149`），但 COMMENTED 不等于 APPROVED**，Copilot 的 review 是否具有实质审查能力需要评估
5. **fix-agent 的 Bash 工具无白名单过滤**，`--allowedTools "Bash,Read,Write,Edit,Glob,Grep"`（`run-agent.sh:218`）允许执行任意 shell 命令，安全边界仅依赖 prompt 约束
6. **pm-cup2026 项目 `staging_url` 为 null**（`projects/pm-cup2026.json:13`），master-agent 将跳过 UI 验收，仅做 SHA 验证，闭环不完整
7. **backlog 中 12 条 backend 场景（track=backend）但 dex-sui 的 fix_disabled=true**，后端 bug 发现后无法自动修复，需要人工流转

---

## FAQ

### Q1: 如果不用数据库（当前是 JSON），还有其他更好的办法吗？希望状态存储是轻量级的。

**核心结论**：真正的痛点不是 JSON 格式本身，而是 (1) 缺乏归档导致的无限膨胀 (2) flock 粒度与实际写操作不匹配。最小可行改进是**先加归档 + 修复锁粒度**，不需要更换存储格式。

**现状数据**（dex-ui 项目，最大项目）：

| 文件 | 大小 | 记录数 | 可归档比例 |
|------|------|--------|-----------|
| backlog.json | 812KB | 1434 scenarios | 71.4%（1025 条已完结） |
| issues.json | 98KB | 189 issues | 88.9%（168 条已 closed） |
| prs.json | 64KB | ~60 PRs | - |

dex-sui 项目状态文件很小（backlog 7KB），膨胀问题仅存在于 dex-ui。

**锁粒度实际漏洞**（事实）：
- explore-agent 写 issues.json 时无 flock 保护（只持 backlog.json.lock）：`scripts/run-agent.sh:41`，`agents/explore-agent.md:186`
- master-agent 写 backlog.json 时只持 prs.json.lock：`agents/master-agent.md:220`
- run-agent.sh 的 master pre-check 写 issues.json 无任何 flock：`scripts/run-agent.sh:137-193`

**八种方案对比**（按改造成本/收益比排序，非推荐）：

| 方案 | 并发安全 | 查询能力 | 膨胀控制 | 实现复杂度 | Git 兼容 | Agent 改动量 |
|------|:-------:|:-------:|:-------:|:---------:|:-------:|:----------:|
| **1. JSON + 归档** | 低→中(加全局锁) | 不变 | 好(归档) | 极低 | 好 | 几乎无 |
| **8. JSON 分片**（按状态拆文件） | 中 | 按状态分片 | 好(冷热分离) | 中 | 好 | 部分重写 |
| 2. JSONL | 中(追加安全) | 流式 | 需 compact | 中 | 好(追加) | 全部重写 |
| 7. 每记录一文件 | 高 | 需遍历 | 天然分散 | 高 | 中(文件多) | 全部重写 |
| 3. NDJSON + WAL | 中 | 复杂 | 需 compact | 高 | 中 | 全部重写 |
| 4. TOML/YAML | 低 | 不变 | 无改善 | 中(无收益) | 中 | 全部重写 |
| 5. CSV/TSV | 中(追加) | 弱 | 需 compact | 高(数据结构不匹配) | 好 | 全部重写 |
| 6. Git 作为存储 | 低 | 不变 | 无改善 | 无 | 差(膨胀) | 无 |

**方案 1（JSON + 归档）详细说明**：
- 思路：保持 JSON 格式不变，定期把已完结记录移到 `state/{project}/archive/` 子目录
- 预期效果：backlog 812KB → ~60KB（409 条 pending），issues 98KB → ~10KB（21 条活跃）
- 改造面：新增 `archive.py` (~50 行) + 一个 cron 条目，Agent prompt 无需修改
- 可顺手改 flock 为全局锁（~5 行 shell）解决跨 Agent 竞态

**为什么不是 JSONL/每记录一文件**：Agent prompt 中的 JSON 操作代码是**内联 Python**（写在 Markdown 里，无共享模块），存储格式变更需逐个修改 4 个 Agent prompt 文件，改造成本远超收益。

---

### Q2: crontab 如果改成 Claude Code 最新功能的 Monitor 会更好吗？

**核心结论**：Claude Code 原生调度**无法完整替代 crontab**，但可以做有价值的补充。真正的痛点是**响应延迟**（explore 发现 bug 后 fix 要等 30 分钟），不是资源浪费（shell 层空转 2-3 秒 + 零 token）。

**Claude Code 原生调度能力全景**（2026-04-16）：

| 机制 | 持久性 | 最小间隔 | 本地文件访问 | Linux 支持 | 状态 | 致命问题 |
|------|--------|---------|-------------|-----------|------|---------|
| `/loop` + CronCreate | 否（session-scoped，7天过期） | 1分钟 | 是 | 是 | GA | 退出即消亡 |
| Monitor 工具 | 否（session-scoped） | 事件驱动 | 是 | 是 | GA | 依附 session |
| Desktop Scheduled Tasks | 是 | 1分钟 | 是 | **否** | GA | 不支持 Linux |
| Routines（云端） | 是 | **1小时** | 否（fresh clone） | 是 | Research Preview | 间隔不够 + 无本地文件 |
| Channels | 否 | 事件驱动 | 是 | 是（需 Bun） | Research Preview | 需自建 plugin |

**反直觉发现**：空转成本其实很低。分析 `run-agent.sh`：

| Agent | 频率 | 前置检查 | 实际调 Claude 比例 |
|-------|------|---------|------------------|
| master | 每 10 分钟 | 检查 open PR 数，为 0 则跳过 | 估计 <5% |
| fix | 每 30 分钟 | 检查 open issue 数，为 0 则跳过 | 估计 <20% |
| explore | 每 10 分钟 | **无前置检查** | ~100% |
| plan | 每周一 | 无前置检查 | ~100% |

**五种方案对比**（非推荐）：

| 方案 | 改造面 | 调度灵活性 | 可靠性 |
|------|-------|-----------|-------|
| **A. crontab + shell trigger 文件** | ~10 行 shell | 现有轮询 + 事件驱动补充 | 最高（OS 级） |
| B. 长驻 Claude session + /loop/Monitor | 大改 | 动态自选间隔 | 单点故障风险 |
| C. Routines 云端 | architecture 级重构 | GitHub event 触发 | 依赖 Preview 状态 |
| D. crontab + 自建 webhook server | 新增 ~200 行服务 | 完全事件驱动 | 依赖自建服务 |
| E. crontab + Channels plugin | 新增 plugin + 重构 | 事件驱动 | Research Preview 依赖 |

**方案 A 最小改动示例**：
- explore 发现 bug 后：`touch state/dex-ui/.fix-trigger`
- fix 的 cron 改为每 5 分钟检查 trigger 文件，存在则启动，不存在则退出
- 效果：bug 发现到修复延迟从最长 30 分钟降到最长 5 分钟，零新依赖

**开放事实层问题**：
- master agent 实际 Claude 调用率未量化（run-agent.sh 有 skip 日志但未统计）
- state/ 文件是否已纳入 Git 管理（决定 Routines 方案可行性前提）
- chainupcloud/dex-ui 的 GitHub webhook 管理权限（决定方案 D 可行性）

---

*分析基于 2026-04-16 代码快照和状态数据。*

**行业参考来源**：
- [Zero Bugs in CI/CD: The Agentic Revolution of 2026](https://www.getautonoma.com/blog/zero-bugs-cicd)
- [Claude Code Remote Tasks: Run AI Agents 24/7](https://www.computeleap.com/blog/claude-code-remote-tasks-cloud-ai-agents-2026/)
- [Claude Code Q1 2026 Update Roundup](https://www.mindstudio.ai/blog/claude-code-q1-2026-update-roundup-2)
- [AI Agents in CI/CD Pipelines for Continuous Quality](https://www.mabl.com/blog/ai-agents-cicd-pipelines-continuous-quality)
