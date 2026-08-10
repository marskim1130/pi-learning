// 多选组件（规格 22）：checkbox 支持多选，明确提示“可能有多个正确答案”，
// 提交前至少选一个（无 skip answer，故提交按钮在零选择时禁用），提交后锁定。
// 键盘：空格切换聚焦选项（原生 checkbox 行为）、数字/字母键直接切换对应选项，Enter 提交。

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import MathText from "./MathText";
import { client, describeSubmitError } from "../api/client";
import { useLearningWorkspace } from "../state/store";
import type { MultiChoiceInteraction } from "../types/protocol";

export default function MultiChoice({
  interaction
}: {
  interaction: MultiChoiceInteraction;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = submitting;

  function toggle(optionId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFieldSetElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (selected.size > 0 && !locked) {
        void doSubmit();
      }
      return;
    }
    const index = optionIndexForKey(event.key);
    const option = index === undefined ? undefined : interaction.options[index];
    if (option !== undefined && !locked) {
      event.preventDefault();
      toggle(option.id);
    }
  }

  async function doSubmit(): Promise<void> {
    if (submitting || selected.size === 0) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const optionIds = [...selected];
      const result = await client.submit(interaction.id, { optionIds });
      const labels = interaction.options
        .filter((o) => selected.has(o.id))
        .map((o) => o.label)
        .join("、");
      useLearningWorkspace
        .getState()
        .submitSuccess(interaction, result.answer, labels);
    } catch (err) {
      setError(describeSubmitError(err));
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selected.size > 0 && !locked) {
      void doSubmit();
    }
  }

  return (
    <form className="interaction" onSubmit={handleSubmit}>
      <h2 className="interaction-title">{interaction.title ?? "多选题"}</h2>
      <MathText text={interaction.question} className="interaction-question" />
      <p className="muted multi-choice-hint">可能有多个正确答案，请选择所有正确的选项。</p>
      <fieldset
        className="options"
        onKeyDown={handleKeyDown}
        disabled={locked}
        aria-label="选项（可多选）"
      >
        {interaction.options.map((option, index) => (
          <label
            key={option.id}
            className={`option ${selected.has(option.id) ? "selected" : ""}`}
          >
            <input
              type="checkbox"
              name={`multi-choice-${interaction.id}`}
              value={option.id}
              checked={selected.has(option.id)}
              onChange={() => toggle(option.id)}
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
          disabled={selected.size === 0 || locked}
        >
          {submitting ? "提交中…" : "提交答案"}
        </button>
        <span className="muted hint">
          {selected.size > 0
            ? `已选 ${selected.size} 项`
            : "1/2/3… 或 A/B/C 切换选项，Enter 提交"}
        </span>
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
