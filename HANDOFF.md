# Pi Learning Agent Handoff

更新时间：2026-08-10（Asia/Shanghai）

## 目标与范围

用户要求根据 `PI_LEARNING_AGENT_IMPLEMENTATION_SPEC.md` 实现 Pi learning plugin，并采用"实现一步 → 独立测试 agent 验证一步"的循环推进。当前已完成规格 Milestone 0-5 主体：TUI 闭环 + 本地 HTTP/SSE server + Web Workspace + Web/TUI 自动路由 + MultiChoice + mastery 更新 + 流式 transcript/Markdown 渲染。

## 已完成

- TypeScript/Vitest 项目骨架，依赖锁定：Pi Coding Agent `0.84.0`、Node `>=22.19.0`。
- `InteractionBroker`：`present`/`submit`/`cancel`/`cancelAll`/`getPending`；AbortSignal、重复提交、非法答案、pending/resolved ID 冲突、有限 tombstone；可选 `subscribe({ onPresented, onResolved })` 钩子（向后兼容）。
- 四个结构化 Tool：`learning_ask_single_choice` / `learning_ask_multi_choice` / `learning_ask_free_response` / `learning_ask_code`（均 sequential，答案永远作为 tool result 返回，代码只提交不执行）+ `learning_record_attempt`（非阻塞，outcome/evidenceType 枚举用 TypeBox Union——`@earendil-works/pi-ai` 不是本仓库直接依赖，规格 11.6 的 StringEnum 留作后续）。
- TUI fallback：单选用 `ctx.ui.select`；多选用循环 select + "✔ 完成"（pi-tui 0.84 的 SelectList 无多选）；单行用 `ctx.ui.input`；TUI 多行/代码用 `ctx.ui.custom + CustomEditor`（响应 AbortSignal）；非 TUI 用 `ctx.ui.editor`。
- **Web/TUI 自动路由**（`createModeAwarePresenter`）：每次 tool 调用时判断 `LearningServer.hasWebClient()`——有活跃 SSE 客户端只走 broker 等 Web 提交；无则 broker + TUI race。
- **LearningServer**：127.0.0.1 随机端口、token auth（Bearer + SSE query）、health/session/pending/events(SSE, 20s heartbeat)/submit(413/400/401/404/409)/静态伺服 web/dist（防 traversal 含编码向量）；lazy start（`/learn`/`/learn-open`）；`broadcastSessionUpdated`/`broadcastTutorMessage`/`broadcastTutorStatus`。
- **Web Workspace**（web/，Vite + React 19 + TS + zustand + @monaco-editor/react + marked@18）：SingleChoice/MultiChoice/FreeResponse/CodeExercise/TutorTranscript(Markdown 渲染, marked 未消毒)/ProgressPanel；启动序列 health→session→pending→SSE；刷新恢复；SSE 断线重连；store 流式合并（responseId 主 key + seq 兜底，同 id 原地替换保留位置，done 语义）。
- **mastery**（规格 16.1）：`updateMastery` 纯函数（初始 0.20、choice +0.08 / free_response +0.12 / code +0.15、incorrect -0.08 / partial -0.04、clamp 0..1、>0.75 需最近连续 correct ≥2 种 evidenceType）；`recordAttempt`（attempts/correct/misconception 去重 cap10/recentAttempts 20/recentOutcomes 10/lastPracticedAt）；`ConceptState.recentOutcomes?` 可选字段（旧快照 restore 兼容）；`LearningStateStore` 构造参数 `onChange`，start/stop/recordAttempt 后触发 → server 广播 session.updated。
- **流式 transcript**：transcript-sync 订阅 message_update（100ms 节流可注入 setTimeout）+ message_end 终帧（done:true 恒最后，未 flush 节流帧先取消）；messageId 用 AgentMessage 的 `responseId`（pi-ai AssistantMessage 无 id 字段）+ 自增 seq 兜底；extractAssistantText 只收 text part，不混入 reasoning。
- `LearningStateStore` 启停 + 严格 restore；`/learn`、`/learn-status`、`/learn-open`、`/learn-stop`；`before_agent_start` Tutor policy（含 multi_choice 约束）；`session_start` 按 `getBranch()` 恢复；`session_shutdown` cancelAll + `await server.close()`。
- `tests/rpc-smoke.mjs`：RPC smoke 已脚本化（spawn node，Windows 可跑）。

## 当前验证

