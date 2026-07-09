import { Archive, FileText, FolderOpen, Globe2, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { animate } from "animejs";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPicker } from "./FolderPicker";
import { SelectMenu } from "./SelectMenu";
import { isDesktopRuntime, pickLocalFiles, pickLocalFolder } from "../lib/desktop";
import { getSafeErrorMessage } from "../lib/redaction";
import { READING_STATUSES, type FolderNode, type ItemType, type ReadingStatus } from "../types";

export type ImportMode = "card" | "url" | "file" | "folder";

export type ImportDraft = {
  id: string;
  title: string;
  type: ItemType;
  filePath: string;
  folderId?: string;
  tags: string[];
  readingStatus: ReadingStatus;
  content: string;
};

type ImportDialogProps = {
  open: boolean;
  folders: FolderNode[];
  defaultFolderId?: string;
  onClose: () => void;
  onCreate: (input: {
    mode: ImportMode;
    title: string;
    titleProvided: boolean;
    type: ItemType;
    folderId?: string;
    content: string;
    sourceUrl?: string;
    filePath?: string;
    tags: string[];
    readingStatus?: ReadingStatus;
  }) => Promise<void>;
  onCreateBatch: (drafts: ImportDraft[]) => Promise<boolean | void>;
};

const MAX_BATCH_IMPORTS = 200;

const modes: Array<{ id: ImportMode; label: string; icon: LucideIcon }> = [
  { id: "card", label: "知识卡片", icon: FileText },
  { id: "url", label: "添加网址", icon: Globe2 },
  { id: "file", label: "文件路径", icon: Archive },
  { id: "folder", label: "资料文件夹", icon: FolderOpen },
];

