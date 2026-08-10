// 桌面端左右分栏（规格 20）：Tutor Transcript | Active Panel；
// 移动端纵向。顶部 Course/Topic + 连接状态 + Mastery，底部 ProgressPanel。

import { useEffect } from "react";

import { initialize, useLearningWorkspace } from "./state/store";
import type { LearningInteraction } from "./types/protocol";
import CodeExercise from "./components/CodeExercise";
import FreeResponse from "./components/FreeResponse";
import MultiChoice from "./components/MultiChoice";
import ProgressPanel from "./components/ProgressPanel";
import SingleChoice from "./components/SingleChoice";
import StatusBar from "./components/StatusBar";
import TutorTranscript from "./components/TutorTranscript";

export default function App(): React.JSX.Element {
  const bootError = useLearningWorkspace((s) => s.bootError);
  const session = useLearningWorkspace((s) => s.session);

  useEffect(() => {
    void initialize();
    return () => {
      useLearningWorkspace.getState().disconnect();
    };
  }, []);

  if (bootError !== null) {
    return (
      <div className="boot-error">
        <h1>无法打开学习工作台</h1>
        <p>{bootError}</p>
        <p className="muted">
          在 Pi 会话中运行 <code>/learn</code> 或 <code>/learn-open</code>{" "}
          获取带 token 的链接。
        </p>
      </div>
    );
  }

  const course = session?.course?.title ?? "未进入学习模式";
  const topic = session?.topic?.title;

  return (
    <div className="workspace">
      <header className="app-header">
        <div className="header-course">
          <span className="course-title">{course}</span>
          {topic !== undefined && <span className="topic-title">/ {topic}</span>}
        </div>
        <StatusBar />
      </header>
      <main className="main-grid">
        <section className="pane transcript-pane" aria-label="Tutor Transcript">
          <TutorTranscript />
        </section>
        <section className="pane active-pane" aria-label="Active Interaction">
          <ActivePanel />
        </section>
      </main>
      <ProgressPanel />
    </div>
  );
}

function ActivePanel(): React.JSX.Element {
  const pending = useLearningWorkspace((s) => s.pending);
  const first = pending[0];

  if (first === undefined) {
    return (
      <div className="waiting">
        <p>等待 Tutor 出题…</p>
        <p className="muted">题目会出现在这里，答案将作为结构化结果返回给 Tutor。</p>
      </div>
    );
  }
  return <InteractionView key={first.id} interaction={first} />;
}

function InteractionView({
  interaction
}: {
  interaction: LearningInteraction;
}): React.JSX.Element {
  switch (interaction.type) {
    case "single_choice":
      return <SingleChoice interaction={interaction} />;
    case "multi_choice":
      return <MultiChoice interaction={interaction} />;
    case "free_response":
      return <FreeResponse interaction={interaction} />;
    case "code":
      return <CodeExercise interaction={interaction} />;
  }
}
