/**
 * What sets the three cabinets apart. The play field, gantry and pile are shared (the claw's model depends on
 * them); everything here sits outside them and escalates with the machine:
 *
 *   single  compact: casters, a plain low topper with the lockup, one button
 *   stack   more structure: cream chrome trim, round speaker grilles on the side, a second button, a taller
 *           topper with a crown and its own name plate
 *   vault   premium: a heavy skirt on levelling feet, a vault door with a dial and bolts, reinforced corners,
 *           a shelf light inside (flat tone steps), a display on the deck, the tallest stepped topper
 *
 * Server-safe; geometry.tsx places these in painter's order.
 */
import { corners, cylinder, insetPlan, planOutline, sideMatrix, sideRing, sideSeam, slabOf, type Plane, type Point3 } from "@/components/iso/iso-kit";
import { Dots, FaceText, Line, Poly, Solid } from "@/components/iso/draw";
import { CLAW, CREAM, LOCKUP, LOCKUP_W, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_PATH } from "@/lib/brand/logo";
import { USDC_BLUE, USDC_BOX, USDC_DISC, USDC_DOLLAR, USDC_RINGS } from "@/lib/brand/usdc";
import { box3, byDepth, dots, frontRect, seg, sideRect } from "./helpers";
import { BODY, DECK, P, PLINTH, SLOT, Z, at, type Variant } from "./view";

const yF = BODY.y + BODY.d; // body front face
const xR = BODY.x + BODY.w; // body right face

/* ---------- Base ---------- */

