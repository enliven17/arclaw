// arclaw mainnet launch (20 s, 120 BPM, bar = 2 s, 16:9). For the X post on the day mainnet goes live.
//
// One world: claw orange paper, ink halftone, like a xerox poster. The claw (the logo's claw, drawn in ink) is the
// anchor: it comes down, looks around on the beat, grabs the first line and yanks it away, pulls the lid off a box,
// watches the cards turn, squeezes the two promises, hangs over MAINNET while it types, and on the drop falls into
// the real mark (cream hub, orange prongs) as the world flips to ink.
//
//   bar 0    halftone rings pulse, the claw drops in and looks left, right
//   bar 1    "Every play wins." slams in under it; it grabs the line
//   bar 2    yanks it off; a box slams up; "A box. Every time."; the claw comes back for it
//   bar 3    it rips the lid off, a pack rises and tears, three cards deal
//   bar 4    the cards turn, NVDA is the jackpot; "Real stocks." "Paid to your wallet."
//   bar 5    the three machines; the middle one plays
//   bar 6    "At least half back." "Up to 10x." each on a squeeze
//   bar 7    the build: MAINNET types out under the claw
//   bar 8-9  the drop: ink, the claw becomes the mark, arclaw, Live on Solana devnet., MagicBlock, arclaw.app @arclawapp
//
// Box, pack, cards, cabinets, mark and wordmark are the ones in examples/arclaw-launch (the site's own components).
import { TAU, prog, rgba, E, EASE, spring, wobble, setFont, maskedText, shake, clamp, lerp, hash, noise1 } from '../../engine/core.js';
import { glitch } from '../../engine/fx.js';
import { MARK_BODY, MARK_PRONGS, PRONG_W, WORD_PATH, WORD_W, WORD_H, WORD_BASELINE, LOGOS } from './brand.js';

// ── copy
const COPY = {
  en: {
    wins: 'Every play wins.',
    box: 'A box. Every time.',
    real: 'Real stocks.',
    paid: 'Paid to your wallet.',
    pick: 'Pick a machine.',
    half: 'At least half back.',
    ten: 'Up to 10x.',
    mainnet: 'MAINNET',
    live: 'Live on Solana devnet.',
    token: 'MagicBlock',
    url: 'arclaw.app',
    handle: '@arclawapp',
    usdc: 'USDC',
    // A Single (1 USDC) box at the Jackpot tier: a pack worth 10x = 10.00 USDC (lib/machines.json).
    cards: [
      { ticker: 'AAPL', name: 'Apple', amount: '0.80' },
      { ticker: 'TSLA', name: 'Tesla', amount: '1.20' },
      { ticker: 'NVDA', name: 'NVIDIA', amount: '8.00', tier: 'Jackpot' },
    ],
    machines: [
      { name: 'Single', price: '1' },
      { name: 'Stack', price: '5' },
      { name: 'Vault', price: '10' },
    ],
  },
};

// ── palette (DESIGN.md): claw orange is the paper until the drop, ink after it
const INK = [12, 12, 14], PANEL = [20, 20, 23], PANEL2 = [28, 28, 33], CREAM = [236, 230, 218], MUTED = [139, 134, 125];
const CLAW = [255, 90, 31], PRIZE = [233, 196, 106];
const SANS = 'Geist', MONO = "'Geist Mono'";
const FINISH = {
  single: { body: '#25211c', lid: '#2d2822', edge: 'rgba(236,230,218,0.16)', side: '#1d1a16', tape: '#3a352d' },
  stack: { body: '#1f1f25', lid: '#26262d', edge: 'rgba(236,230,218,0.2)', side: '#18181d' },
  vault: { body: '#111114', lid: '#18181c', edge: 'rgba(236,230,218,0.32)', side: '#0b0b0d' },
};

// ── layout (16:9)
const L = {
  K: 29.6, // big claw: px per logo unit
  boxS: 2.15, floorY: 830,
  packS: 1.85,
  cw: 380, gap: 60, cardY: 560,
  capY: 1000, capPx: 80,
  mw: 340, mgap: 120, mTop: 245, mH: 570, headY: 130, headPx: 72,
  lockS: 4.2, lockY: 400,
};
const GRIP_Y = 13.6 - 8.25; // box lid top below the hub centre, claw units

let P, CARDS, PACK;

// ── timeline (scene seconds, on the beat grid); filled in setup
let T;
function timeline(at, step) {
  const DEAL = at(3, 10);
  return {
    LOOK: [at(0, 8), at(0, 12)], OPEN1: at(0, 14), SLAM1: at(1), GRAB1: at(1, 12), YANK: at(2),
    BOXIN: at(2, 2), BOXCOPY: at(2, 4), DESC2: at(2, 9), GRIP2: at(2, 14), POP: at(3),
    TUG: at(3, 6), TEAR: at(3, 8), DEAL, DEALS: [DEAL, DEAL + step * 2, DEAL + step * 4],
    FLIPS: [at(4), at(4, 4), at(4, 8)], REAL: at(3, 14), PAID: at(4, 12), CARDSOUT: at(4, 14),
    MACH: at(5), GAME: [at(5, 5), at(5, 15)], MOUT: at(6), HALF: at(6, 4), TEN: at(6, 10), HOUT: at(6, 15),
    BUILD: at(7), LETTERS: Array.from({ length: 7 }, (_, i) => at(7) + i * step * 2), DROP: at(8),
    WORD: at(8, 4), LIVE: at(8, 8), TOKEN: at(8, 14), URL: at(9, 2),
    CUTS: [at(1), at(2), at(5), at(6), at(8)],
  };
}

// ───────────────────────────── helpers
const col = (c, a = 1) => rgba(c, a);
function text(ctx, s, x, y, px, { weight = 500, family = SANS, color = INK, align = 'center', track = -0.03 } = {}) {
  setFont(ctx, weight, px, family, track * px);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = typeof color === 'string' ? color : col(color);
  ctx.fillText(s, x, y);
}
/** A line that slams in (overshoots from big) and cuts out. Ink on the orange paper with a paper-coloured knockout
 *  so the halftone never touches the letters. dy/sx let the claw carry or squeeze it. */
