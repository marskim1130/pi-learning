# Pi Learning Agent Handoff

更新时间：2026-08-08（Asia/Shanghai）

## 目标与范围

用户要求根据 `PI_LEARNING_AGENT_IMPLEMENTATION_SPEC.md` 实现 Pi learning plugin。
当前实现范围已经收敛到规格第 44 节的 Milestone 0 + 1：纯 Pi TUI 闭环，不实现 React/Web/HTTP/SSE。

## 已完成

- TypeScript/Vitest 项目骨架，依赖锁定：Pi Coding Agent `0.84.0`、Node `>=22.19.0`。
- `InteractionBroker`：`present`、`submit`、`cancel`、`cancelAll`、`getPending`；支持 AbortSignal、重复提交、非法答案、pending/resolved ID 冲突、有限 tombstone。
- 三个结构化 Tool：
  - `learning_ask_single_choice`
  - `learning_ask_free_response`
  - `learning_ask_code`
- Tool 均为 `executionMode: "sequential"`，Tool result 的 `details` 保存结构化答案和 interaction 元数据；代码只提交给模型，不执行。
- TUI fallback：单选用 `ctx.ui.select`；单行文本用 `ctx.ui.input`；TUI 多行/代码用 `ctx.ui.custom + CustomEditor`，支持本地 AbortSignal。
- Broker 已接入真实 TUI presenter 路径。外部 Broker submit 先完成时不会重复 submit；shutdown/cancel 会让 Tool 立即 reject。
- `LearningStateStore` 最小启停状态及严格 `restore(snapshot)` 校验。
- `/learn`、`/learn-status`、`/learn-stop`；`/learn` 首词解析为 course，其余文本解析为 topic。
- `before_agent_start` Tutor policy，禁止用普通 Markdown 假造结构化交互。
- `session_start` 按 `ctx.sessionManager.getBranch()` 从当前 branch 最后一个有效 `learning-state` custom entry 恢复；`session_shutdown` 取消全部 pending。
- README 与 `docs/architecture.md` 已同步当前 Broker/TUI/session 恢复架构。

## 当前验证

已执行：

```powershell
npm run typecheck
npm test
```

结果：typecheck 通过；7 个测试文件、30 个测试通过。

之前的 Pi RPC loader smoke test 也通过，命令为：

```powershell
'{"id":"smoke","type":"get_commands"}' |
  .\node_modules\.bin\pi.cmd `
    --mode rpc --no-session --offline --no-extensions --no-skills `
    --no-prompt-templates --no-context-files --no-builtin-tools `
    -e .\extension\index.ts
```

当前目录没有 Git 元数据，不能使用 `git diff/status` 作为变更清单依据。

## 下一位 Agent 必做

1. 补真实 TUI custom editor 测试：测试设置 `ctx.mode: "tui"`，模拟 `ctx.ui.custom` 工厂，覆盖 submit、Escape、Broker cancel/shutdown；现有 code 测试没有走此分支。
2. 统一 README 的 editor 描述：第 73/77 行仍写成全部使用 `ctx.ui.editor()`，应明确 TUI 多行/代码走 `ctx.ui.custom + CustomEditor`，非 TUI 才走 `ctx.ui.editor()`。
3. 重新执行 `npm run check`，再执行 RPC smoke test；若改动了 presenter，检查无 `unhandledRejection`。
4. 做一次人工验收：启动 `npm run pi`，输入 `/learn rust generics`，确认 Tutor 主动调用三个 learning tool、答案作为当前 tool result 返回，而不是打印假选择题。没有可用模型凭据时，明确记录“待人工验收”，不要伪造成功结果。
5. 检查是否要在本里程碑明确 `allowSkip` 限制；当前字段保留但没有 skip answer/UI 语义，README 已记录此限制。

## 关键文件

- 入口：[extension/index.ts](C:\Users\Qilia\Desktop\learnany\extension\index.ts)
- Broker：[extension/server/interaction-broker.ts](C:\Users\Qilia\Desktop\learnany\extension\server\interaction-broker.ts)
- 协议：[extension/server/protocol.ts](C:\Users\Qilia\Desktop\learnany\extension\server\protocol.ts)
- TUI presenter：[extension/tools/tui-presenter.ts](C:\Users\Qilia\Desktop\learnany\extension\tools\tui-presenter.ts)
- 状态：[extension/state/learning-state.ts](C:\Users\Qilia\Desktop\learnany\extension\state\learning-state.ts)
- session 恢复：[extension/state/session-persistence.ts](C:\Users\Qilia\Desktop\learnany\extension\state\session-persistence.ts)
- Tool 实现：`extension/tools/ask-*.ts`
- 测试：`tests/*.test.ts`

## 已知设计决策

- Learning tool 答案永远作为当前 tool result 返回；只有 `/learn` kickoff 使用 `sendUserMessage()`。
- 代码题绝不执行任意提交代码。
- Broker 的 response time 使用运行时 `Date.now()`，忽略客户端时间戳做计时。
- `getBranch()` 是 Pi `0.84.0` 类型定义提供的当前活动分支 API；不要直接解析 JSONL。

## 官方文档核对

- Context7 library：`/earendil-works/pi`。
- 参考：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- TUI：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md>
- 本机 `node_modules` 类型定义是最终签名依据，尤其是 `SessionManager.getBranch()` 与 `ctx.ui.custom()`。

