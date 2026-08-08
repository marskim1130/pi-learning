# Pi Learning Agent Extension — 实现规格说明书

版本：v0.1 MVP 设计版  
日期：2026-08-08  
目标读者：负责实现该项目的 Coding Agent / 工程师  
项目定位：基于 Pi Coding Agent Extension 构建“AI 自适应学习工作台”，用结构化交互组件替代纯聊天框学习。

---

## 0. 给 Coding Agent 的执行指令

请把本文档视为实现规范，而不是讨论稿。

实现时遵守以下原则：

1. 第一版必须是 **Pi Extension + 本地 Web Learning Workspace**，不要先改 Gemini/ChatGPT 网页，也不要先做浏览器扩展。
2. Pi 是 Agent Runtime；浏览器是学习 UI。模型负责教学决策，前端负责结构化交互。
3. 不允许模型直接生成任意 HTML/JS 作为题目 UI。模型只能调用预定义 Learning Tools，前端根据结构化 payload 渲染组件。
4. 第一版优先打通完整闭环，不追求全学科组件数量。
5. `learning_ask_*` 工具调用后，应等待浏览器回答，并把答案直接作为 **tool result** 返回给模型；不要默认通过 `pi.sendUserMessage()` 把答案伪装成新的 user turn。
6. Web 服务默认只监听 `127.0.0.1`，不要监听 `0.0.0.0`。
7. MVP 不执行任意不受限制的用户代码。代码运行必须有显式 runner 层、超时、工作目录限制和输出上限；如果安全隔离暂未实现，则先只提交代码给模型评阅。
8. 所有核心模块必须可单元测试，不能把全部逻辑堆在一个 extension 文件里。
9. Pi API 以当前安装版本/官方文档为准。如果 API 与本文档示例存在小版本差异，应保留本文档架构并适配当前类型定义。
10. 每完成一个里程碑，运行测试并按本文档“验收标准”验证后再进入下一阶段。

---

## 1. 产品目标

当前 ChatGPT/Gemini 式学习的主要问题不是模型能力，而是“所有教学活动都挤在普通聊天输入框里”：

- 单选题需要手动输入 A/B/C/D；
- 多选题需要手动写答案；
- 代码回答没有 IDE 级编辑体验；
- 数学、排序、匹配、图表、Flashcard 等学习行为缺乏合适交互；
- 学习进度隐藏在聊天历史里，没有显式 Learner Model；
- AI 很难稳定区分“讲解”“出题”“作答”“反馈”“掌握度更新”这些教学状态。

本项目要把学习过程变成：

```text
AI Tutor
  │
  ├─ 讲解概念
  │
  ├─ 调用 learning_ask_choice
  │      ↓
  │   浏览器显示真正的单选组件
  │      ↓
  │   用户点击提交
  │      ↓
  │   Tool Result 返回答案
  │
  ├─ AI 判断理解程度
  │
  ├─ 调用 learning_ask_code
  │      ↓
  │   Monaco Editor
  │      ↓
  │   用户提交代码
  │
  └─ 更新掌握度 → 决定下一教学动作
```

最终产品形态应接近：

> LLM Tutor + Interactive Textbook + Quiz Engine + IDE + Learner Model

而不是“另一个聊天客户端”。

---

## 2. MVP 范围

### 2.1 必须实现

MVP 只实现以下学习组件：

1. `Explanation`：Markdown/代码块/公式展示；
2. `SingleChoice`：单选题；
3. `MultiChoice`：多选题；
4. `FreeResponse`：普通开放回答；
5. `CodeExercise`：Monaco Editor 代码回答；
6. `Feedback`：结果与解析展示；
7. `Learning Progress`：当前主题、概念掌握度、题目计数。

必须实现完整闭环：

```text
/learn rust-generics
→ Tutor 进入学习模式
→ 讲解
→ 调用选择题 Tool
→ Web UI 出现选择题
→ 用户点击答案
→ Tool 返回结构化答案
→ Tutor 解释答案
→ 调用代码题 Tool
→ Monaco 提交代码
→ Tutor 反馈
→ 更新 learner state
```

### 2.2 MVP 不做

第一版不要做：

- 任意 HTML 组件生成；
- 复杂拖拽题；
- 地图题；
- 语音识别；
- 视频课；
- 多人课堂；
- 云端账号系统；
- 多设备同步；
- 完整 LMS；
- 浏览器扩展注入 ChatGPT/Gemini；
- 自动部署公网服务；
- 复杂 RAG 课程知识库。

这些全部留到第二阶段以后。

---

## 3. 技术路线

### 3.1 第一阶段架构

第一版使用：

```text
Pi CLI
  │
  │ loads
  ▼
Pi Learning Extension
  │
  ├── Learning Tools
  ├── Tutor Prompt Injection
  ├── Learning Session State
  ├── Interaction Broker
  └── Local HTTP/SSE Server
             │
             ▼
      Browser Learning Workspace
             │
             ├── Chat/Explanation
             ├── Quiz Components
             ├── Monaco Editor
             └── Progress Panel
```

不要在 MVP 中让 Web App 再启动第二个 Pi 进程。

Extension 本身就是当前 Pi session 的一部分，因此工具可以直接访问 Pi Extension API 和当前 session。

### 3.2 后续独立应用架构

等 MVP 稳定后，可以演进到：

```text
Standalone Learning App
        │
        ├── Web UI
        ├── Learning DB
        └── Agent Runtime
               │
               ├── Pi AgentSession SDK（Node/TS 优先）
               └── Pi RPC（跨语言或进程隔离时）
```

