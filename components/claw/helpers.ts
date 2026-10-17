/** Small world-space drawing helpers shared by the cabinet modules (geometry.tsx, trim.tsx). Server-safe. */
import { depthOf, pathOf, segment, slabOf, type Plane, type Point3 } from "@/components/iso/iso-kit";
import { P, at } from "./view";

export const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.4, bevel = 0) =>
  slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, P, 2, bevel);
export const poly = (pts: Point3[]) => pathOf(pts.map(at), true);
export const line = (pts: Point3[]) => pathOf(pts.map(at));
export const seg = (a: Point3, b: Point3) => segment(a, b, P);
export const dots = (pts: Point3[]) => pts.map(at);
export const byDepth = <T,>(items: T[], c: (t: T) => Point3) => [...items].sort((a, b) => depthOf(c(a), P) - depthOf(c(b), P));

/** Rectangle on the front face (y = const) from x0..x1, z0..z1. */
export const frontRect = (y: number, x0: number, x1: number, z0: number, z1: number) =>
  poly([
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ]);
/** Rectangle on the side face (x = const) from y0..y1, z0..z1. */
export const sideRect = (x: number, y0: number, y1: number, z0: number, z1: number) =>
  poly([
    [x, y0, z0],
    [x, y1, z0],
    [x, y1, z1],
    [x, y0, z1],
  ]);

/** A square ring turned by `yaw` radians about its centre. */
export function yawRing(cx: number, cy: number, half: number, yaw: number): Plane[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ].map(([u, v]) => [cx + u! * c - v! * s, cy + u! * s + v! * c] as Plane);
}

