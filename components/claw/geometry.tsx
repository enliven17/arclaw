/**
 * Static art of the claw machine, built once on the server with the anatomy kit and handed to the live component
 * as element props (references/react.md). Painter's order: back to front, bottom to top. Moving parts are drawn
 * at rest (claw at HOME, box at TARGET) and moved by transforms.
 *
 * Parts (about 140): casters, plinth, cabinet body with kick plate, prize door, coin door, slot plate, lock,
 * coin return, side vents and a label plate; control deck with grille, screws, joystick and button bezels;
 * the play field floor, far panels with perforations, far post and frame rails; the chute with four walls and
 * its hole; nineteen sealed prize boxes with tape bands; two gantry rails with hangers, end stops and a tick
 * ruler; a bridge with two trucks; a trolley with motor can and sheave; the claw hub with collar, band and
 * flange; near posts, rails, two glass panes; the header with its sign.
 */
import type { ReactElement, ReactNode } from "react";
import {
  corners,
  cylinder,
  depthOf,
  extrude,
  haloOf,
  insetPlan,
  pathOf,
  planOutline,
  ring,
  segment,
  sideMatrix,
  sideRing,
  sideSeam,
  sideTicks,
  slabOf,
  type Flat,
  type Plane,
  type Point3,
} from "@/components/iso/iso-kit";
import { Dots, Line, Poly, Solid } from "@/components/iso/draw";
import { CLAW, CREAM, LOCKUP, LOCKUP_W, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_PATH } from "@/lib/brand/logo";
import {
  BODY,
  BOX,
  CHUTE,
  CHUTE_TOP,
  CHUTE_WALL,
  DECK,
  HOME,
  HUB_H,
  HUB_REST,
  JOY,
  BUTTON,
  P,
  PLINTH,
  RAIL_D,
  RAIL_X,
  RAIL_Y,
  SLOT,
  TARGET,
  TROLLEY_BOTTOM,
  Z,
  at,
} from "./view";

/* Small helpers in world space. */
const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.4, bevel = 0) =>
  slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, P, 2, bevel);
const poly = (pts: Point3[]) => pathOf(pts.map(at), true);
const line = (pts: Point3[]) => pathOf(pts.map(at));
const seg = (a: Point3, b: Point3) => segment(a, b, P);
const dots = (pts: Point3[]) => pts.map(at);
const byDepth = <T,>(items: T[], c: (t: T) => Point3) => [...items].sort((a, b) => depthOf(c(a), P) - depthOf(c(b), P));

/** Rectangle on the front face (y = const) from x0..x1, z0..z1. */
const frontRect = (y: number, x0: number, x1: number, z0: number, z1: number) =>
  poly([
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ]);
/** Rectangle on the side face (x = const) from y0..y1, z0..z1. */
const sideRect = (x: number, y0: number, y1: number, z0: number, z1: number) =>
  poly([
    [x, y0, z0],
    [x, y1, z0],
    [x, y1, z1],
    [x, y0, z1],
  ]);

/** A square ring turned by `yaw` radians about its centre. */
function yawRing(cx: number, cy: number, half: number, yaw: number): Plane[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ].map(([u, v]) => [cx + u! * c - v! * s, cy + u! * s + v! * c] as Plane);
}

/* ---------- Prize box ---------- */

/** A sealed prize box: a cube with a tape band over the top and down the two faces you can see, and a seal tab. */
export function PrizeBox({ cx, cy, z, yaw = 0, k }: { cx: number; cy: number; z: number; yaw?: number; k: string }) {
  const half = BOX / 2;
  const solid = extrude(yawRing(cx, cy, half, yaw), z, BOX, P, { convex: true });
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const w = (u: number, v: number, zz: number): Point3 => [cx + u * c - v * s, cy + u * s + v * c, zz];
  const top = z + BOX;
  const t = 2.2; // tape half width
  // Tape runs along the box's local v axis: over the top and down the +v face, which faces the viewer.
  const tape = [
    line([w(-t, -half, top), w(-t, half, top), w(-t, half, z)]),
    line([w(t, -half, top), w(t, half, top), w(t, half, z)]),
  ].join("");
  // Seam of the lid flaps across the tape, edge to edge on the top.
  const seam = line([w(-half, 0, top), w(-t, 0, top)]) + line([w(t, 0, top), w(half, 0, top)]);
  // Seal: a small square on the tape where it turns down the face.
  const seal = poly([w(-t, half, z + BOX - 2.5), w(t, half, z + BOX - 2.5), w(t, half, z + BOX - 6.5), w(-t, half, z + BOX - 6.5)]);
  return (
    <g key={k} className="prize-box">
      <Solid paths={solid} tone="mid" crease="lo" />
      <Poly className="iso-tape" d={poly([w(-t, -half, top), w(t, -half, top), w(t, half, top), w(-t, half, top)])} />
      <Poly className="iso-tape" d={poly([w(-t, half, top), w(t, half, top), w(t, half, z), w(-t, half, z)])} />
      <Line d={tape} tone="lo" />
      <Line d={seam} tone="faint" />
      <Poly className="iso-seal" d={seal} />
    </g>
  );
}

