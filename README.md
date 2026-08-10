# Pi Learning Agent

Pi Learning Agent 是一个面向 `@earendil-works/pi-coding-agent` 的结构化学习扩展。当前版本实现规格说明书第 44 节定义的首个交付：Interaction Broker、三个 Learning Tool、Learning Mode prompt、学习命令，以及纯 Pi TUI fallback。

当前版本不会执行学习者提交的代码，也不会启动 HTTP 服务。

## 环境要求

- Node.js `>=22.19.0`
- Pi Coding Agent `0.84.0`
- npm `>=11`

## 安装与验证

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

- `/learn <course> <topic>`：开启 Learning Mode，并让 Tutor 开始诊断和教学。
- `/learn-status`：显示课程、主题、教学阶段和 pending interaction。
- `/learn-stop`：停止 Learning Mode，并取消所有等待中的 Broker interaction。

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
2. Tutor 调用 `learning_ask_single_choice`，Pi 显示原生选择器。
3. 学习者选择后，答案作为当前 tool call 的结构化 result 返回。
4. Tutor 根据答案解释，并可调用 `learning_ask_free_response`。
5. Tutor 调用 `learning_ask_code`，Pi 打开多行编辑器。
6. 代码仅提交给模型评阅，不在本机执行。

可随时运行 `/learn-status` 查看状态，或运行 `/learn-stop` 结束学习。

## Learning Tools

### `learning_ask_single_choice`

通过 `ctx.ui.select()` 展示单选题。结果保留 `interactionId`、`optionId`、响应时间和可选 `conceptId`。

### `learning_ask_free_response`

单行回答使用 `ctx.ui.input()`。多行回答在 TUI 模式使用 `ctx.ui.custom() + CustomEditor`（可响应 AbortSignal），非 TUI 模式回退到 `ctx.ui.editor()`。结果使用 `{ text }` 保存结构化答案。

### `learning_ask_code`

通过多行编辑器提供 starter code：TUI 模式使用 `ctx.ui.custom() + CustomEditor`（可响应 AbortSignal），非 TUI 模式使用 `ctx.ui.editor()`。结果使用 `{ language, code }`，没有 runner 或隐式代码执行。

三个 Tool 都使用 `executionMode: "sequential"`，避免并行 TUI 对话框互相覆盖。

## 架构

```text
Pi Extension entry
  |-- Learning commands ----> LearningStateStore
  |-- before_agent_start ---> Tutor teaching policy
  |-- session_start --------> restore active-branch learning state
  |-- Learning tools -------> Broker-backed TUI presenter
  |-- session_shutdown -----> InteractionBroker.cancelAll()
  `-- InteractionBroker ----> TUI now; Web/SSE transport seam next
```

`extension/index.ts` 只负责装配。协议、Broker、状态、命令和每个 Tool 都是独立模块，并通过公开接口测试。

## 已知限制

- 这是规格的 Milestone 0 + 1，不是完整 Web MVP。
- 尚无 React、Monaco、HTTP、SSE 或 token auth。
- 已支持 Pi session reload/resume/fork 时从当前 branch 的最后一个有效 `learning-state` entry 恢复；尚无跨 session 的长期 learner profile。
- 尚无 MultiChoice、Tutor Transcript 或 mastery 更新。
- `allowSkip` 已进入单选 interaction 协议，但本阶段没有定义结构化 skip answer，因此 TUI 不展示 Skip 选项。
- TUI 模式的代码/多行回答使用可响应 AbortSignal 的 `ctx.ui.custom()` 编辑器；非 TUI 模式仍受 Pi `ctx.ui.editor()` 不接受 AbortSignal 的限制。
- `/learn` 的文档签名与课程/多词主题存在歧义；本阶段采用首词为课程、剩余文本为主题的规则，以满足 `rust generics` 验收场景。

下一里程碑将加入 localhost-only HTTP/SSE server、token auth、浏览器连接检测和 SingleChoice Web 往返闭环。