export function ImportDialog({
  open,
  folders,
  defaultFolderId,
  onClose,
  onCreate,
  onCreateBatch,
}: ImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>("card");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const [tagText, setTagText] = useState("资料");
  const [folderId, setFolderId] = useState("");
  const [batchDrafts, setBatchDrafts] = useState<ImportDraft[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const savingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const pendingBatchDiscardRef = useRef(false);
  const desktop = isDesktopRuntime();
  const batchMode = batchDrafts.length > 0;
  const dirty = Boolean(
    title.trim() ||
      content.trim() ||
      sourceUrl.trim() ||
      filePath.trim() ||
      tagText.trim() !== "资料" ||
      batchDrafts.length > 0,
  );

  const reset = () => {
    setTitle("");
    setContent("");
    setSourceUrl("");
    setFilePath("");
    setTagText("资料");
    setFolderId(defaultFolderId ?? "");
    setBatchDrafts([]);
    setMessage("");
    setMode("card");
    pendingCloseRef.current = false;
    pendingBatchDiscardRef.current = false;
  };

  const close = (force = false) => {
    if (!force && savingRef.current) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (!force && dirty && !pendingCloseRef.current) {
      pendingCloseRef.current = true;
      setMessage("还有未保存的导入内容。再次点击关闭才会放弃这些内容。");
      return;
    }
    reset();
    onClose();
  };

  useEffect(() => {
    if (open) {
      setFolderId(defaultFolderId ?? "");
    }
  }, [defaultFolderId, open]);

  useEffect(() => {
    pendingCloseRef.current = false;
    pendingBatchDiscardRef.current = false;
  }, [batchDrafts, content, filePath, folderId, mode, sourceUrl, tagText, title]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    animate(dialogRef.current, {
      opacity: [0, 1],
      scale: [0.985, 1],
      duration: 180,
      easing: "outQuad",
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving]);

  const readingOptions = useMemo(
    () => READING_STATUSES.map((status) => ({ value: status, label: status })),
    [],
  );

  if (!open) return null;

  const handleModeChange = (nextMode: ImportMode) => {
    pendingCloseRef.current = false;
    setMode(nextMode);
    setBatchDrafts([]);
    setMessage("");
  };

  const handlePickFiles = async () => {
    setMessage("");
    try {
      const paths = await pickLocalFiles();
      if (paths.length === 0) return;
      if (paths.length > MAX_BATCH_IMPORTS) {
        setMessage(`一次最多导入 ${MAX_BATCH_IMPORTS} 个路径，请分批选择。`);
        return;
      }

      setMode("file");
      setBatchDrafts(createDraftsFromPaths(paths, "file", folderId || undefined));
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "选择文件失败。"));
    }
  };

  const handlePickSingleFile = async () => {
    setMessage("");
    try {
      const paths = await pickLocalFiles();
      if (paths.length === 0) return;
      const selectedPath = paths[0];

      setMode("file");
      setBatchDrafts([]);
      setFilePath(selectedPath);
      if (!title.trim()) {
        setTitle(getFileName(selectedPath));
      }
      if (paths.length > 1) {
        setMessage("已填入第一个文件；批量导入请用下方按钮。");
      }
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "选择文件失败。"));
    }
  };

  const handlePickFolder = async () => {
    setMessage("");
    try {
      const path = await pickLocalFolder();
      if (!path) return;
      setMode("folder");
      setBatchDrafts([]);
      setFilePath(path);
      if (!title.trim()) {
        setTitle(getFileName(path));
      }
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "选择文件夹失败。"));
    }
  };

  const submit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      if (batchMode) {
        const completed = await onCreateBatch(batchDrafts);
        if (completed === false) return;
        close(true);
        return;
      }

      const titleProvided = Boolean(title.trim());
      const finalType = mode === "folder" ? "project" : mode === "file" ? inferTypeFromPath(filePath) : mode === "url" ? "url" : "note";
      const finalTitle = title.trim() || getFallbackTitle(mode, sourceUrl, filePath, content);
      if (mode === "url" && !sourceUrl.trim()) {
        setMessage("请先填写网址。");
        return;
      }
      if ((mode === "file" || mode === "folder") && !filePath.trim()) {
        setMessage(mode === "folder" ? "请先选择或填写文件夹路径。" : "请先选择或填写文件路径。");
        return;
      }
      if (mode === "card" && !title.trim() && !content.trim()) {
        setMessage("请先写一点标题或内容。");
        return;
      }

      await onCreate({
        mode,
        title: finalTitle,
        titleProvided,
        type: finalType,
        folderId: folderId || undefined,
        content: content.trim(),
        sourceUrl: mode === "url" ? sourceUrl.trim() : undefined,
        filePath: mode === "file" || mode === "folder" ? filePath.trim() : undefined,
        tags: parseTags(tagText),
        readingStatus: getDefaultReadingStatus(finalType),
      });
      close(true);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<ImportDraft>) => {
    pendingCloseRef.current = false;
    setBatchDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  };

  const removeDraft = (id: string) => {
    pendingCloseRef.current = false;
    pendingBatchDiscardRef.current = false;
    setBatchDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const discardBatchDrafts = () => {
    if (savingRef.current) return;
    if (!pendingBatchDiscardRef.current) {
      pendingBatchDiscardRef.current = true;
      setMessage("批量导入草稿还没有保存。再次点击“返回单条导入”才会放弃这些草稿。");
      return;
    }
    setBatchDrafts([]);
    setMessage("");
    pendingBatchDiscardRef.current = false;
  };

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} aria-label="导入资料" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden p-5" role="dialog">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">导入资料</h2>
            <p className="truncate text-sm text-ink/52">资料库保存长期资料与知识卡片；日常流水请写到日志。</p>
          </div>
          <button
            className="soft-button flex h-9 w-9 items-center justify-center"
            disabled={saving}
            onClick={() => close()}
            aria-label="关闭导入资料"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {!batchMode && (
          <div className="mb-4 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {modes.map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;

              return (
                <button
                  key={item.id}
                  className={`flex h-10 items-center justify-center gap-2 rounded-[8px] border text-sm transition ${
                    active ? "border-copper/40 bg-copper/10 text-copper shadow-sm" : "border-line bg-surface text-ink/62 hover:border-copper/35 hover:bg-copper/10 hover:text-copper"
                  }`}
                  disabled={saving}
                  onClick={() => handleModeChange(item.id)}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {message && (
          <div className="mb-3 shrink-0 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm text-ink/70">
            {message}
          </div>
        )}

        {batchMode ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">批量导入回顾</p>
                <p className="text-xs text-ink/52">确认标题、类型、目录、标签和阅读状态后再写入资料库。</p>
              </div>
              <button
                className="soft-button h-9 px-3 text-sm"
                disabled={saving}
                onClick={discardBatchDrafts}
              >
                返回单条导入
              </button>
            </div>

            <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
              {batchDrafts.map((draft, index) => (
                <div key={draft.id} className="rounded-[8px] border border-line bg-surface p-3 shadow-card">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink/42">#{index + 1}</span>
                    <button
                      className="danger-icon-action h-8 w-8"
                      onClick={() => removeDraft(draft.id)}
                      title="移除"
                      aria-label="移除这条导入草稿"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_150px_minmax(0,1fr)]">
                    <label className="block text-xs font-medium text-ink/58">
                      标题
                      <input
                        value={draft.title}
                        onChange={(event) => updateDraft(draft.id, { title: event.target.value })}
                        className="field-control mt-1 h-10 w-full px-3 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-medium text-ink/58">
                      类型
                      <SelectMenu
                        value={draft.type}
                        options={[
                          { value: "document", label: "文档" },
                          { value: "archive", label: "压缩包" },
                          { value: "image", label: "图片" },
                          { value: "project", label: "项目/文件夹" },
                        ]}
                        onChange={(value) => updateDraft(draft.id, { type: value as ItemType })}
                      />
                    </label>
                    <label className="block text-xs font-medium text-ink/58">
                      阅读状态
                      <SelectMenu
                        value={draft.readingStatus}
                        options={readingOptions}
                        onChange={(value) => updateDraft(draft.id, { readingStatus: value as ReadingStatus })}
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="block text-xs font-medium text-ink/58">
                      标签
                      <input
                        value={draft.tags.join("，")}
                        onChange={(event) => updateDraft(draft.id, { tags: parseTags(event.target.value) })}
                        className="field-control mt-1 h-10 w-full px-3 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-medium text-ink/58">
                      放到目录
                      <div className="mt-1">
                        <FolderPicker
                          folders={folders}
                          value={draft.folderId}
                          onChange={(nextFolderId) => updateDraft(draft.id, { folderId: nextFolderId })}
                        />
                      </div>
                    </label>
                  </div>

                  <p className="mt-3 text-anywhere rounded-[8px] bg-panel px-3 py-2 text-xs leading-5 text-ink/52">
                    {draft.filePath}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
            <label className="block text-xs font-medium text-ink/58">
              标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={mode === "card" ? "知识卡片标题，可留空，按正文生成本地标题" : "可留空，使用网址或文件名"}
                className="field-control mt-1 h-10 w-full px-3 text-sm"
              />
            </label>

            {mode === "url" && (
              <label className="block text-xs font-medium text-ink/58">
                网址
                <input
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="field-control mt-1 h-10 w-full px-3 text-sm"
                />
              </label>
            )}

            {(mode === "file" || mode === "folder") && (
              <label className="block text-xs font-medium text-ink/58">
                {mode === "folder" ? "文件夹路径" : "文件路径"}
                <div className="mt-1 flex gap-2">
                  <input
                    value={filePath}
                    onChange={(event) => setFilePath(event.target.value)}
                    placeholder={mode === "folder" ? "D:\\资料库\\projects\\example" : "D:\\资料库\\documents\\example.pdf"}
                    className="field-control h-10 min-w-0 flex-1 px-3 text-sm"
                  />
                  {desktop && (
                    <button
                      type="button"
                      className="soft-button h-10 shrink-0 px-3 text-sm"
                      onClick={mode === "folder" ? handlePickFolder : handlePickSingleFile}
                    >
                      {mode === "folder" ? "选择文件夹" : "选择文件"}
                    </button>
                  )}
                </div>
              </label>
            )}

            <label className="block text-xs font-medium text-ink/58">
              标签
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="用逗号分隔"
                className="field-control mt-1 h-10 w-full px-3 text-sm"
              />
            </label>

            <label className="block text-xs font-medium text-ink/58">
              放到目录
              <div className="mt-1">
                <FolderPicker folders={folders} value={folderId} onChange={(nextFolderId) => setFolderId(nextFolderId ?? "")} />
              </div>
            </label>

            <label className="block text-xs font-medium text-ink/58">
              内容 / 备注
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={5}
                placeholder="写入这份资料的说明、摘录或知识卡片正文。"
                className="field-control mt-1 w-full resize-none px-3 py-2 text-sm leading-6"
              />
            </label>

            {desktop && mode === "file" && (
              <button
                type="button"
                className="soft-button flex h-10 items-center gap-2 px-4 text-sm"
                onClick={handlePickFiles}
              >
                <Plus size={16} />
                批量选择文件
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex shrink-0 justify-end gap-2">
          <button
            className="soft-button h-10 px-4 text-sm"
            onClick={() => close()}
          >
            取消
          </button>
          <button
            className="primary-button flex h-10 items-center gap-2"
            disabled={saving || (batchMode && batchDrafts.length === 0)}
            onClick={submit}
          >
            <Plus size={16} />
            {saving ? "保存中" : batchMode ? `确认导入 ${batchDrafts.length} 项` : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseTags(value: string) {
  const tags = value
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return Array.from(new Set(tags));
}

function createDraftsFromPaths(paths: string[], kind: "file" | "folder", folderId?: string): ImportDraft[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).map((path, index) => {
    const type = kind === "folder" ? "project" : inferTypeFromPath(path);

    return {
      id: `${Date.now()}-${index}-${path}`,
      title: getFileName(path) || (kind === "folder" ? "未命名文件夹" : "未命名文件"),
      type,
      filePath: path,
      folderId,
      tags: kind === "folder" ? ["资料文件夹"] : ["资料"],
      readingStatus: getDefaultReadingStatus(type),
      content: "",
    };
  });
}

function getFallbackTitle(mode: ImportMode, sourceUrl: string, filePath: string, content: string) {
  if (mode === "url") return sourceUrl.trim() || "未命名网址";
  if (mode === "folder") return getFileName(filePath) || "未命名文件夹";
  if (mode === "file") return getFileName(filePath) || "未命名文件";
  const suffix = Array.from(content.replace(/\s+/g, " ").trim() || "知识卡片").slice(0, 18).join("");
  return `未命名知识卡片 - ${suffix}`;
}

function getFileName(path: string) {
  const parts = path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function inferTypeFromPath(path: string): ItemType {
  const lower = path.toLowerCase();

  if (/\.(zip|rar|7z|tar|gz)$/.test(lower)) return "archive";
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(lower)) return "image";

  return "document";
}

function getDefaultReadingStatus(type: ItemType): ReadingStatus {
  return type === "document" || type === "url" ? "待阅读" : "不需要";
}
