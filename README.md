# Pi Learning Agent

Pi Learning Agent 是一个面向 `@earendil-works/pi-coding-agent` 的结构化学习扩展。当前实现规格 Milestone 0-7 主体：Interaction Broker、四个 Learning Tool（单选/多选/自由回答/代码，含 `learning_record_attempt`）、Learning Mode prompt、学习命令、TUI fallback、本地 HTTP/SSE 学习服务器与浏览器 Web Learning Workspace、mastery 持久化、流式 Tutor 文本同步与 Markdown/KaTeX 渲染。

官方扩展装配默认不执行学习者代码，Web 只提供提交给模型评阅的能力。仓库保留可注入的 `CodeRunner` 接口用于受控测试或未来隔离运行器；未显式注入 runner 时 `/api/code/run` 返回 403，前端不显示 Run 按钮。

## 环境要求

- Node.js `>=22.19.0`
- Pi Coding Agent `0.84.0`
- npm `>=11`

## 安装与验证

发布到 npm 后，通过 Pi 安装：

```powershell
pi install npm:pi-learning-agent
```

从源码开发与验证：

```powershell
npm install
npm run check
```

直接从仓库加载扩展：

```powershell
pi -e ./extension/index.ts
```

也可以使用：

```powershell
npm run pi
```

## 命令

- `/learn <course> <topic>`：开启 Learning Mode，启动本地学习服务器，并让 Tutor 开始诊断和教学。
- `/learn-status`：显示课程、主题、教学阶段和 pending interaction。
- `/learn-open`：在浏览器中打开学习工作台（含 token 的 workspace URL）。
- `/learn-stop`：停止 Learning Mode，并取消所有等待中的 Broker interaction。
- `/learn-reset`：重置当前主题的 learner state（概念 / 掌握度 / 答题历史，带确认），保留课程与主题。

当前命令解析规则把第一个单词视为课程，其余内容视为主题。例如：

```text
/learn rust trait bounds
```

会得到课程 `Rust`、主题 `Trait Bounds`。

## TUI 演示流程

启动 Pi 后输入：

```text
/learn rust generics
```

预期流程：

1. Tutor 简短诊断当前理解。
2. Tutor 调用 `learning_ask_single_choice`：有浏览器客户端时题目出现在 Web Active Panel，否则 Pi 显示原生选择器。
3. 学习者作答后，答案作为当前 tool call 的结构化 result 返回。
4. Tutor 根据答案解释，并可调用 `learning_ask_free_response` / `learning_ask_code`（Monaco 或 TUI 多行编辑器）。
5. 代码内容作为 tool result 返回给模型评阅，默认不在本机执行。

可随时运行 `/learn-status` 查看状态，或运行 `/learn-stop` 结束学习。

## Learning Tools

### `learning_ask_single_choice`

通过 `ctx.ui.select()` 展示单选题。结果保留 `interactionId`、`optionId`、响应时间和可选 `conceptId`。

### `learning_ask_multi_choice`

多选题，答案为 `optionIds: string[]`。TUI 模式用循环选择 + "✔ 完成"，Web 模式用 checkbox 组件；空选提交被服务端拒绝。

### `learning_ask_free_response`

单行回答使用 `ctx.ui.input()`。多行回答在 TUI 模式使用 `ctx.ui.custom() + CustomEditor`（可响应 AbortSignal），非 TUI 模式回退到 `ctx.ui.editor()`。结果使用 `{ text }` 保存结构化答案。

### `learning_ask_code`

通过多行编辑器提供 starter code：TUI 模式使用 `ctx.ui.custom() + CustomEditor`（可响应 AbortSignal），非 TUI 模式使用 `ctx.ui.editor()`。结果使用 `{ language, code }`，源码同时写入模型可见的 tool result `content`；默认没有隐式代码执行。

四个交互 Tool 都使用 `executionMode: "sequential"`，避免并行 TUI 对话框互相覆盖。

### `learning_record_attempt`

非阻塞记录工具：Tutor 评估答案后调用，参数 `{ interactionId, conceptId, outcome, evidenceType, misconception? }`。只接受 Broker 已解析且尚未记录的 interaction ID，防止伪造或重复提升 mastery。应用层按规格 16.1 更新 mastery、持久化快照并广播 `session.updated`；result 的 `details` 含 `previousMastery` / `newMastery`。

## Web Workspace

浏览器端学习工作台位于 `web/`（Vite + React + TypeScript）。构建前端产物：

```powershell
npm run build:web
```

启动 Pi 并进入学习模式：

```powershell
npm run pi
/learn rust generics
```

`/learn` 或 `/learn-open` 会显示带 token 的 workspace URL（形如 `http://127.0.0.1:<port>/?token=...`），用浏览器打开即进入工作台。Pi 调用 `learning_ask_*` 时，结构化组件（单选 / 多选 / 自由回答 / Monaco 代码编辑器）出现在右侧 Active Panel；底部 ProgressPanel 显示概念掌握度（mastery，由 Tutor 调用 `learning_record_attempt` 后经 `session.updated` 事件实时刷新）；左侧 transcript 显示流式 Tutor 文本（Markdown 渲染）与已提交的答案。