Pi 官方当前文档明确支持 RPC headless/custom UI，并建议 Node.js/TypeScript 应用优先考虑直接使用 AgentSession SDK。

MVP 不要提前迁移。

---

## 4. 建议项目目录

项目建议作为独立仓库，同时包含可复制到 `.pi/extensions` 的扩展入口：

```text
pi-learning-agent/
├─ package.json
├─ tsconfig.json
├─ README.md
├─ docs/
│  └─ architecture.md
│
├─ extension/
│  ├─ index.ts
│  ├─ tutor-prompt.ts
│  ├─ commands.ts
│  ├─ tools/
│  │  ├─ ask-single-choice.ts
│  │  ├─ ask-multi-choice.ts
│  │  ├─ ask-free-response.ts
│  │  ├─ ask-code.ts
│  │  ├─ show-feedback.ts
│  │  └─ index.ts
│  ├─ state/
│  │  ├─ learning-state.ts
│  │  ├─ persistence.ts
│  │  └─ types.ts
│  ├─ server/
│  │  ├─ learning-server.ts
│  │  ├─ interaction-broker.ts
│  │  ├─ sse-hub.ts
│  │  └─ protocol.ts
│  └─ utils/
│     ├─ ids.ts
│     ├─ browser.ts
│     └─ validation.ts
│
├─ web/
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ api/client.ts
│  │  ├─ state/store.ts
│  │  ├─ components/
│  │  │  ├─ TutorTranscript.tsx
│  │  │  ├─ LearningCard.tsx
│  │  │  ├─ SingleChoice.tsx
│  │  │  ├─ MultiChoice.tsx
│  │  │  ├─ FreeResponse.tsx
│  │  │  ├─ CodeExercise.tsx
│  │  │  ├─ Feedback.tsx
│  │  │  └─ ProgressPanel.tsx
│  │  └─ types/protocol.ts
│  └─ dist/
│
├─ tests/
│  ├─ interaction-broker.test.ts
│  ├─ learning-state.test.ts
│  ├─ protocol.test.ts
│  └─ extension-tools.test.ts
│
└─ scripts/
   └─ install-extension.mjs
```

开发时可以从仓库直接通过 `pi -e ./extension/index.ts` 测试；稳定后安装到项目级 `.pi/extensions/learning-agent/` 或全局 `~/.pi/agent/extensions/learning-agent/`。

---

## 5. 技术栈

推荐：

### Extension / Server

- TypeScript
- Node.js
- `@earendil-works/pi-coding-agent`
- `typebox`
- `@earendil-works/pi-ai` 中的 `StringEnum`
- Node `http`
- SSE：原生 HTTP 实现
- `zod` 可用于 Web API runtime 校验（可选）

### Web

- React
- TypeScript
- Vite
- Monaco Editor
- Markdown renderer
- KaTeX/MathJax 二选一（MVP 推荐 KaTeX）
- Zustand 或简单 React store

### 测试

- Vitest
- Playwright（第二阶段加入浏览器 E2E）

MVP 没有必要上 Next.js、NestJS、Electron 或复杂数据库。

---

## 6. 核心设计原则：LLM 输出语义，程序决定 UI

禁止这种设计：

```text
LLM: “生成下面 HTML 来显示一个选择题……”
```

必须设计为：

```text
LLM
 ↓ tool call
learning_ask_single_choice({ ...structured data... })
 ↓
Extension
 ↓
Web UI renderer
```

例如：

```ts
interface SingleChoiceRequest {
  id: string;
  type: "single_choice";
  conceptId?: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
  }>;
  allowSkip?: boolean;
}
```

前端只渲染已知组件。

这样可以保证：

- UI 一致；
- 可验证；
- 可统计；
- 可测试；
- 不会让模型任意执行前端代码；
- 后续可以换 React/移动端而不改变 Agent Tool 协议。

---

## 7. Learning Interaction Protocol

Extension 与浏览器之间必须定义稳定协议。

### 7.1 基础事件

```ts
type LearningEvent =
  | InteractionPresentedEvent
  | InteractionResolvedEvent
  | TutorMessageEvent
  | ProgressUpdatedEvent
  | SessionStateEvent
  | ErrorEvent;
```

### 7.2 题目展示事件

```ts
interface InteractionPresentedEvent {
  event: "interaction.presented";
  interaction: LearningInteraction;
}
```

### 7.3 用户提交

浏览器提交：

```ts
interface InteractionSubmission {
  interactionId: string;
  answer: unknown;
  clientTimestamp: number;
}
```

服务端验证后转成：

```ts
interface ResolvedAnswer {
  interactionId: string;
  type: LearningInteraction["type"];
  answer: unknown;
  responseTimeMs: number;
}
```

### 7.4 interaction 类型

```ts
type LearningInteraction =
  | SingleChoiceInteraction
  | MultiChoiceInteraction
  | FreeResponseInteraction
  | CodeExerciseInteraction;
```

### 7.5 单选

```ts
interface SingleChoiceInteraction {
  id: string;
  type: "single_choice";
  title?: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  conceptId?: string;
  allowSkip: boolean;
  createdAt: number;
}
```

答案：

```ts
interface SingleChoiceAnswer {
  optionId: string;
}
```

### 7.6 多选

```ts
interface MultiChoiceAnswer {
  optionIds: string[];
}
```

### 7.7 开放回答

```ts
interface FreeResponseInteraction {
  id: string;
  type: "free_response";
  question: string;
  placeholder?: string;
  multiline: boolean;
  conceptId?: string;
  createdAt: number;
}
```

答案：

```ts
interface FreeResponseAnswer {
  text: string;
}
```

