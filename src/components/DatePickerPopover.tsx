import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toDateKey } from "../lib/date";

type DatePickerPopoverProps = {
  value: string;
  onChange: (date: string) => void;
  onClear: () => void;
  placeholder: string;
  buttonLabel: string;
};

export function DatePickerPopover({
  value,
  onChange,
  onClear,
  placeholder,
  buttonLabel,
}: DatePickerPopoverProps) {
  const today = toDateKey(new Date());
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || today).slice(0, 7));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const days = useMemo(() => getCalendarDays(month), [month]);

  useEffect(() => {
    if (open) setMonth((value || today).slice(0, 7));
  }, [open, today, value]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`field-control flex h-9 w-full items-center justify-between gap-2 px-2 text-left text-xs ${
          value ? "font-mono text-ink" : "text-ink/35"
        }`}
        onClick={() => setOpen((current) => !current)}
        aria-label={buttonLabel}
        aria-expanded={open}
      >
        <span className="truncate">{value || placeholder}</span>
        <CalendarDays size={14} className="shrink-0 text-ink/38" />
      </button>

      {open && (
        <section className="section-surface absolute left-0 top-full z-40 mt-2 w-[260px] p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="soft-button flex h-8 w-8 items-center justify-center"
              onClick={() => setMonth(shiftMonth(month, -1))}
              title="上个月"
              aria-label="上个月"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="text-sm font-semibold text-ink">{formatMonthLabel(month)}</div>
            <button
              type="button"
              className="soft-button flex h-8 w-8 items-center justify-center"
              onClick={() => setMonth(shiftMonth(month, 1))}
              title="下个月"
              aria-label="下个月"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink/35">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((dateKey) => {
              const isCurrentMonth = dateKey.slice(0, 7) === month;
              const isSelected = value === dateKey;
              const isToday = dateKey === today;
              return (
                <button
                  key={dateKey}
                  type="button"
                  className={`relative flex h-8 items-center justify-center rounded-[8px] text-xs transition ${
                    isSelected
                      ? "bg-copper/20 font-semibold text-copper ring-1 ring-copper/25"
                      : isToday
                        ? "bg-lake/10 font-semibold text-lake"
                        : isCurrentMonth
                          ? "text-ink/70 hover:bg-panel hover:text-ink"
                          : "text-ink/24 hover:bg-panel"
                  }`}
                  onClick={() => {
                    if (!isCurrentMonth) setMonth(dateKey.slice(0, 7));
                    onChange(dateKey);
                    setOpen(false);
                  }}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                >
                  {Number(dateKey.slice(8, 10))}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="soft-button h-8 px-2.5 text-xs"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              清空
            </button>
            <button
              type="button"
              className="soft-button h-8 px-2.5 text-xs"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              今天
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function getCalendarDays(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  const startOffset = 1 - getMondayFirstDayOfWeek(year, monthValue, 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthValue - 1, 1 + startOffset + index, 12);
    return toDateKey(date);
  });
}

function getMondayFirstDayOfWeek(year: number, month: number, day: number) {
  const nativeDay = new Date(year, month - 1, day, 12).getDay();
  return nativeDay === 0 ? 7 : nativeDay;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthValue] = month.split("-").map(Number);
  const date = new Date(year, monthValue - 1 + offset, 1);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const [year, monthValue] = month.split("-");
  return `${year} 年 ${Number(monthValue)} 月`;
}