没有构建产物（未运行 `npm run build:web`）时，`GET /` 回退到内置占位页，API 照常工作。

**刷新恢复**：页面重新加载后自动执行 `GET /api/session` → `GET /api/interactions/pending` → 建立 SSE，pending 的题目立即重新渲染，不会让 Pi Tool 卡死。提交后即使 SSE 短暂断开，答案也已通过 POST 确认。

**交互路由**：`learning_ask_*` 每次调用时检查服务器是否有活跃 SSE 客户端——有则优先走 Web；无则回退 TUI（单选用 `ctx.ui.select`，多选用循环选择 + "✔ 完成"，多行/代码用 `ctx.ui.custom + CustomEditor`）。题目等待期间若 Web 客户端断开，Presenter 会取消原 Web pending 并切换到 TUI，避免 tool call 永久悬挂。

**Tutor 文本同步**：`message_update` 的 assistant 可见文本经 100ms 节流以 `tutor.message` 事件流式同步（只取 `text` 内容，不含 reasoning），`message_end` 广播 `done: true` 终帧；`learning_*` 工具执行时广播 `waiting` 状态，`agent_settled` / `tool_execution_end` 广播 `idle`。Transcript 用 marked 渲染 Markdown、KaTeX 渲染 `$$...$$` / `$...$` 公式，并在唯一 HTML 边界通过 DOMPurify 清洗模型输出。

**代码自测（规格 25）**：默认关闭，因为当前 `LocalCodeRunner` 的临时目录、环境白名单、超时和输出截断并不构成主机安全隔离。只有宿主显式注入 runner 时 health 才声明 `codeExecution: true`，Web 才显示 Run；运行结果仅展示给学习者，不进入 tool result。正式发布配置保持关闭。

**Mastery 更新**：Tutor 评估答案后调用 `learning_record_attempt`（outcome: correct/partial/incorrect；evidenceType: choice/free_response/code）。应用层按规格 16.1 的透明 heuristic 更新掌握度：初始 0.20、正确单选 +0.08 / 开放 +0.12 / 代码 +0.15、错误 -0.08、partial -0.04，clamp 0..1；超过 0.75 要求最近连续正确中出现过至少两种 evidence 形式（一道单选不能直升掌握）。每次 state 变更广播 `session.updated`。

**已知限制**：Monaco 仅语法高亮，无 Language Server；MathText 对 `\$` 转义和代码块内数学分隔符仍有边缘限制；Tutor 文本同步依赖构建后的 Web 前端。
## 架构

```text
Pi Extension entry
  |-- Learning commands ----> LearningStateStore (mastery, onChange)
  |-- before_agent_start ---> Tutor teaching policy
  |-- session_start --------> restore active-branch learning state
  |-- Learning tools -------> mode-aware presenter (Web SSE / TUI fallback)
  |-- learning_record_attempt -> mastery update + session.updated broadcast
  |-- transcript-sync ------> message_update/message_end + tool status -> SSE
  |-- LearningServer -------> 127.0.0.1 HTTP + SSE + token auth + static dist
  |-- session_shutdown -----> InteractionBroker.cancelAll() + server.close()
  `-- InteractionBroker ----> Web submit now; TUI race fallback
```

`extension/index.ts` 只负责装配。协议、Broker、状态、命令和每个 Tool 都是独立模块，并通过公开接口测试。

## 已知限制

- 当前实现覆盖规格 Milestone 0-7 主体（TUI + Web 往返闭环 + MultiChoice + mastery + 流式 transcript/Markdown/KaTeX + readOnlyRanges + 组件单测）。未完成项：Monaco Language Server、真正隔离的代码 runner、跨 session 长期 learner profile（SQLite）、TUI 原生多选组件。
- `allowSkip` 的完整闭环已实现：Web 与 TUI 单选/多选均可跳过，答案以 `skipped: true` 的结构化结果返回模型（`POST /api/interactions/:id/skip`）。
- TUI 模式的代码/多行回答使用可响应 AbortSignal 的 `ctx.ui.custom()` 编辑器；非 TUI 模式仍受 Pi `ctx.ui.editor()` 不接受 AbortSignal 的限制。
- TUI 多选是逐项循环选择 + "✔ 完成"（pi-tui 无多选组件）；Web 端是完整 checkbox 交互。
- `/learn` 的文档签名与课程/多词主题存在歧义；本阶段采用首词为课程、剩余文本为主题的规则，以满足 `rust generics` 验收场景。
- 规格 37 的人工验收（完整 `/learn rust generics` 教学流程）尚未执行，需要真人 + 模型凭据运行。