### 7.8 代码题

```ts
interface CodeExerciseInteraction {
  id: string;
  type: "code";
  title?: string;
  instructions: string;
  language: string;
  starterCode: string;
  readOnlyRanges?: Array<{ start: number; end: number }>;
  conceptId?: string;
  createdAt: number;
}
```

答案：

```ts
interface CodeExerciseAnswer {
  language: string;
  code: string;
}
```

不要让浏览器把“A”这种模糊字符串作为通用答案。必须保留结构化语义。

---

## 8. Interaction Broker：整个系统最关键的模块

实现：

```text
extension/server/interaction-broker.ts
```

它负责在 Pi Tool 和浏览器之间桥接异步交互。

内部维护：

```ts
Map<string, PendingInteraction>
```

建议类型：

```ts
interface PendingInteraction {
  interaction: LearningInteraction;
  createdAt: number;
  resolve: (answer: ResolvedAnswer) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}
```

公开 API：

```ts
class InteractionBroker {
  present(interaction: LearningInteraction, signal?: AbortSignal): Promise<ResolvedAnswer>;
  submit(submission: InteractionSubmission): SubmitResult;
  cancel(interactionId: string, reason: string): void;
  cancelAll(reason: string): void;
  getPending(): LearningInteraction[];
}
```

`present()` 流程：

```text
Tool execute()
  ↓
broker.present(interaction)
  ↓
写入 pending map
  ↓
通过 SSE 广播 interaction.presented
  ↓
Promise 暂停等待
  ↓
浏览器 POST /api/interactions/:id/submit
  ↓
broker.submit()
  ↓
resolve(answer)
  ↓
Tool execute() 返回 result
  ↓
Pi 继续下一轮 LLM
```

这正是 MVP 的核心闭环。

### 8.1 AbortSignal

Pi tool 的 `execute` 会收到 signal。

Broker 必须监听：

```ts
signal?.addEventListener("abort", ...)
```

Agent 被 abort、session 切换或 extension shutdown 时，等待中的交互不能永久悬挂。

### 8.2 超时

不建议默认 30 秒这种短超时，因为学习代码题可能需要很久。

MVP 默认：

- 普通题：可不设置自动超时；
- shutdown/abort 时立即取消；
- 可选配置 `maxInteractionMinutes`，例如 60 分钟。

---

## 9. Local Learning Server

实现：

```text
extension/server/learning-server.ts
```

### 9.1 网络规则

默认：

```text
host = 127.0.0.1
port = 自动选择可用端口
```

禁止默认监听公网接口。

### 9.2 推荐 API

```text
GET  /api/health
GET  /api/session
GET  /api/interactions/pending
GET  /api/events                  SSE
POST /api/interactions/:id/submit
POST /api/interactions/:id/skip
GET  /                            静态 Web App
GET  /assets/*                    Vite build assets
```

### 9.3 SSE

MVP 推荐继续使用 SSE，而不是 WebSocket。

原因：

- Server → Browser 是主要实时方向；
- Browser → Server 可以普通 POST；
- 原生 Node HTTP 就能实现；
- 比 WebSocket 更少依赖；
- 与现有 Pi Monitor 风格一致；
- 调试简单。

SSE Hub：

```ts
class SseHub {
  addClient(response: ServerResponse): void;
  broadcast(event: LearningEvent): void;
  close(): void;
}
```

必须实现 heartbeat，例如 15~30 秒发送 comment，避免代理/浏览器长连接被静默关闭。

### 9.4 浏览器刷新恢复

浏览器重新加载时：

1. `GET /api/session`
2. `GET /api/interactions/pending`
3. 建立 SSE
4. 如果有 pending interaction，立即重新渲染

所以刷新页面不能导致 Pi Tool 永远卡死。

---

## 10. Extension 生命周期

入口：

```text
extension/index.ts
```

职责只做装配，不写业务细节。

伪代码：

```ts
export default async function learningExtension(pi: ExtensionAPI) {
  const state = new LearningStateStore();
  const broker = new InteractionBroker();
  const server = new LearningServer({ broker, state });

  registerLearningTools(pi, { broker, state });
  registerCommands(pi, { server, state, broker });
  registerTutorPrompt(pi, { state });
  registerPersistence(pi, { state });

  pi.on("session_start", async (_event, ctx) => {
    await restoreState(ctx, state);
  });

  pi.on("session_shutdown", async () => {
    broker.cancelAll("session_shutdown");
    await server.close();
  });
}
```

Pi 当前官方文档支持 async extension factory，并提供 `session_shutdown` 用于清理长生命周期资源。因此 server 必须在 shutdown 时关闭。

---

## 11. Pi Learning Tools

MVP 推荐注册 5 个工具，不要一开始做 30 个。

### 11.1 `learning_ask_single_choice`

参数：

```ts
{
  question: string;
  options: Array<{ id: string; label: string }>;
  conceptId?: string;
  allowSkip?: boolean;
}
```

执行：

1. 创建 interaction id；
2. 调用 `broker.present()`；
3. 等待 Web 提交；
4. 返回 tool result。

Tool result 示例：

```json
{
  "interactionId": "q_123",
  "answer": { "optionId": "A" },
  "responseTimeMs": 8421
}
```

返回给模型的 `content` 可以是简短文本，但 `details` 应保留完整结构化数据。

### 11.2 `learning_ask_multi_choice`

同上，答案为 `optionIds: string[]`。

### 11.3 `learning_ask_free_response`

用于：

- 概念解释；
- 简答；
- 反思题；
- 非代码开放问题。

不要拿它代替单选题。

### 11.4 `learning_ask_code`

