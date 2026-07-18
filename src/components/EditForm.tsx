import { FolderPicker } from "./FolderPicker";
import { MarkdownEditor } from "./MarkdownEditor";
import { SelectMenu } from "./SelectMenu";
import { PROCESS_STATUSES, READING_STATUSES, ITEM_TYPES, type FolderNode, type Item, type ItemType, type ProcessStatus, type ReadingStatus } from "../types";
import { typeMeta } from "../ui/itemMeta";
import type { ReactNode } from "react";

type EditFormProps = {
  draft: Item;
  items: Item[];
  folders: FolderNode[];
  tagText: string;
  onDraftChange: (item: Item) => void;
  onTagTextChange: (value: string) => void;
};

export function EditForm({ draft, items, folders, tagText, onDraftChange, onTagTextChange }: EditFormProps) {
  const updateField = <K extends keyof Item>(key: K, value: Item[K]) => {
    onDraftChange({ ...draft, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="类型">
          <SelectMenu
            value={draft.type}
            options={ITEM_TYPES.map((type) => ({ value: type, label: typeMeta[type].label }))}
            onChange={(value) => updateField("type", value as ItemType)}
          />
        </Field>

        <Field label="所在目录">
          <FolderPicker folders={folders} value={draft.folderId} onChange={(folderId) => updateField("folderId", folderId)} />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="整理状态">
          <SelectMenu
            value={draft.processStatus}
            options={PROCESS_STATUSES.map((status) => ({ value: status, label: status }))}
            onChange={(value) => updateField("processStatus", value as ProcessStatus)}
          />
        </Field>

        <Field label="阅读状态">
          <SelectMenu
            value={draft.readingStatus}
            options={READING_STATUSES.map((status) => ({ value: status, label: status }))}
            onChange={(value) => updateField("readingStatus", value as ReadingStatus)}
          />
        </Field>
      </div>

      <label className="block text-xs font-medium text-ink/58">
        标签
        <input
          value={tagText}
          onChange={(event) => onTagTextChange(event.target.value)}
          placeholder="用逗号分隔，例如：论文，资料，待阅读"
          className="field-control field-prominent mt-1 w-full"
        />
      </label>

      <MarkdownEditor
        currentItem={draft}
        folders={folders}
        items={items}
        label="正文"
        minHeightClass="min-h-[320px]"
        onChange={(content) => updateField("content", content)}
        value={draft.content}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-ink/58">
          文件路径
          <input
            value={draft.filePath ?? ""}
            onChange={(event) => updateField("filePath", event.target.value || undefined)}
            placeholder="D:\\资料库\\documents\\example.pdf"
            className="field-control field-prominent mt-1 w-full"
          />
        </label>

        <label className="block text-xs font-medium text-ink/58">
          网址
          <input
            value={draft.sourceUrl ?? ""}
            onChange={(event) => updateField("sourceUrl", event.target.value || undefined)}
            placeholder="https://example.com"
            className="field-control field-prominent mt-1 w-full"
          />
        </label>
      </div>

      <label className="block text-xs font-medium text-ink/58">
        AI 摘要
        <textarea
          value={draft.aiSummary}
          onChange={(event) => updateField("aiSummary", event.target.value)}
          rows={4}
          placeholder="后续可由模型自动生成，也可以手动整理。"
          className="field-control mt-1 max-h-[180px] w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin"
        />
      </label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-ink/58">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