export function Base({ variant }: { variant: Variant }) {
  if (variant !== "vault") {
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
  const skirt = { x: -3, y: -3, w: 126, d: 116, r: 1.6 };
  return (
    <g key="feet">
      {byDepth(corners(skirt, 12), ([x, y]) => [x, y, 0]).map(([x, y], i) => (
        <g key={i}>
          <Solid paths={cylinder(x, y, 7, -21, 1.8, P, 32, 0.3)} tone="lo" />
          <Solid paths={cylinder(x, y, 2.6, -19.2, 6.2, P, 20)} tone="mid" />
        </g>
      ))}
      <Solid paths={slabOf(skirt, -13, 13, P, 8, 1.2)} tone="mid" crease="lo" inner={<Line d={sideSeam(skirt, -6.5, P, 8)} tone="hi" />} />
      <Dots points={dots([-1, 30, 60, 90, 121].map((x) => [x, skirt.y + skirt.d, -3.4] as Point3))} size={0.6} tone="hi" />
    </g>
  );
}

/* ---------- USDC mark on a front-facing plane ---------- */

/** The USDC coin mark (Circle's colours) on the plane y = `y`, centred at (x, z), radius `r` in world units. */
export function UsdcMark({ x, y, z, r }: { x: number; y: number; z: number; r: number }) {
  return (
    <g transform={sideMatrix([x - r, y], z + r, P, "left")}>
      <g transform={`scale(${(2 * r) / USDC_BOX})`}>
        <path d={USDC_DISC} fill={USDC_BLUE} />
        <path d={USDC_DOLLAR} fill="#fff" />
        <path d={USDC_RINGS} fill="#fff" />
      </g>
    </g>
  );
}

/* ---------- Body trim ---------- */

function SpeakerGrille({ y, z, r }: { y: number; z: number; r: number }) {
  const holes: Point3[] = [];
  for (let dy = -r + 1.4; dy <= r - 1.4; dy += 2.4) for (let dz = -r + 1.4; dz <= r - 1.4; dz += 2.4) if (dy * dy + dz * dz < (r - 1.2) ** 2) holes.push([xR, y + dy, z + dz]);
  return (
    <g>
      <Line d={sideRing([xR, y, z], r, "x", P, 36)} tone="hi" />
      <Line d={sideRing([xR, y, z], r - 0.8, "x", P, 36)} tone="lo" />
      <Dots points={dots(holes)} size={0.45} tone="mid" />
    </g>
  );
}

/** A vault door over the coin door: thick panel, bolts, a combination dial with ticks and a three-spoke handle. */
function VaultDoor() {
  const door = { x0: 66, x1: 108, z0: 22, z1: 84 };
  const dial: Point3 = [97, yF + 2.2, 36];
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 4.2 : 4.9;
    return seg([dial[0] + Math.cos(a) * r0, dial[1], dial[2] + Math.sin(a) * r0], [dial[0] + Math.cos(a) * 5.6, dial[1], dial[2] + Math.sin(a) * 5.6]);
  }).join("");
  const spokes = [0, 2.094, 4.189].map((a) => seg([dial[0] + Math.cos(a) * 1.6, dial[1], dial[2] + Math.sin(a) * 1.6], [dial[0] + Math.cos(a) * 3.6, dial[1], dial[2] + Math.sin(a) * 3.6])).join("");
  const bolts: Point3[] = [];
  for (let x = door.x0 + 3; x <= door.x1 - 3; x += 6.5) bolts.push([x, yF + 2.2, door.z0 + 2.6], [x, yF + 2.2, door.z1 - 2.6]);
  for (let z = door.z0 + 9; z <= door.z1 - 9; z += 8) bolts.push([door.x0 + 2.6, yF + 2.2, z], [door.x1 - 2.6, yF + 2.2, z]);
  return (
    <g>
      <Solid paths={box3(door.x0, yF, door.z0, door.x1, yF + 2.2, door.z1, 1.4, 0.5)} tone="hi" crease="lo" />
      <Line d={frontRect(yF + 2.2, door.x0 + 5, door.x1 - 5, door.z0 + 5, door.z1 - 5)} tone="lo" />
      <Dots points={dots(bolts)} size={0.75} tone="hi" />
      {/* Slot plate on the door, then the dial. */}
      <Solid paths={box3(SLOT.x - 7, yF + 2.2, SLOT.z - 8, SLOT.x + 7, yF + 3.8, SLOT.z + 8, 0.6, 0.3)} tone="hi" crease="lo" />
      <Poly className="iso-void" d={frontRect(yF + 3.8, SLOT.x - 0.7, SLOT.x + 0.7, SLOT.z - 4.5, SLOT.z + 4.5)} />
      <path className="iso-dial" d={sideRing(dial, 6, "y", P, 40)} />
      <Line d={sideRing(dial, 6, "y", P, 40)} tone="hi" />
      <Line d={ticks} tone="mid" />
      <Line d={sideRing(dial, 1.6, "y", P, 20)} tone="hi" />
      <Line d={spokes} tone="hi" />
      <UsdcMark x={SLOT.x + 11} y={yF + 2.2} z={SLOT.z + 5} r={2.4} />
    </g>
  );
}

export function BodyTrim({ variant }: { variant: Variant }) {
  if (variant === "single") return <UsdcMark key="usdc" x={SLOT.x + 11} y={yF} z={SLOT.z + 5} r={2.2} />;
  if (variant === "stack") {
    return (
      <g key="body-trim">
        <Line d={sideSeam(BODY, 86, P, 6) + sideSeam(BODY, 87.6, P, 6)} tone="hi" />
        <SpeakerGrille y={26} z={68} r={8} />
        <SpeakerGrille y={48} z={68} r={8} />
        <UsdcMark x={SLOT.x + 11} y={yF} z={SLOT.z + 5} r={2.2} />
      </g>
    );
  }
  // Vault: rivet rows on the side, the door on the front.
  const rivets: Point3[] = [];
  for (let y = 8; y <= 102; y += 7.5) rivets.push([xR, y, 14], [xR, y, 94]);
  return (
    <g key="body-trim">
      <Line d={sideSeam(BODY, 92, P, 6)} tone="hi" />
      <Dots points={dots(rivets)} size={0.6} tone="hi" />
      <VaultDoor />
    </g>
  );
}

