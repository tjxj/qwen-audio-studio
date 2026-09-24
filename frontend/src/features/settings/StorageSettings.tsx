import { useEffect, useState } from "react";
import { OutputDirectoryPicker } from "../../components/OutputDirectoryPicker";
import { request, patchSettings, type SettingsPayload } from "../../api";
import { GenerationInspector } from "../create/GenerationInspector";
import { DEFAULT_PARAMS, type GenerationParams } from "../../types";
import { toServerParams } from "../../api";
import { Modal } from "../../components/Modal";
export function StorageSettings({
  settings,
  onSaved,
}: {
  settings: SettingsPayload | null;
  onSaved: (s: SettingsPayload) => void;
}) {
  const [usage, setUsage] = useState<Record<string, number>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const refresh = () =>
    request<Record<string, number>>("/api/storage/usage")
      .then(setUsage)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const save = async (patch: Record<string, unknown>) => {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await patchSettings({ expected_revision: settings.revision, ...patch }),
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const size = (n = 0) =>
    n < 1048576
      ? (n / 1024).toFixed(1) + " KB"
      : (n / 1048576).toFixed(1) + " MB";
  return (
    <>
      <div className="settings-group">
        <h2>文件与存储</h2>
        <p className="settings-note">
          新任务使用这里的默认目录，已有作品继续保留在原位置。
        </p>
        <OutputDirectoryPicker
          value={settings?.default_directory_id || null}
          onChange={(id) => void save({ default_directory_id: id })}
        />
        <p className="settings-hint">
          创作台也可以单次更改。只输出音频、脚本与报告，凭据继续留在钥匙串。
        </p>
        <div className="storage-stats">
          {[
            ["generated_bytes", "生成文件"],
            ["reference_bytes", "本地音色"],
            ["cache_bytes", "临时缓存"],
          ].map(([key, label]) => (
            <div key={key}>
              <strong>{size(usage[key])}</strong>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request("/api/storage/cleanup-cache", "POST", {});
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "清理失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          清理未使用的缓存
        </button>
        <p className="settings-hint">
          不删除作品与已保存音色，运行中使用的片段会保留。
        </p>
      </div>
      <div className="settings-group">
        <h2>默认输出参数</h2>
        <p className="settings-note">应用于新草稿，不改动现有作品。</p>
        <button
          onClick={() => {
            const p = settings?.default_params || {};
            setParams({
              ...DEFAULT_PARAMS,
              format: (p.format as GenerationParams["format"]) || "wav",
              sampleRate: Number(
                p.sample_rate || 48000,
              ) as GenerationParams["sampleRate"],
              channels: Number(p.channels || 2) as 1 | 2,
              volume: Number(p.volume ?? 50),
              rate: Number(p.rate ?? 1),
              seed: Number(p.seed ?? 42),
              enableCbr: Boolean(p.enable_cbr),
              bitRate: Number(p.bit_rate || 128),
              quality: Number(p.quality ?? 5),
              enableAigcTag: Boolean(p.enable_aigc_tag),
            });
            setEditing(true);
          }}
        >
          编辑默认参数
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? (
        <Modal title="默认输出参数" onClose={() => setEditing(false)}>
          <GenerationInspector value={params} onChange={setParams} />
          <div className="modal-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void save({ default_params: toServerParams(params) })
              }
            >
              保存默认参数
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
