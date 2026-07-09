import { flattenFolderOptions } from "../lib/folders";
import type { FolderNode } from "../types";
import { SelectMenu } from "./SelectMenu";

type FolderPickerProps = {
  folders: FolderNode[];
  value?: string;
  onChange: (folderId?: string) => void;
  placeholder?: string;
};

export function FolderPicker({ folders, value, onChange, placeholder = "选择目录" }: FolderPickerProps) {
  return (
    <SelectMenu
      value={value ?? ""}
      searchable
      placeholder={placeholder}
      options={flattenFolderOptions(folders).map((folder) => ({
        value: folder.id ?? "",
        label: folder.label,
        depth: folder.depth,
      }))}
      onChange={(nextValue) => onChange(nextValue || undefined)}
    />
  );
}
