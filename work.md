# 工作日志 [Work Log]

本文件是本仓库的审计账本 [Audit Ledger]。每次落盘修改必须追加一条记录，格式：

```
## YYYY-MM-DD HH:MM — 标题
- **问题** [Problem]：发现了什么问题 / 为什么要改
- **方案** [Solution]：用什么方式解决
- **文件** [Files]：修改了哪些文件
- **撤回** [Rollback]：如何还原
```

时区统一使用 Asia/Shanghai。

---

## 补记说明 [Backfill Note]

2026-08-12 之前的 31 个 commit 在提交时没有留下审计日志。以下条目由 `git log` 补记，
按开发阶段分组。每组给出该组的起止 commit，撤回方式以 commit SHA 为准。
补记内容基于 commit message 与代码现状还原，**不是当时的实时记录**，仅供追溯。

---

## 2026-08-08 18:03 — Milestone 0-1：骨架与 TUI 闭环

- **问题**：需要从零建立 Pi Extension 骨架，并按规格 §44 先打通纯 TUI 的结构化学习闭环，
  证明「模型调用工具 → 学习者作答 → 答案作为 tool result 返回」这条链路成立。
- **方案**：按规格 §39 的文件顺序实现 `types` → `protocol` → `InteractionBroker` → 三个
  `learning_ask_*` 工具 → `tutor-prompt` → `commands` → `index`，TUI 侧用 Pi 原生
  `ctx.ui.select / input / editor`。答案走 tool result，不走 `pi.sendUserMessage()`（规格 §13）。
- **文件**：`extension/**`、`tests/**`、`package.json`、`tsconfig.json`、`docs/architecture.md`
- **撤回**：`git revert c52a968`（初始提交，实际应为重建分支）

## 2026-08-10 09:45 — TUI 自定义编辑器测试补强

- **问题**：TUI 的多行 / 代码作答走 `ctx.ui.custom() + CustomEditor`，提交、Escape 取消、
  broker cancel 三条路径没有测试覆盖。
- **方案**：补 TUI presenter 单测覆盖三条路径；README 澄清编辑器行为差异。
- **文件**：`tests/tui-presenter.test.ts`、`README.md`
- **撤回**：`git revert d95793b`

## 2026-08-10 09:56 ~ 10:00 — Milestone 2：本地 HTTP/SSE 服务器

- **问题**：TUI 闭环无法提供 Monaco、公式渲染等 IDE 级体验，需要按规格 §9 引入本地 Web 服务。
- **方案**：实现 `LearningServer`（仅监听 `127.0.0.1`、bearer token 鉴权、静态资源、body 大小限制）
  与 `SseHub`（含 heartbeat，规格 §9.3）。修复 `interaction.resolved` 被广播两次的缺陷——
  改为只由 broker listener 广播一次。
- **文件**：`extension/server/learning-server.ts`、`extension/server/sse-hub.ts`、
  `tests/learning-server.test.ts`、`tests/learning-server-qa.test.ts`
- **撤回**：`git revert fb97980 c976387 a989178`（逆序）

## 2026-08-10 10:13 ~ 10:40 — Milestone 3-4：Web Workspace 与交互路由

- **问题**：需要把结构化交互真正渲染成 React 组件，并解决「Web 与 TUI 谁接管作答」的路由问题。
- **方案**：搭建 Vite + React workspace（SingleChoice / FreeResponse / CodeExercise / ProgressPanel）；
  `learning_ask_*` 每次调用时检查是否有活跃 SSE 客户端，有则走 Web、无则回退 TUI；
  等待期间 Web 断开则取消 Web pending 并转 TUI，避免 tool call 永久悬挂（规格 §33）。
  过滤纯空白的 tutor 消息，避免 transcript 出现空气泡。
- **文件**：`web/**`、`extension/tools/tui-presenter.ts`、`extension/transcript-sync.ts`、
  `tests/web-roundtrip.test.ts`、`README.md`、`HANDOFF.md`
- **撤回**：`git revert 6317ff3 7ef408b 2632698 2b33a91 ce1cdde`（逆序）

## 2026-08-10 11:07 ~ 11:14 — MultiChoice 全链路

- **问题**：规格 §2.1 要求 MultiChoice，但只有单选闭环。
- **方案**：新增 `learning_ask_multi_choice`，答案为 `optionIds: string[]`；Web 用 checkbox，
  TUI 因 pi-tui 无多选组件，改用循环选择 + 「✔ 完成」；服务端拒绝空选提交（规格 §22）。
