# Pi Learning Agent Handoff

更新时间：2026-08-11（Asia/Shanghai）

## 当前状态

项目已具备 Pi Extension、TUI fallback、本地 HTTP/SSE 服务和 React Web Workspace 的完整结构化作答闭环。npm/Pi 发布 manifest 已补齐，前端构建会在 `prepack` 阶段进入 tarball。

本轮重点修复：

- npm 包：`pi-package` keyword、`pi.extensions`、peer dependencies、`web/dist` 归档、隔离安装。
- 安全：Markdown 经 DOMPurify 清洗；本地代码执行默认禁用，未注入 runner 时 API 返回 403 且 Web 隐藏 Run。
- 状态：mastery 每次变更持久化；新 session 先清空进程状态；interaction ID 查重账本随快照保存。
- 交互：cancelled SSE 从 Broker 贯通到 Web store；Web 等待期间断开会转 TUI。
- 模型闭环：自由回答和代码正文写入模型可见的 tool result `content`。
- 自适应上下文：Tutor prompt 注入逐概念 mastery、attempts、correct 与 misconceptions。
- Provider 兼容：`learning_record_attempt` 用 Pi `StringEnum`，避免 Google 不支持的 `anyOf/const` schema。

## 发布结构

- 包名：`pi-learning-agent`
- Pi 入口：`./extension/index.ts`
- 官方安装形式：`pi install npm:pi-learning-agent`
- 唯一锁文件：根 `package-lock.json`；`web/package-lock.json` 已删除，根 npm workspace 管理前端依赖。
- 发布文件：`extension/`、`web/dist/`、`README.md`
- Pi 内置库通过 `peerDependencies: "*"` 声明，开发版本固定为 `0.84.0`。

真实 tarball 已在空目录完成隔离安装，安装后的包包含 `extension/index.ts` 与 `web/dist/index.html`，没有私有 `pi-learning-web` registry 依赖，也没有虚假的 `main: index.js`。

## 核心行为

- 四个 `learning_ask_*` 工具均以 sequential 模式等待结构化答案。
- `learning_record_attempt` 只接受 Broker 已 resolved 的 ID；同一 ID 最多记录一次。
- 跳过（allowSkip）走 `broker.skip` / `POST /api/interactions/:id/skip`，以 `skipped: true` 结构化结果返回，不进入 submit 校验；`/learn-reset` 经 `ctx.ui.confirm` 确认后清空当前 topic 的 concepts/attempts/幂等账本。
- phase 迁移由 `nextPhase` 纯函数驱动：出题使 explaining→checking，record_attempt 使 correct→practicing、incorrect→diagnosing。
- LearningState 使用 Pi custom entry 按 active branch 恢复；空 branch 会重置状态。
- server 只监听 `127.0.0.1`，API 使用 bearer token，SSE 因 EventSource 限制允许 query token。
- Markdown/KaTeX 只在 `MathText` 的 HTML 边界渲染并清洗。
- `LocalCodeRunner` 仍保留为可注入实现和测试对象，但不是安全沙箱，正式扩展不会默认构造它。

## 验证命令

```powershell
npm ci
npm run check
npm --workspace web test
npm run build:web
node tests/rpc-smoke.mjs
npm pack --dry-run --json
npm audit --omit=dev
```

`tests/package-release.test.ts` 会实际执行 prepack/dry-run pack，并断言 Pi manifest、extension 入口和 Web 构建都在归档中。

## 发布前阻断项

1. 仓库没有 `LICENSE`。不要擅自选择许可证；发布者需明确 MIT、Apache-2.0 或其他授权方案后补文件和 package metadata。
2. 规格 37 的真人 E2E 尚未执行：需要有效模型凭据运行 `npm run pi`，输入 `/learn rust generics`，验证模型主动调用工具、Web/TUI 作答、反馈和 mastery 刷新。
3. npm 发布和 Pi 官方收录仍需发布者账号/官方流程，本轮只完成技术发布准备与隔离安装验证。

## 已知未完成项

- 本轮已完成：`/learn-reset`（确认 + 重置当前主题 learner state，保留 course/topic）；`allowSkip` 全链路结构化 skip（broker.skip、`POST /api/interactions/:id/skip`、Web/TUI Skip 按钮、tool result 返回 `skipped: true`）；phase 应用层迁移规则（`nextPhase` 纯函数：start→diagnosing、explain 后出题→checking、correct→practicing、incorrect→diagnosing，由 /learn、broker.onPresented、learning_record_attempt 触发）。
- Monaco Language Server、长期跨 session learner profile（SQLite）、TUI 原生多选组件尚未实现。
- 真正隔离的代码运行需要 OS/container 级 CPU、内存、网络和进程树限制。
- MathText 对转义美元符号和代码块内数学分隔符仍有边缘限制。
- `reviewing` phase 目前没有自动触发事件（无 /learn-review），只能经持久化恢复保留。

## 关键文件

- `extension/index.ts`：装配与生命周期
- `extension/server/interaction-broker.ts`：pending/resolved/cancelled 协议
- `extension/server/learning-server.ts`：HTTP/SSE/static/capabilities
- `extension/state/learning-state.ts`：mastery、幂等账本与严格 restore
- `extension/state/session-persistence.ts`：Pi active-branch 恢复
- `extension/tools/tui-presenter.ts`：Web/TUI 路由与断连回退
- `extension/tutor-prompt.ts`：Learning Mode policy 与 learner-state 摘要
- `web/src/state/store.ts`：启动、SSE 与前端状态
- `web/src/components/MathText.tsx`：Markdown/KaTeX/DOMPurify 边界
- `tests/package-release.test.ts`：发布包回归测试

## 官方文档

- Packages：<https://pi.dev/docs/latest/packages>
- Extensions：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- Pi AI tools：<https://github.com/earendil-works/pi/blob/main/packages/ai/README.md>
