import {
  AudioLines,
  Clock3,
  Folder,
  Mic2,
  Settings,
  SlidersHorizontal
} from "lucide-react";
import {NavLink} from "react-router-dom";

const navigation = [
  {to: "/", label: "创作台", icon: AudioLines, end: true},
  {to: "/projects", label: "项目", icon: Folder},
  {to: "/references", label: "音色参考", icon: Mic2},
  {to: "/history", label: "生成历史", icon: Clock3},
  {to: "/settings", label: "设置", icon: Settings}
];

export function SideNavigation() {
  return (
    <aside className="side-navigation">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <SlidersHorizontal size={22} />
        </div>
        <div>
          <strong>Qwen Audio Studio</strong>
          <span>Acoustic Darkroom</span>
        </div>
      </div>
      <nav aria-label="主导航">
        {navigation.map(({to, label, icon: Icon, end}) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({isActive}) =>
              "nav-item" + (isActive ? " is-active" : "")
            }
          >
            {({isActive}) => (
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
        <div className="privacy-note">
          <Mic2 size={18} />
          <span>参考音频仅在确认后上传</span>
        </div>
        <div className="local-storage">
          <span>本地工作台</span>
          <div><b /> 数据留在此设备</div>
        </div>
      </div>
    </aside>
  );
}
