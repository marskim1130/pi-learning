// 代码练习组件（规格 24）：Monaco 本地打包、language 只读、Reset、Submit、
// Ctrl/Cmd+Enter 提交、draft 存 localStorage。只提交不运行（无 runner）。

import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";

import "../monaco-setup";
import { client, describeSubmitError } from "../api/client";
import { useLearningWorkspace } from "../state/store";
import type { CodeExerciseInteraction } from "../types/protocol";

const DRAFT_PREFIX = "pi_draft_";

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
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    localStorage.setItem(draftKey, code);
  }, [draftKey, code]);

  async function doSubmit(): Promise<void> {
    if (code.trim() === "" || submitting) {
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
      <div className="interaction-actions">
        <button type="button" onClick={handleReset} disabled={submitting}>
          重置
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void doSubmit()}
          disabled={code.trim() === "" || submitting}
        >
          {submitting ? "提交中…" : "提交"}
        </button>
        <span className="muted hint">Ctrl/Cmd+Enter 提交</span>
      </div>
    </div>
  );
}
