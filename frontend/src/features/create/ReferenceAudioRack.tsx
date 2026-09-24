import { FileAudio2, Plus, Trash2, UploadCloud } from "lucide-react";
import type { PreparedReference } from "../../types";

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(0) + " KB"
    : (bytes / 1024 / 1024).toFixed(1) + " MB";
}

export function ReferenceAudioRack({
  references,
  onAdd,
  onRemove,
  busy,
}: {
  references: PreparedReference[];
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <section className="reference-rack">
      <div className="section-heading">
        <div>
          <span>参考音频</span>
          <strong>音色参考 ({references.length}/3)</strong>
        </div>
        <UploadCloud size={17} />
      </div>
      <div className="reference-list">
        {references.map((item, index) => (
          <article className="reference-item" key={item.id}>
            <div className="reference-play">
              <FileAudio2 size={17} />
            </div>
            <div>
              <strong>
                音频{index + 1} · {item.name}
              </strong>
              <span>
                {item.duration_seconds.toFixed(1)}s · {formatBytes(item.bytes)}
              </span>
            </div>
            <button
              type="button"
              className="ghost-icon"
              aria-label={"移除 " + item.name}
              onClick={() => onRemove(item.id)}
            >
              <Trash2 size={15} />
            </button>
          </article>
        ))}
        {references.length < 3 ? (
          <label className={busy ? "reference-drop is-busy" : "reference-drop"}>
            <Plus size={18} />
            <span>{busy ? "正在检查音频…" : "拖入文件，或点击选择"}</span>
            <small>WAV / MP3 / OGG Opus · 30 秒内 · 10MB 内</small>
            <input
              type="file"
              accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAdd(file);
                event.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