参数：

```ts
{
  instructions: string;
  language: string;
  starterCode?: string;
  conceptId?: string;
}
```

Web 渲染 Monaco。

MVP 返回：

```json
{
  "language": "rust",
  "code": "..."
}
```

第二阶段再加入测试运行结果。

### 11.5 `learning_show_feedback`

该 tool 可以是非阻塞展示工具，也可以第一版不用 Tool、直接把 AI Markdown 反馈同步到 transcript。

推荐第一版把反馈仍保留为普通 assistant message；只有需要特定 UI（正确/错误状态、解析卡片）时再引入 `learning_show_feedback`。

### 11.6 Google-compatible enum

Pi 当前扩展示例明确建议：需要字符串枚举参数时使用 `@earendil-works/pi-ai` 的 `StringEnum`，而不是 TypeBox `Type.Union([Type.Literal(...)])`，以兼容 Google provider。

例如语言或交互类型如果做枚举，应遵循这一点。

---

## 12. Tool Result 语义

不要返回：

```text
User selected A.
```

作为唯一信息。

应该返回：

```ts
return {
  content: [
    {
      type: "text",
      text: `Learner submitted option ${answer.optionId}.`
    }
  ],
  details: {
    interactionId,
    type: "single_choice",
    answer,
    responseTimeMs,
    conceptId
  }
};
```

这样 session 中的 tool result 可以用于：

- 学习记录恢复；
- 统计；
- debug；
- 未来 fork session；
- learner-state 重建。

---

## 13. 为什么 MVP 不默认使用 `pi.sendUserMessage()` 回答题目

Pi 当前支持 `pi.sendUserMessage()`，它会生成真实 user message，并触发新一轮。

但对于 `learning_ask_*`，首选方案应该是：

```text
assistant tool call
→ tool waits
→ learner submits
→ tool result
→ same agent loop continues
```

这比：

```text
assistant tool call
→ tool returns pending
→ browser submit
→ pi.sendUserMessage(...)
```

更容易保证因果关系和状态一致性。

`sendUserMessage()` 以后可用于：

- Web UI 中的“主动问老师”自由聊天；
- 用户没有 pending 题目时，从浏览器发起新问题；
- 额外 steering/follow-up 行为。

不要把它当成所有学习组件的默认答案通道。

---

## 14. Tutor Prompt / Teaching Policy

必须通过 Pi 的 `before_agent_start` 给模型增加 Learning Mode 指令。

Pi 当前允许该事件修改 system prompt。

学习模式开启时追加类似策略：

```text
You are operating in Learning Mode.

Teaching rules:
1. Teach interactively rather than dumping a full solution.
2. When checking learner understanding, use the registered learning_* tools.
3. Do not render fake multiple-choice UI using plain Markdown when a corresponding tool is available.
4. Use one primary learner interaction at a time.
5. After receiving an answer, first evaluate the reasoning, then explain, then decide the next step.
6. Prefer retrieval practice and application over repeated explanation.
7. For coding exercises, use learning_ask_code instead of asking the learner to paste code into ordinary chat.
8. Adapt difficulty based on learner state.
9. Do not mark mastery after a single lucky multiple-choice answer.
10. Keep explanations concise enough to preserve active participation.
```

同时动态注入：

```text
Current course: Rust
Current topic: Generics
Current learner state:
- generic_functions: 0.80
- trait_bounds: 0.35
- where_clause: 0.10
Recent misconception:
- Confuses defining a trait with constraining a generic parameter.
```

不要把整个数据库全部塞到 prompt，只注入当前相关摘要。

---

## 15. Learning Mode 状态机

建议显式状态：

```ts
type LearningPhase =
  | "idle"
  | "diagnosing"
  | "explaining"
  | "checking"
  | "practicing"
  | "reviewing";
```

不需要做成严格有限状态机阻止模型，但应用层要记录当前阶段。

推荐教学循环：

```text
Goal
 ↓
Explain / Example
 ↓
Check Understanding
 ↓
Wrong? ── yes ──> Diagnose misconception
  │                    ↓
  │                Alternate explanation
  │                    ↓
  └──────────────── Re-check

Correct?
 ↓
Application / Code exercise
 ↓
Mastery update
 ↓
Next concept or spaced review
```

---

## 16. Learner Model

实现：

```text
extension/state/learning-state.ts
```

MVP 数据结构：

```ts
interface LearningState {
  enabled: boolean;
  course?: {
    id: string;
    title: string;
  };
  topic?: {
    id: string;
    title: string;
  };
  phase: LearningPhase;
  concepts: Record<string, ConceptState>;
  recentAttempts: AttemptSummary[];
}

interface ConceptState {
  id: string;
  title: string;
  mastery: number;       // 0..1
  attempts: number;
  correct: number;
  lastPracticedAt?: number;
  misconceptions: string[];
}
```

### 16.1 掌握度算法

第一版不要自称使用复杂认知模型。

用简单、透明的 heuristic：

- 初始：0.20 或 unknown；
- 正确单选：小幅 +0.08；
- 正确开放解释：+0.12；
- 正确代码/应用题：+0.15；
- 错误：-0.08；
- 连续不同形式正确才允许超过 0.75；
- 一道单选不能把 mastery 直接升到“掌握”。

实现时应把规则封装成函数：

```ts
updateMastery(state, attempt): ConceptState
```

不要在多个 tool 文件里复制计算规则。

第二阶段再考虑 BKT/IRT/FSRS 等正式模型。

---

## 17. 状态持久化

