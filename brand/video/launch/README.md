# arclaw launch video

22 s, 60 fps, 120 BPM (bar = 2 s, step = 0.125 s). 16:9 1920 x 1080 from this folder, 1:1 1080 x 1080 from `square/`
(same scene; `layoutFor` in `scene.js` picks the sizes). Telegram bot launch video and the X launch post.

Made with [ft-motion](https://github.com/imserhatdemir/ft-motion). The project lives in the arclaw repo at
`brand/video/launch/` (`project.json`, `scene.js`, `sound.py`, `brand.js`, `fonts.css`, `fonts/`, `square/`);
ft-motion scenes import its engine by relative path, so render it from an ft-motion checkout as
`examples/arclaw-launch`.

## Storyboard

| Bar | Time | What we see | Copy | Sound |
|---|---|---|---|---|
| 0 | 0.0 to 2.0 | A big claw (the logo's claw: cream cable and hub, three orange prongs) drops down the middle on its cable, prongs opening, and runs past the bottom edge | | motor whir, prongs click open, low pad |
| 1 | 2.0 | Off screen it grabs: the cable jolts and shivers | | clank, kick, cable creak |
| 1 | 2.25 to 4.0 | It hauls a sealed box (the Single machine's cardboard box) up from below the frame; heavy spring, the load swings | | motor under load, cable strain |
| 2 | 4.0 to 5.0 | Prongs open, the box drops onto the floor and squashes; the claw dips and leaves upward | Every play wins a box. | release click, box thud, motor away |
| 2 | 5.0 to 6.0 | The box trembles, faster into the pop | | rattle, riser |
| 3 | 6.0 | The lid pops off and spins away; the box sinks out the bottom as a foil pack rises (arclaw mark, "Single", rarity pips, flat specular streaks that slide as it turns) | | thud, kick, whoosh, crinkle |
| 3 | 7.25 to 7.75 | The pack tugs, then the top strip rips off up and right | | crinkle, rip |
| 4 | 8.0 to 8.75 | Three face-down cards slide out of the torn top and deal left, right, middle while the empty pack falls away | | three swishes, snaps |
| 4 to 5 | 9.5, 10.0 | AAPL flips (0.80 USDC), then TSLA (1.20 USDC) | | flip swish, snap, pluck |
| 5 | 10.35 to 10.9 | NVDA lifts, shivers, flips: Jackpot, 8.00 USDC, prize gold border and label; the screen jolts, the other two dim | | riser, impact, bell arpeggio sting |
| 5 to 6 | 11.25 to 13.6 | The three cards hold | Real stocks. Paid to your wallet. | groove |
| 7 | 14.0 | The cards drop away; three cabinets spring up: Single 1 USDC, Stack 5, Vault 10 (labels mono for prices) | Pick a machine. | three landing thumps |
| 8 | 15.6 to 16.0 | A USDC coin falls, spinning, into the Stack slot; the little claw inside goes for a box | At least half back. Up to 10x. | spin ticks, coin clink |
| 9 | 18.5 | Machines drop away; the mark drops in and bounces, "arclaw" rises beside it | | clank, kick, bells |
| 9 to 10 | 19.35 to 22.0 | The line, then the URL and the handle | Grab a box. Pull real stocks. / arclaw.app @arclawapp | Gmaj9 pad, fade |

The pack in the video is a Single (1 USDC) box at the Jackpot tier: the pack is worth 10x, so the three cards add up to
10.00 USDC (0.80 + 1.20 + 8.00). "At least half back" and "Up to 10x" are the on-chain floor and cap from
`lib/machines.json` and `docs/TOKENOMICS.md`.

Style: arclaw tokens (`DESIGN.md`): ink `#0C0C0E`, cream `#ECE6DA`, claw orange `#FF5A1F` as the one accent, prize gold
`#E9C46A` only on the jackpot card. Geist 500 (never bold) and Geist Mono for money, bundled in `fonts/` (SIL OFL). Box,
pack and card follow `components/pack/SealedBox.tsx`, `components/pack/BoosterPack.tsx` and
`components/landing/StockCard.tsx`; `brand.js` is copied path data from `lib/brand/*` and `public/logos/*.svg`. The USDC
coin keeps Circle's colours. No gradients, glow, accent lines, dots or em dashes.

## Render

```sh
git clone https://github.com/imserhatdemir/ft-motion ../../ft-motion && cd ../../ft-motion && npm install
pip install -r requirements.txt
cp -r ../arclaw/brand/video/launch examples/arclaw-launch
python examples/arclaw-launch/sound.py                    # → out/audio.wav (-14 LUFS, true peak -1.3 dBFS)
node ft.mjs sheet examples/arclaw-launch 24                # contact sheet to check the frames
node ft.mjs render examples/arclaw-launch                  # → out/arclaw-launch.mp4 (16:9)
node ft.mjs render examples/arclaw-launch/square           # → square/out/arclaw-launch-square.mp4 (1:1, same audio)
```

The engine's encode (H.264 high, yuv420p, CRF 16, AAC, faststart) already lands at about 4 MB (16:9) and 3.5 MB (1:1),
under Telegram's 20 MB sendVideo-by-URL limit, so copy the files as they are and take the poster on the jackpot:

```sh
cp examples/arclaw-launch/out/arclaw-launch.mp4 ../arclaw/public/video/launch.mp4
cp examples/arclaw-launch/square/out/arclaw-launch-square.mp4 ../arclaw/public/video/launch-square.mp4
ffmpeg -ss 10.95 -i ../arclaw/public/video/launch.mp4 -frames:v 1 ../arclaw/public/video/launch.png
ffmpeg -ss 10.95 -i ../arclaw/public/video/launch-square.mp4 -frames:v 1 ../arclaw/public/video/launch-square.png
```
