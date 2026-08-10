// 连接状态 + 工作台 URL 提示。

import { useLearningWorkspace } from "../state/store";
import type { ConnectionStatus } from "../state/store";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "连接中…",
  connected: "已连接",
  disconnected: "已断开，重连中…"
};

export default function StatusBar(): React.JSX.Element {
  const status = useLearningWorkspace((s) => s.status);
  return (
    <div className="status-bar">
      <span className={`status-dot status-${status}`} aria-hidden="true" />
      <span>{STATUS_TEXT[status]}</span>
      <span className="workspace-url muted" title="本页即学习工作台">
        {window.location.origin}/
      </span>
    </div>
  );
}
