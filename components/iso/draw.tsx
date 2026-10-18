/**
 * Server-safe drawing primitives for kit paths (adapted from the anatomy kit's react/draw.tsx, MIT).
 * Styles live in components/claw/claw.css under `.iso`.
 */
import type { ReactNode } from "react";
import type { Flat, LineTone, SolidPaths, Tone } from "./iso-kit";

type SolidProps = {
  paths: SolidPaths;
  tone?: Tone;
  crease?: Tone | "none";
  halo?: boolean;
  lit?: boolean;
  flat?: boolean;
  className?: string;
  inner?: ReactNode;
  children?: ReactNode;
};

export function Solid({ paths, tone = "hi", crease = "faint", halo = false, lit = false, flat = false, className, inner, children }: SolidProps) {
  return (
    <g className={className ? `iso-solid ${className}` : "iso-solid"} data-lit={lit ? "" : undefined}>
      {halo ? <path className="iso-halo" d={paths.fill} /> : null}
      <path className="iso-fill" d={paths.fill} />
      {flat ? null : paths.shades.map((d, shade) => (d ? <path key={shade} className="iso-shade" data-shade={shade} d={d} /> : null))}
      {flat ? null : <path className="iso-top" d={paths.top} />}
      {crease === "none" || !paths.crease ? null : <path className="iso-line" data-tone={crease} d={paths.crease} />}
      {crease === "none" || !paths.bevel ? null : <path className="iso-line" data-tone={crease} d={paths.bevel} />}
      {inner}
      <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
      {children}
    </g>
  );
}

export function Line({ d, tone = "lo", className }: { d: string; tone?: LineTone; className?: string }) {
  if (!d) return null;
  return <path className={className ? `iso-line ${className}` : "iso-line"} data-tone={tone} d={d} />;
}

const tenth = (v: number) => Math.round(v * 10) / 10;

export function Dots({ points, size = 0.5, tone = "mid" }: { points: Flat[]; size?: number; tone?: Tone }) {
  return (
    <g className="iso-dots" data-tone={tone}>
      {points.map(([x, y], i) => (
        <circle key={i} cx={tenth(x)} cy={tenth(y)} r={size} />
      ))}
    </g>
  );
}

export function Poly({ d, className }: { d: string; className: string }) {
  return <path className={className} d={d} />;
}

export function FaceText({ transform, children, size = 3, tone = "mid" }: { transform: string; children: ReactNode; size?: number; tone?: Tone }) {
  return (
    <text className="iso-face-text" data-tone={tone} transform={transform} fontSize={size}>
      {children}
    </text>
  );
}
