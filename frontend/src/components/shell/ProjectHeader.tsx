import {Circle, Settings2} from "lucide-react";
import {Link} from "react-router-dom";

export function ProjectHeader({connection}: {connection: "connecting" | "connected" | "disconnected"}) {
  const label = connection === "connected" ? "已连接" : connection === "disconnected" ? "已断开" : "正在连接";
  return (
    <header className="project-header">
      <div className="project-title">
        <span>当前项目</span>
        <strong>本地声音项目</strong>
      </div>
      <div className="header-actions">
        <span className={`connection-status ${connection}`}>
          <Circle size={8} fill="currentColor" />
          本地 · {label}
        </span>
        <Link to="/settings" className="icon-button" aria-label="打开设置">
          <Settings2 size={19} />
        </Link>
      </div>
    </header>
  );
}
