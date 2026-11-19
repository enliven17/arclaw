/**
 * Paths for the parts that change shape every frame (prongs, cable, joystick shaft) and the transforms for the
 * parts that only move. Imported by the live component, so it ships to the client; keep it small.
 */
import { cameraOf, pathOf, translateAlong, type Flat, type Point3 } from "@/components/iso/iso-kit";
import type { Pose } from "./model";
import { BOX, CHUTE, CHUTE_TOP, CHUTE_WALL, HOME, HUB_H, HUB_REST, JOY, P, SLOT, TARGET, TROLLEY_BOTTOM, at } from "./view";

const K = cameraOf(P).k;
/** World thickness to viewBox px. */
export const px = (world: number) => world * K;

/** Prong azimuths: the first points at the viewer, the other two behind the hub. */
const VIEW = Math.atan2(Math.sin((P.azimuth ?? 45) * (Math.PI / 180)), Math.cos((P.azimuth ?? 45) * (Math.PI / 180)));
export const PRONG_ANGLES = [VIEW, VIEW + (2 * Math.PI) / 3, VIEW - (2 * Math.PI) / 3] as const;

const HALF = BOX / 2;
/** Where a ray from the box centre at angle `a` leaves the box: the prong's resting place while gripping. */
const contact = (a: number) => HALF / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) + 0.9;
const GRIP = 0.42;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Finger radius from the axis for an opening `o`: closed 6, touching the box at GRIP, wide open 15. */
function fingerR(a: number, o: number) {
  const c = contact(a);
  return o <= GRIP ? lerp(6, c, o / GRIP) : lerp(c, 15.5, (o - GRIP) / (1 - GRIP));
}

/** One prong as a polyline in world space, for a claw whose hub top sits at `c`. */
export function prongPoints(c: Point3, a: number, o: number): Point3[] {
  const f = fingerR(a, o);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const p = (r: number, dz: number): Point3 => [c[0] + ca * r, c[1] + sa * r, c[2] + dz];
  return [p(4.6, -HUB_H - 0.6), p(f - 1.4, -HUB_H - 8), p(f, -HUB_H - 17), p(f - 2.6, -HUB_H - 22.5)];
}

export function prongPath(c: Point3, a: number, o: number): { d: string; knuckle: Flat } {
  const pts = prongPoints(c, a, o).map(at);
  return { d: pathOf(pts), knuckle: pts[1]! };
}

/** The claw is drawn at HOME / HUB_REST; this moves it to the pose (sway included). */
export const clawShift = (s: Pose) => translateAlong(P, [s.gx + s.sx - HOME.x, s.gy + s.sy - HOME.y, s.hub - HUB_REST]);
export const bridgeShift = (s: Pose) => translateAlong(P, [s.gx - HOME.x, 0, 0]);
export const trolleyShift = (s: Pose) => translateAlong(P, [s.gx - HOME.x, s.gy - HOME.y, 0]);
export const boxShift = (s: Pose) => translateAlong(P, [s.box.x - TARGET.x, s.box.y - TARGET.y, s.box.z - TARGET.z]);

/** The claw's hub top in world space for a pose. */
export const hubTop = (s: Pose): Point3 => [s.gx + s.sx, s.gy + s.sy, s.hub];

/** Cable from the trolley's sheave to the hub's collar. */
export const cablePath = (s: Pose) => pathOf([at([s.gx, s.gy, TROLLEY_BOTTOM]), at([s.gx + s.sx, s.gy + s.sy, s.hub + 4])]);

/** The coin's curved path into the slot. */
export function coinShift(s: Pose) {
  const u = s.coin;
  const from: Point3 = [SLOT.x + 34, 150, SLOT.z + 26];
  const to: Point3 = [SLOT.x, 112, SLOT.z];
  const lift = Math.sin(Math.PI * u) * 14;
  const p: Point3 = [lerp(from[0], to[0], u), lerp(from[1], to[1], u), lerp(from[2], to[2], u) + lift];
  return translateAlong(P, [p[0] - to[0], p[1] - to[1], p[2] - to[2]]);
}

/** Joystick shaft and ball centre, leaning with the gantry's velocity. */
export function joystick(s: Pose) {
  const base: Point3 = [JOY.x, JOY.y, 100.6];
  const top: Point3 = [JOY.x + s.lean.x * 4.5, JOY.y + s.lean.y * 4.5, 112];
  return { d: pathOf([at(base), at(top)]), ball: at([top[0], top[1], top[2] + 3.4]) };
}

/** Screen polygon of the chute opening, extruded straight up: a falling box is only seen through it. */
export const CHUTE_CLIP = (() => {
  const { x, y, w, d } = CHUTE;
  const t = CHUTE_WALL;
  const rim: Flat[] = [
    [x + t, y + t],
    [x + w - t, y + t],
    [x + w - t, y + d - t],
    [x + t, y + d - t],
  ].map(([px, py]) => at([px!, py!, CHUTE_TOP]));
  const pts = [...rim, ...rim.map(([px, py]) => [px, py - 2000] as Flat)].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hull = (list: Flat[]) => {
    const out: Flat[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = hull(pts);
  const upper = hull([...pts].reverse());
  return pathOf([...lower.slice(0, -1), ...upper.slice(0, -1)], true);
})();