/* ---------- Back layer: cabinet, deck, play field, pile ---------- */

function Feet() {
  return (
    <g key="feet">
      {byDepth(corners(PLINTH, 10), ([x, y]) => [x, y, 0]).map(([x, y], i) => (
        <g key={i}>
          <Solid paths={cylinder(x, y, 5, Z.foot, 1.6, P, 28)} tone="lo" />
          <Solid paths={cylinder(x, y, 3.4, Z.foot + 1.6, -Z.foot - 1.6, P, 24)} tone="mid" />
        </g>
      ))}
    </g>
  );
}

function Body() {
  const yF = BODY.y + BODY.d; // front face
  const xR = BODY.x + BODY.w; // right face
  const z0 = Z.body;
  const vents = Array.from({ length: 7 }, (_, i) => {
    const y = 16 + i * 6;
    return sideRect(xR, y, y + 2.6, 60, 82);
  }).join("");
  const plate = { y0: 70, y1: 98, z0: 28, z1: 44 };
  return (
    <g key="body">
      <Solid paths={slabOf(PLINTH, Z.plinth, z0 - Z.plinth, P, 8, 1)} tone="mid" inner={<Line d={sideSeam(PLINTH, 4.5, P, 8)} tone="faint" />} />
      <Solid
        paths={slabOf(BODY, z0, Z.floor - z0, P, 6, 0.8)}
        tone="mid"
        crease="lo"
        inner={
          <>
            <Line d={sideSeam(BODY, 84, P, 6)} tone="lo" />
            <Line d={sideSeam(BODY, 24, P, 6)} tone="faint" />
          </>
        }
      />
      {/* Kick plate with screws. */}
      <Line d={frontRect(yF, 8, 112, 12, 22)} tone="lo" />
      <Dots points={dots([10.5, 109.5].flatMap((x) => [14.5, 19.5].map((z) => [x, yF, z] as Point3)))} size={0.6} tone="mid" />
      {/* Prize door below the chute: frame, dark window, hinge line, pull. */}
      <Line d={frontRect(yF, 12, 38, 30, 64)} tone="mid" />
      <Poly className="iso-void" d={frontRect(yF, 15, 35, 42, 61)} />
      <Line d={frontRect(yF, 15, 35, 42, 61)} tone="lo" />
      <Line d={seg([15, yF, 58.5], [35, yF, 58.5])} tone="faint" />
      <Solid paths={box3(20, yF, 34, 30, yF + 1.6, 36.4, 0.3)} tone="mid" />
      <Dots points={dots([[13.6, yF, 31.6], [36.4, yF, 31.6], [13.6, yF, 62.4], [36.4, yF, 62.4]])} size={0.55} />
      {/* Coin door: panel, slot plate (raised), coin return, lock. */}
      <Line d={frontRect(yF, 70, 104, 26, 78)} tone="mid" />
      <Line d={frontRect(yF, 72, 102, 28, 76)} tone="faint" />
      <Solid paths={box3(SLOT.x - 7, yF, SLOT.z - 8, SLOT.x + 7, yF + 1.8, SLOT.z + 8, 0.6, 0.3)} tone="hi" crease="lo" />
      <Poly className="iso-void" d={frontRect(yF + 1.8, SLOT.x - 0.7, SLOT.x + 0.7, SLOT.z - 4.5, SLOT.z + 4.5)} />
      <Line d={sideRing([96, yF, 64], 2.4, "y", P, 24)} tone="mid" />
      <Line d={sideRing([96, yF, 64], 1.2, "y", P, 16)} tone="lo" />
      <Line d={sideRing([87, yF, 36], 1.8, "y", P, 20)} tone="mid" />
      <Line d={seg([87, yF, 35], [87, yF, 37])} tone="lo" />
      <Dots points={dots([[71.6, yF, 27.6], [102.4, yF, 27.6], [71.6, yF, 76.4], [102.4, yF, 76.4]])} size={0.55} />
      {/* Side: vent slots and a label plate with three printed rules. */}
      <Line d={vents} tone="lo" />
      <Line d={sideRect(xR, plate.y0, plate.y1, plate.z0, plate.z1)} tone="mid" />
      <Line d={[38, 35, 32].map((z, i) => seg([xR, plate.y0 + 3, z], [xR, plate.y1 - 3 - i * 5, z])).join("")} tone="faint" />
      <Dots points={dots([[xR, plate.y0 + 1.4, plate.z0 + 1.4], [xR, plate.y1 - 1.4, plate.z0 + 1.4], [xR, plate.y0 + 1.4, plate.z1 - 1.4], [xR, plate.y1 - 1.4, plate.z1 - 1.4]])} size={0.5} />
    </g>
  );
}

