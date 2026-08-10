// 代码练习组件（规格 24/25）：Monaco 本地打包、language 只读、Reset、Run、
// Submit、Ctrl/Cmd+Enter 提交、draft 存 localStorage。Run 只做本地自测
// （结果仅学习者可见，不进 tool result）；Submit 才提交答案给模型评阅。
// readOnlyRanges（规格 7.8）：字符偏移数组 → Monaco 局部只读（见 applyReadOnlyRanges）。

import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";

import "../monaco-setup";
import { client, describeRunError, describeSubmitError } from "../api/client";
import { useLearningWorkspace } from "../state/store";
import type { CodeExerciseInteraction, CodeRunResult } from "../types/protocol";

const DRAFT_PREFIX = "pi_draft_";

// 与 extension/runner/code-runner.ts 的白名单保持一致（web 侧只用于决定是否显示 Run 按钮）。
const RUNNABLE_LANGUAGES = new Set(["python", "node"]);

export default function CodeExercise({
  interaction
}: {
  interaction: CodeExerciseInteraction;
}): React.JSX.Element {
  const draftKey = `${DRAFT_PREFIX}${interaction.id}`;
  const [code, setCode] = useState<string>(
    () => localStorage.getItem(draftKey) ?? interaction.starterCode
  );
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CodeRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const submitRef = useRef<() => void>(() => undefined);
  const canRun = RUNNABLE_LANGUAGES.has(interaction.language);
  const busy = submitting || running;

  useEffect(() => {
    localStorage.setItem(draftKey, code);
  }, [draftKey, code]);

  async function doSubmit(): Promise<void> {
    if (code.trim() === "" || busy) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await client.submit(interaction.id, {
        language: interaction.language,
        code
      });
      localStorage.removeItem(draftKey);
      useLearningWorkspace.getState().submitSuccess(
        interaction,
        result.answer,
        `代码（${interaction.language}）已提交`
      );
    } catch (err) {
      setError(describeSubmitError(err));
      setSubmitting(false);
    }
  }

  /** 本地自测（规格 25）：只展示运行结果，不提交答案。 */
  async function doRun(): Promise<void> {
    if (code.trim() === "" || busy) {
      return;
    }
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      setRunResult(await client.runCode(interaction.language, code));
    } catch (err) {
      setRunError(describeRunError(err));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    submitRef.current = () => {
      void doSubmit();
    };
  });

function intersects(a: monaco.IRange, b: monaco.IRange): boolean {
  const isect = monaco.Range.intersectRanges(a, b);
  if (isect === null) {
    return false;
  }
  // 零宽交集：折叠光标/空选区。intersectRanges 对落在只读区内的
  // 零宽 range 返回零宽结果，不能因此漏拦截（规格 7.8 局部只读）。
  const zeroWidth =
    isect.startLineNumber === isect.endLineNumber &&
    isect.startColumn === isect.endColumn;
  if (!zeroWidth) {
    return true;
  }
  // 零宽时按位置判定：p 在 b 的 [start, end) 区间内（end 列 exclusive）
  // 即视为相交；恰好位于只读区末尾边界之外的位置不拦。
  const { startLineNumber: line, startColumn: column } = isect;
  if (line < b.startLineNumber || line > b.endLineNumber) {
    return false;
  }
  if (line === b.startLineNumber && column < b.startColumn) {
    return false;
  }
  if (line === b.endLineNumber && column >= b.endColumn) {
    return false;
  }
  return true;
}

type PushEditOperations = (
  beforeCursorState: monaco.Selection[] | null,
  editOperations: monaco.editor.IIdentifiedSingleEditOperation[],
  cursorStateComputer: monaco.editor.ICursorStateComputer,
  group?: string,
  reason?: unknown
) => monaco.Selection[] | null;