function slam(ctx, s, x, y, px, t, t0, t1, { color = INK, knock = CLAW, family = SANS, weight = 500, track = -0.04, dy = 0, sx = 1, align = 'center' } = {}) {
  if (t < t0 || t >= t1) return;
  const k = 1 + 0.35 * (1 - spring(t - t0, 22, 9));
  ctx.save(); ctx.translate(x, y + dy); ctx.scale(k * sx, k);
  setFont(ctx, weight, px, family, track * px);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  if (knock) { ctx.lineWidth = px * 0.14; ctx.strokeStyle = col(knock); ctx.strokeText(s, 0, 0); }
  ctx.fillStyle = col(color); ctx.fillText(s, 0, 0);
  ctx.restore();
}
/** Masked rise in, fade out (for the calm lines of the end card). */
function rise(ctx, s, x, y, px, t, t0, opts = {}) {
  if (t < t0) return;
  ctx.save();
  setFont(ctx, opts.weight ?? 500, px, opts.family ?? SANS, (opts.track ?? -0.03) * px);
  ctx.textAlign = opts.align ?? 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = col(opts.color ?? CREAM);
  maskedText(ctx, s, x, y, EASE.expo(prog(t, t0, t0 + 0.7)), { size: px, pad: 0.4 });
  ctx.restore();
}
function floorShadow(ctx, x, y, rx, ry, a) {
  if (a <= 0.005) return;
  ctx.save(); ctx.filter = `blur(${Math.max(2, ry * 0.6)}px)`;
  ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ───────────────────────────── the paper: an ink halftone on claw orange
/** Dot size is the sum of: a slow standing wave from the centre (the poster's concentric bands), rings launched on
 *  hits, and a darker xerox edge. `paper` / `dot` swap after the drop. */
function halftone(ctx, W, H, t, { paper, dot, alpha = 1, standing = 0.3, speed = 3, edge = 0.5, rings = [], cx = W / 2, cy = H / 2 }) {
  ctx.fillStyle = col(paper); ctx.fillRect(0, 0, W, H);
  const s = 18, rmax = s * 0.64;
  ctx.fillStyle = col(dot, alpha); ctx.beginPath();
  for (let row = 0, y = 0; y < H + s; row++, y += s * 0.866) {
    for (let x = row % 2 ? s / 2 : 0; x < W + s; x += s) {
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
      let v = standing * (0.5 + 0.5 * Math.sin(d * 0.022 - t * speed));
      const ex = Math.max(Math.abs(dx) / (W / 2), Math.abs(dy) / (H / 2));
      v += edge * ex * ex * ex * ex;
      for (const [t0, amp] of rings) {
        const age = t - t0;
        if (age < 0 || age > 1.1) continue;
        const R = age * 1500, q = (d - R) / 110;
        v += amp * Math.exp(-q * q) * (1 - age / 1.1);
      }
      const r = rmax * clamp(v);
      if (r < 0.7) continue;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
  }
  ctx.fill();
}
/** Pixel blocks on a cut: grid cells flash ink or paper for a few frames, thinning out. */
function blocks(ctx, W, H, t, t0, { dur = 0.3, cell = 60, density = 0.22, colors = [INK, CLAW] } = {}) {
  if (t < t0 - 0.05 || t > t0 + dur) return;
  const k = 1 - clamp((t - t0) / dur), step = Math.floor(t * 24);
  for (let j = 0; j * cell < H; j++) {
    for (let i = 0; i * cell < W; i++) {
      const h = hash(step * 13.1 + i * 7.31 + j * 91.7);
      if (h > density * k) continue;
      const w = hash(h * 977) < 0.3 ? cell * 2 : cell;
      ctx.fillStyle = col(colors[hash(h * 311) < 0.55 ? 0 : 1]);
      ctx.fillRect(i * cell, j * cell, w, cell);
    }
  }
}

// ───────────────────────────── the claw (the mark's claw, 24-unit grid, origin at the hub centre (12, 8.25))
function claw(ctx, x, y, K, { open = 0, cable = 2000, rot = 0, part = 'all', body = INK, prongs = INK } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(K, K); ctx.translate(-12, -8.25);
  if (part !== 'front') {
    ctx.fillStyle = col(body); ctx.fillRect(11, 6 - cable / K, 2, cable / K + 0.5);
    ctx.fill(P.hub);
    ctx.strokeStyle = col(prongs); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(12, 10.5); ctx.lineTo(12, 20); ctx.stroke();
  }
  if (part !== 'back') {
    ctx.strokeStyle = col(prongs); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    const a = open * 0.5;
    for (const [px, sgn] of [[9, 1], [15, -1]]) {
      ctx.save(); ctx.translate(px, 10.5); ctx.rotate(sgn * a); ctx.translate(-px, -10.5);
      ctx.beginPath();
      if (sgn > 0) { ctx.moveTo(9, 10.5); ctx.lineTo(4.6, 15); ctx.lineTo(4.6, 18.6); ctx.lineTo(8.2, 22); }
      else { ctx.moveTo(15, 10.5); ctx.lineTo(19.4, 15); ctx.lineTo(19.4, 18.6); ctx.lineTo(15.8, 22); }
      ctx.stroke(); ctx.restore();
    }
  }
  ctx.restore();
}
/** A short blink of the prongs on a beat (the claw's version of a glance). */
const blink = (t, beats, amt = 0.35) => beats.reduce((a, b) => a + amt * Math.sin(Math.PI * prog(t, b, b + 0.16)), 0);
/** Smoothly follow a list of [time, value] keys. */
function keys(t, ks, ease = E.inOutCubic) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t < ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], ease(prog(t, ks[i - 1][0], ks[i][0])));
  return ks[ks.length - 1][1];
}

