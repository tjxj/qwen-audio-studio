import {
  AudioLines,
  Folder,
  Lightbulb,
  CircleHelp,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";

const navigation = [
  { to: "/", label: "创作台", icon: AudioLines, end: true },
  { to: "/library", label: "作品库", icon: Folder },
  { to: "/templates", label: "灵感模板", icon: Lightbulb },
];

export function SideNavigation() {
  return (
    <aside className="side-navigation">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <AudioLines size={28} strokeWidth={1.8} />
        </div>
        <div>
          <strong>Qwen Audio</strong>
          <span>Studio</span>
        </div>
      </div>
      <nav aria-label="主导航">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              "nav-item" + (isActive ? " is-active" : "")
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={19} strokeWidth={1.7} />
                <span>{label}</span>
                {isActive ? <i aria-hidden="true" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="nav-footer">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            "nav-item" + (isActive ? " is-active" : "")
          }
        >
          <Settings size={19} /> <span>设置</span>
        </NavLink>
        <NavLink
          to="/help"
          className={({ isActive }) =>
            "nav-item" + (isActive ? " is-active" : "")
          }
        >
          <CircleHelp size={19} /> <span>帮助</span>
        </NavLink>
        <p className="nav-caption">让灵感，被听见。</p>
      </div>
    </aside>
  );
}
