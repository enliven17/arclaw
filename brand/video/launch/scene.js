// arclaw launch video (22 s, 120 BPM, bar = 2 s). 16:9 here, 1:1 in square/ (same scene, layoutFor picks the sizes).
//
//   bar 0-1  a big claw (the logo's claw) comes down the middle, past the bottom edge, grabs, and pulls a sealed box up
//   bar 2    it sets the box down and leaves; the box trembles
//   bar 3    the lid pops, a foil pack rises out, its top strip rips off
//   bar 4-6  three face-down cards deal out and flip: AAPL, TSLA, then NVDA as the jackpot
//   bar 7-8  the three machines; a USDC coin drops into a slot
//   bar 9-10 the lockup, the line, arclaw.app and @arclawapp
//
// Matte: flat brand colours, hairlines, soft black shadows only. The pack's flat specular streaks are the one shine.
// Box, pack and cards follow the site's own components (components/pack/SealedBox.tsx, BoosterPack.tsx,
// components/landing/StockCard.tsx); logo, wordmark, USDC and stock marks are the repo's paths (brand.js).
import { TAU, prog, rgba, E, EASE, spring, wobble, setFont, maskedText, shake, clamp, lerp, hash, noise1 } from '../../engine/core.js';
import { MARK_BODY, MARK_PRONGS, PRONG_W, WORD_PATH, WORD_W, WORD_H, WORD_BASELINE, USDC_BLUE, USDC_BOX, USDC_DISC, USDC_DOLLAR, USDC_RINGS, LOGOS } from './brand.js';

