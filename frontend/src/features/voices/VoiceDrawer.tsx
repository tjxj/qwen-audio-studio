import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Check, Mic2 } from "lucide-react";
import { Modal } from "../../components/Modal";
import { request, upload } from "../../api";

export interface VoiceReference {
  id: string;
  name: string;
  asset_id: string;
  persistent: boolean;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  bytes: number;
  warnings?: string[];
}
interface Imported {
  import_id: string;
  name: string;
  preview_asset_id: string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  needs_trim: boolean;
}
export function VoiceDrawer({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (voice: VoiceReference) => void;
}) {
  const [tab, setTab] = useState<"upload" | "saved">("upload"),
    [saved, setSaved] = useState<VoiceReference[]>([]),
    [imported, setImported] = useState<Imported | null>(null),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0),
    [name, setName] = useState(""),
    [persistent, setPersistent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [prepared, setPrepared] = useState<VoiceReference | null>(null),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const refresh = () =>
    request<VoiceReference[]>("/api/references?persistent=true")
      .then(setSaved)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const value = await upload<Imported>("/api/reference-imports", file);
      setImported(value);
      setName(file.name.replace(/\.[^.]+$/, ""));
      setStart(0);
      setEnd(value.duration_seconds);
      setPrepared(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "音频读取失败");
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    if (!imported) return;
    setBusy(true);
    setError("");
    try {
      const voice = await request<VoiceReference>(
        "/api/reference-imports/" + imported.import_id + "/prepare",
        "POST",
        {
          start_seconds: start,
          end_seconds: end,
          name: name.trim() || "我的声音",
          persistent,
        },
      );
      setPrepared(voice);
      if (persistent) void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "片段准备失败");
    } finally {
      setBusy(false);
    }
  };
  const valid =
    !!imported &&
    start >= 0 &&
    end > start &&
    end <= imported.duration_seconds + 0.005 &&
    end - start <= 30;
  return (
    <Modal title="参考音色" wide onClose={onClose}>
      <div className="page-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "upload"}
          onClick={() => setTab("upload")}
        >
          上传与裁剪
        </button>
        <button
          role="tab"
          aria-selected={tab === "saved"}
          onClick={() => setTab("saved")}
        >
          我的音色
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {tab === "upload" ? (
        <div className="reference-import">
          {!imported ? (
            <label
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void importFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload size={26} />
              <strong>{busy ? "正在读取音频…" : "选择文件，或拖到这里"}</strong>
              <span className="hint">
                WAV / MP3 / OGG Opus / M4A · 源文件最长 10 分钟、50 MB
              </span>
              <input
                aria-label="导入参考音频"
                type="file"
                accept=".wav,.mp3,.ogg,.m4a"
                disabled={busy}
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            </label>
          ) : (
            <>
              <div>
                <strong>{imported.name}</strong>
                <p className="hint">
                  {imported.duration_seconds.toFixed(2)} 秒 ·{" "}
                  {imported.sample_rate / 1000} kHz · {imported.channels} 声道
                </p>
              </div>
              <audio
                ref={audio}
                controls
                src={"/api/media/" + imported.preview_asset_id}
                onTimeUpdate={() => {
                  if (
                    audio.current &&
                    !audio.current.paused &&
                    audio.current.currentTime >= end
                  )
                    audio.current.pause();
                }}
              />
              <div className="trim-fields">
                <label>
                  起点（秒）
                  <input
                    aria-label="裁剪起点"
                    type="number"
                    min={0}
                    max={imported.duration_seconds}
                    step=".1"
                    value={start}
                    onChange={(e) => {
                      setStart(Number(e.target.value));
                      setPrepared(null);
                    }}
                  />
                </label>
                <label>
                  终点（秒）
                  <input
                    aria-label="裁剪终点"
                    type="number"
                    min={0}
                    max={imported.duration_seconds}
                    step=".1"
                    value={end}
                    onChange={(e) => {
                      setEnd(Number(e.target.value));
                      setPrepared(null);
                    }}
                  />
                </label>
              </div>
              <div>
                <button
                  onClick={() => {
                    if (audio.current) {
                      audio.current.currentTime = start;
                      void audio.current
                        .play()
                        .catch(() => setError("请重新点击播放"));
                    }
                  }}
                >
                  试听选区
                </button>
                <span className="hint">
                  {" "}
                  选中 {(end - start).toFixed(2)} 秒 · 成品最多 30 秒
                </span>
              </div>
              {!valid ? (
                <p className="inline-error">
                  请手动选择 0–30 秒的有效片段；不会自动截断录音。
                </p>
              ) : null}
              <label>
                音色名称
                <input
                  aria-label="音色名称"
                  value={name}
                  maxLength={120}
                  onChange={(e) => {
                    setName(e.target.value);
                    setPrepared(null);
                  }}
                />
              </label>
              <label className="toggle-row">
                <span>保存到我的音色，方便下次使用</span>
                <input
                  type="checkbox"
                  checked={persistent}
                  onChange={(e) => {
                    setPersistent(e.target.checked);
                    setPrepared(null);
                  }}
                />
              </label>
              <p className="hint">
                本地处理为单声道
                WAV，原文件保持不变。生成时仍需确认本次上传至阿里云。
              </p>
              {prepared ? (
                <div className="inline-info">
                  <Check size={16} /> 片段已准备 ·{" "}
                  {prepared.duration_seconds.toFixed(2)} 秒{" "}
                  {prepared.warnings?.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              ) : null}
              <div className="modal-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setImported(null);
                    setPrepared(null);
                  }}
                >
                  重新选择
                </button>
                {prepared ? (
                  <button
                    className="primary"
                    onClick={() => {
                      onSelect(prepared);
                      onClose();
                    }}
                  >
                    应用这个音色
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={!valid || busy}
                    onClick={() => void prepare()}
                  >
                    {busy ? "正在处理…" : "准备片段"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div>
          {!saved.length ? (
            <div className="empty-state">
              <Mic2 size={32} />
              <h2>留住你喜欢的声音</h2>
              <p>上传片段时勾选保存，就能在这里重复使用。</p>
              <button onClick={() => setTab("upload")}>添加音色</button>
            </div>
          ) : (
            saved.map((voice) => (
              <div className="saved-voice" key={voice.id}>
                <div>
                  <strong>{voice.name}</strong>
                  <small>
                    {voice.duration_seconds.toFixed(1)} 秒 ·{" "}
                    {voice.sample_rate / 1000} kHz
                  </small>
                </div>
                <audio controls src={"/api/media/" + voice.asset_id} />
                <button
                  onClick={() => {
                    onSelect(voice);
                    onClose();
                  }}
                >
                  使用
                </button>
                <button
                  className="icon-button"
                  aria-label={"删除音色 " + voice.name}
                  onClick={() => setConfirmDelete(voice.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {confirmDelete ? (
        <div className="inline-error">
          <span>删除这个本地音色？已生成音频不受影响。</span>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("/api/references/" + confirmDelete, "DELETE");
                setConfirmDelete(null);
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : "删除失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            确认删除
          </button>
          <button onClick={() => setConfirmDelete(null)}>保留</button>
        </div>
      ) : null}
    </Modal>
  );
}