/** Where the big claw is. Before the drop it is ink; the drop is handled by the end card. */
function clawPose(t, W) {
  const cx = W / 2, K = L.K, hold1 = 395, hold2 = L.floorY - 160 * L.boxS - GRIP_Y * K;
  const s = T;
  // bar 0-2: down, look, open, grab the line, yank it away
  if (t < s.YANK + 0.5) {
    let y = lerp(-420, 170, spring(t - 0.15, 7, 4.2)), open = blink(t, [0.5, s.LOOK[0], s.LOOK[1]]);
    const rot = 0.16 * E.inOutCubic(prog(t, s.LOOK[0] - 0.1, s.LOOK[0] + 0.1)) - 0.32 * E.inOutCubic(prog(t, s.LOOK[1] - 0.1, s.LOOK[1] + 0.1)) + 0.16 * E.inOutCubic(prog(t, s.OPEN1 - 0.05, s.OPEN1 + 0.15));
    open = Math.max(open, E.outCubic(prog(t, s.OPEN1, s.SLAM1)) * (1 - E.inCubic(prog(t, s.GRAB1 - 0.04, s.GRAB1 + 0.04))));
    if (t > s.SLAM1) y = 170 + Math.sin((t - s.SLAM1) * 2.4) * 8;
    y = lerp(y, hold1, E.inCubic(prog(t, s.GRAB1 - 0.16, s.GRAB1)));
    if (t > s.GRAB1) y = hold1 - 12 * prog(t, s.GRAB1, s.YANK) - E.inBack(prog(t, s.YANK, s.YANK + 0.4), 1.6) * 1400;
    return { on: true, x: cx, y, open, rot: rot + noise1(t * 1.4) * 0.015, carry: t > s.GRAB1 ? Math.min(0, y - hold1) : 0 };
  }
  // bar 2-3: back down for the box, grip, rip the lid off
  if (t < s.POP + 0.5) {
    if (t < s.DESC2) return { on: false };
    let y = lerp(-420, hold2, E.outCubic(prog(t, s.DESC2, s.GRIP2)));
    const open = E.outCubic(prog(t, s.DESC2, s.DESC2 + 0.25)) * (1 - E.inCubic(prog(t, s.GRIP2, s.GRIP2 + 0.1)));
    if (t > s.GRIP2) y = hold2 + 6 * Math.sin(prog(t, s.GRIP2, s.POP) * Math.PI) - E.inBack(prog(t, s.POP, s.POP + 0.45), 1.4) * 1500;
    return { on: true, x: cx, y, open, rot: wobble(t - s.GRIP2, 9, 4) * 0.02, lidLift: Math.min(0, y - hold2) };
  }
  // bar 3-4: hangs at the top and watches the cards it dealt turn over
  if (t < s.CARDSOUT + 0.6) {
    if (t < s.DEAL) return { on: false };
    const slot = (i) => cx + (i - 1) * (L.cw + L.gap);
    const x = keys(t, [[s.DEAL, cx], [s.FLIPS[0] - 0.3, slot(0)], [s.FLIPS[1] - 0.3, slot(1)], [s.FLIPS[2] - 0.3, slot(2)], [s.PAID, cx]]);
    const lead = keys(t + 0.12, [[s.DEAL, cx], [s.FLIPS[0] - 0.3, slot(0)], [s.FLIPS[1] - 0.3, slot(1)], [s.FLIPS[2] - 0.3, slot(2)], [s.PAID, cx]]);
    const y = lerp(-700, -190, spring(t - s.DEAL, 8, 5)) - E.inBack(prog(t, s.CARDSOUT, s.CARDSOUT + 0.5), 1.5) * 900;
    return { on: true, x, y, open: blink(t, s.FLIPS, 0.5), rot: clamp((lead - x) / 600, -0.25, 0.25) };
  }
  // bar 6-7: the two promises, then the build over MAINNET
  if (t >= s.MOUT && t < s.DROP) {
    let y = lerp(-500, 110, spring(t - s.MOUT, 8, 5));
    const squeeze = [s.HALF, s.TEN].reduce((a, b) => a + 0.8 * Math.sin(Math.PI * prog(t, b - 0.18, b + 0.1)), 0);
    y = lerp(y, 40, E.inOutCubic(prog(t, s.BUILD - 0.2, s.BUILD + 0.3)));
    const nerve = prog(t, s.BUILD, s.DROP);
    y -= E.inCubic(prog(t, s.DROP - 0.3, s.DROP)) * 80;
    const shiv = Math.sin(t * 70) * 3 * nerve * nerve;
    return { on: true, x: cx + shiv, y, open: squeeze + blink(t, s.LETTERS, 0.25 * (t > s.BUILD ? 1 : 0)), rot: noise1(t * 2) * 0.03 * (1 + nerve * 2) };
  }
  return { on: false };
}

// ───────────────────────────── box, mark, lockup, pack, cards, cabinets (from examples/arclaw-launch)
function box(ctx, s, variant, { lid = null, squash = 0, body = true } = {}) {
  const f = FINISH[variant], W = 200, H = 160, LID = 34, top = LID - 6;
  ctx.save();
  ctx.scale(s * (1 + squash * 0.07), s * (1 - squash * 0.1)); ctx.translate(-W / 2, -H);
  ctx.lineWidth = 1 / s * 1.2;
  if (body) {
    ctx.fillStyle = f.body; ctx.strokeStyle = f.edge;
    ctx.beginPath(); ctx.roundRect(6, top, W - 12, H - top - 2, variant === 'vault' ? 6 : 4); ctx.fill(); ctx.stroke();
    ctx.globalAlpha *= 0.7; ctx.fillStyle = f.side; ctx.fillRect(W - 30, top + 0.5, 23.5, H - top - 3); ctx.globalAlpha /= 0.7;
    if (variant === 'single') { ctx.fillStyle = f.tape; ctx.fillRect(W / 2 - 7, top, 14, 26); }
    if (variant === 'stack') {
      ctx.fillStyle = col(CREAM, 0.2); ctx.fillRect(W / 2 - 12, top, 24, H - top - 2);
      ctx.save(); ctx.translate(18, H - 30); ctx.scale(0.42 * 32 / WORD_H, 0.42 * 32 / WORD_H); ctx.fillStyle = col(CREAM, 0.75); ctx.fill(P.word); ctx.restore();
    }
    if (variant === 'vault') {
      const cy = (top + H) / 2 + 4;
      ctx.fillStyle = col(CREAM, 0.9); ctx.beginPath(); ctx.arc(W / 2, cy, 22, 0, TAU); ctx.fill();
      markAt(ctx, W / 2, cy, 22);
      ctx.strokeStyle = col(CREAM, 0.6); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, H - 18); ctx.lineTo(8, H - 4); ctx.lineTo(22, H - 4); ctx.moveTo(W - 22, H - 4); ctx.lineTo(W - 8, H - 4); ctx.lineTo(W - 8, H - 18); ctx.stroke();
    }
  }
  if (lid && lid.a > 0.005) {
    ctx.save(); ctx.globalAlpha *= lid.a;
    ctx.translate(W / 2 + lid.x / s, 23 + lid.y / s); ctx.rotate(lid.rot); ctx.translate(-W / 2, -23);
    ctx.fillStyle = f.lid; ctx.strokeStyle = f.edge; ctx.lineWidth = 1 / s * 1.2;
    ctx.beginPath(); ctx.roundRect(0, 6, W, LID, variant === 'vault' ? 6 : 4); ctx.fill(); ctx.stroke();
    if (variant === 'single') { ctx.fillStyle = f.tape; ctx.fillRect(W / 2 - 7, 6, 14, LID); }
    if (variant === 'stack') { ctx.fillStyle = col(CREAM, 0.2); ctx.fillRect(W / 2 - 12, 6, 24, LID); markAt(ctx, W / 2, 6 + LID / 2, 16); }
    if (variant === 'vault') {
      ctx.strokeStyle = col(CREAM, 0.25); ctx.beginPath(); ctx.moveTo(4, LID - 2); ctx.lineTo(W - 4, LID - 2); ctx.stroke();
      ctx.strokeStyle = col(CREAM, 0.6); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 6); ctx.lineTo(14, 6); ctx.moveTo(186, 6); ctx.lineTo(200, 6); ctx.lineTo(200, 20); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
function markAt(ctx, x, y, size, { body = CREAM, prongs = CLAW } = {}) {
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24);
  ctx.fillStyle = col(body); ctx.fill(P.body);
  ctx.strokeStyle = col(prongs); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.stroke(P.prongs);
  ctx.restore();
}
const LOCK = (() => {
  const mark = 40, gap = 12, ws = (mark * 0.8) / WORD_H, base = (22 / 24) * mark;
  return { mark, gap, ws, wordY: base - WORD_BASELINE * ws, w: mark + gap + WORD_W * ws, h: mark };
})();
function lockup(ctx, x, y, k, { wordAlpha = 1, wordP = 1, mark = true } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  if (mark) {
    ctx.save(); ctx.scale(LOCK.mark / 24, LOCK.mark / 24);
    ctx.fillStyle = col(CREAM); ctx.fill(P.body);
    ctx.strokeStyle = col(CLAW); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.stroke(P.prongs);
    ctx.restore();
  }
  if (wordAlpha > 0.005) {
    ctx.save(); ctx.globalAlpha *= wordAlpha;
    ctx.beginPath(); ctx.rect(LOCK.mark + LOCK.gap - 2, -20, WORD_W * LOCK.ws + 10, LOCK.h + 22); ctx.clip();
    ctx.translate(LOCK.mark + LOCK.gap, LOCK.wordY + (1 - wordP) * LOCK.h * 1.1); ctx.scale(LOCK.ws, LOCK.ws);
    ctx.fillStyle = col(CREAM); ctx.fill(P.word);
    ctx.restore();
  }
  ctx.restore();
}

