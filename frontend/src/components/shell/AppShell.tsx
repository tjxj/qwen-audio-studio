import {useEffect, useState, type ReactNode} from "react";
import {ProjectHeader} from "./ProjectHeader";
import {SideNavigation} from "./SideNavigation";

export function AppShell({children}: {children: ReactNode}) {
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  useEffect(() => {
    let active = true;
    const check = () => fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("health check failed");
        if (active) setConnection("connected");
      })
      .catch(() => { if (active) setConnection("disconnected"); });
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return (
    <div className="app-shell">
      <SideNavigation />
      <div className="app-stage">
        <ProjectHeader connection={connection} />
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