/* ---------- Deck trim ---------- */

export function DeckTrim({ variant }: { variant: Variant }) {
  if (variant === "single") return null;
  const top = Z.deckTop;
  const b2 = { x: 72, y: 117 };
  return (
    <g key="deck-trim">
      <Solid paths={cylinder(b2.x, b2.y, 4.6, top, 1.2, P, 28, 0.4)} tone="mid" />
      <Solid paths={cylinder(b2.x, b2.y, 3.2, top + 1.2, 2, P, 28, 0.4)} tone="hi" crease="lo" />
      {variant === "vault" ? (
        <g>
          {/* Display: a raised bezel with a dark screen and three readout bars. */}
          <Solid paths={box3(46, 108.5, top, 64, 113, top + 5, 0.6, 0.3)} tone="mid" crease="lo" />
          <Poly className="iso-screen" d={frontRect(113, 47.5, 62.5, top + 1, top + 4.2)} />
          <Line d={[2.2, 3.1, 4].map((dz, i) => seg([48.6, 113, top + 4.3 - dz + 0.4], [48.6 + 8 - i * 2.2, 113, top + 4.3 - dz + 0.4])).join("")} tone="hi" />
          <Line d={planOutline(insetPlan(DECK, 1.2), top, P, 6)} tone="hi" />
        </g>
      ) : (
        <Line d={planOutline(insetPlan(DECK, 1.2), top, P, 6)} tone="hi" />
      )}
    </g>
  );
}

/* ---------- Inside: Vault shelf light ---------- */

export function ShelfLight({ variant }: { variant: Variant }) {
  if (variant !== "vault") return null;
  const zBar = Z.ceiling - 12;
  // Flat tone steps on the back and left panels under the bar: light falling off in three bands.
  const bands = [
    [zBar - 6, zBar, 0.07],
    [zBar - 20, zBar - 6, 0.04],
    [zBar - 44, zBar - 20, 0.02],
  ] as const;
  return (
    <g key="shelf-light">
      {bands.map(([z0, z1, a]) => (
        <g key={z0} opacity={a}>
          <Poly className="iso-light" d={frontRect(4, 8, 112, z0, z1)} />
          <Poly className="iso-light" d={sideRect(4, 8, 102, z0, z1)} />
        </g>
      ))}
      <Solid paths={box3(8, 4, zBar, 112, 8, zBar + 3, 0.4)} tone="hi" crease="lo" className="iso-lightbar" />
      <Solid paths={box3(4, 8, zBar, 8, 102, zBar + 3, 0.4)} tone="hi" crease="lo" className="iso-lightbar" />
    </g>
  );
}

/* ---------- Near frame trim ---------- */

export function FrameTrim({ variant }: { variant: Variant }) {
  if (variant === "single") return null;
  const zA = Z.glass;
  const zB = Z.ceiling - 6;
  if (variant === "stack") {
    // Cream chrome: a hairline down the outer edge of each near post.
    return (
      <Line
        key="frame-trim"
        tone="hi"
        d={[seg([7, 108, Z.floor], [7, 108, Z.ceiling]), seg([118, 103, Z.floor], [118, 103, Z.ceiling]), seg([118, 7, Z.floor], [118, 7, Z.ceiling])].join("")}
      />
    );
  }
  // Vault: corner gussets where the near posts meet the rails, and doubled edge trim.
  const g = 7;
  const gussets = [
    // front face, left and right posts, top and bottom
    [[7, 108, zB], [7 + g, 108, zB], [7, 108, zB - g]],
    [[113, 108, zB], [113 - g, 108, zB], [113, 108, zB - g]],
    [[7, 108, zA], [7 + g, 108, zA], [7, 108, zA + g]],
    [[113, 108, zA], [113 - g, 108, zA], [113, 108, zA + g]],
    // right face
    [[118, 103, zB], [118, 103 - g, zB], [118, 103, zB - g]],
    [[118, 7, zB], [118, 7 + g, zB], [118, 7, zB - g]],
    [[118, 103, zA], [118, 103 - g, zA], [118, 103, zA + g]],
    [[118, 7, zA], [118, 7 + g, zA], [118, 7, zA + g]],
  ] as Point3[][];
  return (
    <g key="frame-trim">
      {gussets.map((t, i) => (
        <g key={i}>
          <path className="iso-gusset" d={`M${t.map((p) => at(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`} />
          <Line d={`M${t.map((p) => at(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`} tone="mid" />
        </g>
      ))}
      <Line d={[seg([2, 108, Z.floor], [2, 108, Z.ceiling]), seg([118, 108, Z.floor], [118, 108, Z.ceiling]), seg([118, 2, Z.floor], [118, 2, Z.ceiling])].join("")} tone="mid" />
    </g>
  );
}