const PW = 200, PH = 330, TEAR_Y = 44, SEAL = 24, TEETH = 24, BOW = 5;
function packPaths() {
  const serrate = (y, dir) => Array.from({ length: TEETH * 2 + 1 }, (_, i) => [(i / (TEETH * 2)) * PW, y + (i % 2 ? dir * 4 : 0)]);
  const jit = [0, 2.2, -1.4, 2.8, -2.1, 1.1, -2.6, 2, -0.8, 1.6, -1.9, 2.5];
  const tear = Array.from({ length: 47 }, (_, i) => [(i / 46) * PW, TEAR_Y + jit[i % jit.length]]);
  const top = serrate(4, -1), bottom = serrate(PH - 4, 1).reverse();
  const body = new Path2D();
  tear.forEach(([x, y], i) => (i ? body.lineTo(x, y) : body.moveTo(x, y)));
  body.quadraticCurveTo(PW + BOW, PH / 2, PW, PH - SEAL);
  bottom.forEach(([x, y]) => body.lineTo(x, y));
  body.lineTo(0, PH - SEAL); body.quadraticCurveTo(-BOW, PH / 2, tear[0][0], tear[0][1]); body.closePath();
  const strip = new Path2D();
  top.forEach(([x, y], i) => (i ? strip.lineTo(x, y) : strip.moveTo(x, y)));
  [...tear].reverse().forEach(([x, y]) => strip.lineTo(x, y)); strip.closePath();
  return { body, strip };
}
const ribs = (ctx, y0, y1) => { ctx.beginPath(); for (let i = 0; i < 48; i++) { const x = 2 + i * 4.1; ctx.moveTo(x, y0); ctx.lineTo(x, y1); } ctx.stroke(); };
function foilNoise(ctx, x0, y0, w, h, seed) {
  for (let i = 0; i < 2600; i++) {
    const x = x0 + hash(seed + i * 1.37) * w, y = y0 + hash(seed + i * 2.11 + 9) * h, a = 0.04 + hash(seed + i * 3.7) * 0.1;
    ctx.fillStyle = `rgba(236,230,218,${a.toFixed(3)})`; ctx.fillRect(x, y, 0.7, 0.7);
  }
}
function renderPack(s, machine) {
  const pad = 12, mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil((PW + pad * 2) * s); c.height = Math.ceil((PH + pad * 2) * s); const x = c.getContext('2d'); x.scale(s, s); x.translate(pad, pad); return [c, x]; };
  const [bc, b] = mk(), [sc, st] = mk(), { body, strip } = P.pack;
  b.fillStyle = '#1a1a1f'; b.fill(body);
  b.save(); b.clip(body);
  b.fillStyle = '#1e1e24'; b.beginPath(); b.roundRect(10, TEAR_Y + 10, PW - 20, PH - TEAR_Y - SEAL - 20, 18); b.fill();
  b.fillStyle = '#222229'; b.beginPath(); b.roundRect(22, TEAR_Y + 22, PW - 44, PH - TEAR_Y - SEAL - 44, 14); b.fill();
  foilNoise(b, 0, 0, PW, PH, 7);
  markAt(b, PW / 2, 80 + 32, 64);
  const ws = (32 * 0.95) / WORD_H; b.save(); b.translate((PW - WORD_W * ws) / 2, 160); b.scale(ws, ws); b.fillStyle = col(CREAM); b.fill(P.word); b.restore();
  setFont(b, 500, 26, SANS, -0.6); b.textAlign = 'center'; b.fillStyle = col(CREAM, 0.85); b.fillText(machine, PW / 2, 232);
  b.fillStyle = col(CREAM, 0.07); b.fillRect(0, 250, PW, 26);
  const pip = 9, gp = 7, pw = 6 * pip + 5 * gp;
  for (let i = 0; i < 6; i++) { b.fillStyle = i === 5 ? col(PRIZE) : col(CREAM, 0.22 + i * 0.06); b.beginPath(); b.roundRect((PW - pw) / 2 + i * (pip + gp), 258.5, pip, pip, 2); b.fill(); }
  b.lineCap = 'round'; b.lineJoin = 'round';
  b.strokeStyle = col(CREAM, 0.28); b.lineWidth = 1.6; b.beginPath(); b.moveTo(6, TEAR_Y + 30); b.quadraticCurveTo(2, PH / 2, 6, PH - SEAL - 30); b.stroke();
  b.strokeStyle = col(CREAM, 0.2); b.lineWidth = 0.9; b.stroke(new Path2D('M18 64l9 6l7-3l10 8M150 58l8 9l11 2M172 120l-6 14l5 9M22 214l8-5l6 9l9-3M150 270l10-6l8 7M40 288l12-4l9 5M178 200l-7 10M30 140l5 12l-3 10'));
  b.fillStyle = '#141418'; b.fillRect(0, PH - SEAL, PW, SEAL);
  b.lineCap = 'butt'; b.strokeStyle = col(CREAM, 0.09); b.lineWidth = 1; ribs(b, PH - SEAL, PH);
  b.strokeStyle = col(CREAM, 0.14); b.lineWidth = 0.8; b.beginPath(); b.moveTo(0, PH - SEAL); b.lineTo(PW, PH - SEAL); b.stroke();
  b.restore();
  b.strokeStyle = col(CREAM, 0.18); b.lineWidth = 1; b.stroke(body);
  st.fillStyle = '#141418'; st.fill(strip);
  st.save(); st.clip(strip);
  st.strokeStyle = col(CREAM, 0.09); st.lineWidth = 1; ribs(st, 0, SEAL);
  st.strokeStyle = col(CREAM, 0.14); st.lineWidth = 0.8; st.beginPath(); st.moveTo(0, SEAL); st.lineTo(PW, SEAL); st.stroke();
  st.fillStyle = '#1a1a1f'; st.fillRect(0, SEAL, PW, TEAR_Y - SEAL + 4);
  foilNoise(st, 0, 0, PW, TEAR_Y + 4, 31);
  st.fillStyle = col(CREAM, 0.1); st.beginPath(); st.moveTo(PW * 0.7, 0); st.lineTo(PW * 0.76, 0); st.lineTo(PW * 0.7, TEAR_Y + 4); st.lineTo(PW * 0.64, TEAR_Y + 4); st.fill();
  st.restore();
  st.fillStyle = col(INK); st.beginPath(); st.moveTo(-0.5, TEAR_Y - 5); st.lineTo(7, TEAR_Y); st.lineTo(-0.5, TEAR_Y + 5); st.fill();
  st.strokeStyle = col(CREAM, 0.18); st.lineWidth = 1; st.stroke(strip);
  return { body: bc, strip: sc, s, pad };
}
function pack(ctx, x, y, k, { rot = 0, tear = 0, sheen = 0, tug = 0 } = {}) {
  const { body, strip, s, pad } = PACK, sc = k / s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-(PW / 2 + pad) * s, -(PH / 2 + pad) * s);
  ctx.drawImage(body, 0, 0);
  ctx.save(); ctx.scale(s, s); ctx.translate(pad, pad); ctx.clip(P.pack.body);
  const o = sheen * PW;
  ctx.fillStyle = col(CREAM, 0.07); ctx.beginPath(); ctx.moveTo(PW * 0.62 + o, TEAR_Y); ctx.lineTo(PW * 0.8 + o, TEAR_Y); ctx.lineTo(PW * 0.3 + o, PH); ctx.lineTo(PW * 0.12 + o, PH); ctx.fill();
  ctx.fillStyle = col(CREAM, 0.12); ctx.beginPath(); ctx.moveTo(PW * 0.84 + o, TEAR_Y); ctx.lineTo(PW * 0.9 + o, TEAR_Y); ctx.lineTo(PW * 0.4 + o, PH); ctx.lineTo(PW * 0.34 + o, PH); ctx.fill();
  ctx.restore();
  if (tear < 1) {
    const r = E.outCubic(tear);
    ctx.save(); ctx.globalAlpha *= 1 - prog(tear, 0.55, 1);
    const ox = (PW * 0.96 + pad) * s, oy = (PH * 0.12 + pad) * s;
    ctx.translate(ox + r * 260 * s, oy - r * 150 * s - tug * 2 * s); ctx.rotate(-tug * 0.05 + r * 0.9); ctx.translate(-ox, -oy);
    ctx.drawImage(strip, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
function renderCard(w, card, face) {
  const h = Math.round((w * 88) / 63), c = document.createElement('canvas'), S = 2;
  c.width = (w + 4) * S; c.height = (h + 4) * S;
  const x = c.getContext('2d'); x.scale(S, S); x.translate(2, 2);
  const r = (14 / 210) * w, big = !!card?.tier;
  x.fillStyle = col(PANEL); x.beginPath(); x.roundRect(0, 0, w, h, r); x.fill();
  x.lineWidth = big && face === 'front' ? 2.5 : 1.25;
  x.strokeStyle = big && face === 'front' ? col(PRIZE) : col(CREAM, 0.16);
  x.beginPath(); x.roundRect(0.6, 0.6, w - 1.2, h - 1.2, r); x.stroke();
  if (face === 'back') {
    x.lineWidth = 1.2; x.strokeStyle = col(CREAM, 0.1);
    x.beginPath(); x.roundRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12, (10 / 210) * w); x.stroke();
    x.beginPath(); x.roundRect(w * 0.12, w * 0.12, w * 0.76, h - w * 0.24, (8 / 210) * w); x.stroke();
    markAt(x, w / 2, h / 2, w * 0.3);
    return c;
  }
  const px = w * 0.085, py = w * 0.085;
  text(x, card.ticker, px, py + w * 0.1, w * 0.115, { family: MONO, align: 'left', track: 0, color: CREAM });
  if (card.tier) text(x, card.tier, w - px, py + w * 0.1, w * 0.085, { color: PRIZE, align: 'right', track: -0.01 });
  const wy = py + w * 0.16, wh = h - wy - py - w * 0.17;
  x.lineWidth = 1.2; x.strokeStyle = col(CREAM, 0.1); x.beginPath(); x.roundRect(px, wy, w - px * 2, wh, (10 / 210) * w); x.stroke();
  const ls = w * 0.42; x.save(); x.translate(w / 2 - ls / 2, wy + wh / 2 - ls / 2); x.scale(ls / 24, ls / 24); x.fillStyle = col(CREAM); x.fill(new Path2D(LOGOS[card.ticker])); x.restore();
  text(x, card.name, px, h - py, w * 0.078, { color: MUTED, align: 'left', track: 0, weight: 400 });
  text(x, `${card.amount} USDC`, w - px, h - py, w * 0.084, { family: MONO, align: 'right', track: 0, color: CREAM });
  return c;
}
function drawCard(ctx, img, w, x, y, { rot = 0, sx = 1, scale = 1, alpha = 1, shadow = 0.5 } = {}) {
  if (alpha <= 0.005) return;
  const h = (w * 88) / 63;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx * scale, scale);
  if (shadow > 0) { ctx.shadowColor = `rgba(0,0,0,${shadow})`; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16; }
  ctx.drawImage(img, -w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  ctx.restore();
}
function cabinet(ctx, x, y, w, h, variant, t, { play = 0 } = {}) {
  const line = (a) => col(CREAM, a);
  ctx.save(); ctx.lineWidth = 1.5;
  const mq = h * 0.13, gTop = mq + h * 0.02, gH = h * 0.47, deck = gTop + gH, dH = h * 0.06, base = deck + dH, bH = h - base - 10;
  ctx.fillStyle = col(PANEL); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x, y, w, mq, 8); ctx.fill(); ctx.stroke();
  const lk = (mq * 0.36) / LOCK.h; lockup(ctx, x + w / 2 - (LOCK.w * lk) / 2, y + mq / 2 - (LOCK.h * lk) / 2, lk);
  ctx.fillStyle = '#0f0f12'; ctx.fillRect(x + 6, y + gTop, w - 12, gH);
  ctx.strokeStyle = line(0.16); ctx.strokeRect(x + 6, y + gTop, w - 12, gH);
  ctx.strokeStyle = line(0.08); ctx.beginPath(); ctx.moveTo(x + 18, y + gTop + 14); ctx.lineTo(x + w - 18, y + gTop + 14); ctx.stroke();
  const chW = w * 0.24, chH = gH * 0.2;
  ctx.strokeStyle = line(0.16); ctx.strokeRect(x + 16, y + gTop + gH - chH - 8, chW, chH);
  const bs = (w * 0.18) / 200, bh = 160 * bs, sealed = { x: 0, y: 0, rot: 0, a: 1 };
  const pileAt = (px, row) => [x + w * px - 4, y + gTop + gH - 8 - row * bh * 0.86];
  const pile = [[0.48, 0], [0.66, 0], [0.84, 0], [0.57, 1], [0.75, 1], [0.66, 2]];
  const taken = play > 0.47;
  for (const [px, row] of pile) {
    if (taken && row === 2) continue;
    const [bx, by] = pileAt(px, row);
    ctx.save(); ctx.translate(bx, by); box(ctx, bs, variant, { lid: sealed }); ctx.restore();
  }
  const ck = (100 * bs) / 7.4, rest = y + gTop + 8.25 * ck - 6;
  const [topX, topBottom] = pileAt(0.66, 2), chuteX = x + 16 + (w * 0.24) / 2;
  const reach = topBottom - bh - GRIP_Y * ck - rest;
  const seg = (a, b) => E.inOutCubic(prog(play, a, b));
  const idleX = x + w * 0.32 + Math.sin(t * 0.6 + w) * 4 * (play > 0 ? 0 : 1);
  const hx = play < 0.6 ? lerp(idleX, topX, seg(0, 0.2)) : lerp(topX, chuteX, seg(0.6, 0.8));
  const drop = reach * (seg(0.22, 0.38) - seg(0.47, 0.6));
  const open = Math.min(seg(0.05, 0.2), 1 - seg(0.4, 0.46)) + seg(0.84, 0.9) * 0.8;
  const hy = rest + drop;
  ctx.save(); ctx.beginPath(); ctx.rect(x + 6, y + gTop + 14, w - 12, gH - 14); ctx.clip();
  claw(ctx, hx, hy, ck, { open, cable: hy - y - gTop + 20, part: 'back', body: CREAM, prongs: CLAW });
  if (taken) {
    const fall = prog(play, 0.86, 1), bottom = hy + GRIP_Y * ck + bh + (play > 0.86 ? fall * fall * gH * 0.8 : 0);
    ctx.save(); ctx.translate(hx, bottom); box(ctx, bs, variant, { lid: sealed }); ctx.restore();
  }
  claw(ctx, hx, hy, ck, { open, cable: hy - y - gTop + 20, part: 'front', body: CREAM, prongs: CLAW });
  ctx.restore();
  ctx.fillStyle = col(PANEL2); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x - 8, y + deck, w + 16, dH, 6); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = line(0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w * 0.24, y + deck + dH * 0.55); ctx.lineTo(x + w * 0.24, y + deck - dH * 0.45); ctx.stroke();
  ctx.fillStyle = line(0.8); ctx.beginPath(); ctx.arc(x + w * 0.24, y + deck - dH * 0.5, dH * 0.24, 0, TAU); ctx.fill();
  ctx.fillStyle = line(0.3); ctx.beginPath(); ctx.ellipse(x + w * 0.72, y + deck + dH * 0.5, dH * 0.34, dH * 0.24, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.fillStyle = col(PANEL); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x, y + base, w, bH, 8); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = line(0.12); ctx.strokeRect(x + w * 0.12, y + base + bH * 0.22, w * 0.26, bH * 0.36);
  const sx = x + w * 0.72, sy = y + base + bH * 0.4, sw = w * 0.14, sh = bH * 0.36;
  ctx.fillStyle = col(PANEL2); ctx.strokeStyle = line(0.2); ctx.beginPath(); ctx.roundRect(sx - sw / 2, sy - sh / 2, sw, sh, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col(INK); ctx.fillRect(sx - 3, sy - sh * 0.32, 6, sh * 0.64);
  if (variant === 'vault') {
    ctx.strokeStyle = line(0.5); ctx.lineWidth = 3;
    for (const [cx0, sx0] of [[x, 1], [x + w, -1]]) { ctx.beginPath(); ctx.moveTo(cx0 + sx0 * 2, y + h - 40); ctx.lineTo(cx0 + sx0 * 2, y + h - 12); ctx.lineTo(cx0 + sx0 * 30, y + h - 12); ctx.stroke(); }
  }
  ctx.fillStyle = col(PANEL2); ctx.fillRect(x + 14, y + h - 10, 26, 10); ctx.fillRect(x + w - 40, y + h - 10, 26, 10);
  ctx.restore();
}