- `npm run check`：typecheck（根 + web）+ 15 个测试文件 **143 个测试全过**。
- `npm run build:web` 成功（web/dist 已 gitignore；4MB chunk 为 Monaco，既有警告）。
- `node tests/rpc-smoke.mjs` → `RPC SMOKE OK`，无 `unhandledRejection`。
- 每步实现后均有独立 QA agent 审查；已修复缺陷：interaction.resolved 双帧广播（fb97980）、纯空白 tutor 消息（6317ff3）；低危遗留：marked 未消毒（本地模型内容）、partial -0.04 为规格未定义处的补充约定、TUI 多选逐项循环、web 组件无 @testing-library 单测。
- Git 历史：`c52a968` → `d95793b` TUI editor 测试 → `a989178` M2 server → `c976387` server QA → `fb97980` 双帧修复 → `ce1cdde` web workspace → `2b33a91` web QA → `2632698` 路由+transcript → `7ef408b` 最终 QA → `6317ff3` 空白修复+文档 → `308ce03` multi-choice → `95f3cb7` multi-choice QA → `075ae10` mastery → `78ae235` mastery QA → `edcfdea` 流式 transcript → `99c703e` 类型收尾 → `99323ec` streaming QA。

## 下一位 Agent 必做

1. **人工验收（规格 37）仍未执行**：`npm run build:web` → `npm run pi` → `/learn rust generics`，确认 Tutor 主动调用 learning tools、Web 组件出现、作答后 tool result 返回、mastery 刷新。必须真人执行；没有凭据时记录"待人工验收"，不要伪造结果。
2. 剩余规格项（M5-7）：KaTeX 数学渲染、Monaco Language Server、`readOnlyRanges` 两端落地、代码 runner（规格 25，需先解决隔离）、跨 session 长期 learner profile（SQLite）、TUI 多选升级（等 pi-tui 多选组件或自绘 custom）、web 组件单测（@testing-library）、DOMPurify（若引入外部输入）。
3. 检查 `npm run check`、`node tests/rpc-smoke.mjs` 仍全绿（若改动 presenter/server/state）。

## 关键文件

- 入口：[extension/index.ts](C:\Users\Qilia\Desktop\learnany\extension\index.ts)
- Broker：[extension/server/interaction-broker.ts](C:\Users\Qilia\Desktop\learnany\extension\server\interaction-broker.ts)
- 协议：[extension/server/protocol.ts](C:\Users\Qilia\Desktop\learnany\extension\server\protocol.ts)
- Server/SSE：[extension/server/learning-server.ts](C:\Users\Qilia\Desktop\learnany\extension\server\learning-server.ts)、[extension/server/sse-hub.ts](C:\Users\Qilia\Desktop\learnany\extension\server\sse-hub.ts)
- Presenter：[extension/tools/tui-presenter.ts](C:\Users\Qilia\Desktop\learnany\extension\tools\tui-presenter.ts)（含 `createModeAwarePresenter`）
- Transcript：[extension/transcript-sync.ts](C:\Users\Qilia\Desktop\learnany\extension\transcript-sync.ts)
- 状态/mastery：[extension/state/learning-state.ts](C:\Users\Qilia\Desktop\learnany\extension\state\learning-state.ts)、[extension/state/types.ts](C:\Users\Qilia\Desktop\learnany\extension\state\types.ts)、[extension/state/session-persistence.ts](C:\Users\Qilia\Desktop\learnany\extension\state\session-persistence.ts)
- Tools：`extension/tools/ask-*.ts`（含 `ask-record-attempt.ts`）
- Web：`web/src/`（App.tsx、state/store.ts、api/client.ts、components/、types/protocol.ts）
- 测试：`tests/*.test.ts`、`tests/rpc-smoke.mjs`、`web/src/state/store.test.ts`

## 已知设计决策

- Learning tool 答案永远作为当前 tool result 返回；只有 `/learn` kickoff 使用 `sendUserMessage()`。
- 代码题绝不执行任意提交代码（规格 25 runner 未做）。
- Broker 的 response time 使用运行时 `Date.now()`，忽略客户端时间戳做计时。
- `getBranch()` 是 Pi `0.84.0` 类型定义提供的当前活动分支 API；不要直接解析 JSONL。
- Web 路由判断粒度是"每次 tool 调用时求值 hasWebClient()"，刷新瞬间 SSE 断开会短暂回退 TUI（MVP 可接受）。
- SSE 广播无背压；`interaction.resolved` 只由 broker listener 广播（防双帧）；前端 store 对重复帧幂等。
- `interaction.resolved` / `tutor.message` 等事件字段用 spread 省略 undefined（兼容旧客户端）。
- mastery 四舍五入 2 位小数；0.75 门槛 clamp 到恰 0.75（=0.75 合规）。
- `learning_record_attempt` 不做 interactionId 存在性强校验（broker 无 resolved 查询接口，MVP 注释说明）。
- 前端 token 存 sessionStorage（规格 31 约定），SSE 经 query 传 token。

