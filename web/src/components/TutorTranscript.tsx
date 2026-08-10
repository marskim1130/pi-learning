// Tutor Transcript（规格 26/27）：渲染已提交记录与 tutor 消息。
// tutor 消息用 marked 渲染 markdown/code block，公式段走 KaTeX（规格 20 的
// Transcript 区域；混合渲染见 MathText 的分段策略）。

import { useEffect, useRef } from "react";

import MathText from "./MathText";
import { useLearningWorkspace } from "../state/store";
import type { TranscriptEntry } from "../state/store";

export default function TutorTranscript(): React.JSX.Element {
  const transcript = useLearningWorkspace((s) => s.transcript);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcript]);

  if (transcript.length === 0) {
    return <p className="muted empty-transcript">还没有学习记录，等待 Tutor 出题…</p>;
  }

  return (
    <div className="transcript" ref={listRef}>
      {transcript.map((entry) => (
        <TranscriptItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function TranscriptItem({ entry }: { entry: TranscriptEntry }): React.JSX.Element {
  if (entry.kind === "submitted") {
    return (
      <div className="entry entry-submitted">
        <div className="entry-head">已提交</div>
        {entry.question !== undefined && (
          <div className="entry-question">{entry.question}</div>
        )}
        <div className="entry-answer">{entry.answerText}</div>
      </div>
    );
  }
  if (entry.kind === "tutor_message") {
    return (
      <div className="entry entry-tutor">
        <div className="entry-head">
          {entry.role === "user" ? "你" : "Tutor"}
          {entry.done === false && <span className="streaming-dot" />}
        </div>
        <MathText text={entry.text ?? ""} />
      </div>
    );
  }
  return (
    <div className="entry entry-status">
      <span className="pill">{entry.status}</span>
    </div>
  );
}