// ───────────────────────────── the scene
export default {
  setup(api) {
    T = timeline(api.at.bind(api), api.step);
    P = {
      body: new Path2D(MARK_BODY), prongs: new Path2D(MARK_PRONGS), word: new Path2D(WORD_PATH),
      hub: new Path2D('M7.5 6h9a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'),
      pack: packPaths(),
    };
    const C = COPY[api.lang] ?? COPY.en;
    PACK = renderPack(L.packS * 1.25, 'Single');
    CARDS = { back: renderCard(L.cw, null, 'back'), front: C.cards.map((c) => renderCard(L.cw, c, 'front')) };
  },

  draw(ctx, t, api) {
    const { W, H } = api, C = COPY[api.lang] ?? COPY.en, cx = W / 2, s = T;
    const inked = t >= s.DROP;

    // ── the paper
    const hits = [[0, 0.5], [0.5, 0.35], [1, 0.4], [1.5, 0.4], [s.SLAM1, 0.9], [s.GRAB1, 0.5], [s.YANK, 0.7], [s.BOXIN + 0.2, 0.7], [s.POP, 0.8],
      [s.FLIPS[2], 1], [s.MACH, 0.6], [s.HALF, 0.8], [s.TEN, 0.9], ...Array.from({ length: 8 }, (_, i) => [s.BUILD + i * api.beat / 2, 0.3 + i * 0.06])];
    const calm = t > s.DEAL && t < s.MOUT ? 0.45 : 1; // quieter paper behind the cards and the machines
    const build = prog(t, s.BUILD, s.DROP);
    if (!inked) halftone(ctx, W, H, t, { paper: CLAW, dot: INK, standing: (0.3 + build * 0.25) * calm, speed: 3 + build * 9, edge: 0.3, rings: hits.map(([a, b]) => [a, b * calm]) });
    else halftone(ctx, W, H, t, { paper: INK, dot: CLAW, alpha: 0.16, standing: 0.08, speed: 1.5, edge: 0, rings: [[s.DROP, 1.2], [s.DROP + 0.4, 0.5]], cy: L.lockY });

    const [sx, sy] = shake(t, [[s.SLAM1, 10], [s.YANK, 8], [s.BOXIN + 0.25, 12], [s.POP, 10], [s.FLIPS[2] + 0.12, 12], [s.HALF, 9], [s.TEN, 11], [s.DROP, 18], [s.DROP + 0.36, 6]]);
    ctx.save(); ctx.translate(sx, sy);

    if (!inked) {
      const cp = clawPose(t, W);
      // ── bar 1-2: the first line, grabbed and carried off
      if (t >= s.SLAM1 && t < s.YANK + 0.45) {
        const squeeze = 1 - 0.05 * E.outCubic(prog(t, s.GRAB1, s.GRAB1 + 0.1));
        slam(ctx, C.wins, cx, 700, 170, t, s.SLAM1, s.YANK + 0.45, { dy: cp.carry ?? 0, sx: squeeze });
      }
      // ── bar 2-3: the box, its lid, the pack, the cards
      if (t >= s.BOXIN && t < s.FLIPS[2] + 2) boxAndPack(ctx, t, api, cp);
      slam(ctx, C.box, cx, 990, 88, t, s.BOXCOPY, s.POP);
      // ── bar 4: the turned cards
      if (t >= s.DEAL && t < s.MACH + 0.6) {
        const ps = packState(t, H);
        cardsDeal(ctx, t, api, ps, false);
        cardsFlip(ctx, t, api);
      }
      slam(ctx, C.real, cx, L.capY, L.capPx, t, s.REAL, s.PAID);
      slam(ctx, C.paid, cx, L.capY, L.capPx, t, s.PAID, s.MACH + 0.1);
      // ── bar 5: the machines
      if (t >= s.MACH - 0.1 && t < s.MOUT + 0.5) machines(ctx, t, api, C);
      // ── bar 6: the two promises, bar 7: MAINNET
      slam(ctx, C.half, cx, 690, 130, t, s.HALF, s.HOUT);
      slam(ctx, C.ten, cx, 860, 130, t, s.TEN, s.HOUT);
      if (t >= s.BUILD) mainnet(ctx, t, api, C);
      // ── the claw over everything it touches
      if (cp.on) claw(ctx, cp.x, cp.y, L.K, { open: clamp(cp.open, 0, 1.2), rot: cp.rot });
    } else endCard(ctx, t, api, C);

    ctx.restore();

    // ── cuts: pixel blocks and a slice tear
    for (const c of s.CUTS) {
      blocks(ctx, W, H, t, c, { density: c === s.DROP ? 0.4 : 0.2 });
    }
    for (const c of s.CUTS) glitch(ctx, W, H, t, c, { pre: 0.04, post: 0.18, width: 0.16, colors: [INK, CREAM] });
  },

  /** Xerox grain on the finished frame (sharp time, so it does not smear). */
  post(ctx, t, api) {
    const { W, H } = api, inked = t >= T.DROP, step = Math.floor(t * 15);
    ctx.fillStyle = inked ? 'rgba(236,230,218,0.05)' : 'rgba(12,12,14,0.16)';
    for (let i = 0; i < 1400; i++) {
      const x = hash(step * 3.1 + i * 1.73) * W, y = hash(step * 7.7 + i * 2.39 + 5) * H, r = 0.8 + hash(i * 9.1 + step) * 1.6;
      ctx.fillRect(x, y, r, r);
    }
  },
};

