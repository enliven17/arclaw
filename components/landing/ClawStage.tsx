"use client";

import { useEffect, useRef } from "react";
import { ClawMachine, type ClawHandle } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";

export function ClawStage({ art }: { art: ClawArt }) {
  const ref = useRef<ClawHandle>(null);
  useEffect(() => {
    (window as unknown as { __claw?: ClawHandle | null }).__claw = ref.current;
  }, []);
  return <ClawMachine ref={ref} art={art} />;
}