Pi 当前提供 `pi.appendEntry(customType, data)`，自定义 entry 不进入 LLM context，但会写进 session，可在 `session_start` 时读取并恢复。

MVP 应使用它保存关键 Learning State 快照：

```ts
pi.appendEntry("learning-state", {
  version: 1,
  state: snapshot
});
```

不要每个按键都写 snapshot。

推荐持久化时机：

- `/learn` 开启；
- 一次 interaction 完成；
- mastery 更新；
- topic 切换；
- learning mode 关闭。

恢复时，从当前 branch/entries 中找到最后一个有效 `learning-state` entry。

### 17.1 外部 SQLite

MVP 可以不做 SQLite。

如果需要跨 Pi session 的长期课程记忆，再加入：

```text
~/.pi/agent/learning/learning.db
```

但必须区分：

- Pi session state：当前对话可恢复；
- Learner profile DB：跨 session 长期学习历史。

两者不要混成一个概念。

---

## 18. Pi Commands

至少实现：

### `/learn [topic]`

行为：

1. 开启 Learning Mode；
2. 如果 server 未启动则启动；
3. 初始化课程/主题；
4. 设置 session name（可选）；
5. 打开或提示 Learning Workspace URL；
6. 注入 kickoff user prompt，让 Tutor 开始诊断/教学。

示例：

```text
/learn rust generics
```

### `/learn-status`

显示：

```text
Learning Mode: ON
Course: Rust
Topic: Generics
Workspace: http://127.0.0.1:xxxxx/...
Pending interaction: none
Concepts: 4
```

### `/learn-open`

重新打开浏览器。

### `/learn-stop`

行为：

- 关闭 Learning Mode；
- cancel pending interaction；
- 持久化 state；
- server 可以保留，也可以根据配置关闭。

### `/learn-reset`

重置当前 topic learner state；必须确认。

---

## 19. 浏览器自动打开

实现 `utils/browser.ts`：

- Windows：`start`；
- macOS：`open`；
- Linux：`xdg-open`；
- 失败时不要报致命错误，只在 TUI 输出 URL。

不要依赖必须安装某个第三方 browser opener 才能启动核心系统。

---

## 20. Web Learning Workspace

布局建议：

```text
┌─────────────────────────────────────────────────────────┐
│ Course / Topic                          Mastery / Status │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│ Tutor Transcript             │ Active Learning Panel    │
│                              │                          │
│ Explanation                  │ SingleChoice             │
│ Feedback                     │ / CodeExercise           │
│ Previous reasoning           │ / FreeResponse           │
│                              │                          │
├──────────────────────────────┴──────────────────────────┤
│ Concepts / progress / recent attempts                  │
└─────────────────────────────────────────────────────────┘
```

移动端改为纵向：

```text
Topic
Tutor Explanation
Active Interaction
Feedback
Progress
```

### 20.1 Active Interaction

同一时刻 MVP 只允许一个 blocking interaction。

如果收到第二个，应：

- server 拒绝；或者
- queue。

建议第一版直接 reject 并记录开发错误，强迫 Agent 一次问一个问题。

---

## 21. SingleChoice UX

必须：

- 选项是真正按钮/Radio；
- 点击选项只选择，不自动提交（避免误触）；
- 有“提交答案”；
- 提交后锁定；
- 等待 Tutor 反馈；
- 支持键盘 1/2/3/4 或 A/B/C/D；
- 不允许重复提交同一 interaction id。

提交 payload：

```json
{
  "interactionId": "...",
  "answer": { "optionId": "B" },
  "clientTimestamp": 1786212345678
}
```

---

## 22. MultiChoice UX

必须：

- Checkbox；
- 支持多个；
- 明确“可能有多个正确答案”；
- 提交前至少选一个，除非题目允许空答案；
- answer 中顺序不应影响语义。

---

## 23. FreeResponse UX

普通回答不再强迫用户回 Pi TUI 输入。

必须支持：

- 单行/多行；
- Markdown 可选；
- Ctrl+Enter 提交；
- 普通 Enter 换行；
- 提交前保留本地 draft；
- 页面刷新后 draft 可暂存 localStorage。

---

## 24. CodeExercise UX

使用 Monaco Editor。

最低能力：

- 语法高亮；
- 行号；
- 自动缩进；
- Tab；
- 自动括号；
- starter code；
- language selector 只读显示（由题目决定）；
- Reset；
- Submit；
- Ctrl/Cmd+Enter 提交；
- 页面刷新前保存 draft。

MVP 可以先没有 Language Server。

推荐首批语言：

- TypeScript/JavaScript；
- Python；
- Rust；
- Go；

但 Monaco 只负责编辑体验，不代表本地 runner 已支持这些语言。

---

## 25. Code Runner（第二小阶段）

代码执行涉及安全，不要直接：

```ts
exec(userCode)
```

推荐抽象：

```ts
interface CodeRunner {
  run(request: CodeRunRequest, signal: AbortSignal): Promise<CodeRunResult>;
}
```

结果：

```ts
interface CodeRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  tests?: Array<{
    name: string;
    passed: boolean;
    message?: string;
  }>;
}
```

安全最低要求：

- 独立临时目录；
- 固定允许语言；
- 命令模板由程序定义，不能由用户控制 executable；
- 5~10 秒超时；
- stdout/stderr 大小限制；
- 结束后清理临时目录；
- 不把 API key/敏感 env 传入；
- 不允许任意 cwd；
- 更成熟版本放 Docker/沙箱。

如果隔离没做好，宁可 MVP 暂时不提供 Run 按钮，只提供 Submit。

---

## 26. Tutor Transcript

Extension 应监听 Pi 的 message lifecycle，把 assistant 最终文本同步到 Web UI。

