import {
  Bold,
  Braces,
  Code2,
  Heading2,
  Italic,
  Library,
  Link2,
  List,
  ListOrdered,
  Quote,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { findOpenItemReferenceQuery, getItemReferenceCandidates, insertItemReference } from "../lib/itemReferences";
import { applyMarkdownEdit, type MarkdownEditAction } from "../lib/markdown";
import type { FolderNode, Item } from "../types";
import { MarkdownContent } from "./MarkdownContent";

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  minHeightClass?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  items?: Item[];
  folders?: FolderNode[];
  currentItem?: Item;
};

type EditorTab = "edit" | "preview";

const toolbarActions: Array<{
  action: MarkdownEditAction;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}> = [
  { action: "heading", label: "二级标题", icon: Heading2 },
  { action: "bold", label: "粗体", icon: Bold, shortcut: "Ctrl+B" },
  { action: "italic", label: "斜体", icon: Italic, shortcut: "Ctrl+I" },
  { action: "unordered-list", label: "无序列表", icon: List },
  { action: "ordered-list", label: "有序列表", icon: ListOrdered },
  { action: "quote", label: "引用", icon: Quote },
  { action: "inline-code", label: "行内代码", icon: Code2 },
  { action: "code-block", label: "代码块", icon: Braces },
  { action: "link", label: "链接", icon: Link2, shortcut: "Ctrl+K" },
];

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  label = "正文",
  minHeightClass = "min-h-[280px]",
  ariaInvalid,
  ariaDescribedBy,
  items = [],
  folders = [],
  currentItem,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>("edit");
  const previewValue = useDebouncedValue(value, 200);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [referencePicker, setReferencePicker] = useState<{
    start: number;
    end: number;
    query: string;
    typed: boolean;
    left: number;
    top: number;
  } | null>(null);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const editorId = useId();
  const previewId = useId();
  const editorTabId = useId();
  const previewTabId = useId();
  const referenceCandidates = useMemo(
    () => referencePicker ? getItemReferenceCandidates(items, folders, referencePicker.query, currentItem) : [],
    [currentItem, folders, items, referencePicker],
  );

  useEffect(() => setReferenceIndex(0), [referencePicker?.query]);

  const openReferencePicker = (typed = false) => {
    if (disabled) return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const position = getReferencePickerPosition(textarea, start);
    setReferencePicker({ start, end, query: "", typed, ...position });
  };

  const chooseReference = (candidateIndex = referenceIndex) => {
    const candidate = referenceCandidates[candidateIndex];
    if (!candidate || !referencePicker) return;
    const result = referencePicker.typed
      ? insertTypedItemReference(value, referencePicker.start, referencePicker.end, candidate.targetRef)
      : insertItemReference(value, referencePicker.start, referencePicker.end, candidate.targetRef);
    onChange(result.value);
    setReferencePicker(null);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const applyAction = (action: MarkdownEditAction) => {
    if (disabled) return;
    const textarea = textareaRef.current;
    const result = applyMarkdownEdit(
      value,
      textarea?.selectionStart ?? value.length,
      textarea?.selectionEnd ?? value.length,
      action,
    );
    onChange(result.value);
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (referencePicker) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setReferenceIndex((current) => (current + direction + Math.max(referenceCandidates.length, 1)) % Math.max(referenceCandidates.length, 1));
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && referenceCandidates.length > 0) {
        event.preventDefault();
        chooseReference();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setReferencePicker(null);
        return;
      }
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && event.shiftKey) {
      event.preventDefault();
      openReferencePicker(false);
      return;
    }
    const action = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
    if (!action) return;
    event.preventDefault();
    applyAction(action);
  };

  const preserveSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <section className="markdown-editor" aria-label={`${label} Markdown 编辑器`}>
      <div className="markdown-editor-header">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink/62">{label}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-ink/40">Markdown 源码会原样保存，预览不会改写内容。</div>
        </div>
        <div className="markdown-editor-tabs lg:hidden" role="tablist" aria-label={`${label}视图`}>
          <button
            aria-controls={editorId}
            aria-selected={activeTab === "edit"}
            className={activeTab === "edit" ? "is-active" : ""}
            id={editorTabId}
            onClick={() => setActiveTab("edit")}
            role="tab"
            type="button"
          >
            编辑
          </button>
          <button
            aria-controls={previewId}
            aria-selected={activeTab === "preview"}
            className={activeTab === "preview" ? "is-active" : ""}
            id={previewTabId}
            onClick={() => setActiveTab("preview")}
            role="tab"
            type="button"
          >
            预览
          </button>
        </div>
      </div>

      <div className="markdown-toolbar scrollbar-thin" aria-label="Markdown 格式工具" role="toolbar">
        {toolbarActions.map(({ action, label: actionLabel, icon: Icon, shortcut }) => (
          <button
            aria-label={actionLabel}
            className="markdown-tool-button"
            disabled={disabled}
            key={action}
            onClick={() => applyAction(action)}
            onMouseDown={preserveSelection}
            title={shortcut ? `${actionLabel} · ${shortcut}` : actionLabel}
            type="button"
          >
            <Icon size={15} />
          </button>
        ))}
        <button
          aria-label="资料链接"
          className="markdown-tool-button"
          disabled={disabled}
          onClick={() => openReferencePicker(false)}
          onMouseDown={preserveSelection}
          title="资料链接 · Ctrl+Shift+K"
          type="button"
        >
          <Library size={15} />
        </button>
      </div>

      <div className="grid min-w-0 lg:grid-cols-2">
        <div
          aria-label={`${label}编辑区`}
          aria-labelledby={editorTabId}
          className={`${activeTab === "edit" ? "block" : "hidden"} relative min-w-0 lg:block lg:border-r lg:border-line`}
          id={editorId}
          role="tabpanel"
        >
          <textarea
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={`${label} Markdown 源码`}
            className={`markdown-source ${minHeightClass}`}
            disabled={disabled}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChange(nextValue);
              const trigger = findOpenItemReferenceQuery(nextValue, event.target.selectionStart);
              if (!trigger) {
                if (referencePicker?.typed) setReferencePicker(null);
                return;
              }
              setReferencePicker({ ...trigger, typed: true, ...getReferencePickerPosition(event.target, trigger.end) });
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入正文，可使用 Markdown 标题、列表、引用、代码和链接。"
            ref={textareaRef}
            spellCheck
            value={value}
          />
          {referencePicker && (
            <div
              aria-label="选择资料链接"
              className="markdown-reference-picker scrollbar-thin"
              role="listbox"
              style={{ left: referencePicker.left, top: referencePicker.top }}
            >
              <div className="border-b border-line px-3 py-2 text-[11px] text-ink/45">
                {referencePicker.query ? `搜索“${referencePicker.query}”` : "选择要引用的资料"}
              </div>
              {referenceCandidates.length === 0 ? (
                <p className="px-3 py-3 text-xs text-ink/42">没有匹配的资料。</p>
              ) : referenceCandidates.map((candidate, index) => (
                <button
                  aria-selected={referenceIndex === index}
                  className={referenceIndex === index ? "is-active" : ""}
                  key={candidate.item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseReference(index)}
                  role="option"
                  type="button"
                >
                  <span className="truncate text-sm font-medium text-ink">{candidate.item.title}</span>
                  <span className="truncate text-[11px] text-ink/42">{candidate.folderPath}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          aria-label={`${label}预览区`}
          aria-labelledby={previewTabId}
          className={`${activeTab === "preview" ? "block" : "hidden"} min-w-0 lg:block`}
          id={previewId}
          role="tabpanel"
          tabIndex={0}
        >
          <div className={`markdown-preview scrollbar-thin ${minHeightClass}`}>
            <MarkdownContent
              compact
              content={previewValue}
              currentItemId={currentItem?.id}
              emptyText="开始输入后，这里会显示 Markdown 预览。"
              items={items}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function insertTypedItemReference(value: string, start: number, end: number, targetRef: string) {
  const token = `[[item:${targetRef}]]`;
  return {
    value: `${value.slice(0, start)}${token}${value.slice(end)}`,
    selectionStart: start + token.length,
    selectionEnd: start + token.length,
  };
}

function getReferencePickerPosition(textarea: HTMLTextAreaElement | null, caret: number) {
  if (!textarea) return { left: 8, top: 48 };
  const before = textarea.value.slice(0, caret).split(/\r?\n/);
  const line = before.length - 1;
  const column = before[before.length - 1]?.length ?? 0;
  const left = Math.max(8, Math.min(column * 7.4 + 14 - textarea.scrollLeft, Math.max(8, textarea.clientWidth - 316)));
  const below = line * 22 + 34 - textarea.scrollTop;
  const top = below + 250 > textarea.clientHeight ? Math.max(8, below - 240) : Math.max(8, below);
  return { left, top };
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}
