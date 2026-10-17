"use client";

/**
 * Segmented machine picker (a radio group): Single, Stack, Vault with their prices in mono. Arrow keys move the
 * selection, as in a native radio group.
 */
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { Machine } from "@/lib/machines";

export function MachineSwitch({
  machines,
  value,
  onChange,
  label,
  className,
}: {
  machines: readonly Pick<Machine, "id" | "name" | "priceUsdc">[];
  value: number;
  onChange: (id: number) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, machines.findIndex((m) => m.id === value));

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + machines.length) % machines.length;
    onChange(machines[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("grid grid-cols-3 gap-1 rounded-[14px] border border-line bg-panel p-1", className)}>
      {machines.map((m, i) => {
        const on = m.id === value;
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex min-h-[52px] flex-col items-center justify-center rounded-[10px] px-2 py-2 transition-colors duration-200",
              on ? "bg-cream text-ink" : "text-muted hover:bg-panel-2 hover:text-cream",
            )}
          >
            <span className="text-[15px] leading-tight">{m.name}</span>
            <span className={cn("money text-[13px] leading-tight", on ? "text-ink/70" : "text-muted")}>{m.priceUsdc} USDC</span>
          </button>
        );
      })}
    </div>
  );
}