推荐至少监听：

- `message_update`：可实现流式显示；
- `message_end`：保存最终消息；
- `tool_execution_start/end`：显示“正在等待你的答案”等状态；
- `agent_settled`：显示 Tutor idle。

第一版如果流式实现复杂，可以只同步 `message_end`，先保证正确性。

不要把 chain-of-thought/hidden reasoning 暴露给 Web UI。

只同步用户可见 assistant 文本和学习 tool 状态。

---

## 27. Web 与 Pi Transcript 的关系

MVP 的 Web Workspace 是“学习视图”，不是第二个完整 Pi 客户端。

因此第一版：

- 普通开发工具输出不必全部显示；
- bash/read/edit 等 coding-agent 工具可以继续留在 TUI；
- Learning Workspace 只显示教学相关内容；
- 用户回答主要通过 Web。

之后若要完全替代 Pi TUI，再考虑 AgentSession/RPC 独立客户端。

---

## 28. TUI Fallback

如果浏览器未连接，系统不要完全不可用。

MVP 至少为以下工具提供 TUI fallback：

- SingleChoice → `ctx.ui.select()`；
- FreeResponse → `ctx.ui.input()` / `ctx.ui.editor()`；
- CodeExercise → `ctx.ui.editor()`。

判断逻辑：

```text
有 Web client?
 ├─ yes → broker/Web
 └─ no  → ctx.ui fallback
```

可以增加配置：

```ts
uiMode: "auto" | "web" | "tui"
```

`auto` 为默认。

Pi 当前官方 API 已提供 `select / confirm / input / editor / custom`，所以 fallback 是官方支持路径。

---

## 29. Prompt 约束：避免模型绕开组件

Learning Mode system prompt 要明确：

```text
When a registered learning interaction tool can represent the activity, use it instead of asking the learner to type an equivalent answer in ordinary chat.
```

具体：

- 单选 → 必须 `learning_ask_single_choice`；
- 多选 → `learning_ask_multi_choice`；
- 代码 → `learning_ask_code`；
- 开放问题 → `learning_ask_free_response`；
- 单纯解释 → 普通 assistant text。

不要每句话都 Tool 化。

讲解保持自然 Markdown；“需要学习者动作时”才切交互组件。

---

## 30. 状态更新时机

推荐流程：

```text
Tool returns learner answer
 ↓
LLM evaluates
 ↓
LLM gives feedback
 ↓
LLM optionally calls learning_record_attempt
```

也可以由应用层自动记“提交行为”，但正确/错误与 misconception 最好由 Tutor 评估后记录。

第二阶段可加：

```text
learning_record_attempt
```

参数：

```ts
{
  interactionId: string;
  conceptId: string;
  outcome: "correct" | "partial" | "incorrect";
  evidenceType: "choice" | "free_response" | "code";
  misconception?: string;
}
```

这样掌握度更新不是靠解析自然语言反馈。

MVP 如果工具数量要压缩，可以先在 Extension 根据 answer 元数据记录 attempt，再让模型通过专门的 state update tool 更新 outcome。

---

## 31. HTTP 安全

即使只监听 localhost，也要做基础保护。

启动 server 时生成随机 session token：

```text
crypto.randomBytes(24).toString("hex")
```

Workspace URL：

```text
http://127.0.0.1:PORT/?token=...
```

API 需要 token，可通过 header：

```text
Authorization: Bearer <token>
```

或同源 session cookie。

MVP 最简单是：页面初次从 query 获取 token，保存在 sessionStorage，以 Authorization header 调 API。

同时：

- 严格校验 interaction id；
- 拒绝已经 resolved 的重复提交；
- request body 限制大小；
- 不提供任意文件系统 API；
- 静态文件路径防 path traversal；
- 不把 Pi system prompt、API keys、环境变量发送给浏览器。

Pi Extension 本身拥有用户权限，因此这一层不能当成普通无权限网页插件处理。

---

## 32. 日志与可观测性

实现结构化日志，但默认不要记录全部敏感学习内容。

建议：

```ts
logger.info("interaction_presented", {
  interactionId,
  type,
  conceptId
});
```

不要默认：

```ts
logger.info({ fullCode, fullAnswer, systemPrompt, apiKey });
```

可选 debug 模式才输出完整 payload。

---

## 33. 错误处理

需要明确处理：

1. Web server 启动失败；
2. port 被占用；
3. 浏览器断开；
4. interaction 重复提交；
5. interaction 不存在；
6. user abort；
7. Pi session reload；
8. Pi session switch/fork/new；
9. Extension reload；
10. tool schema 参数错误；
11. 前端 bundle 不存在；
12. Monaco 加载失败。

关键原则：

- UI 崩溃不能导致 Pi Extension 永久 pending；
- shutdown 必须 reject/cancel 所有 pending promises；
- Tool error 要返回可理解信息；
- 能 fallback TUI 时优先 fallback。

---

## 34. Session reload / fork

Pi session 是树结构并支持 fork。

MVP learner state 至少要做到：

- reload 后恢复；
- resume 后恢复；
- fork 时基于该 branch 的 state 恢复，而不是读取“整个文件最后一条”导致串支。

实现时优先使用当前 session manager 提供的 branch/entries API，按当前 Pi 类型定义选择正确方法。

不要自己直接解析 Pi JSONL 文件，除非官方 API 确实缺少所需能力。

---

## 35. 开发里程碑

### Milestone 0 — Skeleton

任务：

- 建项目；
- Extension 能被 Pi 加载；
- `/learn-status` 可执行；
- session_start/shutdown 正常；
- Vitest 可运行。