- **文件**：`extension/tools/ask-multi-choice.ts`、`web/src/components/MultiChoice.tsx`、
  `extension/tools/tui-presenter.ts`、对应测试
- **撤回**：`git revert 95f3cb7 308ce03`（逆序）

## 2026-08-10 11:28 ~ 11:42 — Milestone 6：掌握度模型

- **问题**：掌握度不能靠解析模型的自然语言反馈（规格 §30），需要显式记录工具。
- **方案**：新增非阻塞的 `learning_record_attempt`，只接受 broker 已 resolved 且未记录过的
  interaction ID（防伪造 / 防重复提升）；按规格 §16.1 的透明 heuristic 更新 mastery，
  并加「超过 0.75 需最近连续正确中出现 ≥2 种 evidence 形式」的天花板规则。
- **文件**：`extension/tools/ask-record-attempt.ts`、`extension/state/learning-state.ts`、
  `extension/state/types.ts`、`tests/learning-state.test.ts`、`tests/record-attempt-tool.test.ts`
- **撤回**：`git revert 78ae235 075ae10`（逆序）

## 2026-08-10 11:55 ~ 12:32 — Milestone 5：流式 transcript 与 Markdown

- **问题**：学习者需要「主要看浏览器就能完成教学」（规格 §35 M5 验收），但 tutor 文本只在 TUI。
- **方案**：监听 `message_update` / `message_end`，100ms 节流后经 `tutor.message` 事件流式同步；
  只取 `text` 内容，不同步 reasoning（规格 §26 明令不得暴露 chain-of-thought）；
  transcript 用 marked 渲染 Markdown。补提交了上一里程碑遗留的 `ConceptState.recentOutcomes` 类型。
- **文件**：`extension/transcript-sync.ts`、`web/src/components/TutorTranscript.tsx`、
  `extension/state/types.ts`、`tests/transcript-sync.test.ts`、`README.md`、`HANDOFF.md`
- **撤回**：`git revert d0d1c3b 99323ec 99c703e edcfdea`（逆序）

## 2026-08-10 14:11 ~ 14:17 — 本地代码运行器（可注入）

- **问题**：规格 §25 要求代码执行必须有 runner 抽象 + 安全边界，不能直接 `exec(userCode)`。
- **方案**：实现 `CodeRunner` 接口与 `LocalCodeRunner`（独立临时目录、固定语言白名单、
  程序定义命令模板、超时、输出截断、事后清理）。修复语言查表的原型链污染风险
  （`__proto__` 等 key 会命中 Object.prototype）。
- **文件**：`extension/runner/code-runner.ts`、`tests/code-runner.test.ts`
- **撤回**：`git revert 2a0c5ad 4f5ee2b 59f08b2`（逆序）
- **备注**：该 runner **不是安全沙箱**，正式扩展默认不构造它（见 2026-08-11 条目）。

## 2026-08-10 14:29 ~ 15:02 — Milestone 7：KaTeX、只读区间、组件测试

- **问题**：数学公式无法渲染；代码题的 starter code 骨架会被学习者误删；Web 组件无单测。
- **方案**：`MathText` 在唯一 HTML 边界渲染 Markdown + KaTeX 并经 DOMPurify 清洗；
  Monaco 实现 `readOnlyRanges`；补齐组件单测。修复零宽度（collapsed caret）编辑能绕过
  只读区间的缺陷——区间相交判断需覆盖零宽度情形。
- **文件**：`web/src/components/MathText.tsx`、`web/src/components/CodeExercise.tsx`、
  `web/src/components/*.test.tsx`、`README.md`、`HANDOFF.md`
- **撤回**：`git revert 14ba679 aa3f58d 7cfbe8d cbe216d`（逆序）

## 2026-08-10 15:24 ~ 15:56 — 交互体验打磨

- **问题**：`/learn` 后还要手动复制 URL；模型输出的字面 `\n` 在题面里显示为转义字符；
  题面缺少上下文导致学习者看不懂题。
- **方案**：`/learn` 自动调用系统浏览器打开 workspace（失败不致命，只输出 URL，规格 §19）；
  题面按 Markdown 渲染并归一化字面 `\n`；tutor prompt 加第 12 条约束——
  每个 `learning_ask_*` 的题面必须自足，因为 Active Panel 只显示该参数内容，看不到聊天上文。