function Deck() {
  const top = Z.deckTop;
  const grille: Point3[] = [];
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 4; gy++) grille.push([52 + gx * 3.2, 110.5 + gy * 3.2, top]);
  return (
    <g key="deck">
      <Solid paths={slabOf(DECK, Z.deck, top - Z.deck, P, 6, 1)} tone="mid" crease="lo" inner={<Line d={sideSeam(DECK, Z.deck + 3, P, 6)} tone="faint" />} />
      <Line d={planOutline(insetPlan(DECK, 3), top, P, 6)} tone="lo" />
      <Dots points={dots(corners(DECK, 1.6).map(([x, y]) => [x, y, top] as Point3))} size={0.5} />
      <Dots points={grille.map(at)} size={0.55} tone="lo" />
      {/* Joystick bezel and dust washer, button bezel. Shaft, ball and cap move. */}
      <Solid paths={cylinder(JOY.x, JOY.y, 6.4, top, 1.2, P, 32, 0.4)} tone="mid" />
      <Solid paths={cylinder(JOY.x, JOY.y, 3.6, top + 1.2, 0.5, P, 28)} tone="lo" />
      <Solid paths={cylinder(BUTTON.x, BUTTON.y, 6.2, top, 1.4, P, 32, 0.4)} tone="mid" />
      <Line d={ring(BUTTON.x, BUTTON.y, 4.8, top + 1.4, P, 32)} tone="lo" />
    </g>
  );
}

/** Far panels (perforated), far post and frame rails, the floor plate. */
function FarField() {
  const zA = Z.glass;
  const zB = Z.ceiling - 6;
  const perf: Point3[] = [];
  for (let x = 14; x <= 106; x += 8) for (let z = 112; z <= 222; z += 8) perf.push([x, 4, z]);
  const perfL: Point3[] = [];
  for (let y = 14; y <= 98; y += 8) for (let z = 112; z <= 222; z += 8) perfL.push([4, y, z]);
  return (
    <g key="far">
      <Line d={planOutline(insetPlan(BODY, 7), Z.floor, P, 4)} tone="faint" />
      <Solid paths={box3(7, 2, zA, 113, 4, zB)} tone="lo" crease="none" />
      <Solid paths={box3(2, 7, zA, 4, 103, zB)} tone="lo" crease="none" />
      <Dots points={perf.map(at)} size={0.45} tone="lo" />
      <Dots points={perfL.map(at)} size={0.45} tone="lo" />
      <Line d={[38, 82].map((x) => seg([x, 4, zA], [x, 4, zB])).join("") + seg([4, 55, zA], [4, 55, zB])} tone="faint" />
      <Solid paths={box3(2, 2, Z.floor, 7, 7, Z.ceiling)} tone="mid" />
      <Solid paths={box3(7, 2, Z.floor, 113, 7, zA)} tone="mid" />
      <Solid paths={box3(2, 7, Z.floor, 7, 103, zA)} tone="mid" />
      <Solid paths={box3(7, 2, zB, 113, 7, Z.ceiling)} tone="mid" />
      <Solid paths={box3(2, 7, zB, 7, 103, Z.ceiling)} tone="mid" />
    </g>
  );
}

