import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  depth?: number;
  description?: string;
};

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
};

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = "请选择",
  searchable = false,
  disabled = false,
  triggerClassName = "",
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 220, maxHeight: 288 });
  const menuId = useId();
  const selected = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => option.label.toLowerCase().includes(keyword));
  }, [options, query]);

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gap = 6;
    const margin = 12;
    const minWidth = 220;
    const desiredHeight = searchable ? 344 : 288;
    const viewportWidth = Math.max(160, window.innerWidth - margin * 2);
    const width = Math.min(Math.max(rect.width, Math.min(minWidth, viewportWidth)), viewportWidth);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);
    const openUp = spaceBelow < Math.min(220, desiredHeight) && spaceAbove > spaceBelow;
    const availableSpace = Math.max(96, openUp ? spaceAbove - gap : spaceBelow - gap);
    const maxHeight = Math.min(desiredHeight, availableSpace);
    const preferredTop = openUp ? rect.top - maxHeight - gap : rect.bottom + gap;
    const top = Math.min(
      Math.max(margin, preferredTop),
      Math.max(margin, window.innerHeight - margin - maxHeight),
    );

    setMenuPosition({
      left: Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin)),
      top,
      width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, searchable, options.length]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(0, selectedIndex));
  }, [filteredOptions, open, value]);

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) {
      window.setTimeout(() => buttonRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }

      if (event.key === "Tab") {
        closeMenu(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (filteredOptions.length ? Math.min(filteredOptions.length - 1, current + 1) : 0));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(Math.max(0, filteredOptions.length - 1));
        return;
      }

      if (event.key === "Enter" && filteredOptions[activeIndex]) {
        event.preventDefault();
        handleSelect(filteredOptions[activeIndex].value, true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [activeIndex, filteredOptions, open]);

  const handleSelect = (nextValue: string, returnFocus = false) => {
    onChange(nextValue);
    closeMenu(returnFocus);
  };

  const activeOptionId = open && filteredOptions[activeIndex] ? `${menuId}-option-${activeIndex}` : undefined;

  const menu =
    open && !disabled ? (
      <div
        ref={menuRef}
        className="select-pop fixed z-[70] overflow-hidden rounded-[8px] border border-line bg-surface shadow-soft"
        id={menuId}
        role="listbox"
        style={{
          left: `${menuPosition.left}px`,
          top: `${menuPosition.top}px`,
          width: `${menuPosition.width}px`,
          maxHeight: `${menuPosition.maxHeight}px`,
        }}
      >
        {searchable && (
          <div className="border-b border-line bg-panel p-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
              className="field-control h-9 w-full px-3 text-sm"
              autoFocus
            />
          </div>
        )}

        <div
          className="overflow-y-auto p-1 scrollbar-thin"
          style={{ maxHeight: `${searchable ? menuPosition.maxHeight - 50 : menuPosition.maxHeight}px` }}
        >
          {filteredOptions.map((option, index) => {
            const active = option.value === value;
            const focused = index === activeIndex;

            return (
              <button
                key={option.value || "__empty"}
                id={`${menuId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`flex w-full items-start gap-2 rounded-[7px] px-2 py-2 text-left text-sm transition ${
                  active
                    ? "bg-copper/10 text-copper"
                    : focused
                      ? "bg-panel text-ink"
                      : "text-ink/72 hover:bg-panel hover:text-ink"
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(option.value, true)}
              >
                <span style={{ width: `${(option.depth ?? 0) * 14}px` }} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block truncate text-xs text-ink/42">{option.description}</span>
                  )}
                </span>
                {active && <Check size={14} className="mt-0.5 shrink-0" />}
              </button>
            );
          })}
          {filteredOptions.length === 0 && <div className="px-3 py-4 text-center text-sm text-ink/42">无匹配项</div>}
        </div>
      </div>
    ) : null;

  return (
    <div ref={triggerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={activeOptionId}
        className={`field-control flex w-full items-center justify-between gap-2 text-left shadow-sm hover:border-copper/35 hover:bg-copper/10 disabled:cursor-not-allowed disabled:opacity-60 ${triggerClassName || "h-10 px-3 text-sm"}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? "truncate" : "truncate text-ink/40"}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-ink/45 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {menu && createPortal(menu, document.body)}
    </div>
  );
}