// ── copy (one dictionary per language)
const COPY = {
  en: {
    wins: 'Every play wins a box.',
    real: ['Real stocks.', 'Paid to your wallet.'],
    pick: 'Pick a machine.',
    half: ['At least half back.', 'Up to 10x.'],
    line: ['Grab a box.', 'Pull real stocks.'],
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

// ── palette (DESIGN.md)
const INK = [12, 12, 14], PANEL = [20, 20, 23], PANEL2 = [28, 28, 33], CREAM = [236, 230, 218], MUTED = [139, 134, 125];
const CLAW = [255, 90, 31], PRIZE = [233, 196, 106];
const SANS = 'Geist', MONO = "'Geist Mono'";

// Box finishes (SealedBox.tsx FINISH).
const FINISH = {
  single: { body: '#25211c', lid: '#2d2822', edge: 'rgba(236,230,218,0.16)', side: '#1d1a16', tape: '#3a352d' },
  stack: { body: '#1f1f25', lid: '#26262d', edge: 'rgba(236,230,218,0.2)', side: '#18181d' },
  vault: { body: '#111114', lid: '#18181c', edge: 'rgba(236,230,218,0.32)', side: '#0b0b0d' },
};

/** Sizes per aspect ratio. Everything else is measured from W/2 and these. */
function layoutFor(W, H) {
  const sq = W / H < 1.3;
  return {
    sq,
    clawK: sq ? 26.2 : 29.6, // claw: px per logo unit (the outer prongs hug the box: 7.4 units = half the box)
    boxS: sq ? 1.9 : 2.15, // box: px per SealedBox unit
    floorY: sq ? 760 : 770,
    winsY: sq ? 950 : 940, winsPx: sq ? 64 : 72,
    packS: sq ? 1.7 : 1.85,
    cw: sq ? 300 : 400, gap: sq ? 30 : 60, cardY: sq ? 500 : 490,
    capY: sq ? 830 : 885, capPx: sq ? 52 : 56,
    mw: sq ? 290 : 360, mgap: sq ? 40 : 110, mTop: sq ? 250 : 225, mH: sq ? 545 : 600,
    headY: sq ? 120 : 165, headPx: sq ? 60 : 72,
    lockS: sq ? 3.6 : 4.2, lockY: sq ? 400 : 420,
    lineY: sq ? 650 : 650, linePx: sq ? 66 : 72,
    urlY: sq ? 850 : 800, urlPx: sq ? 40 : 40,
  };
}

let P; // Path2D cache
let CARDS; // pre-rendered card faces
let PACK; // pre-rendered pack parts

// ───────────────────────────── helpers
const col = (c, a = 1) => rgba(c, a);
function text(ctx, s, x, y, px, { weight = 500, family = SANS, color = CREAM, align = 'center', track = -0.03 } = {}) {
  setFont(ctx, weight, px, family, track * px);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = typeof color === 'string' ? color : col(color);
  ctx.fillText(s, x, y);
}
/** Masked rise in, fade + lift out. */
function line(ctx, s, x, y, px, t, t0, t1, opts = {}) {
  if (t < t0 || t > t1 + 0.5) return;
  const p = EASE.expo(prog(t, t0, t0 + 0.7)), o = E.inCubic(prog(t, t1, t1 + 0.35));
  if (o >= 1) return;
  ctx.save(); ctx.globalAlpha *= 1 - o; ctx.translate(0, -o * 24);
  setFont(ctx, opts.weight ?? 500, px, opts.family ?? SANS, (opts.track ?? -0.03) * px);
  ctx.textAlign = opts.align ?? 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = col(opts.color ?? CREAM);
  maskedText(ctx, s, x, y, p, { size: px, pad: 0.4 });
  ctx.restore();
}
/** A soft black floor shadow (no light, no colour). */
function floorShadow(ctx, x, y, rx, ry, a) {
  if (a <= 0.005) return;
  ctx.save(); ctx.filter = `blur(${Math.max(2, ry * 0.6)}px)`;
  ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ───────────────────────────── the claw (the mark, 24-unit grid, origin at the hub centre (12, 8.25))
/** open: 0 = logo pose, 1 = fully open. cable: px of cable above the hub. front/back: which prongs to paint. */
function claw(ctx, x, y, K, { open = 0, cable = 2000, rot = 0, part = 'all' } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(K, K); ctx.translate(-12, -8.25);
  if (part !== 'front') {
    // cable: from far above down into the hub
    ctx.fillStyle = col(CREAM); ctx.fillRect(11, 6 - cable / K, 2, cable / K + 0.5);
    ctx.fill(P.hub);
    // the centre prong sits behind whatever the claw holds
    ctx.strokeStyle = col(CLAW); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(12, 10.5); ctx.lineTo(12, 20); ctx.stroke();
  }
  if (part !== 'back') {
    ctx.strokeStyle = col(CLAW); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
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
/** Where the box's lid top sits below the hub centre, in claw units (the outer prongs hug its sides). */
const GRIP_Y = 13.6 - 8.25;

// ───────────────────────────── the sealed box (SealedBox.tsx, 200 x 160 units), drawn bottom-centre at the origin
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
/** The mark (cream body, claw prongs) centred at (x, y), `size` px square. */
function markAt(ctx, x, y, size, { body = CREAM, prongs = CLAW } = {}) {
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24);
  ctx.fillStyle = col(body); ctx.fill(P.body);
  ctx.strokeStyle = col(prongs); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.stroke(P.prongs);
  ctx.restore();
}
/** The lockup (logo.ts): mark 40 units, gap 12, wordmark at 0.8 of the mark, baseline on the prong tips. */
const LOCK = (() => {
  const mark = 40, gap = 12, ws = (mark * 0.8) / WORD_H, base = (22 / 24) * mark;
  return { mark, gap, ws, wordY: base - WORD_BASELINE * ws, w: mark + gap + WORD_W * ws, h: mark };
})();

// ───────────────────────────── the foil pack (BoosterPack.tsx, 200 x 330 units)
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
/** Pre-render the pack body and strip at `s` px per unit (the specular streaks are drawn live on top). */
function renderPack(s, machine) {
  const pad = 12, mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil((PW + pad * 2) * s); c.height = Math.ceil((PH + pad * 2) * s); const x = c.getContext('2d'); x.scale(s, s); x.translate(pad, pad); return [c, x]; };
  const [bc, b] = mk(), [sc, st] = mk(), { body, strip } = P.pack;
  // body
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
  // strip
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
/** Draw the pack centred at (x, y). tear: 0 = sealed, 1 = strip gone. sheen: the streak offset (flat, translucent cream). */
function pack(ctx, x, y, k, { rot = 0, tear = 0, sheen = 0, tug = 0 } = {}) {
  const { body, strip, s, pad } = PACK, sc = k / s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-(PW / 2 + pad) * s, -(PH / 2 + pad) * s);
  ctx.drawImage(body, 0, 0);
  // live specular streaks on the bulge: they slide as the pack turns
  ctx.save(); ctx.scale(s, s); ctx.translate(pad, pad); ctx.clip(P.pack.body);
  const o = sheen * PW;
  ctx.fillStyle = col(CREAM, 0.07); ctx.beginPath(); ctx.moveTo(PW * 0.62 + o, TEAR_Y); ctx.lineTo(PW * 0.8 + o, TEAR_Y); ctx.lineTo(PW * 0.3 + o, PH); ctx.lineTo(PW * 0.12 + o, PH); ctx.fill();
  ctx.fillStyle = col(CREAM, 0.12); ctx.beginPath(); ctx.moveTo(PW * 0.84 + o, TEAR_Y); ctx.lineTo(PW * 0.9 + o, TEAR_Y); ctx.lineTo(PW * 0.4 + o, PH); ctx.lineTo(PW * 0.34 + o, PH); ctx.fill();
  ctx.restore();
  // the strip: tugs, then rips off up and to the right around its right end
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

// ───────────────────────────── cards (StockCard.tsx, 63:88, radius 14 at 210 px)
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
  text(x, card.ticker, px, py + w * 0.1, w * 0.115, { family: MONO, align: 'left', track: 0, weight: 500 });
  if (card.tier) text(x, card.tier, w - px, py + w * 0.1, w * 0.085, { color: PRIZE, align: 'right', track: -0.01 });
  const wy = py + w * 0.16, wh = h - wy - py - w * 0.17;
  x.lineWidth = 1.2; x.strokeStyle = col(CREAM, 0.1); x.beginPath(); x.roundRect(px, wy, w - px * 2, wh, (10 / 210) * w); x.stroke();
  const ls = w * 0.42; x.save(); x.translate(w / 2 - ls / 2, wy + wh / 2 - ls / 2); x.scale(ls / 24, ls / 24); x.fillStyle = col(CREAM); x.fill(new Path2D(LOGOS[card.ticker])); x.restore();
  text(x, card.name, px, h - py, w * 0.078, { color: MUTED, align: 'left', track: 0, weight: 400 });
  text(x, `${card.amount} USDC`, w - px, h - py, w * 0.084, { family: MONO, align: 'right', track: 0 });
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

// ───────────────────────────── a cabinet, front on, (x, y) its top-left
function cabinet(ctx, x, y, w, h, variant, t, { clawDrop = 0, clawGrab = 0 } = {}) {
  const f = FINISH[variant], line = (a) => col(CREAM, a);
  ctx.save(); ctx.lineWidth = 1.5;
  const mq = h * 0.13, gTop = mq + h * 0.02, gH = h * 0.47, deck = gTop + gH, dH = h * 0.06, base = deck + dH, bH = h - base - 10;
  // marquee
  ctx.fillStyle = col(PANEL); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x, y, w, mq, 8); ctx.fill(); ctx.stroke();
  const lk = (mq * 0.36) / LOCK.h; lockup(ctx, x + w / 2 - (LOCK.w * lk) / 2, y + mq / 2 - (LOCK.h * lk) / 2, lk);
  // glass and frame posts
  ctx.fillStyle = '#0f0f12'; ctx.fillRect(x + 6, y + gTop, w - 12, gH);
  ctx.strokeStyle = line(0.16); ctx.strokeRect(x + 6, y + gTop, w - 12, gH);
  ctx.strokeStyle = line(0.08); ctx.beginPath(); ctx.moveTo(x + 18, y + gTop + 14); ctx.lineTo(x + w - 18, y + gTop + 14); ctx.stroke(); // rail
  // prize chute on the left
  const chW = w * 0.24, chH = gH * 0.2;
  ctx.strokeStyle = line(0.16); ctx.strokeRect(x + 16, y + gTop + gH - chH - 8, chW, chH);
  // the pile of boxes in this machine's finish
  const bs = (w * 0.18) / 200;
  const pile = [[0.48, 0], [0.66, 0], [0.84, 0], [0.57, 1], [0.75, 1], [0.66, 2]];
  for (const [px, row] of pile) {
    ctx.save(); ctx.translate(x + w * px - 4, y + gTop + gH - 8 - row * 160 * bs * 0.86); box(ctx, bs, variant, { lid: { x: 0, y: 0, rot: 0, a: 1 } }); ctx.restore();
  }
  // the little claw on its rail
  const ck = (w * 0.15) / 24, cx = x + w * 0.32 + Math.sin(t * 0.6 + w) * 4, cy = y + gTop + 30 + clawDrop * gH * 0.42;
  ctx.save(); ctx.beginPath(); ctx.rect(x + 6, y + gTop + 14, w - 12, gH - 14); ctx.clip();
  claw(ctx, cx, cy + 8.25 * ck - 30, ck, { open: clawGrab, cable: 40 + clawDrop * gH * 0.42 });
  ctx.restore();
  // deck: joystick and button
  ctx.fillStyle = col(PANEL2); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x - 8, y + deck, w + 16, dH, 6); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = line(0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w * 0.24, y + deck + dH * 0.55); ctx.lineTo(x + w * 0.24, y + deck - dH * 0.45); ctx.stroke();
  ctx.fillStyle = line(0.8); ctx.beginPath(); ctx.arc(x + w * 0.24, y + deck - dH * 0.5, dH * 0.24, 0, TAU); ctx.fill();
  ctx.fillStyle = line(0.3); ctx.beginPath(); ctx.ellipse(x + w * 0.72, y + deck + dH * 0.5, dH * 0.34, dH * 0.24, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 1.5;
  // lower body
  ctx.fillStyle = col(PANEL); ctx.strokeStyle = line(0.16); ctx.beginPath(); ctx.roundRect(x, y + base, w, bH, 8); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = line(0.12); ctx.strokeRect(x + w * 0.12, y + base + bH * 0.22, w * 0.26, bH * 0.36); // prize door
  const slot = slotOf(x, y, w, h);
  ctx.fillStyle = col(PANEL2); ctx.strokeStyle = line(0.2); ctx.beginPath(); ctx.roundRect(slot.x - slot.w / 2, slot.y - slot.h / 2, slot.w, slot.h, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col(INK); ctx.fillRect(slot.x - 3, slot.y - slot.h * 0.32, 6, slot.h * 0.64);
  if (variant === 'vault') {
    ctx.strokeStyle = line(0.5); ctx.lineWidth = 3;
    for (const [cx0, sx0] of [[x, 1], [x + w, -1]]) { ctx.beginPath(); ctx.moveTo(cx0 + sx0 * 2, y + h - 40); ctx.lineTo(cx0 + sx0 * 2, y + h - 12); ctx.lineTo(cx0 + sx0 * 30, y + h - 12); ctx.stroke(); }
  }
  // feet
  ctx.fillStyle = col(PANEL2); ctx.fillRect(x + 14, y + h - 10, 26, 10); ctx.fillRect(x + w - 40, y + h - 10, 26, 10);
  ctx.restore();
}
const slotOf = (x, y, w, h) => { const base = h * 0.13 + h * 0.02 + h * 0.47 + h * 0.06, bH = h - base - 10; return { x: x + w * 0.72, y: y + base + bH * 0.4, w: w * 0.14, h: bH * 0.36 }; };
function lockup(ctx, x, y, k, { wordAlpha = 1, wordP = 1, markY = 0 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  ctx.save(); ctx.translate(0, markY / k); ctx.scale(LOCK.mark / 24, LOCK.mark / 24);
  ctx.fillStyle = col(CREAM); ctx.fill(P.body);
  ctx.strokeStyle = col(CLAW); ctx.lineWidth = PRONG_W; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.stroke(P.prongs);
  ctx.restore();
  if (wordAlpha > 0.005) {
    ctx.save(); ctx.globalAlpha *= wordAlpha;
    ctx.beginPath(); ctx.rect(LOCK.mark + LOCK.gap - 2, -20, WORD_W * LOCK.ws + 10, LOCK.h + 22); ctx.clip();
    ctx.translate(LOCK.mark + LOCK.gap, LOCK.wordY + (1 - wordP) * LOCK.h * 1.1); ctx.scale(LOCK.ws, LOCK.ws);
    ctx.fillStyle = col(CREAM); ctx.fill(P.word);
    ctx.restore();
  }
  ctx.restore();
}
function usdcCoin(ctx, x, y, r, spin) {
  ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(0.06, Math.abs(Math.cos(spin))), 1);
  const k = (r * 2) / USDC_BOX; ctx.scale(k, k); ctx.translate(-USDC_BOX / 2, -USDC_BOX / 2);
  ctx.fillStyle = USDC_BLUE; ctx.fill(P.usdc.disc);
  ctx.fillStyle = '#ffffff'; ctx.fill(P.usdc.dollar); ctx.fill(P.usdc.rings);
  ctx.restore();
}

// ───────────────────────────── the scene
export default {
  setup(api) {
    P = {
      body: new Path2D(MARK_BODY), prongs: new Path2D(MARK_PRONGS), word: new Path2D(WORD_PATH),
      hub: new Path2D('M7.5 6h9a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'),
      usdc: { disc: new Path2D(USDC_DISC), dollar: new Path2D(USDC_DOLLAR), rings: new Path2D(USDC_RINGS) },
      pack: packPaths(),
    };
    const L = layoutFor(api.W, api.H), C = COPY[api.lang] ?? COPY.en;
    PACK = renderPack(L.packS * 1.25, 'Single');
    CARDS = { back: renderCard(L.cw, null, 'back'), front: C.cards.map((c) => renderCard(L.cw, c, 'front')) };
  },

  draw(ctx, t, api) {
    const { W, H } = api, at = api.at.bind(api), L = layoutFor(W, H), C = COPY[api.lang] ?? COPY.en, cx = W / 2;
    // beat grid
    const GRAB = at(1), LIFT = at(1, 2), RELEASE = at(2), LAND = at(2, 2), TREMBLE = at(2, 8), POP = at(3), TUG = at(3, 10), TEAR = at(3, 12);
    const DEAL = at(4), FLIPS = [at(4, 12), at(5), at(5, 6)], CAP = at(5, 10), MACH = at(7), COPY2 = at(8), COIN = at(8), END = at(9, 4);
    ctx.fillStyle = col(INK); ctx.fillRect(0, 0, W, H);

    const [sx, sy] = shake(t, [[GRAB, 7], [LAND, 9], [POP, 12], [FLIPS[2] + 0.12, 10], [COIN, 4], [END + 0.42, 5]]);
    ctx.save(); ctx.translate(sx, sy);

    // ── bars 0-3: claw, box, pack
    if (t < DEAL + 1.2) {
      const K = L.clawK, bs = L.boxS, bw = 200 * bs, bh = 160 * bs;
      const hubHeld = L.floorY - 60 - bh - GRIP_Y * K; // hub centre while it holds the box 60 px above the floor
      const below = H + GRIP_Y * K + 100; // hub centre at the grab: the box top is under the frame
      let hubY, open = 0, sway = 0;
      if (t < GRAB) {
        // the descent: accelerates down the middle, prongs open on the way
        const p = prog(t, 0.05, GRAB - 0.12);
        hubY = lerp(-420, below, E.inOutCubic(p));
        open = E.outCubic(prog(t, 0.35, 1.25)) * (1 - E.inCubic(prog(t, GRAB - 0.14, GRAB - 0.02)));
        sway = Math.sin(t * 5.2) * 0.012 * (1 - p);
      } else if (t < LIFT) {
        // the grab: the cable takes the weight, stretches and shivers
        hubY = below + 16 * Math.sin(prog(t, GRAB, LIFT) * Math.PI);
        sway = wobble(t - GRAB, 38, 9) * 0.01;
      } else if (t < RELEASE) {
        // the lift: a heavy spring up into the frame, the load swinging under it
        hubY = lerp(below, hubHeld, spring(t - LIFT, 9, 5.5));
        sway = wobble(t - LIFT - 0.5, 6.5, 2.2) * 0.05 * prog(t, LIFT + 0.2, LIFT + 0.5);
      } else {
        // release, then back up and out with a small dip first
        open = E.outCubic(prog(t, RELEASE, RELEASE + 0.12)) * 0.7 * (1 - E.inOutCubic(prog(t, LAND + 0.25, LAND + 0.6)));
        hubY = hubHeld + 9 * Math.sin(prog(t, RELEASE, LAND + 0.05) * Math.PI) - E.inBack(prog(t, LAND + 0.05, LAND + 0.85), 1.4) * (hubHeld + 500);
        sway = wobble(t - RELEASE, 6.5, 2.2) * 0.02;
      }
      // the box: waiting below, held, falling, landed, trembling, popping, sinking away
      let boxX = cx, boxBottom, boxRot = 0, squash = 0;
      const lid = { x: 0, y: 0, rot: 0, a: 1 }, fallT = RELEASE + 0.07, held = hubHeld + GRIP_Y * K + bh;
      if (t < GRAB) boxBottom = below + GRIP_Y * K + bh;
      else if (t < fallT) { boxBottom = hubY + GRIP_Y * K + bh; boxRot = sway; }
      else {
        const ft = t - fallT, g = (2 * (L.floorY - held)) / Math.pow(LAND - fallT, 2);
        boxBottom = Math.min(L.floorY, held + 0.5 * g * ft * ft);
        if (t > LAND) squash = wobble(t - LAND, 22, 9) * 0.7;
      }
      const trem = t < POP ? Math.pow(prog(t, TREMBLE, POP), 2) : 0;
      boxX += Math.sin(t * 88) * 7 * trem; boxRot += Math.sin(t * 71) * 0.035 * trem;
      if (t >= POP) {
        squash = wobble(t - POP, 20, 8) * 0.8;
        const lp = prog(t, POP, POP + 0.55);
        Object.assign(lid, { x: -E.outCubic(lp) * 420, y: -E.outCubic(lp) * 520 + lp * lp * 220, rot: -E.outCubic(lp) * 1.3, a: 1 - prog(t, POP + 0.25, POP + 0.55) });
      }
      const sink = E.inBack(prog(t, POP + 0.75, POP + 1.35), 1.2);
      boxBottom += sink * 560;

      if (t > fallT && t < POP + 1.4) floorShadow(ctx, boxX, L.floorY + 6, bw * 0.48, 14, 0.55 * clamp(1 - (L.floorY - boxBottom) / 300) * (1 - sink));

      // the pack and the cards that come out of it
      if (t > POP) {
        const ps = packState(t, L, H, api);
        if (t >= DEAL) cardsDeal(ctx, t, api, L, ps, true);
        pack(ctx, cx, ps.y, L.packS, { rot: ps.rot, tear: t >= TEAR ? prog(t, TEAR, TEAR + 0.4) : 0, tug: t > TUG && t < TEAR ? Math.sin(prog(t, TUG, TEAR) * Math.PI) : 0, sheen: -0.25 + E.outCubic(prog(t, POP + 0.1, TEAR + 0.5)) * 0.35 });
      }
      // claw: cable, hub and centre prong behind the box, outer prongs in front
      const clawOn = hubY > -420 && t < LAND + 1.0;
      if (clawOn) claw(ctx, cx, hubY, K, { open, rot: sway, part: 'back' });
      if (boxBottom - bh < H + 20 && t < POP + 1.5) {
        ctx.save(); ctx.translate(boxX, boxBottom); ctx.rotate(boxRot);
        box(ctx, bs, 'single', { lid: t < POP + 0.6 ? lid : null, squash });
        ctx.restore();
      }
      if (clawOn) claw(ctx, cx, hubY, K, { open, rot: sway, part: 'front' });
    }

    // ── bar 2-3 copy
    line(ctx, C.wins, cx, L.winsY, L.winsPx, t, RELEASE + 0.1, POP + 0.02);

    // ── bars 4-6: the cards
    if (t >= DEAL && t < MACH + 0.8) {
      const ps = packState(t, L, H, api);
      cardsDeal(ctx, t, api, L, ps, false);
      cardsFlip(ctx, t, api, L, FLIPS, MACH);
      const capOut = MACH - 0.35;
      line(ctx, C.real[0] + ' ' + C.real[1], cx, L.capY, L.capPx, t, CAP, capOut);
    }

    // ── bars 7-8: the machines
    if (t >= MACH - 0.2 && t < END + 0.8) machines(ctx, t, api, L, C, { MACH, COIN, COPY2, END });

    // ── bars 9-10: the end card
    if (t >= END - 0.1) endCard(ctx, t, L, C, END, W);

    ctx.restore();
  },
};

/** Where the pack is: it rises out of the box, tugs, tears, then drops away as the cards come out. */
function packState(t, L, H, api) {
  const POP = api.at(3), TEAR = api.at(3, 12), DEAL = api.at(4), packH = PH * L.packS;
  const y0 = lerp(L.floorY + packH * 0.42, H * 0.47, spring(t - POP - 0.12, 8, 5.2)) + E.inCubic(prog(t, DEAL + 0.05, DEAL + 0.8)) * H * 0.85;
  const rot = noise1(t * 1.3 + 4) * 0.025 + (t > TEAR ? wobble(t - TEAR, 20, 7) * 0.03 : 0);
  return { y: y0, rot, top: y0 - packH / 2 + TEAR_Y * L.packS, w: PW * L.packS };
}
const slotX = (api, L, i) => api.W / 2 + (i - 1) * (L.cw + L.gap);
/** Deal order: left, right, then the middle (the pack is gone by then). */
const dealAt = (api, i) => api.at(4) + [0, 2, 1].indexOf(i) * api.step * 2;

/** Cards leaving the pack and flying to their slots, face down. The `behind` pass is drawn before the pack and
 *  clipped by it, so a card reads as sliding out of the torn top. */
function cardsDeal(ctx, t, api, L, ps, behind) {
  const h = (L.cw * 88) / 63;
  [0, 1, 2].forEach((i) => {
    const t0 = dealAt(api, i);
    if (t < t0 || t >= t0 + 0.75) return;
    const fly = EASE.expo(prog(t, t0 + 0.1, t0 + 0.75)), lift = E.outCubic(prog(t, t0, t0 + 0.2));
    if (behind !== fly < 0.2) return;
    const startY = ps.top + h * 0.55 - lift * h * 0.35;
    const x = lerp(api.W / 2, slotX(api, L, i), fly), y = lerp(startY, L.cardY, fly) - Math.sin(fly * Math.PI) * 30;
    const rot = (1 - fly) * (i - 1) * 0.3 * prog(fly, 0, 0.3);
    if (behind) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4); ctx.rect(api.W / 2 - ps.w / 2 - 6, ps.top, ps.w + 12, 4000); ctx.clip('evenodd');
      drawCard(ctx, CARDS.back, L.cw, x, y, { rot, shadow: 0 });
      ctx.restore();
    } else drawCard(ctx, CARDS.back, L.cw, x, y, { rot, shadow: 0.45 * fly });
  });
}

/** Settled cards: face down, then each flips on its beat. The third is the jackpot: it lifts, waits, turns. */
function cardsFlip(ctx, t, api, L, FLIPS, MACH) {
  const out = (i) => E.inBack(prog(t, MACH - 0.4 + i * 0.06, MACH + 0.25 + i * 0.06), 1.6);
  [0, 1, 2].forEach((i) => {
    const t0 = dealAt(api, i);
    if (t < t0 + 0.75) return;
    const tf = FLIPS[i], jack = i === 2;
    const lift = jack ? E.outCubic(prog(t, tf - 0.4, tf)) * (1 - 0.6 * E.outCubic(prog(t, tf + 0.3, tf + 0.9))) : Math.sin(prog(t, tf, tf + 0.4) * Math.PI) * 0.4;
    const q = EASE.expo(prog(t, tf, tf + (jack ? 0.55 : 0.45)));
    const ang = q * Math.PI, sx = Math.cos(ang);
    const img = sx >= 0 ? CARDS.back : CARDS.front[i];
    const settle = wobble(t - t0 - 0.75, 16, 6) * 0.025 * (i - 1) + wobble(t - tf - 0.3, 14, 6) * 0.03 * (q > 0.5 ? 1 : 0);
    const dim = i < 2 ? 1 - 0.45 * E.outCubic(prog(t, FLIPS[2] + 0.1, FLIPS[2] + 0.6)) : 1;
    const shiver = jack && t > tf - 0.4 && t < tf ? Math.sin(t * 80) * 0.012 * prog(t, tf - 0.4, tf) : 0;
    const o = out(i);
    const y = L.cardY - lift * 34 + o * 900;
    drawCard(ctx, img, L.cw, slotX(api, L, i), y, { rot: settle + shiver - o * (i - 1) * 0.3, sx: Math.abs(sx) < 0.02 ? 0.02 : Math.abs(sx), scale: 1 + lift * 0.06 + Math.sin(q * Math.PI) * 0.05, alpha: dim, shadow: 0.45 + lift * 0.2 });
  });
}

function machines(ctx, t, api, L, C, { MACH, COIN, COPY2, END }) {
  const { W } = api, cx = W / 2, kinds = ['single', 'stack', 'vault'];
  const xs = [-1, 0, 1].map((i) => cx + i * (L.mw + L.mgap) - L.mw / 2);
  const gone = (i) => E.inBack(prog(t, END - 0.35 + i * 0.05, END + 0.25 + i * 0.05), 1.5);
  // coin: falls into the middle machine's slot, spinning, lands edge-on on the beat
  const mid = 1, slot = slotOf(xs[mid], L.mTop, L.mw, L.mH);
  kinds.forEach((k, i) => {
    const t0 = MACH + i * api.step * 1.5, p = spring(t - t0, 10, 6.5), g = gone(i);
    if (p <= 0) return;
    const dy = (1 - p) * 700 + g * 900;
    const clawDrop = i === mid ? Math.sin(prog(t, COIN + 0.25, COIN + 1.6) * Math.PI) : 0;
    const clawGrab = i === mid ? 1 - E.outCubic(prog(t, COIN + 0.6, COIN + 0.8)) * (t < COIN + 1.6 ? 1 : 0) : 0;
    ctx.save(); ctx.translate(0, dy); ctx.globalAlpha *= clamp(p * 2) * (1 - g * 0.6);
    cabinet(ctx, xs[i], L.mTop, L.mw, L.mH, k, t, { clawDrop, clawGrab: i === mid && t > COIN + 0.2 ? clawGrab : 0 });
    // label: name left, price right in mono
    const m = C.machines[i];
    if (L.sq) {
      // square: name over price, centred under the cabinet (side by side they run into the next label)
      const mx = xs[i] + L.mw / 2, ly = L.mTop + L.mH + 62;
      text(ctx, m.name, mx, ly, 46);
      setFont(ctx, 500, 38, MONO, 0); const pw = ctx.measureText(m.price).width;
      setFont(ctx, 400, 30, MONO, 0); const uw = ctx.measureText(C.usdc).width, x0 = mx - (pw + 12 + uw) / 2;
      text(ctx, m.price, x0, ly + 52, 38, { family: MONO, align: 'left', track: 0 });
      text(ctx, C.usdc, x0 + pw + 12, ly + 52, 30, { family: MONO, align: 'left', track: 0, color: MUTED, weight: 400 });
    } else {
      const ly = L.mTop + L.mH + 76;
      text(ctx, m.name, xs[i] + 2, ly, 52, { align: 'left' });
      setFont(ctx, 400, 34, MONO, 0); const uw = ctx.measureText(C.usdc).width;
      text(ctx, C.usdc, xs[i] + L.mw - 2, ly, 34, { family: MONO, align: 'right', track: 0, color: MUTED, weight: 400 });
      text(ctx, m.price, xs[i] + L.mw - 2 - uw - 14, ly, 44, { family: MONO, align: 'right', track: 0 });
    }
    ctx.restore();
  });
  // the coin
  const c0 = COIN - 0.42; // after the first heading has gone, so the coin never crosses copy
  if (t > c0 && t < COIN + 0.3) {
    const p = prog(t, c0, COIN), y = lerp(-80, slot.y, p * p), r = L.sq ? 32 : 38;
    const spin = p * 7.5;
    const edge = prog(t, COIN - 0.12, COIN);
    ctx.save(); ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, slot.y + 1e4 - r * 0.2 + (edge > 0 ? 0 : 1e4)); ctx.clip();
    const into = prog(t, COIN, COIN + 0.18);
    usdcCoin(ctx, slot.x, y + into * r * 2.2, r, lerp(spin, Math.PI / 2, edge));
    ctx.restore();
  }
  // copy above the machines
  const hy = L.headY;
  line(ctx, C.pick, cx, hy, L.headPx, t, MACH + 0.25, COIN - 0.5);
  if (L.sq) {
    line(ctx, C.half[0], cx, hy - 10, L.headPx * 0.86, t, COPY2, END - 0.3);
    line(ctx, C.half[1], cx, hy + L.headPx * 0.95, L.headPx * 0.86, t, COPY2 + 0.4, END - 0.3);
  } else {
    setFont(ctx, 500, L.headPx, SANS, -0.03 * L.headPx);
    const a = ctx.measureText(C.half[0]).width, b = ctx.measureText(C.half[1]).width, gap = L.headPx * 0.45, x0 = cx - (a + gap + b) / 2;
    line(ctx, C.half[0], x0, hy, L.headPx, t, COPY2, END - 0.3, { align: 'left' });
    line(ctx, C.half[1], x0 + a + gap, hy, L.headPx, t, COPY2 + 0.4, END - 0.3, { align: 'left' });
  }
}

function endCard(ctx, t, L, C, END, W) {
  const cx = W / 2, k = L.lockS, w = LOCK.w * k, x0 = cx - w / 2, y0 = L.lockY - (LOCK.h * k) / 2;
  // the mark drops in on its cable and settles with a little bounce; the name rises beside it
  const d = spring(t - END - 0.05, 11, 6.5), markY = (1 - d) * -(y0 + LOCK.h * k + 60);
  const wp = EASE.expo(prog(t, END + 0.45, END + 1.2));
  if (d > 0) lockup(ctx, x0, y0, k, { markY, wordP: wp, wordAlpha: wp > 0 ? 1 : 0 });
  if (L.sq) {
    line(ctx, C.line[0], cx, L.lineY - L.linePx * 0.55, L.linePx, t, END + 0.85, 99);
    line(ctx, C.line[1], cx, L.lineY + L.linePx * 0.6, L.linePx, t, END + 1.05, 99);
  } else {
    line(ctx, C.line[0] + ' ' + C.line[1], cx, L.lineY, L.linePx, t, END + 0.85, 99);
  }
  // url and handle, mono, apart (no separator)
  setFont(ctx, 400, L.urlPx, MONO, 0);
  const a = ctx.measureText(C.url).width, b = ctx.measureText(C.handle).width, gap = L.urlPx * 2.2, ux = cx - (a + gap + b) / 2;
  line(ctx, C.url, ux, L.urlY, L.urlPx, t, END + 1.5, 99, { family: MONO, align: 'left', track: 0, weight: 400 });
  line(ctx, C.handle, ux + a + gap, L.urlY, L.urlPx, t, END + 1.65, 99, { family: MONO, align: 'left', track: 0, weight: 400, color: MUTED });
}