验收：

```text
pi -e ./extension/index.ts
```

无异常加载，并能运行命令。

---

### Milestone 1 — Interaction Broker + TUI

先不要做 Web。

实现：

- `learning_ask_single_choice`；
- `learning_ask_free_response`；
- `learning_ask_code`；
- 使用 `ctx.ui.select/editor`；
- Tutor prompt 约束。

验收：

要求模型教学 Rust，并确认模型能主动调用 tool，而不是打印假选择题。

---

### Milestone 2 — Local Web Server

实现：

- HTTP server；
- health；
- SSE；
- token auth；
- static app；
- `/learn-open`。

验收：

浏览器打开，能显示“Connected to Pi Learning Session”。

---

### Milestone 3 — SingleChoice Web Loop

实现：

```text
Tool call
→ SSE interaction
→ React SingleChoice
→ POST answer
→ Broker resolve
→ Tool result
→ Agent continues
```

这是最重要的里程碑。

验收必须人工完整执行 20 次，不出现：

- answer 串题；
- 重复提交；
- tool 永久 pending；
- 浏览器刷新后丢失题目。

---

### Milestone 4 — FreeResponse + Monaco

实现：

- FreeResponse；
- CodeExercise；
- Monaco；
- draft 恢复；
- 提交。

验收：

Rust/Python/TypeScript starter code 均正确高亮、缩进、提交。

---

### Milestone 5 — Tutor Transcript

实现：

- assistant message 同步；
- Markdown；
- code block；
- KaTeX；
- streaming 可选。

验收：

用户主要看浏览器即可完成一段 10 分钟教学过程。

---

### Milestone 6 — Learner State

实现：

- concepts；
- attempts；
- mastery；
- Pi appendEntry persistence；
- reload/resume restore；
- ProgressPanel。

验收：

重启/恢复 Pi session 后学习进度仍存在。

---

### Milestone 7 — Polish

实现：

- keyboard shortcuts；
- loading state；
- retry；
- TUI fallback；
- responsive layout；
- errors；
- docs。

到这里定义为 v0.1 MVP 完成。

---

## 36. 单元测试要求

### InteractionBroker

必须测：

- present creates pending；
- submit resolves exact interaction；
- wrong id rejected；
- duplicate submit rejected；
- abort rejects；
- cancelAll rejects all；
- pending list correct；
- responseTimeMs >= 0。

### LearningState

必须测：

- init；
- add attempt；
- mastery clamps 0..1；
- code evidence 权重大于 choice；
- one choice 不能直接 mastery=1；
- serialization/deserialization。

### HTTP

必须测：

- no token → 401；
- valid token → 200；
- oversized body → reject；
- invalid payload → 400；
- resolved interaction → 409。

### Tool

用 mock broker 测：

- tool 参数转 interaction；
- broker answer 正确转 tool result；
- abort 传播。

---

## 37. E2E 验收场景

至少人工/E2E 覆盖：

### 场景 A：Rust Trait Bound

用户：

```text
/learn Rust trait bound
```

预期：

1. AI 简要诊断；
2. 浏览器显示选择题；
3. 用户选择；
4. AI 根据答案解释；
5. AI 出代码题；
6. Monaco 输入代码；
7. AI 给反馈；
8. mastery 更新。

### 场景 B：错误答案

用户连续答错。

预期不是重复同一段解释，而应：

- 识别 misconception；
- 改用例子/对比；
- 降低题目难度；
- 再验证。

### 场景 C：浏览器刷新

Tool 正在等选择题时刷新。

预期：

- pending 题重新出现；
- 仍能提交；
- Pi 继续执行。

### 场景 D：Pi abort

题目等待时用户 abort。

预期：

- broker promise 被取消；
- 前端标记 interaction cancelled；
- 没有内存泄漏。

### 场景 E：无浏览器

关闭 Web client。

预期：

- auto mode fallback 到 TUI；
- 学习仍可继续。

---

## 38. Definition of Done — v0.1

只有同时满足以下条件才算完成：

- [ ] Extension 可通过 Pi 正常加载；
- [ ] `/learn`、`/learn-open`、`/learn-status`、`/learn-stop` 可用；
- [ ] Learning Mode prompt 生效；
- [ ] 模型会使用结构化 learning tools；
- [ ] SingleChoice 完整 Web 往返闭环；
- [ ] MultiChoice 完整闭环；
- [ ] FreeResponse 完整闭环；
- [ ] Monaco CodeExercise 完整闭环；
- [ ] 页面刷新可恢复 pending interaction；
- [ ] Pi abort/reload/shutdown 不留下 pending promise；
- [ ] TUI fallback 可用；
- [ ] learner state 可保存/恢复；
- [ ] Web 只监听 localhost；
- [ ] API token protection 生效；
- [ ] 核心模块有测试；
- [ ] README 有安装与运行说明；
- [ ] 至少完成 Rust 学习 E2E 示例。

---

## 39. 推荐的第一批文件实现顺序

Coding Agent 请严格按这个顺序推进，不要一开始同时铺开前后端：

```text
1. extension/state/types.ts
2. extension/server/protocol.ts
3. extension/server/interaction-broker.ts
4. tests/interaction-broker.test.ts
5. extension/tools/ask-single-choice.ts
6. extension/tools/ask-free-response.ts
7. extension/tools/ask-code.ts
8. extension/tutor-prompt.ts
9. extension/commands.ts
10. extension/index.ts
11. 先完成 TUI 闭环
12. extension/server/sse-hub.ts
13. extension/server/learning-server.ts
14. web/src/api/client.ts
15. web/src/components/SingleChoice.tsx
16. 打通第一个 Web interaction
17. MultiChoice
18. FreeResponse
19. Monaco CodeExercise
20. TutorTranscript
21. LearningState persistence
22. ProgressPanel
23. 安全/恢复/错误处理
24. README + E2E
```