## 官方文档核对

- 参考：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- TUI：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md>
- 本机 `node_modules` 类型定义是最终签名依据，尤其是 `SessionManager.getBranch()`、`ctx.ui.custom()`、`message_update`/`message_end`/`tool_execution_*`/`agent_settled` 事件载荷、pi-ai `AssistantMessage.responseId`（无 id 字段）。

## 已完成（Milestone 0-3）

- TypeScript/Vitest 项目骨架，依赖锁定：Pi Coding Agent `0.84.0`、Node `>=22.19.0`。
- `InteractionBroker`：`present`/`submit`/`cancel`/`cancelAll`/`getPending`；AbortSignal、重复提交、非法答案、pending/resolved ID 冲突、有限 tombstone；可选 `subscribe({ onPresented, onResolved })` 钩子（默认无，向后兼容）。
- 三个结构化 Tool：`learning_ask_single_choice` / `learning_ask_free_response` / `learning_ask_code`，均 `executionMode: "sequential"`；答案永远作为当前 tool result 返回（`details` 保留结构化数据），代码只提交不执行。
- TUI fallback：单选用 `ctx.ui.select`；单行用 `ctx.ui.input`；TUI 多行/代码用 `ctx.ui.custom + CustomEditor`（响应 AbortSignal）；非 TUI 用 `ctx.ui.editor`。
- **Web/TUI 自动路由**（`createModeAwarePresenter`）：`learning_ask_*` 每次调用时判断 `LearningServer.hasWebClient()`——有活跃 SSE 客户端只走 broker 等 Web 提交（不弹 TUI）；无则 broker + TUI race。
- **本地 LearningServer**（`extension/server/learning-server.ts`）：127.0.0.1 随机端口、`randomBytes(24)` token（`Authorization: Bearer`，SSE 用 query token）、`/api/health`、`/api/session`、`/api/interactions/pending`、`/api/events`（SSE，20s heartbeat，客户端断开清理）、`POST /api/interactions/:id/submit`（body 256KB 上限→413、坏 JSON→400、id 不匹配→400、不存在→404、已 resolved→409、非法答案→400）、`GET /` 静态伺服 `web/dist`（resolve+startsWith 防 traversal，含 `%2e%2e`/`%5c` 等编码向量；无产物回退内置占位页）。
- **Web Workspace**（`web/`，Vite + React 19 + TS + zustand + @monaco-editor/react）：SingleChoice（点击选中不自动提交、键盘 1-9/A-Z+Enter、提交锁定）、FreeResponse（单/多行、Ctrl+Enter、draft localStorage）、CodeExercise（Monaco 本地打包、Reset、Ctrl/Cmd+Enter、draft）、TutorTranscript、ProgressPanel；启动序列 health→session→pending→SSE；刷新恢复 pending；SSE 断线 5s 重连、resolved 幂等（双帧安全）。
- **Tutor 文本同步**（`extension/transcript-sync.ts`）：`message_end` 只同步 assistant 可见文本（`extractAssistantText` 只拼 `type==="text"`，跳过 reasoning/image，空/纯空白不广播）；`tool_execution_start` 仅 `learning_*` 前缀广播 waiting；`tool_execution_end`/`agent_settled` 广播 idle。不订阅 `message_update`（无流式，规格 26 先保证正确性）。
- `LearningStateStore` 启停状态与严格 `restore(snapshot)` 校验；`/learn`、`/learn-status`、`/learn-open`、`/learn-stop`；`before_agent_start` Tutor policy；`session_start` 按 `getBranch()` 恢复、`session_shutdown` cancelAll + `await server.close()`（server lazy start，仅 `/learn`/`/learn-open` 时启动）。

## 当前验证