/* ---------- Toppers ---------- */

/** The arclaw lockup printed on a sign on the front plane, `height` world units tall, centred on x = 60. */
function SignLockup({ y, top, height }: { y: number; top: number; height: number }) {
  const k = height / 40;
  const at0: Plane = [60 - (LOCKUP_W * k) / 2, y];
  return (
    <g transform={sideMatrix(at0, top, P, "left")}>
      <g transform={`scale(${k})`}>
        <g transform={`scale(${LOCKUP.mark / MARK_SIZE})`}>
          <path fill={CREAM} d={MARK_BODY} />
          <path fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter" d={MARK_PRONGS} />
        </g>
        <path fill={CREAM} transform={`translate(${LOCKUP.mark + LOCKUP.gap} ${LOCKUP.wordY}) scale(${LOCKUP.wordScale})`} d={WORD_PATH} />
      </g>
    </g>
  );
}

function Sign({ y, x0, x1, z0, z1, lockup }: { y: number; x0: number; x1: number; z0: number; z1: number; lockup: number }) {
  return (
    <g>
      <Poly className="iso-sign" d={frontRect(y, x0, x1, z0, z1)} />
      <Line d={frontRect(y, x0, x1, z0, z1)} tone="mid" />
      <Dots points={dots([[x0 + 1.6, y, z0 + 1.6], [x1 - 1.6, y, z0 + 1.6], [x0 + 1.6, y, z1 - 1.6], [x1 - 1.6, y, z1 - 1.6]])} size={0.5} />
      <SignLockup y={y} top={(z0 + z1) / 2 + lockup / 2} height={lockup} />
    </g>
  );
}

/** A name plate on a front face with the machine's name in the pixel face. */
function NamePlate({ y, x0, x1, z0, z1, name }: { y: number; x0: number; x1: number; z0: number; z1: number; name: string }) {
  const size = (z1 - z0) * 0.78;
  return (
    <g>
      <Poly className="iso-sign" d={frontRect(y, x0, x1, z0, z1)} />
      <Line d={frontRect(y, x0, x1, z0, z1)} tone="hi" />
      <FaceText transform={sideMatrix([x0 + 3, y], z0 + (z1 - z0) / 2 - size * 0.36, P, "left")} size={size} tone="hi">
        {name}
      </FaceText>
    </g>
  );
}