- **文件**：`extension/commands.ts`、`extension/utils/browser.ts`、`extension/tutor-prompt.ts`、
  `web/src/components/*.tsx`
- **撤回**：`git revert 3dc6cfb 32f0e0e 4b400c4`（逆序）

## 2026-08-11 13:53 ~ 13:54 — Provider 兼容与代码执行开关

- **问题**：`learning_record_attempt` 的枚举参数用 TypeBox `Type.Union([Type.Literal(...)])`
  生成 `anyOf/const` schema，Google provider 不支持；模型拿不到 `interactionId` 就无法记录 attempt。
- **方案**：改用 `@earendil-works/pi-ai` 的 `StringEnum`（规格 §11.6）；
  在四个 ask 工具的 result 中显式暴露 `interactionId`；
  代码执行默认禁用——未注入 runner 时 `/api/code/run` 返回 403 且 Web 隐藏 Run 按钮。
- **文件**：`extension/tools/ask-record-attempt.ts`、`extension/tools/ask-*.ts`、
  `extension/server/learning-server.ts`、`web/src/state/store.ts`
- **撤回**：`git revert 9f5a865 8ee9f0e`（逆序）

## 2026-08-11 15:15 — `/learn-reset`、allowSkip、phase 迁移

- **问题**：规格 §18 要求 `/learn-reset`；`allowSkip` 只是声明没有真正闭环；
  规格 §15 的 phase 状态机没有任何应用层迁移规则。
- **方案**：`/learn-reset` 经 `ctx.ui.confirm` 确认后清空当前 topic 的 concepts / attempts /
  幂等账本，保留 course/topic；skip 走 `broker.skip` 与 `POST /api/interactions/:id/skip`，
  以 `skipped: true` 结构化结果返回、不进入 submit 校验；抽出 `nextPhase` 纯函数驱动 phase 迁移。
- **文件**：`extension/commands.ts`、`extension/state/learning-state.ts`、
  `extension/server/interaction-broker.ts`、`extension/server/learning-server.ts`、
  `extension/tools/tui-presenter.ts`、`web/**`、对应测试
- **撤回**：`git revert 05348c5`

---

# 实时记录 [Live Log]

以下为 2026-08-12 起的实时审计记录。

## 2026-08-12 — A1：建立审计账本

- **问题**：全局工作规则要求所有落盘修改在 `work.md` 记账，但仓库自始至终没有该文件，
  31 个历史 commit 全部无审计日志，无法追溯「为什么这么改」。
- **方案**：创建 `work.md`，定义记录格式，按开发阶段补记全部历史 commit（标注为补记、非实时），
  并开启实时记录区。
- **文件**：`work.md`（新建）
- **撤回**：`rm work.md`（纯新增文件，删除即还原）

## 2026-08-12 — A2：补 LICENSE 与 package 元数据

- **问题**：HANDOFF.md 发布前阻断项 1——仓库没有 `LICENSE`，npm 无法正式发布；
  许可文本未定，需发布者确认。经确认采用 MIT。
- **方案**：新增 MIT `LICENSE`（版权人 金琦亮）；`package.json` 补 `license: "MIT"`
  并把 `LICENSE` 加入 `files` 白名单；`tests/package-release.test.ts` 断言
  `license === "MIT"` 且 tarball 内含 `LICENSE`。
- **文件**：`LICENSE`（新建）、`package.json`、`tests/package-release.test.ts`
- **撤回**：`git revert`（对应 commit）或手动删除 LICENSE 字段与断言。

## 2026-08-12 — A3a：RPC headless E2E 与浏览器开关

- **问题**：规格 37 的场景 A/B/D/E 从未用真模型验证；`/learn` 每次都会弹系统浏览器，
  headless 跑不起来。
- **方案**：① `extension/utils/browser.ts` 增加 `PI_LEARNING_NO_BROWSER=1` 跳过打开浏览器
  （headless/CI 友好，URL 仍打印）。② 新建 `tests/e2e-rpc.mjs`：原始 JSONL RPC 客户端
  （spawn 仓库 0.84.0 CLI `--mode rpc -e extension/index.ts`），驱动真模型跑四类场景——
  A 走 server API 作答、B 连续答错、D 中途 abort（断言 broker promise 及时释放）、
  E 无浏览器纯 TUI 对话框作答。模型偶尔只诊断不出题，harness 用 followUp nudge 引导；
  abort 命令慢是因为 `session.abort()` 等全 idle，改为轮询断言 pending 清空。
