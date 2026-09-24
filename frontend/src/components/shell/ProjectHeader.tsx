import { Circle } from "lucide-react";
import { useLocation } from "react-router-dom";
import {ThemeToggle} from './ThemeToggle';

export function ProjectHeader({
  connection,
}: {
  connection: "connecting" | "connected" | "disconnected";
}) {
  const label =
    connection === "connected"
      ? "已连接"
      : connection === "disconnected"
        ? "已断开"
        : "正在连接";
  const path = useLocation().pathname;
  const title = path.startsWith("/results")
    ? "结果试听"
    : {
        "/": "创作台",
        "/library": "作品库",
        "/templates": "灵感模板",
        "/settings": "设置",
        "/help": "帮助",
      }[path] || "工作台";
  return (
    <header className="project-header">
      <div className="project-title">
        <strong>{title}</strong>
      </div>
      <div className="header-actions">
        <span className={`connection-status ${connection}`}>
          <Circle size={8} fill="currentColor" />
          本地服务{label}
        </span>
        <ThemeToggle/>
      </div>
    </header>
  );
}