// 局部只读（规格 7.8）：Monaco 0.56 无内建 readOnlyRanges，这里两层实现——
// ① createDecorationsCollection 画灰底视觉标记；② 包一层 model.pushEditOperations，
// 丢弃与只读区相交的编辑（打字/粘贴/拖放都经过此入口）。
// 已知限制：undo 不经过 pushEditOperations，Ctrl+Z 仍可能改到只读区；
// 规格字段是可选提示性质，MVP 不做更深的拦截。
function applyReadOnlyRanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  ranges: Array<{ start: number; end: number }>
): void {
  const model = editor.getModel();
  if (model === null || ranges.length === 0) {
    return;
  }
  const roRanges = ranges
    .filter((r) => r.start >= 0 && r.end > r.start)
    .map((r) => {
      const start = model.getPositionAt(r.start);
      const end = model.getPositionAt(r.end);
      return new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column
      );
    });
  if (roRanges.length === 0) {
    return;
  }

  editor.createDecorationsCollection(
    roRanges.map((range) => ({
      range,
      options: { inlineClassName: "read-only-range" }
    }))
  );

  const original = model.pushEditOperations.bind(model) as unknown as PushEditOperations;
  // 覆盖实例方法以保持 Monaco 调用签名；仅过滤入参后转发（group/reason 原样透传，
  // 保证 undo 分组与变更事件元数据不丢）。
  const wrapper: PushEditOperations = (
    beforeCursorState,
    editOperations,
    cursorStateComputer,
    group,
    reason
  ) => {
    const allowed = editOperations.filter(
      (op) => !roRanges.some((ro) => intersects(op.range, ro))
    );
    return original(beforeCursorState, allowed, cursorStateComputer, group, reason);
  };
  model.pushEditOperations = wrapper as unknown as typeof model.pushEditOperations;
}

  function handleReset(): void {
    setCode(interaction.starterCode);
  }

  return (
    <div className="interaction code-interaction">
      <h2 className="interaction-title">
        {interaction.title ?? "代码练习"}
        <span className="language-badge">{interaction.language}</span>
      </h2>
      <p className="interaction-question">{interaction.instructions}</p>
      <div className="code-editor">
        <Editor
          height="100%"
          language={interaction.language}
          value={code}
          onChange={(value) => setCode(value ?? "")}
          theme="vs-dark"
          onMount={(editor) => {
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
              () => submitRef.current()
            );
            if (interaction.readOnlyRanges !== undefined) {
              applyReadOnlyRanges(editor, interaction.readOnlyRanges);
            }
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2
          }}
        />
      </div>
      {error !== null && <p className="error">{error}</p>}
      {runError !== null && <p className="error">{runError}</p>}
      {runResult !== null && (
        <div className="run-result">
          <div className="run-result-head">
            <span>退出码 {runResult.exitCode ?? "—"}</span>
            <span>{runResult.durationMs} ms</span>
            {runResult.timedOut && <span className="run-warn">已超时</span>}
            {runResult.truncated && <span className="run-warn">输出已截断（上限 64KB）</span>}
          </div>
          <p className="run-label">标准输出</p>
          <pre className="run-output">{runResult.stdout || "（无输出）"}</pre>
          <p className="run-label">标准错误</p>
          <pre className="run-output">{runResult.stderr || "（无输出）"}</pre>
        </div>
      )}
      <div className="interaction-actions">
        <button type="button" onClick={handleReset} disabled={busy}>
          重置
        </button>
        {canRun && (
          <button
            type="button"
            onClick={() => void doRun()}
            disabled={code.trim() === "" || busy}
          >
            {running ? "运行中…" : "运行"}
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => void doSubmit()}
          disabled={code.trim() === "" || busy}
        >
          {submitting ? "提交中…" : "提交"}
        </button>
        <span className="muted hint">Ctrl/Cmd+Enter 提交</span>
        {interaction.readOnlyRanges !== undefined && (
          <span className="muted hint">灰底区域为只读</span>
        )}
      </div>
    </div>
  );
}
