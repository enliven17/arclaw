/**
 * World layout of the claw machine and its camera. World units are about 1 px of the real cabinet: x and y on the
 * floor, z up. The front of the machine is the +y face, the right side is +x; azimuth 58 shows the front long.
 *
 * Shared by geometry.tsx (server, static art) and frame.ts (client, moving parts), so both draw in one camera.
 */
import { boxCorners, fitProjection, iso, type Flat, type Plan, type Point3 } from "@/components/iso/iso-kit";

export const W = 560;
export const H = 760;
export const AZIMUTH = 58;
export const ELEVATION = 30;

/** Cabinet shell. */
export const BODY: Plan = { x: 2, y: 2, w: 116, d: 106, r: 1.2 };
export const PLINTH: Plan = { x: 0, y: 0, w: 120, d: 110, r: 1.6 };
export const DECK: Plan = { x: 6, y: 106, w: 108, d: 20, r: 2 };
export const Z = {
  foot: -7,
  plinth: 0,
  body: 9,
  deck: 90,
  deckTop: 99,
  floor: 100,
  glass: 104,
  rail: 214,
  railTop: 219,
  ceiling: 250,
  header: 252,
  headerTop: 278,
} as const;

/** Glass section posts (square, 5 units) and the panes between them. */
export const POST = 5;
export const IN = { x0: 2, x1: 118, y0: 2, y1: 108 } as const;

/** The chute: a walled hole in the floor at the front-left, where prizes drop. */
export const CHUTE: Plan = { x: 9, y: 70, w: 30, d: 32, r: 0 };
export const CHUTE_WALL = 2;
export const CHUTE_TOP = 122;

/** Gantry: two rails along x, a bridge along y that rides them, a trolley that rides the bridge. */
export const RAIL_Y = [10, 95] as const;
export const RAIL_D = 5;
export const RAIL_X = [9, 111] as const;
export const TROLLEY_BOTTOM = 206;

/** Prize boxes: 18 unit cubes. */
export const BOX = 18;

/** Where the claw rests and where it grips (the top box of the pile). */
export const HOME = { x: 24, y: 86 } as const;
export const TARGET = { x: 61, y: 58, z: 136 } as const;
export const HUB_REST = 194;
export const HUB_GRIP = 170;
export const HUB_H = 9;
/** Hub bottom to the box top while gripping. */
export const CARRY_DROP = HUB_H + 7;

/** Coin slot plate, play button and joystick on the front. */
export const SLOT = { x: 86, z: 58 } as const;
export const JOY = { x: 32, y: 116 } as const;
export const BUTTON = { x: 86, y: 116 } as const;

export const P = fitProjection([...boxCorners({ x: 0, y: 0, w: 120, d: 126, r: 0 }, Z.foot, Z.headerTop)], W, H, {
  pad: 18,
  azimuth: AZIMUTH,
  elevation: ELEVATION,
});

export const at = (p: Point3): Flat => iso(p, P);
