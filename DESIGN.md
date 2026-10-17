# arclaw design tokens

Matte arcade at night. Dark room, one lit cabinet, everything else recedes.

## Colour

| Token | Hex | Use |
|---|---|---|
| ink | #0C0C0E | page |
| panel | #141417 | raised surfaces |
| panel-2 | #1C1C21 | inputs, chips |
| line | #ECE6DA at 8% | hairlines only |
| cream | #ECE6DA | text |
| muted | #8B867D | secondary text |
| claw | #FF5A1F | the one accent: CTA, claw, active state. Once per screen. |
| prize | #E9C46A | card rarity foil only, never UI chrome |

## Type

- Display: Geist 500, tight tracking (-0.03em), clamp sizes. Never bold.
- UI labels: Geist Pixel Square, caps, small.
- Numbers, addresses, money: Geist Mono, `tabular-nums`.

## Shape

Radius 4 / 10 / 18 / full. Cards (stock cards) 14 with 63:88 aspect.

## Motion

- Ease: `cubic-bezier(0.22, 1, 0.36, 1)` (out-quint).
- Scroll: Lenis lerp 0.08, GSAP ticker wakes only while scrolling.
- Reveals by data attribute: `data-reveal`, `data-split`, `data-count`.
- Claw drop: anticipation, drop, grip, lift, carry, release. Spring, no linear.
- Reduced motion: static frames, no smoothing.

## Never

Em dashes, dot separators, blinking/pulsing dots, accent lines, gradients, glow, bold headings, green money.
