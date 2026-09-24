import { FileAudio2, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import type { PreparedReference } from "../../types";

export default function ReferenceLibraryPage({
  onPrepare,
  onDiscard,
}: {
  onPrepare: (file: File) => Promise<PreparedReference>;
  onDiscard?: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<PreparedReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prepare = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await onPrepare(file);
      setItems((current) => [...current, result].slice(0, 3));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "参考音频检查失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="data-page reference-library-page">
      <header>
        <div>
          <span>本地预检与临时缓存</span>
          <h1>音色参考</h1>
        </div>
        <FileAudio2 size={24} />
      </header>
      <div className="reference-privacy-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>先在本机验证，生成前再次确认</strong>
          <p>选择文件后只做格式、时长、大小与编码检查；尚未发送到云端。</p>
        </div>
      </div>
      <label className="reference-library-dropzone">
        <UploadCloud size={28} />
        <strong>{busy ? "正在检查音频…" : "选择参考音频"}</strong>
        <span>WAV / MP3 / OGG Opus · 每条不超过 30 秒、10 MB · 最多 3 条</span>
        <input
          ref={inputRef}
          aria-label="选择参考音频"
          type="file"
          accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
          disabled={busy || items.length >= 3}
          onChange={(event) => void prepare(event.target.files?.[0])}
        />
      </label>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="reference-library-list">
        {items.map((item, index) => (
          <article key={item.id}>
            <div className="reference-index">@voice{index + 1}</div>
            <div>
              <strong>{item.name}</strong>
              <span>
                {item.duration_seconds.toFixed(1)} 秒 ·{" "}
                {(item.bytes / 1024).toFixed(0)} KB · {item.codec}
              </span>
            </div>
            <button
              type="button"
              aria-label={`移除 ${item.name}`}
              onClick={() => {
                setItems((current) =>
                  current.filter((entry) => entry.id !== item.id),
                );
                if (onDiscard) void onDiscard(item.id);
              }}
            >
              <Trash2 size={16} />
            </button>
          </article>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="empty-state compact">
          <FileAudio2 size={25} />
          <strong>还没有已检查的参考音频</strong>
          <p>
            这里不会建立永久音色库。移除、成功生成或服务退出会立即清理；一小时以上缓存会在下次添加时清理。
          </p>
        </div>
      ) : null}
    </section>
  );
}
