import {
  Bold,
  Braces,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { applyMarkdownEdit, type MarkdownEditAction } from "../lib/markdown";
import { MarkdownContent } from "./MarkdownContent";

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  minHeightClass?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
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
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>("edit");
  const previewValue = useDebouncedValue(value, 200);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorId = useId();
  const previewId = useId();
  const editorTabId = useId();
  const previewTabId = useId();

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
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
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
      </div>

      <div className="grid min-w-0 lg:grid-cols-2">
        <div
          aria-label={`${label}编辑区`}
          aria-labelledby={editorTabId}
          className={`${activeTab === "edit" ? "block" : "hidden"} min-w-0 lg:block lg:border-r lg:border-line`}
          id={editorId}
          role="tabpanel"
        >
          <textarea
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={`${label} Markdown 源码`}
            className={`markdown-source ${minHeightClass}`}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入正文，可使用 Markdown 标题、列表、引用、代码和链接。"
            ref={textareaRef}
            spellCheck
            value={value}
          />
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
              emptyText="开始输入后，这里会显示 Markdown 预览。"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}
