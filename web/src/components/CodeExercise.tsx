// 代码练习组件（规格 24/25）：Monaco 本地打包、language 只读、Reset、Run、
// Submit、Ctrl/Cmd+Enter 提交、draft 存 localStorage。Run 只做本地自测
// （结果仅学习者可见，不进 tool result）；Submit 才提交答案给模型评阅。

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
      </div>
    </div>
  );
}