export function Topper({ variant }: { variant: Variant }) {
  const lip = { x: -1, y: -1, w: 122, d: 112, r: 1.4 };
  const head = { x: 0, y: 0, w: 120, d: 110, r: 1.2 };
  const z0 = Z.header;
  if (variant === "single") {
    const top = z0 + 18;
    return (
      <g key="header">
        <Solid paths={slabOf(lip, Z.ceiling, z0 - Z.ceiling, P, 6)} tone="mid" />
        <Solid paths={slabOf(head, z0, top - z0, P, 6, 1)} tone="mid" crease="lo" />
        <Line d={planOutline(insetPlan(head, 6), top, P, 4)} tone="faint" />
        <Dots points={dots(corners(head, 3).map(([x, y]) => [x, y, top] as Point3))} size={0.5} />
        <Sign y={110} x0={22} x1={98} z0={z0 + 3.5} z1={z0 + 14.5} lockup={8.4} />
      </g>
    );
  }
  if (variant === "stack") {
    const top = z0 + 26;
    const crown = { x: 12, y: 14, w: 96, d: 80, r: 1 };
    const cTop = top + 11;
    const grille: Point3[] = [];
    for (let gy = 0; gy < 9; gy++) for (let gz = 0; gz < 3; gz++) grille.push([120, 26 + gy * 6.5, z0 + 7 + gz * 4.5]);
    return (
      <g key="header">
        <Solid paths={slabOf(lip, Z.ceiling, z0 - Z.ceiling, P, 6)} tone="mid" />
        <Solid paths={slabOf(head, z0, top - z0, P, 6, 1)} tone="mid" crease="lo" inner={<Line d={sideSeam(head, z0 + 1.5, P, 6) + sideSeam(head, top - 1.5, P, 6)} tone="hi" />} />
        <Sign y={110} x0={14} x1={106} z0={z0 + 5} z1={z0 + 22} lockup={12.6} />
        <Dots points={grille.map(at)} size={0.55} tone="lo" />
        <Solid paths={slabOf(crown, top, cTop - top, P, 4, 0.8)} tone="mid" crease="lo" />
        <NamePlate y={crown.y + crown.d} x0={30} x1={90} z0={top + 1.6} z1={cTop - 1.6} name="STACK" />
        <Line d={planOutline(insetPlan(crown, 5), cTop, P, 4)} tone="faint" />
      </g>
    );
  }
  // Vault: the deepest header, a heavy lip, a two step crown and the largest sign.
  const z1 = z0 + 2;
  const top = z1 + 34;
  const step1 = { x: 6, y: 6, w: 108, d: 98, r: 1.2 };
  const step2 = { x: 18, y: 16, w: 84, d: 76, r: 1 };
  const s1 = top + 6;
  const s2 = s1 + 11;
  const rivets: Point3[] = [];
  for (let x = 4; x <= 116; x += 8) rivets.push([x, 110, z1 + 1.8], [x, 110, top - 1.8]);
  return (
    <g key="header">
      <Solid paths={slabOf({ ...lip, x: -2, y: -2, w: 124, d: 114 }, Z.ceiling, z1 - Z.ceiling, P, 6, 0.6)} tone="mid" crease="lo" inner={<Line d={sideSeam({ ...lip, x: -2, y: -2, w: 124, d: 114 }, Z.ceiling + 2, P, 6)} tone="hi" />} />
      <Solid paths={slabOf(head, z1, top - z1, P, 6, 1)} tone="mid" crease="lo" inner={<Line d={sideSeam(head, z1 + 4, P, 6) + sideSeam(head, top - 4, P, 6)} tone="hi" />} />
      <Dots points={dots(rivets)} size={0.6} tone="hi" />
      <Sign y={110} x0={10} x1={110} z0={z1 + 7} z1={top - 7} lockup={14.4} />
      <Solid paths={slabOf(step1, top, s1 - top, P, 4, 0.6)} tone="mid" crease="lo" />
      <Solid paths={slabOf(step2, s1, s2 - s1, P, 4, 0.8)} tone="hi" crease="lo" />
      <NamePlate y={step2.y + step2.d} x0={32} x1={88} z0={s1 + 1.6} z1={s2 - 1.6} name="VAULT" />
      <Line d={planOutline(insetPlan(step2, 5), s2, P, 4)} tone="faint" />
      <Dots points={dots(corners(step2, 2.5).map(([x, y]) => [x, y, s2] as Point3))} size={0.55} tone="hi" />
    </g>
  );
}