/** Level-1 and level-2 boxes plus the chute walls, sorted together by depth. The target box is not here. */
const PILE: { cx: number; cy: number; z: number; yaw: number }[] = (() => {
  const yaws = [0.05, -0.08, 0.1, -0.03, 0.07, -0.11, 0.02, 0.09, -0.06, 0.04, -0.09, 0.06, -0.02, 0.08, -0.05, 0.03, -0.07, 0.11];
  const out: { cx: number; cy: number; z: number; yaw: number }[] = [];
  let i = 0;
  for (const cx of [52, 72, 92]) for (const cy of [18, 38, 58, 80]) out.push({ cx: cx + ((i * 7) % 3) - 1, cy, z: Z.floor, yaw: yaws[i++ % yaws.length]! });
  for (const cx of [61, 81]) for (const cy of [28, 48, 68]) out.push({ cx, cy: cy + ((i * 5) % 3) - 1, z: Z.floor + BOX, yaw: yaws[i++ % yaws.length]! });
  return out;
})();

function ChuteAndPile() {
  const { x, y, w, d } = CHUTE;
  const t = CHUTE_WALL;
  const z0 = Z.floor;
  const z1 = CHUTE_TOP;
  type Item = { c: Point3; node: ReactElement };
  const walls: Item[] = [
    { c: [x + w / 2, y + t / 2, z0], node: <Solid key="cw-back" paths={box3(x, y, z0, x + w, y + t, z1, 0.2)} tone="mid" /> },
    { c: [x + t / 2, y + d / 2, z0], node: <Solid key="cw-left" paths={box3(x, y + t, z0, x + t, y + d - t, z1, 0.2)} tone="mid" /> },
    {
      c: [x + w - t / 2, y + d / 2, z0],
      node: (
        <Solid key="cw-right" paths={box3(x + w - t, y + t, z0, x + w, y + d - t, z1, 0.2)} tone="mid">
          <Line d={seg([x + w, y + t, z1 - 4], [x + w, y + d - t, z1 - 4])} tone="faint" />
        </Solid>
      ),
    },
    {
      c: [x + w / 2, y + d - t / 2, z0],
      node: (
        <Solid key="cw-front" paths={box3(x, y + d - t, z0, x + w, y + d, z1, 0.2)} tone="mid">
          <Line d={seg([x, y + d, z1 - 4], [x + w, y + d, z1 - 4])} tone="faint" />
        </Solid>
      ),
    },
  ];
  const boxes: Item[] = PILE.map((b, i) => ({ c: [b.cx, b.cy, b.z], node: <PrizeBox key={`pb-${i}`} k={`pb-${i}`} cx={b.cx} cy={b.cy} z={b.z} yaw={b.yaw} /> }));
  // Level 1 and the chute share the floor; level 2 always sits over level 1, so draw it after.
  const floorItems = byDepth([...walls, ...boxes.slice(0, 12)], (i) => i.c);
  const upper = byDepth(boxes.slice(12), (i) => i.c);
  return (
    <g key="pile">
      <Poly className="iso-void" d={poly([[x + t, y + t, z0], [x + w - t, y + t, z0], [x + w - t, y + d - t, z0], [x + t, y + d - t, z0]])} />
      {floorItems.map((i) => i.node)}
      {upper.map((i) => i.node)}
    </g>
  );
}

/* ---------- Gantry ---------- */

const RAIL_TOP = Z.railTop;
const railSolid = (ry: number) => box3(RAIL_X[0], ry, Z.rail, RAIL_X[1], ry + RAIL_D, RAIL_TOP, 0.3, 0.3);

function Rail({ ry, near }: { ry: number; near: boolean }) {
  const face = ry + RAIL_D;
  const ticks = sideTicks(RAIL_X[0] + 4, RAIL_X[1] - 4, 4, 5, face, RAIL_TOP - 0.6, [1.4, 2.6], P, "x");
  return (
    <g key={near ? "rail-near" : "rail-far"}>
      {[RAIL_X[0] + 2, RAIL_X[1] - 4].map((hx) => (
        <Solid key={hx} paths={box3(hx, ry + 0.5, RAIL_TOP, hx + 2, ry + RAIL_D - 0.5, Z.ceiling, 0.2)} tone="lo" />
      ))}
      <Solid paths={railSolid(ry)} tone="mid" crease="lo" inner={near ? <Line d={seg([RAIL_X[0], face, Z.rail + 1.6], [RAIL_X[1], face, Z.rail + 1.6])} tone="faint" /> : null}>
        {near ? (
          <>
            <Line d={ticks.minor} tone="lo" />
            <Line d={ticks.major} tone="mid" />
          </>
        ) : null}
      </Solid>
      {[RAIL_X[0], RAIL_X[1] - 2].map((sx) => (
        <Solid key={`stop-${sx}`} paths={box3(sx, ry - 0.5, RAIL_TOP, sx + 2, ry + RAIL_D + 0.5, RAIL_TOP + 2.4, 0.2)} tone="lo" />
      ))}
    </g>
  );
}

