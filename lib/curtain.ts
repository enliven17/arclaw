/** Hands a navigation to the claw curtain (components/motion/ClawCurtain.tsx) without the link knowing about it. */
let run: ((href: string) => void) | null = null;

export const registerCurtain = (fn: ((href: string) => void) | null) => {
  run = fn;
};

/** True when the curtain took the navigation; false means the caller should navigate normally. */
export function runCurtain(href: string): boolean {
  if (!run) return false;
  run(href);
  return true;
}