- `npm run check`：typecheck（根 + web）+ 13 个测试文件 **88 个测试全过**。
- `npm run build:web` 成功（web/dist 构建产物，已 gitignore）。
- RPC smoke（`get_commands` 返回 4 个 learning 命令）通过，无 `unhandledRejection`。
- 多轮独立 QA agent 审查（每步实现后派独立测试 agent）：发现并修复的唯一缺陷是 `interaction.resolved` 重复广播（handleSubmit 与 broker listener 双帧，已删 handleSubmit 侧并补回归测试）；其余为低优先级项（见已知限制）。
- Git 历史：`c52a968` 初始 → `d95793b` TUI editor 测试 → `a989178` M2 server → `c976387` server QA → `fb97980` 双帧修复 → `ce1cdde` web workspace → `2b33a91` web QA → `2632698` 路由+transcript → `7ef408b` 最终 QA →（最新：空白文本修复 + README/HANDOFF 更新）。

## 下一位 Agent 必做

1. **人工验收（规格 37）仍未执行**：启动 `npm run pi` → `npm run build:web`（若未构建）→ `/learn rust generics`，确认：Tutor 主动调用 learning tools、打开 workspace URL、Web 组件出现、作答后 tool result 返回、Tutor 继续教学、mastery 显示。本机有 deepseek/opencode-go 凭据，但 TUI 交互无法由脚本驱动，必须真人执行；没有凭据时记录"待人工验收"，不要伪造结果。
2. Milestone 4-7 规划（规格 35）：MultiChoice（协议层无此类型，需先加 `multi_choice` interaction + tool + 前端组件）、mastery 更新（`learning_record_attempt` 或应用层自动记录，规格 30）、流式 transcript（`message_update`）、Markdown/KaTeX 渲染、Monaco Language Server、`readOnlyRanges` 两端落地、`session.updated` 广播接入。
3. 检查 `npm run check` 与 RPC smoke 仍全绿（若改动 presenter/server）。

## 关键文件

- 入口：[extension/index.ts](C:\Users\Qilia\Desktop\learnany\extension\index.ts)
- Broker：[extension/server/interaction-broker.ts](C:\Users\Qilia\Desktop\learnany\extension\server\interaction-broker.ts)
- 协议：[extension/server/protocol.ts](C:\Users\Qilia\Desktop\learnany\extension\server\protocol.ts)
- Server/SSE：[extension/server/learning-server.ts](C:\Users\Qilia\Desktop\learnany\extension\server\learning-server.ts)、[extension/server/sse-hub.ts](C:\Users\Qilia\Desktop\learnany\extension\server\sse-hub.ts)
- Presenter：[extension/tools/tui-presenter.ts](C:\Users\Qilia\Desktop\learnany\extension\tools\tui-presenter.ts)（含 `createModeAwarePresenter`）
- Transcript：[extension/transcript-sync.ts](C:\Users\Qilia\Desktop\learnany\extension\transcript-sync.ts)
- 状态：[extension/state/learning-state.ts](C:\Users\Qilia\Desktop\learnany\extension\state\learning-state.ts)、[extension/state/session-persistence.ts](C:\Users\Qilia\Desktop\learnany\extension\state\session-persistence.ts)
- Web：`web/src/`（App.tsx、state/store.ts、api/client.ts、components/）
- 测试：`tests/*.test.ts`、`web/src/state/store.test.ts`

## 已知设计决策

- Learning tool 答案永远作为当前 tool result 返回；只有 `/learn` kickoff 使用 `sendUserMessage()`。
- 代码题绝不执行任意提交代码。
- Broker 的 response time 使用运行时 `Date.now()`，忽略客户端时间戳做计时。
- `getBranch()` 是 Pi `0.84.0` 类型定义提供的当前活动分支 API；不要直接解析 JSONL。
- Web 路由判断粒度是"每次 tool 调用时求值 `hasWebClient()`"，刷新瞬间 SSE 断开会短暂回退 TUI（MVP 可接受，已注释）。
- SSE 广播无背压（慢客户端丢帧），本地回环足够；`interaction.resolved` 只由 broker listener 广播（防止双帧）。
- 前端 token 存 sessionStorage（规格 31 约定），SSE 经 query 传 token（EventSource 无法带 header）。

## 官方文档核对

- 参考：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- TUI：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md>
- 本机 `node_modules` 类型定义是最终签名依据，尤其是 `SessionManager.getBranch()`、`ctx.ui.custom()`、`message_end`/`tool_execution_*`/`agent_settled` 事件载荷。