function Truck({ ry }: { ry: number }) {
  const x0 = HOME.x - 8;
  const x1 = HOME.x + 8;
  const y0 = ry - 1.6;
  const y1 = ry + RAIL_D + 1.6;
  return (
    <g>
      <Solid paths={box3(x0, y0, RAIL_TOP, x1, y1, RAIL_TOP + 6, 0.6, 0.4)} tone="hi" crease="lo" />
      {/* Wheel axles on the outer face. */}
      <Line d={sideRing([x0 + 4, y1, RAIL_TOP + 2.6], 1.6, "y", P, 16) + sideRing([x1 - 4, y1, RAIL_TOP + 2.6], 1.6, "y", P, 16)} tone="lo" />
      <Dots points={dots([[x0 + 4, y1, RAIL_TOP + 2.6], [x1 - 4, y1, RAIL_TOP + 2.6]])} size={0.5} tone="hi" />
    </g>
  );
}

const BEAM = { y0: RAIL_Y[0] + RAIL_D + 1.6, y1: RAIL_Y[1] - 1.6, z0: RAIL_TOP + 1, z1: RAIL_TOP + 5 };

function Trolley() {
  const { x, y } = HOME;
  return (
    <g>
      <Solid paths={box3(x - 5, y - 5, TROLLEY_BOTTOM + 12, x + 5, y + 5, BEAM.z0, 0.3)} tone="lo" />
      <Solid
        paths={box3(x - 7, y - 7, TROLLEY_BOTTOM + 1, x + 7, y + 7, TROLLEY_BOTTOM + 12, 0.8, 0.5)}
        tone="hi"
        crease="lo"
        inner={<Line d={sideSeam({ x: x - 7, y: y - 7, w: 14, d: 14, r: 0.8 }, TROLLEY_BOTTOM + 6.5, P, 2)} tone="faint" />}
      />
      <Solid paths={cylinder(x + 9.6, y + 2, 2.6, TROLLEY_BOTTOM + 3, 8, P, 24, 0.3)} tone="mid" />
      <Solid paths={box3(x + 7, y + 0.4, TROLLEY_BOTTOM + 5, x + 7.6, y + 3.6, TROLLEY_BOTTOM + 9, 0.1)} tone="lo" />
      <Solid paths={cylinder(x, y, 2.2, TROLLEY_BOTTOM - 1.2, 2.2, P, 20)} tone="mid" />
      <Dots points={dots([[x - 5.6, y + 7, TROLLEY_BOTTOM + 10.6], [x + 5.6, y + 7, TROLLEY_BOTTOM + 10.6], [x + 7, y - 5.6, TROLLEY_BOTTOM + 10.6], [x + 7, y + 5.6, TROLLEY_BOTTOM + 10.6]])} size={0.5} />
    </g>
  );
}

export function Hub() {
  const { x, y } = HOME;
  const z = HUB_REST;
  const bolts = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    return at([x + Math.cos(a) * 4.8, y + Math.sin(a) * 4.8, z]);
  });
  return (
    <g>
      <Solid paths={cylinder(x, y, 5.2, z - HUB_H - 1.2, 1.2, P, 28)} tone="mid" />
      <Solid paths={cylinder(x, y, 7, z - HUB_H, HUB_H, P, 36, 0.8)} tone="hi" crease="lo" inner={<Line d={sideSeamRound(x, y, 7, z - HUB_H / 2)} tone="lo" />} />
      <Dots points={bolts} size={0.5} tone="mid" />
      <Solid paths={cylinder(x, y, 2.4, z, 4, P, 20)} tone="mid" />
    </g>
  );
}

