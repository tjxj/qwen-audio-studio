import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Search,
  Star,
  UsersRound,
} from "lucide-react";
import type {
  CreationMode,
  GenerationParams,
  ReferenceBinding,
} from "../../types";
import {
  deleteTemplate,
  favoriteTemplate,
  listTemplates,
  savePendingTemplate,
  type StudioTemplate,
  type TemplateChoice,
} from "./templatesApi";
import { TemplatePreviewPanel } from "./TemplatePreviewDialog";
import { TemplateEditor, TEMPLATE_MODE_LABELS } from "./TemplateEditor";
import { TemplateDialog } from "./TemplateDialog";
import "./templates.css";

export interface TemplateLibraryProps {
  onApply?: (choice: TemplateChoice) => void | Promise<void>;
  currentPrompt?: string;
  referenceBindings?: ReferenceBinding[];
  currentParams?: GenerationParams;
  initialMode?: CreationMode;
  initialTemplateId?: string;
  embedded?: boolean;
}
export function TemplateLibrary({
  onApply,
  currentPrompt,
  referenceBindings,
  currentParams,
  initialMode,
  initialTemplateId,
  embedded = false,
}: TemplateLibraryProps) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [mode, setMode] = useState<CreationMode | "">(initialMode || "");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const [favorite, setFavorite] = useState(false);
  const [source, setSource] = useState<"builtin" | "user" | "">("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTemplateId || null,
  );
  const [mobilePreview, setMobilePreview] = useState(false);
  const [editor, setEditor] = useState<{
    template?: StudioTemplate;
    duplicate?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<StudioTemplate | null>(null);
  const [error, setError] = useState("");
  const templates = useQuery({
    queryKey: ["templates", mode, query, favorite, source, page],
    queryFn: () =>
      listTemplates({
        mode: mode || undefined,
        q: query,
        favorite: favorite || undefined,
        source: source || undefined,
        page,
        page_size: 50,
      }),
    staleTime: 30_000,
  });
  const selected =
    templates.data?.items.find((item) => item.id === selectedId) ||
    templates.data?.items[0];
  const favoriteAction = useMutation({
    mutationFn: (item: StudioTemplate) =>
      favoriteTemplate(item.id, !item.favorite),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (failure) => setError(failure.message),
  });
  const deleteAction = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      setDeleting(null);
      setSelectedId(null);
      void cache.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (failure) => setError(failure.message),
  });
  function apply(choice: TemplateChoice) {
    if (onApply) return onApply(choice);
    savePendingTemplate(choice);
    navigate("/?applyTemplate=1");
  }
  function resetFilters(change: () => void) {
    change();
    setPage(1);
    setSelectedId(null);
    setMobilePreview(false);
  }
  return (
    <div className={`tpl-library ${embedded ? "tpl-library-embedded" : ""}`}>
      {!embedded ? (
        <header className="tpl-page-heading">
          <div>
            <h1>从一个灵感开始</h1>
            <p>42 个原创声音场景，换上你的故事。</p>
          </div>
          <button
            className="tpl-secondary"
            type="button"
            onClick={() => setEditor({})}
          >
            <Plus size={17} />
            自建模板
          </button>
        </header>
      ) : null}
      <div className="tpl-mode-tabs" aria-label="模板模式筛选">
        <button
          type="button"
          aria-pressed={!mode}
          onClick={() => resetFilters(() => setMode(""))}
        >
          全部
        </button>
        {Object.entries(TEMPLATE_MODE_LABELS).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => resetFilters(() => setMode(value as CreationMode))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tpl-toolbar">
        <label className="tpl-search">
          <Search size={17} />
          <input
            aria-label="搜索模板"
            placeholder="搜索场景、标题或标签"
            value={q}
            onChange={(event) => resetFilters(() => setQ(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="tpl-filter"
          aria-pressed={favorite}
          onClick={() => resetFilters(() => setFavorite(!favorite))}
        >
          <Star size={16} fill={favorite ? "currentColor" : "none"} />
          已收藏
        </button>
        <select
          aria-label="模板来源"
          value={source}
          onChange={(event) =>
            resetFilters(() => setSource(event.target.value as typeof source))
          }
        >
          <option value="">全部来源</option>
          <option value="builtin">内置模板</option>
          <option value="user">我的模板</option>
        </select>
        {embedded ? (
          <button
            type="button"
            className="tpl-icon-button"
            title="自建模板"
            aria-label="自建模板"
            onClick={() => setEditor({})}
          >
            <Plus size={18} />
          </button>
        ) : null}
        <span className="tpl-result-count">
          {templates.data?.total ?? 0} 个场景
        </span>
      </div>
      {error ? (
        <p className="tpl-warning" role="alert">
          {error}
          <button
            type="button"
            className="tpl-text-button"
            onClick={() => setError("")}
          >
            关闭提示
          </button>
        </p>
      ) : null}
      <div className={`tpl-body ${mobilePreview ? "tpl-mobile-preview" : ""}`}>
        <div className="tpl-list-side">
          {templates.isPending ? (
            <div className="tpl-empty" role="status">
              正在整理灵感…
            </div>
          ) : templates.error ? (
            <div className="tpl-empty" role="alert">
              <h2>暂时未能加载模板</h2>
              <p>{templates.error.message}</p>
              <button type="button" onClick={() => void templates.refetch()}>
                重新加载
              </button>
            </div>
          ) : !templates.data?.items.length ? (
            <div className="tpl-empty">
              <h2>这里还没有模板</h2>
              <p>
                {favorite
                  ? "收藏喜欢的场景，它们就会出现在这里。"
                  : "换个关键词，或为自己创建一个模板。"}
              </p>
              <button type="button" onClick={() => setEditor({})}>
                创建模板
              </button>
            </div>
          ) : (
            <div className="tpl-cards">
              {templates.data.items.map((template, index) => (
                <article
                  key={template.id}
                  className={`tpl-card ${selected?.id === template.id ? "is-selected" : ""}`}
                >
                  <button
                    className="tpl-card-main"
                    type="button"
                    aria-label={`预览${template.name}`}
                    aria-pressed={selected?.id === template.id}
                    onClick={() => {
                      setSelectedId(template.id);
                      setMobilePreview(true);
                    }}
                  >
                    <span className="tpl-card-overline">
                      <span>{TEMPLATE_MODE_LABELS[template.mode]}</span>
                      <span>
                        {String((page - 1) * 50 + index + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <h2>{template.name}</h2>
                    <p>{template.description}</p>
                    <span className="tpl-card-meta">
                      <span>
                        <UsersRound size={13} />
                        {template.role_count
                          ? `${template.role_count} 人`
                          : "无人声"}
                      </span>
                      <span>
                        {template.suggested_duration_seconds
                          ? `建议 ${template.suggested_duration_seconds} 秒`
                          : "自由时长"}
                      </span>
                      {template.source === "user" ? <span>自建</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tpl-card-favorite"
                    aria-label={`${template.favorite ? "取消收藏" : "收藏"}${template.name}`}
                    aria-pressed={template.favorite}
                    disabled={favoriteAction.isPending}
                    onClick={() => favoriteAction.mutate(template)}
                  >
                    <Star
                      size={17}
                      fill={template.favorite ? "currentColor" : "none"}
                    />
                  </button>
                </article>
              ))}
            </div>
          )}
          {templates.data && templates.data.total > 50 ? (
            <div className="tpl-pagination">
              <button
                type="button"
                aria-label="上一页"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ArrowLeft size={16} />
              </button>
              <span>
                {page} / {Math.ceil(templates.data.total / 50)}
              </span>
              <button
                type="button"
                aria-label="下一页"
                disabled={page * 50 >= templates.data.total}
                onClick={() => setPage(page + 1)}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}
        </div>
        {selected ? (
          <div className="tpl-detail-side">
            <button
              type="button"
              className="tpl-mobile-back"
              onClick={() => setMobilePreview(false)}
            >
              <ArrowLeft size={16} />
              返回模板
            </button>
            <TemplatePreviewPanel
              key={`${selected.id}:${selected.version}`}
              template={selected}
              currentPrompt={currentPrompt}
              onApply={apply}
              referenceBindings={referenceBindings}
              currentParams={currentParams}
              onCopy={() => setEditor({ template: selected, duplicate: true })}
              onEdit={() => setEditor({ template: selected })}
              onDelete={() => setDeleting(selected)}
            />
          </div>
        ) : null}
      </div>
      {editor ? (
        <TemplateEditor
          initial={editor.template}
          duplicate={editor.duplicate}
          onClose={() => setEditor(null)}
          onSaved={(template) => {
            setEditor(null);
            setMode("");
            setSource("user");
            setFavorite(false);
            setQ("");
            setPage(1);
            setSelectedId(template.id);
            setMobilePreview(true);
            void cache.invalidateQueries({ queryKey: ["templates"] });
          }}
        />
      ) : null}
      {deleting ? (
        <TemplateDialog
          title="删除自建模板？"
          onClose={() => !deleteAction.isPending && setDeleting(null)}
        >
          <div className="tpl-confirm-content">
            <p>
              “{deleting.name}
              ”将从模板库中移除，已保存的草稿和生成记录不会改变。
            </p>
          </div>
          <div className="tpl-dialog-actions">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={deleteAction.isPending}
            >
              保留
            </button>
            <button
              type="button"
              className="tpl-primary"
              disabled={deleteAction.isPending}
              onClick={() => deleteAction.mutate(deleting.id)}
            >
              {deleteAction.isPending ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </TemplateDialog>
      ) : null}
    </div>
  );
}

export function TemplatePicker({
  open,
  onClose,
  mode,
  ...props
}: Omit<TemplateLibraryProps, "initialMode" | "embedded"> & {
  open: boolean;
  onClose: () => void;
  mode?: CreationMode;
}) {
  if (!open) return null;
  return (
    <TemplateDialog title="灵感模板" onClose={onClose} wide>
      <TemplateLibrary {...props} initialMode={mode} embedded />
    </TemplateDialog>
  );
}
