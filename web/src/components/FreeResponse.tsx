// 自由回答组件（规格 23）：单行 input / 多行 textarea；
// 多行 Ctrl+Enter 提交、Enter 换行；draft 存 localStorage，刷新后恢复。

import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

import { client, describeSubmitError } from "../api/client";
import { useLearningWorkspace } from "../state/store";
import type { FreeResponseInteraction } from "../types/protocol";

const DRAFT_PREFIX = "pi_draft_";

export default function FreeResponse({
  interaction
}: {
  interaction: FreeResponseInteraction;
}): React.JSX.Element {
  const draftKey = `${DRAFT_PREFIX}${interaction.id}`;
  const [text, setText] = useState<string>(
    () => localStorage.getItem(draftKey) ?? ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(draftKey, text);
  }, [draftKey, text]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // 多行：Ctrl/Cmd+Enter 提交，Enter 换行（textarea 默认行为）。
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void doSubmit();
    }
  }

  async function doSubmit(): Promise<void> {
    const value = text.trim();
    if (value === "" || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await client.submit(interaction.id, { text: value });
      localStorage.removeItem(draftKey);
      useLearningWorkspace
        .getState()
        .submitSuccess(interaction, result.answer, value);
    } catch (err) {
      setError(describeSubmitError(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="interaction">
      <h2 className="interaction-title">
        {interaction.multiline ? "自由回答" : "简答"}
      </h2>
      <p className="interaction-question">{interaction.question}</p>
      {interaction.multiline ? (
        <textarea
          className="free-response-input"
          rows={6}
          value={text}
          placeholder={interaction.placeholder ?? "输入你的回答…"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
          autoFocus
        />
      ) : (
        <input
          className="free-response-input"
          type="text"
          value={text}
          placeholder={interaction.placeholder ?? "输入你的回答…"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void doSubmit();
            }
          }}
          disabled={submitting}
          autoFocus
        />
      )}
      {error !== null && <p className="error">{error}</p>}
      <div className="interaction-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void doSubmit()}
          disabled={text.trim() === "" || submitting}
        >
          {submitting ? "提交中…" : "提交答案"}
        </button>
        {interaction.multiline && (
          <span className="muted hint">Ctrl+Enter 提交，Enter 换行</span>
        )}
      </div>
    </div>
  );
}
