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
    [revealing,setRevealing] = useState(false),
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
      <button className="directory-reveal" aria-label="在Finder中打开输出文件夹" title="在 Finder 中打开" disabled={!directory?.id||busy||revealing} onClick={async()=>{if(!directory)return;setRevealing(true);setError('');try{await request('/api/directories/'+encodeURIComponent(directory.id)+'/reveal','POST',{})}catch(e){setError(e instanceof Error?e.message:'无法打开文件夹')}finally{setRevealing(false)}}}><FolderOpen size={18}/></button>
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