/** Visible half of a ring around a cylinder (a band seam on its side). */
function sideSeamRound(cx: number, cy: number, r: number, z: number): string {
  const pts: Flat[] = [];
  const view = Math.atan2(Math.sin(((P.azimuth ?? 45) * Math.PI) / 180), Math.cos(((P.azimuth ?? 45) * Math.PI) / 180));
  for (let i = 0; i <= 24; i++) {
    const a = view - Math.PI / 2 + (i / 24) * Math.PI;
    pts.push(at([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]));
  }
  return pathOf(pts);
}

/* ---------- Front layer: near frame, glass, header ---------- */

function NearFrame() {
  const zA = Z.glass;
  const zB = Z.ceiling - 6;
  const yF = 105.5;
  const xR = 115.5;
  const glintF = [
    [20, 66],
    [30, 76],
  ].map(([a, b]) => seg([a!, yF, zA], [b!, yF, zB]));
  const glintR = [[20, 58]].map(([a, b]) => seg([xR, a!, zA], [xR, b!, zB]));
  const posts: { c: Point3; node: ReactNode }[] = [
    { c: [115.5, 4.5, 0], node: <Solid key="p-br" paths={box3(113, 2, Z.floor, 118, 7, Z.ceiling)} tone="mid" /> },
    { c: [4.5, 105.5, 0], node: <Solid key="p-fl" paths={box3(2, 103, Z.floor, 7, 108, Z.ceiling)} tone="mid" /> },
    { c: [115.5, 105.5, 0], node: <Solid key="p-fr" paths={box3(113, 103, Z.floor, 118, 108, Z.ceiling)} tone="mid" /> },
  ];
  return (
    <g key="near">
      <Poly className="iso-glass" d={sideRect(xR, 7, 103, zA, zB)} />
      <Line d={glintR.join("")} tone="faint" className="glint" />
      <Poly className="iso-glass" d={frontRect(yF, 7, 113, zA, zB)} />
      <Line d={glintF.join("")} tone="faint" className="glint" />
      <Solid paths={box3(113, 7, Z.floor, 118, 103, zA)} tone="mid" />
      <Solid paths={box3(7, 103, Z.floor, 113, 108, zA)} tone="mid" />
      {byDepth(posts, (p) => p.c).map((p) => p.node)}
      <Solid paths={box3(113, 7, zB, 118, 103, Z.ceiling)} tone="mid" />
      <Solid paths={box3(7, 103, zB, 113, 108, Z.ceiling)} tone="mid" />
    </g>
  );
}

/** The arclaw lockup printed on the marquee sign, from lib/brand/logo (same paths as the site and brand kit). */
const SIGN_SCALE = 12.6 / 40;
function SignLockup({ at, top }: { at: Plane; top: number }) {
  return (
    <g transform={sideMatrix(at, top, P, "left")}>
      <g transform={`scale(${SIGN_SCALE})`}>
        <g transform={`scale(${LOCKUP.mark / MARK_SIZE})`}>
          <path fill={CREAM} d={MARK_BODY} />
          <path fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter" d={MARK_PRONGS} />
        </g>
        <path fill={CREAM} transform={`translate(${LOCKUP.mark + LOCKUP.gap} ${LOCKUP.wordY}) scale(${LOCKUP.wordScale})`} d={WORD_PATH} />
      </g>
    </g>
  );
}