- **文件**：`tests/e2e-rpc.mjs`（新建）、`extension/utils/browser.ts`
- **撤回**：删除 harness 文件、`git revert` browser.ts 的改动。
- **结果**：A（7 工具闭环）、B（15 题答错仍继续）、D（9ms 释放）、E（8 题 TUI 对话框）全部通过。

## 2026-08-12 — A3b：Playwright 浏览器 E2E

- **问题**：场景 A 浏览器侧与场景 C 刷新恢复没有真浏览器覆盖；单测收集规则会把 spec 误收。
- **方案**：① 把 `e2e-rpc.mjs` 改为可导入模块（导出 RpcSession 等，仅直接执行时跑 main）。
  ② 新增 `tests/e2e-rpc.d.mts` 让 spec 通过 tsc。③ 新增 `vitest.config.ts`
  显式 include `*.test.ts(x)`，排除 `.spec.ts`。④ 安装 `@playwright/test`，新增
  `playwright.config.ts`（`channel: "msedge"` 复用系统 Edge、免下载浏览器）与
  `tests/e2e-browser.spec.ts`（打开工作台 → 题目渲染 → 刷新恢复 → DOM 作答 →
  server 确认解析 → 等下一题再刷新+作答）。package.json 加 `e2e` / `e2e:browser` 脚本。
- **文件**：`tests/e2e-browser.spec.ts`、`tests/e2e-rpc.d.mts`、`playwright.config.ts`、
  `vitest.config.ts`（均新建）、`tests/e2e-rpc.mjs`、`package.json`
- **撤回**：删除对应文件、`git revert` 对已有文件的改动。
- **结果**：真实模型 + 系统 Edge 下，场景 A 浏览器侧与场景 C 刷新恢复通过（约 2.5 分钟）。

## 2026-08-12 — A4：修复 E2E 暴露的问题并产出报告

- **问题**：场景 A 显示模型从不调用 `learning_record_attempt`，mastery 停在初始 0.20——
  tutor prompt 没有任何规则指导模型记录作答评估。
- **方案**：`extension/tutor-prompt.ts` 加第 13 条规则：评估每道题后调用
  `learning_record_attempt`（interactionId/conceptId/outcome/evidenceType，
  skipped 不记录）。重跑场景 A 验证：10 次 record_attempt、3 个概念、mastery 0.20→0.28。
  另产出 `docs/e2e-report.md` 汇总 A/B/C/D/E 结果与残余限制；README/HANDOFF 补充 E2E 说明。
- **文件**：`extension/tutor-prompt.ts`、`docs/e2e-report.md`（新建）、`README.md`、`HANDOFF.md`
- **撤回**：`git revert` 对应改动；报告与 README 为文档，删除或回退即可。
- **验证**：`npm run check`（23 文件 / 256 测试全过）、`npx playwright test` 再跑通过。

## 2026-08-12 — E2E 清理：限制模型工具集 + 副产物清理

- **问题**：E2E 期间模型（cwd=repo 根）用 bash 编写并编译了 `trait_bound_demo.rs` /
  `bound_demo2.exe` 等演示文件，污染仓库；学习模式本就不该给模型文件系统权限。
- **方案**：两个 harness（`tests/e2e-rpc.mjs`、`tests/e2e-browser.spec.ts`）统一加
  `--tools learning_ask_single_choice,...` 白名单，模型只能调 learning 工具，
  既防写文件/编译，也防权限弹窗；导出 `LEARNING_TOOL_ALLOWLIST` 常量复用。
  删除模型生成的杂散文件；`.gitignore` 增补 Playwright 输出目录
  （`test-results/`、`playwright-report/`）。限制后场景 A 复验通过（7 题、9 次
  record_attempt、phase=practicing）。
- **文件**：`tests/e2e-rpc.mjs`、`tests/e2e-browser.spec.ts`、`tests/e2e-rpc.d.mts`、
  `.gitignore`
- **撤回**：去掉 `--tools` 参数、`git revert` .gitignore；杂散文件为测试副产物，删除即还原。
- **验证**：`npm run check`（23 文件 / 256 测试）通过。