// ───────────────────────────── bar 2-4: box, lid, pack, cards
function boxAndPack(ctx, t, api, cp) {
  const { W, H } = api, s = T, cx = W / 2, bs = L.boxS, bw = 200 * bs, bh = 160 * bs;
  // the box slams up from below and lands on the floor line
  let bottom = lerp(H + bh + 40, L.floorY, spring(t - s.BOXIN, 13, 7.5)), squash = 0;
  if (t > s.BOXIN + 0.25) squash = wobble(t - s.BOXIN - 0.25, 22, 9) * 0.6;
  const trem = Math.pow(prog(t, s.GRIP2 + 0.1, s.POP), 2);
  const bx = cx + Math.sin(t * 88) * 6 * trem;
  // the claw takes the lid with it; the body drops away under the rising pack
  const lid = { x: 0, y: Math.min(0, cp.lidLift ?? 0), rot: (cp.lidLift ?? 0) * -0.0004, a: 1 };
  if (t >= s.POP + 0.5) lid.a = 0;
  const sink = E.inCubic(prog(t, s.POP + 0.06, s.POP + 0.5));
  const sinkBy = sink * (H - L.floorY + bh + 80);
  bottom += sinkBy; lid.y -= sinkBy;
  if (t < s.POP + 0.6) floorShadow(ctx, bx, L.floorY + 6, bw * 0.48, 14, 0.4 * (1 - sink) * clamp(1 - (L.floorY - bottom) / 300));
  if (t > s.POP) {
    const ps = packState(t, H);
    if (t >= s.DEAL) cardsDeal(ctx, t, api, ps, true);
    pack(ctx, cx, ps.y, L.packS, { rot: ps.rot, tear: t >= s.TEAR ? prog(t, s.TEAR, s.TEAR + 0.4) : 0, tug: t > s.TUG && t < s.TEAR ? Math.sin(prog(t, s.TUG, s.TEAR) * Math.PI) : 0, sheen: -0.25 + E.outCubic(prog(t, s.POP + 0.1, s.TEAR + 0.5)) * 0.35 });
  }
  if (bottom - bh < H + 20 && t < s.POP + 0.6) {
    ctx.save(); ctx.translate(bx, bottom); box(ctx, bs, 'single', { lid, squash }); ctx.restore();
  }
}
function packState(t, H) {
  const s = T, packH = PH * L.packS;
  const y0 = lerp(L.floorY + packH * 0.42, H * 0.5, spring(t - s.POP - 0.08, 9, 5.5)) + E.inCubic(prog(t, s.DEAL + 0.05, s.DEAL + 0.8)) * H * 0.9;
  const rot = noise1(t * 1.3 + 4) * 0.025 + (t > s.TEAR ? wobble(t - s.TEAR, 20, 7) * 0.03 : 0);
  return { y: y0, rot, top: y0 - packH / 2 + TEAR_Y * L.packS, w: PW * L.packS };
}
const slotX = (api, i) => api.W / 2 + (i - 1) * (L.cw + L.gap);
const dealAt = (i) => T.DEALS[[0, 2, 1].indexOf(i)];
function cardsDeal(ctx, t, api, ps, behind) {
  const h = (L.cw * 88) / 63;
  [0, 1, 2].forEach((i) => {
    const t0 = dealAt(i);
    if (t < t0 || t >= t0 + 0.6) return;
    const fly = EASE.expo(prog(t, t0 + 0.06, t0 + 0.6)), lift = E.outCubic(prog(t, t0, t0 + 0.16));
    if (behind !== fly < 0.2) return;
    const startY = ps.top + h * 0.55 - lift * h * 0.35;
    const x = lerp(api.W / 2, slotX(api, i), fly), y = lerp(startY, L.cardY, fly) - Math.sin(fly * Math.PI) * 30;
    const rot = (1 - fly) * (i - 1) * 0.3 * prog(fly, 0, 0.3);
    if (behind) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4); ctx.rect(api.W / 2 - ps.w / 2 - 6, ps.top, ps.w + 12, 4000); ctx.clip('evenodd');
      drawCard(ctx, CARDS.back, L.cw, x, y, { rot, shadow: 0 });
      ctx.restore();
    } else drawCard(ctx, CARDS.back, L.cw, x, y, { rot, shadow: 0.45 * fly });
  });
}
function cardsFlip(ctx, t, api) {
  const s = T, out = (i) => E.inBack(prog(t, s.CARDSOUT + i * 0.05, s.CARDSOUT + 0.55 + i * 0.05), 1.6);
  [0, 1, 2].forEach((i) => {
    const t0 = dealAt(i);
    if (t < t0 + 0.6) return;
    const tf = s.FLIPS[i], jack = i === 2;
    const lift = jack ? E.outCubic(prog(t, tf - 0.35, tf)) * (1 - 0.6 * E.outCubic(prog(t, tf + 0.3, tf + 0.9))) : Math.sin(prog(t, tf, tf + 0.4) * Math.PI) * 0.4;
    const q = EASE.expo(prog(t, tf, tf + (jack ? 0.5 : 0.4)));
    const sxv = Math.cos(q * Math.PI), img = sxv >= 0 ? CARDS.back : CARDS.front[i];
    const settle = wobble(t - t0 - 0.6, 16, 6) * 0.025 * (i - 1) + wobble(t - tf - 0.3, 14, 6) * 0.03 * (q > 0.5 ? 1 : 0);
    const shiver = jack && t > tf - 0.35 && t < tf ? Math.sin(t * 80) * 0.012 * prog(t, tf - 0.35, tf) : 0;
    const o = out(i);
    drawCard(ctx, img, L.cw, slotX(api, i), L.cardY - lift * 34 + o * 900, { rot: settle + shiver - o * (i - 1) * 0.3, sx: Math.max(0.02, Math.abs(sxv)), scale: 1 + lift * 0.06 + Math.sin(q * Math.PI) * 0.05, shadow: 0.45 + lift * 0.2 });
  });
}

