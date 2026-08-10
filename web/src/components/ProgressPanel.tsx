// 学习进度面板（底部）：course/topic/phase 与各概念 mastery 百分比条。

import { useLearningWorkspace } from "../state/store";
import type { LearningPhase } from "../types/protocol";

const PHASE_TEXT: Record<LearningPhase, string> = {
  idle: "空闲",
  diagnosing: "诊断中",
  explaining: "讲解中",
  checking: "检查中",
  practicing: "练习中",
  reviewing: "复习中"
};

export default function ProgressPanel(): React.JSX.Element {
  const session = useLearningWorkspace((s) => s.session);

  if (session === null) {
    return (
      <footer className="progress-panel">
        <span className="muted">正在加载学习进度…</span>
      </footer>
    );
  }

  const concepts = session.concepts;
  const mastery =
    concepts.length === 0
      ? null
      : Math.round(
          concepts.reduce((sum, c) => sum + c.mastery, 0) / concepts.length
        );

  return (
    <footer className="progress-panel">
      <div className="progress-head">
        <span>
          <strong>
            {session.course?.title ?? "未进入学习模式"}
            {session.topic?.title !== undefined ? ` / ${session.topic.title}` : ""}
          </strong>
        </span>
        <span className="phase-badge">{PHASE_TEXT[session.phase]}</span>
        {mastery !== null && <span>总体掌握度 {mastery}%</span>}
      </div>
      {concepts.length === 0 ? (
        <p className="muted">还没有概念进度。Tutor 讲解并出题后会出现在这里。</p>
      ) : (
        <div className="concept-list">
          {concepts.map((concept) => (
            <div key={concept.id} className="concept">
              <span className="concept-title" title={concept.title}>
                {concept.title}
              </span>
              <div className="bar" role="progressbar" aria-valuenow={concept.mastery} aria-valuemin={0} aria-valuemax={100} aria-label={`${concept.title} 掌握度`}>
                <div
                  className="bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, concept.mastery))}%` }}
                />
              </div>
              <span className="concept-mastery">{concept.mastery}%</span>
              <span className="muted">
                尝试 {concept.attempts} · 正确 {concept.correct}
              </span>
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}
