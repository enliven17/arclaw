"use client";

/** Global sound on and off, persisted (lib/sfx.ts). A small speaker drawn in hairlines; waves while on. */
import { useEffect, useState } from "react";
import { onSoundChange, setSound, soundOn } from "@/lib/sfx";
import { cn } from "@/lib/cn";

export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser.
    setOn(soundOn());
    return onSoundChange(() => setOn(soundOn()));
  }, []);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Sound on. Turn sound off" : "Sound off. Turn sound on"}
      onClick={() => setSound(!on)}
      className={cn("btn-ghost !min-h-[36px] !w-[36px] !p-0", className)}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        <path d="M3 8h3l4-3.5v11L6 12H3z" />
        {on ? <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.5a6.5 6.5 0 0 1 0 9" /> : <path d="M13.5 8l4 4M17.5 8l-4 4" />}
      </svg>
    </button>
  );
}
