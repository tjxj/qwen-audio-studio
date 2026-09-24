import { useEffect, useState } from "react";
import { ListFilter } from "lucide-react";
import { listProjects } from "../../api";
import { Modal } from "../../components/Modal";
import type { Project } from "../../types";
export function LibraryFilters({
  search,
  onChange,
}: {
  search: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  const [open, setOpen] = useState(false),
    [projects, setProjects] = useState<Project[]>([]),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [project, setProject] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (open)
      listProjects()
        .then(setProjects)
        .catch(() => setError("项目列表暂时无法读取，日期筛选仍可使用。"));
  }, [open]);
  const count = ["from", "to", "project_id"].filter((key) =>
    search.has(key),
  ).length;
  const localDate = (stamp: string | null) =>
    stamp ? new Intl.DateTimeFormat("sv-SE").format(new Date(stamp)) : "";
  const start = () => {
    setFrom(localDate(search.get("from")));
    const end = search.get("to");
    if (end) {
      const date = new Date(end);
      date.setDate(date.getDate() - 1);
      setTo(localDate(date.toISOString()));
    } else setTo("");
    setProject(search.get("project_id") || "");
    setOpen(true);
  };
  const apply = () => {
    if (from && to && from > to) {
      setError("结束日期应不早于开始日期。");
      return;
    }
    const next = new URLSearchParams(search);
    for (const key of ["from", "to", "project_id", "page"]) next.delete(key);
    if (from) next.set("from", new Date(from + "T00:00:00").toISOString());
    if (to) {
      const date = new Date(to + "T00:00:00");
      date.setDate(date.getDate() + 1);
      next.set("to", date.toISOString());
    }
    if (project) next.set("project_id", project);
    onChange(next);
    setOpen(false);
  };
  return (
    <>
      <button aria-label="更多筛选" aria-pressed={count > 0} onClick={start}>
        <ListFilter size={16} />
        {count || null}
      </button>
      {open ? (
        <Modal title="筛选作品" onClose={() => setOpen(false)}>
          <div className="trim-fields">
            <label>
              开始日期
              <input
                aria-label="开始日期"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              结束日期
              <input
                aria-label="结束日期"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <label className="settings-field" style={{ marginTop: 18 }}>
            所属项目
            <select
              aria-label="所属项目"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">全部项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              onClick={() => {
                setFrom("");
                setTo("");
                setProject("");
                setError("");
              }}
            >
              清空条件
            </button>
            <button className="primary" onClick={apply}>
              应用筛选
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
