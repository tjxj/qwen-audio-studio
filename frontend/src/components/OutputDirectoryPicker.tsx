import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { request } from "../api";
export interface Directory {
  id: string;
  display_name: string;
  display_path?: string;
  writable?: boolean;
}
export function OutputDirectoryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [directory, setDirectory] = useState<Directory | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Directory>(
      value
        ? `/api/directories/${encodeURIComponent(value)}`
        : "/api/directories/default",
    )
      .then((d) => {
        if (active) setDirectory(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value]);
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        cancelled: boolean;
        directory?: Directory;
      }>("/api/directories/choose", "POST", {});
      if (!result.cancelled && result.directory) {
        setDirectory(result.directory);
        onChange(result.directory.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法选择目录");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="output-directory-picker">
      <FolderOpen size={18} />
      <span className="directory-name">
        {directory?.display_name || "默认文件夹"}
      </span>
      <button
        onClick={() => void choose()}
        disabled={busy}
        aria-label="选择输出文件夹"
      >
        {busy ? "选择中…" : "更改"}
      </button>
      {error ? (
        <span role="alert" className="error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