// ───────────────────────────── bar 5: the machines (the middle one plays a game)
function machines(ctx, t, api, C) {
  const { W } = api, s = T, cx = W / 2, kinds = ['single', 'stack', 'vault'];
  const xs = [-1, 0, 1].map((i) => cx + i * (L.mw + L.mgap) - L.mw / 2);
  const gone = (i) => E.inBack(prog(t, s.MOUT - 0.3 + i * 0.05, s.MOUT + 0.2 + i * 0.05), 1.5);
  kinds.forEach((k, i) => {
    const p = spring(t - s.MACH - i * api.step * 1.5, 10, 6.5), g = gone(i);
    if (p <= 0) return;
    const play = i === 1 ? prog(t, s.GAME[0], s.GAME[1]) : 0;
    ctx.save(); ctx.translate(0, (1 - p) * 800 + g * 1000);
    cabinet(ctx, xs[i], L.mTop, L.mw, L.mH, k, t, { play });
    const m = C.machines[i], ly = L.mTop + L.mH + 76;
    text(ctx, m.name, xs[i] + 2, ly, 52, { align: 'left' });
    setFont(ctx, 400, 34, MONO, 0); const uw = ctx.measureText(C.usdc).width;
    text(ctx, C.usdc, xs[i] + L.mw - 2, ly, 34, { family: MONO, align: 'right', track: 0, color: col(INK, 0.6), weight: 400 });
    text(ctx, m.price, xs[i] + L.mw - 2 - uw - 14, ly, 44, { family: MONO, align: 'right', track: 0 });
    ctx.restore();
  });
  slam(ctx, C.pick, cx, L.headY, L.headPx, t, s.MACH + 0.25, s.MOUT - 0.2);
}