function Header() {
  const lip = { x: -1, y: -1, w: 122, d: 112, r: 1.4 };
  const head = { x: 0, y: 0, w: 120, d: 110, r: 1.2 };
  const yF = 110;
  const xR = 120;
  const sign = { x0: 14, x1: 106, z0: Z.header + 5, z1: Z.header + 22 };
  const grille: Point3[] = [];
  for (let gy = 0; gy < 9; gy++) for (let gz = 0; gz < 3; gz++) grille.push([xR, 26 + gy * 6.5, Z.header + 7 + gz * 4.5]);
  return (
    <g key="header">
      <Solid paths={slabOf(lip, Z.ceiling, Z.header - Z.ceiling, P, 6)} tone="mid" />
      <Solid paths={slabOf(head, Z.header, Z.headerTop - Z.header, P, 6, 1)} tone="mid" crease="lo" />
      <Line d={planOutline(insetPlan(head, 6), Z.headerTop, P, 4)} tone="faint" />
      <Dots points={dots(corners(head, 3).map(([x, y]) => [x, y, Z.headerTop] as Point3))} size={0.5} />
      {/* Service hatch with screws and a pull, a cable gland and a vent panel on the roof. */}
      <Solid paths={box3(18, 16, Z.headerTop, 58, 44, Z.headerTop + 1.2, 0.8, 0.3)} tone="mid" />
      <Dots points={dots(corners({ x: 18, y: 16, w: 40, d: 28, r: 0 }, 2.2).map(([x, y]) => [x, y, Z.headerTop + 1.2] as Point3))} size={0.5} />
      <Solid paths={box3(34, 40, Z.headerTop + 1.2, 42, 42, Z.headerTop + 2.4, 0.3)} tone="lo" />
      <Solid paths={cylinder(92, 22, 3.4, Z.headerTop, 2, P, 24, 0.3)} tone="mid" />
      <Line d={ring(92, 22, 1.6, Z.headerTop + 2, P, 16)} tone="lo" />
      <Line d={planOutline({ x: 66, y: 52, w: 40, d: 36, r: 1 }, Z.headerTop, P, 2)} tone="lo" />
      <Line d={Array.from({ length: 6 }, (_, i) => seg([66, 56 + i * 5.6, Z.headerTop], [106, 56 + i * 5.6, Z.headerTop])).join("")} tone="faint" />
      <Poly className="iso-sign" d={frontRect(yF, sign.x0, sign.x1, sign.z0, sign.z1)} />
      <Line d={frontRect(yF, sign.x0, sign.x1, sign.z0, sign.z1)} tone="mid" />
      <Dots points={dots([[sign.x0 + 1.6, yF, sign.z0 + 1.6], [sign.x1 - 1.6, yF, sign.z0 + 1.6], [sign.x0 + 1.6, yF, sign.z1 - 1.6], [sign.x1 - 1.6, yF, sign.z1 - 1.6]])} size={0.5} />
      <SignLockup at={[60 - (LOCKUP_W * SIGN_SCALE) / 2, yF]} top={sign.z1 - 2.2} />
      <Dots points={grille.map(at)} size={0.55} tone="lo" />
    </g>
  );
}

/* ---------- Moving parts drawn at rest ---------- */

function ButtonCap() {
  return <Solid paths={cylinder(BUTTON.x, BUTTON.y, 4.2, Z.deckTop + 1.4, 2.6, P, 32, 0.5)} tone="hi" crease="lo" />;
}

function Coin() {
  const c: Point3 = [SLOT.x, 112, SLOT.z];
  return (
    <g>
      <path className="iso-coin" d={sideRing(c, 4.2, "y", P, 32)} />
      <Line d={sideRing(c, 3.2, "y", P, 28)} tone="lo" />
    </g>
  );
}

/** Everything the live component needs, keyed (react.md: lazy element props need stable keys). */
export function clawArt() {
  return {
    back: (
      <g key="back">
        <path className="iso-halo" d={haloOf(PLINTH, Z.foot, 6, P)} />
        <Feet />
        <Body />
        <Deck />
        <FarField />
        <ChuteAndPile />
        <Rail ry={RAIL_Y[0]} near={false} />
      </g>
    ),
    farTruck: (
      <g key="far-truck">
        <Truck ry={RAIL_Y[0]} />
      </g>
    ),
    trolley: (
      <g key="trolley">
        <Trolley />
      </g>
    ),
    hub: (
      <g key="hub">
        <Hub />
      </g>
    ),
    box: (
      <g key="box">
        <PrizeBox k="target" cx={TARGET.x} cy={TARGET.y} z={TARGET.z} yaw={0} />
      </g>
    ),
    nearRail: <Rail key="near-rail" ry={RAIL_Y[1]} near />,
    bridge: (
      <g key="bridge">
        <Solid paths={box3(HOME.x - 4, BEAM.y0, BEAM.z0, HOME.x + 4, BEAM.y1, BEAM.z1, 0.4, 0.3)} tone="hi" crease="lo" />
        <Truck ry={RAIL_Y[1]} />
      </g>
    ),
    near: <NearFrame key="near-frame" />,
    header: <Header key="header" />,
    buttonCap: (
      <g key="button-cap">
        <ButtonCap />
      </g>
    ),
    coin: (
      <g key="coin">
        <Coin />
      </g>
    ),
  };
}

export type ClawArt = ReturnType<typeof clawArt>;
