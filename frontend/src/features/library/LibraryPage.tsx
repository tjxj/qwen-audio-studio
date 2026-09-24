import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Download,
  MoreHorizontal,
  Play,
  Star,
  FolderOpen,
  Copy,
  Trash2,
  RotateCcw,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  AudioLines,
} from "lucide-react";
import { getJob, mapJob, createProject, request } from "../../api";
import { Modal } from "../../components/Modal";
import { ABComparePlayer } from "../results/ABComparePlayer";
import type { Job, CreationMode } from "../../types";
import { LibraryFilters } from "./LibraryFilters";
type Row = {
  id: string;
  name?: string;
  project_id: string;
  project_name: string;
  display_name: string;
  mode: CreationMode;
  created_at: string;
  duration_seconds?: number;
  status: string;
  stage?: string;
  seed: number;
  favorite: boolean;
  can_play: boolean;
  file_available: boolean;
  output_asset_id: string;
  prompt: string;
  is_final?: boolean;
};
const modes: Record<string, string> = {
  podcast: "播客",
  advertisement: "广告",
  audiobook: "有声书",
  drama: "广播剧",
  game: "游戏配音",
  narration: "旁白",
  auto: "自定义",
};
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  success: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
};
const stages: Record<string, string> = {
  preparing: "准备中",
  requesting: "请求模型中",
  downloading: "下载中",
  validating: "验收中",
};
export default function LibraryPage() {
  const [search, setSearch] = useSearchParams(),
    navigate = useNavigate();
  const view = search.get("view") || "jobs",
    page = Number(search.get("page") || 1);
  const [data, setData] = useState<{ items: Row[]; total: number }>({
      items: [],
      total: 0,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [playing, setPlaying] = useState<Row | null>(null),
    [actions, setActions] = useState<Row | null>(null),
    [rename, setRename] = useState(""),
    [trash, setTrash] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [compare, setCompare] = useState<Job[] | null>(null),
    [notice, setNotice] = useState(""),
    [continueJob, setContinueJob] = useState<Job | null>(null);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearch(next, { replace: true });
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams(search);
    params.set("view", view);
    request<{ items: Row[]; total: number }>("/api/library?" + params)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search.toString(), tick]);
  useEffect(() => {
    if (
      !data.items.some((r) => r.status === "queued" || r.status === "running")
    )
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, 2500);
    return () => clearInterval(timer);
  }, [data.items]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const id = search.get("continue");
    if (id)
      getJob(id)
        .then(setContinueJob)
        .catch((e) => setError(e.message));
  }, [search.get("continue")]);
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : ids.length < 2
          ? [...ids, id]
          : ids,
    );
  const duration = (seconds?: number) =>
    seconds
      ? Math.floor(seconds / 60)
          .toString()
          .padStart(2, "0") +
        ":" +
        Math.floor(seconds % 60)
          .toString()
          .padStart(2, "0")
      : "—";
  return (
    <section className="library-page">
      <header className="page-heading">
        <div>
          <h1>作品库</h1>
          <p>每一次灵感，都有迹可循。</p>
        </div>
      </header>
      <div className="page-tabs" role="tablist">
        {[
          ["jobs", "全部生成"],
          ["projects", "项目"],
          ["trash", "回收站"],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={view === value}
            onClick={() => {
              setSelected([]);
              change("view", value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="library-filters">
        <input
          aria-label="搜索作品"
          placeholder="搜索作品、项目或文案…"
          value={search.get("q") || ""}
          onChange={(e) => change("q", e.target.value)}
        />
        <select
          aria-label="筛选类型"
          value={search.get("mode") || ""}
          onChange={(e) => change("mode", e.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(modes).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {view !== "projects" ? (
          <>
            <select
              aria-label="筛选状态"
              value={search.get("status") || ""}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">全部状态</option>
              {Object.entries(statuses).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button
              aria-pressed={search.get("favorite") === "true"}
              onClick={() =>
                change(
                  "favorite",
                  search.get("favorite") === "true" ? "" : "true",
                )
              }
            >
              <Star size={16} />
              收藏
            </button>
            <LibraryFilters
              search={search}
              onChange={(next) => setSearch(next, { replace: true })}
            />
          </>
        ) : null}
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="inline-info">
          {notice}
          <button className="quiet" onClick={() => setNotice("")}>
            关闭
          </button>
        </p>
      ) : null}
      <div className="library-table-wrap">
        {loading && !data.items.length ? (
          <div className="loading-state">正在加载作品…</div>
        ) : !data.items.length ? (
          <div className="empty-state">
            <AudioLines size={36} />
            <h2>{view === "trash" ? "回收站很干净" : "留下一段声音"}</h2>
            <p>
              {search.get("q")
                ? "没有匹配的作品，试试换个关键词。"
                : "从一个场景开始，把文字变成声音。"}
            </p>
            <Link className="text-link" to="/">
              前往创作台
            </Link>
          </div>
        ) : (
          <table className="library-table">
            <thead>
              <tr>
                <th aria-label="选择" />
                <th>作品名称</th>
                <th>类型</th>
                <th>创建时间</th>
                {view !== "projects" ? (
                  <>
                    <th>时长</th>
                    <th>状态</th>
                  </>
                ) : null}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {view === "jobs" && row.can_play ? (
                      <input
                        type="checkbox"
                        aria-label={"选择 " + row.display_name}
                        checked={selected.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={
                          selected.length === 2 && !selected.includes(row.id)
                        }
                      />
                    ) : null}
                  </td>
                  <td className="work-name">
                    <Link
                      to={
                        view === "projects"
                          ? "/?project=" + row.id
                          : "/results/" +
                            row.id +
                            "?from=" +
                            encodeURIComponent("/library?" + search)
                      }
                    >
                      {row.name || row.display_name || row.project_name}
                    </Link>
                    <small>
                      {view === "projects"
                        ? "本地草稿"
                        : (row.is_final ? "最终版本 · " : "") +
                          "Seed " +
                          row.seed}
                      {row.favorite ? " · 已收藏" : ""}
                    </small>
                  </td>
                  <td>{modes[row.mode]}</td>
                  <td>
                    {new Intl.DateTimeFormat("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(row.created_at))}
                  </td>
                  {view !== "projects" ? (
                    <>
                      <td className="num">{duration(row.duration_seconds)}</td>
                      <td className={"status-" + row.status}>
                        {row.status === "success" &&
                        !row.file_available &&
                        view !== "trash"
                          ? "文件缺失"
                          : stages[row.stage || ""] || statuses[row.status]}
                      </td>
                    </>
                  ) : null}
                  <td>
                    <div className="row-actions">
                      {view === "trash" ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              request(
                                "/api/jobs/" + row.id + "/restore",
                                "POST",
                                {},
                              ),
                            )
                          }
                        >
                          <RotateCcw size={15} />
                          恢复
                        </button>
                      ) : view === "projects" ? (
                        <Link className="text-link" to={"/?project=" + row.id}>
                          继续创作
                        </Link>
                      ) : (
                        <>
                          {row.can_play ? (
                            <button
                              className="icon-button"
                              aria-label={"试听 " + row.display_name}
                              onClick={() => setPlaying(row)}
                            >
                              <Play size={17} />
                            </button>
                          ) : null}
                          {row.file_available && row.status === "success" ? (
                            <a
                              className="icon-button"
                              aria-label={"下载 " + row.display_name}
                              href={
                                "/api/media/" +
                                row.output_asset_id +
                                "?download=true"
                              }
                              download
                            >
                              <Download size={17} />
                            </a>
                          ) : null}
                          <button
                            className="icon-button"
                            aria-label={"更多操作 " + row.display_name}
                            onClick={() => {
                              setActions(row);
                              setRename(row.display_name || row.project_name);
                            }}
                          >
                            <MoreHorizontal size={19} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {playing ? (
        <div className="library-playing">
          <strong>{playing.display_name}</strong>
          <audio
            key={playing.id}
            controls
            autoPlay
            src={"/api/media/" + playing.output_asset_id}
          />
          <button
            className="icon-button"
            aria-label="关闭试听"
            onClick={() => setPlaying(null)}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      <footer className="library-footer">
        {view === "jobs" ? (
          <button
            disabled={selected.length !== 2}
            onClick={() =>
              void act(async () => {
                setPlaying(null);
                setCompare(await Promise.all(selected.map(getJob)));
              })
            }
          >
            A/B 试听{selected.length ? " · " + selected.length + "/2" : ""}
          </button>
        ) : null}
        <div className="pagination">
          <span>共 {data.total} 条</span>
          <select
            aria-label="每页条数"
            value={search.get("page_size") || "20"}
            onChange={(e) => change("page_size", e.target.value)}
          >
            <option value="20">20 条 / 页</option>
            <option value="50">50 条 / 页</option>
          </select>
          <button
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => change("page", String(page - 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span>{page}</span>
          <button
            aria-label="下一页"
            disabled={
              page * Number(search.get("page_size") || 20) >= data.total
            }
            onClick={() => change("page", String(page + 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
      {actions ? (
        <Modal
          title={actions.display_name || "作品操作"}
          onClose={() => setActions(null)}
        >
          <label>
            作品显示名称
            <input
              aria-label="作品显示名称"
              value={rename}
              maxLength={120}
              onChange={(e) => setRename(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button
              disabled={busy || !rename.trim()}
              onClick={() =>
                void act(async () => {
                  await request("/api/jobs/" + actions.id, "PATCH", {
                    display_name: rename.trim(),
                  });
                  setActions(null);
                })
              }
            >
              保存名称
            </button>
          </div>
          <div className="action-grid">
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request("/api/jobs/" + actions.id, "PATCH", {
                    favorite: !actions.favorite,
                  });
                  setActions(null);
                })
              }
            >
              <Star size={16} />
              {actions.favorite ? "取消收藏" : "收藏作品"}
            </button>
            <button
              onClick={() =>
                void act(async () => {
                  await navigator.clipboard.writeText(actions.prompt);
                  setActions(null);
                  setNotice("Prompt 已复制");
                })
              }
            >
              <Copy size={16} />
              复制 Prompt
            </button>
            <button
              onClick={() =>
                void act(async () => {
                  setContinueJob(await getJob(actions.id));
                  setActions(null);
                })
              }
            >
              继续创作
            </button>
            <a
              className="text-link"
              href={"/api/jobs/" + actions.id + "/export-report?format=md"}
              download
            >
              <Download size={16} />
              导出验收报告
            </a>
            {actions.file_available ? (
              <button
                onClick={() =>
                  void act(() =>
                    request(
                      "/api/assets/" + actions.output_asset_id + "/reveal",
                      "POST",
                      {},
                    ),
                  )
                }
              >
                <FolderOpen size={16} />在 Finder 显示
              </button>
            ) : null}
            {actions.status === "queued" ? (
              <button
                onClick={() =>
                  void act(async () => {
                    await request(
                      "/api/jobs/" + actions.id + "/cancel",
                      "POST",
                      {},
                    );
                    setActions(null);
                  })
                }
              >
                取消排队
              </button>
            ) : null}
            {!["queued", "running"].includes(actions.status) ? (
              <button
                className="danger-text"
                onClick={() => {
                  setTrash(actions);
                  setActions(null);
                }}
              >
                <Trash2 size={16} />
                移入回收站
              </button>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {trash ? (
        <Modal title="移入回收站" onClose={() => setTrash(null)}>
          <p>
            可以随时恢复。请选择是否同时移动应用生成的音频和报告，原始参考录音不受影响。
          </p>
          <div className="modal-actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request("/api/jobs/" + trash.id + "/trash", "POST", {
                    scope: "record",
                  });
                  setTrash(null);
                  setSelected((ids) => ids.filter((id) => id !== trash.id));
                })
              }
            >
              只移除记录
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request("/api/jobs/" + trash.id + "/trash", "POST", {
                    scope: "record_and_files",
                  });
                  setTrash(null);
                  setSelected((ids) => ids.filter((id) => id !== trash.id));
                })
              }
            >
              记录与生成文件一起移入
            </button>
          </div>
        </Modal>
      ) : null}
      {continueJob ? (
        <Modal title="继续创作" onClose={() => setContinueJob(null)}>
          <p>使用当次生成的脚本与参数创建独立草稿，现有项目内容保留。</p>
          <div className="prompt-preview">{continueJob.prompt}</div>
          <p className="hint">
            将保留 {continueJob.referenceBindings?.length || 0}{" "}
            个参考音色绑定与当次输出目录。失效片段需重新选择，生成仍会再次确认上传。
          </p>
          <div className="modal-actions">
            <button onClick={() => setContinueJob(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const project = await createProject({
                    name: continueJob.projectName + " · 续作",
                    mode: continueJob.mode,
                    prompt: continueJob.prompt,
                    params: continueJob.params,
                    referenceBindings: continueJob.referenceBindings || [],
                    outputDirectoryId: continueJob.outputDirectoryId ?? null,
                  });
                  navigate("/?project=" + project.id);
                })
              }
            >
              创建续作草稿
            </button>
          </div>
        </Modal>
      ) : null}
      {compare ? (
        <Modal title="A/B 试听" wide onClose={() => setCompare(null)}>
          <ABComparePlayer variants={compare} />
        </Modal>
      ) : null}
    </section>
  );
}