// ───────────────────────────── bar 7: MAINNET types out, a letter on every eighth
function mainnet(ctx, t, api, C) {
  const s = T, px = 250, n = s.LETTERS.filter((x) => t >= x).length;
  setFont(ctx, 500, px, MONO, 0.02 * px);
  const full = ctx.measureText(C.mainnet).width, x0 = api.W / 2 - full / 2;
  const shown = C.mainnet.slice(0, n);
  const last = s.LETTERS[n - 1] ?? 0, pop = 1 + 0.2 * (1 - spring(t - last, 26, 10));
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const w = ctx.measureText(shown.slice(0, -1)).width, y = 760;
  ctx.lineWidth = px * 0.12; ctx.strokeStyle = col(CLAW); ctx.fillStyle = col(INK);
  ctx.strokeText(shown.slice(0, -1), x0, y); ctx.fillText(shown.slice(0, -1), x0, y);
  if (n > 0) {
    ctx.save(); ctx.translate(x0 + w, y); ctx.scale(pop, pop);
    ctx.strokeText(shown.slice(-1), 0, 0); ctx.fillText(shown.slice(-1), 0, 0);
    ctx.restore();
  }
  // the caret: a solid block after the last letter, until the drop
  const cw = ctx.measureText('M').width * 0.62;
  if (n < C.mainnet.length) ctx.fillRect(x0 + ctx.measureText(shown).width + 8, y - px * 0.72, cw, px * 0.74);
  ctx.restore();
}

// ───────────────────────────── bar 8-9: the claw falls into the mark, the world turns ink
function endCard(ctx, t, api, C) {
  const { W } = api, s = T, cx = W / 2, k = L.lockS, w = LOCK.w * k, x0 = cx - w / 2, y0 = L.lockY - (LOCK.h * k) / 2;
  const mk = (k * LOCK.mark) / 24, hubX = x0 + 12 * mk, hubY = y0 + 8.25 * mk;
  // the claw comes down from where it hung, shrinking into the mark; its cable shortens into the mark's stem
  const d = spring(t - s.DROP, 10, 6), q = E.outCubic(prog(t, s.DROP, s.DROP + 0.32));
  const K = lerp(L.K, mk, q), x = lerp(cx, hubX, q), y = lerp(-160, hubY, d);
  const cable = lerp(1400, 5 * K, E.inOutCubic(prog(t, s.DROP + 0.1, s.DROP + 0.45)));
  const open = 0.9 * (1 - E.inCubic(prog(t, s.DROP + 0.18, s.DROP + 0.34)));
  claw(ctx, x, y, K, { open, cable, body: CREAM, prongs: CLAW });
  const wp = EASE.expo(prog(t, s.WORD, s.WORD + 0.7));
  lockup(ctx, x0, y0, k, { mark: false, wordP: wp, wordAlpha: wp > 0 ? 1 : 0 });
  rise(ctx, C.live, cx, 690, 84, t, s.LIVE);
  rise(ctx, C.token, cx, 800, 52, t, s.TOKEN, { family: MONO, track: 0, color: CLAW });
  // url and handle, mono, apart (no separator)
  setFont(ctx, 400, 40, MONO, 0);
  const a = ctx.measureText(C.url).width, b = ctx.measureText(C.handle).width, gap = 88, ux = cx - (a + gap + b) / 2;
  rise(ctx, C.url, ux, 930, 40, t, s.URL, { family: MONO, align: 'left', track: 0, weight: 400 });
  rise(ctx, C.handle, ux + a + gap, 930, 40, t, s.URL + 0.15, { family: MONO, align: 'left', track: 0, weight: 400, color: MUTED });
}