每一步保持可运行状态。

---

## 40. 不允许的实现捷径

Coding Agent 不应采用以下方案：

### 禁止 1：解析模型自然语言来识别选择题

例如用正则寻找：

```text
A.
B.
C.
D.
```

这是脆弱架构。

必须 tool-call first。

### 禁止 2：模型生成前端 JSX/HTML

模型只给 schema data。

### 禁止 3：浏览器直接访问模型 API

模型调用全部经过 Pi runtime。

### 禁止 4：用一个巨大 JSON `learning_ui` Tool 包含无限动态 schema

MVP 应使用少量明确 Tool，让模型调用可靠、类型可控。

后期组件很多时再考虑 registry + generic renderer。

### 禁止 5：把长期 learner state 只放 prompt

状态属于程序，prompt 只是它的摘要视图。

### 禁止 6：直接执行任意代码字符串

必须 runner abstraction + safety boundary。

### 禁止 7：为做 Web UI 立刻重写成独立 Agent 客户端

MVP 保持 Extension-first，先证明教学交互闭环。

---

## 41. 第二阶段扩展方向

v0.1 完成后再加入：

### 新组件

- FillBlank
- Matching
- Ordering
- Flashcards
- NumericAnswer
- MathInput
- Diagram
- InteractiveGraph
- TableExercise
- SQLExercise
- DebugExercise

### Learning Engine

- Diagnostic test；
- dynamic course map；
- misconception graph；
- spaced repetition；
- review queue；
- adaptive difficulty。

### Code

- sandbox runner；
- hidden tests；
- test panel；
- diff view；
- hint system；
- language server。

### Persistence

- SQLite learner profile；
- 跨 Pi session 课程；
- dashboard；
- 学习历史。

### Standalone

当 Web UI 已经承担绝大多数交互后，再把 Agent runtime 迁移为：

```text
Node Learning App
→ createAgentSession(...)
```

或跨语言场景：

```text
Learning App
→ pi --mode rpc
```

---

## 42. 第三阶段的组件注册架构

组件达到十几个以后，可以从“一个组件一个 Tool”演进为 registry：

```ts
interface LearningComponentDefinition<TPayload, TAnswer> {
  type: string;
  validatePayload(payload: unknown): TPayload;
  validateAnswer(answer: unknown): TAnswer;
  blocking: boolean;
}
```

例如：

```text
single_choice
multi_choice
code
fill_blank
matching
ordering
flashcard
math_input
```

但这不是 MVP 首先要解决的问题。

---

## 43. 最终产品边界

这个项目的长期架构应保持三层清晰分离：

```text
┌─────────────────────────────┐
│  Learning Experience Layer  │
│  React / Monaco / Math / UI │
└─────────────┬───────────────┘
              │ structured protocol
┌─────────────▼───────────────┐
│  Learning Engine            │
│  state / mastery / routing  │
└─────────────┬───────────────┘
              │ learning tools
┌─────────────▼───────────────┐
│  Pi Agent Runtime           │
│  models / session / tools   │
└─────────────────────────────┘
```

任何未来功能都尽量归入正确层，而不是把所有逻辑堆到 LLM prompt。

---

## 44. Coding Agent 的第一个实际任务

拿到本文档后，第一个开发任务不是做 React 页面，而是：

> 创建项目骨架，实现 `InteractionBroker`、三个最基础 Learning Tools（single choice/free response/code）以及 TUI fallback，并通过 `/learn rust generics` 完成一次纯 Pi TUI 的结构化学习闭环。

只有这个闭环稳定后，再接 Web。

完成第一个任务时应提供：

1. 新增文件列表；
2. 关键架构说明；
3. 测试结果；
4. 实际启动命令；
5. 一次真实 `/learn` 演示流程；
6. 已知限制；
7. 下一里程碑计划。

---

## 45. 当前 Pi 能力依据

本文档基于 2026-08-08 可访问的 Pi 官方文档/主仓库。实现前 Coding Agent 应再次核对本机安装版本类型定义。

官方资料：

- Extensions: https://pi.dev/docs/latest/extensions
- RPC Mode: https://pi.dev/docs/latest/rpc
- Pi Coding Agent README: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- Extension examples: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/README.md
- Session format: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md

当前官方文档确认的关键能力包括：

- Extension 是 TypeScript module；
- `pi.registerTool()`；
- `pi.registerCommand()`；
- `ctx.ui.select / input / editor / custom`；
- `pi.appendEntry()` session persistence；
- `before_agent_start` system prompt modification；
- `message_update / message_end`；
- `tool_execution_*`；
- `session_shutdown`；
- `pi.sendUserMessage()`；
- SDK `createAgentSession()`；
- `pi --mode rpc` custom UI/headless integration。

这些能力足以实现本文档定义的 v0.1。

---

# 最终要求

不要把项目做成“聊天框旁边多几个按钮”。

v0.1 的成功标准是：

> 当 Tutor 想让学习者做某种学习行为时，它能选择正确的结构化交互工具；学习者通过适合该任务的 UI 回答；答案作为明确、可追踪的数据返回 Pi；Tutor 再基于答案和 learner state 决定下一步教学行为。

只要这个循环稳定，后续数学、拖拽、图表、Flashcard、SQL、算法动画都只是组件扩展，而不需要重写核心架构。
