// 单选组件（规格 21）：点击只选中不提交，显式“提交答案”按钮，提交后锁定。
// 键盘：1/2/3… 或 A/B/C/D 选择，Enter 提交。协议无 skip answer，故不渲染跳过按钮。

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import MathText from "./MathText";
import { client, describeSubmitError } from "../api/client";
import { useLearningWorkspace } from "../state/store";
import type { SingleChoiceInteraction } from "../types/protocol";

export default function SingleChoice({
  interaction
}: {
  interaction: SingleChoiceInteraction;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = submitting;

  function handleKeyDown(event: KeyboardEvent<HTMLFieldSetElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (selected !== null && !locked) {
        void doSubmit(selected);
      }
      return;
    }
    const index = optionIndexForKey(event.key);
    const option = index === undefined ? undefined : interaction.options[index];
    if (option !== undefined && !locked) {
      event.preventDefault();
      setSelected(option.id);
    }
  }

  async function doSubmit(optionId: string): Promise<void> {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await client.submit(interaction.id, { optionId });
      const label =
        interaction.options.find((o) => o.id === optionId)?.label ?? optionId;
      useLearningWorkspace.getState().submitSuccess(interaction, result.answer, label);
    } catch (err) {
      setError(describeSubmitError(err));
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selected !== null && !locked) {
      void doSubmit(selected);
    }
  }

  return (
    <form className="interaction" onSubmit={handleSubmit}>
      <h2 className="interaction-title">单选题</h2>
      <MathText text={interaction.question} className="interaction-question" />
      <fieldset
        className="options"
        onKeyDown={handleKeyDown}
        disabled={locked}
        aria-label="选项"
      >
        {interaction.options.map((option, index) => (
          <label key={option.id} className={`option ${selected === option.id ? "selected" : ""}`}>
            <input
              type="radio"
              name={`single-choice-${interaction.id}`}
              value={option.id}
              checked={selected === option.id}
              onChange={() => setSelected(option.id)}
              disabled={locked}
            />
            <span className="option-label">
              <span className="option-key">{index + 1}</span>
              {option.label}
            </span>
          </label>
        ))}
      </fieldset>
      {error !== null && <p className="error">{error}</p>}
      <div className="interaction-actions">
        <button
          type="submit"
          className="primary"
          disabled={selected === null || locked}
        >
          {submitting ? "提交中…" : "提交答案"}
        </button>
        <span className="muted hint">1/2/3… 或 A/B/C/D 选择，Enter 提交</span>
      </div>
    </form>
  );
}

/** 数字键 1-9 → 0-8；字母 A-Z → 0-25（大小写均可）。 */
function optionIndexForKey(key: string): number | undefined {
  if (key.length !== 1) {
    return undefined;
  }
  const code = key.charCodeAt(0);
  if (code >= 49 && code <= 57) {
    return code - 49;
  }
  const upper = key.toUpperCase().charCodeAt(0);
  if (upper >= 65 && upper <= 90) {
    return upper - 65;
  }
  return undefined;
}
