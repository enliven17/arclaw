# arclaw mainnet launch video

20 s, 60 fps, 120 BPM (bar = 2 s, step = 0.125 s), 16:9 1920 x 1080. The X post for the day mainnet goes live; the
token address goes in the post's caption, never in the video.

Made with [ft-motion](https://github.com/imserhatdemir/ft-motion), like `../launch/`: copy this folder to
`examples/arclaw-mainnet` in an ft-motion checkout and render it there.

Style: a xerox poster. Claw orange paper with an ink halftone (concentric bands, rings on every hit, pixel blocks
and a slice tear on each cut, grain). The claw, in ink, is the anchor of every scene and on the drop falls into the
real mark (cream hub, orange prongs) as the world turns ink. Box, pack, cards, cabinets, mark and wordmark are the
ones in `../launch/` (the site's own components).

| Bar | Time | What we see | Copy |
|---|---|---|---|
| 0 | 0.0 to 2.0 | Halftone rings pulse; the claw drops in, looks left, right, opens | |
| 1 | 2.0 to 4.0 | The line slams in under it; at 3.5 it grabs it | Every play wins. |
| 2 | 4.0 to 6.0 | It yanks the line away; a box slams up; the claw comes back and grips it | A box. Every time. |
| 3 | 6.0 to 8.0 | It rips the lid off, the pack rises, tears, three cards deal | Real stocks. |
| 4 | 8.0 to 10.0 | AAPL 0.80, TSLA 1.20, NVDA 8.00 Jackpot turn while the claw watches each | Paid to your wallet. |
| 5 | 10.0 to 12.0 | Single 1, Stack 5, Vault 10 USDC; the middle machine plays a game | Pick a machine. |
| 6 | 12.0 to 14.0 | Two lines, each on a squeeze of the claw | At least half back. Up to 10x. |
| 7 | 14.0 to 16.0 | MAINNET types out a letter per eighth over a riser | MAINNET |
| 8 to 9 | 16.0 to 20.0 | Drop: ink, the claw becomes the mark, the wordmark rises | Live on Solana devnet. MagicBlock arclaw.app @arclawapp |

The numbers are the product's: 1, 5 and 10 USDC machines, the on-chain floor (half the price) and cap (10x), and a
Single box at the Jackpot tier (0.80 + 1.20 + 8.00 = 10.00 USDC, as in `../launch/`).

```sh
python examples/arclaw-mainnet/sound.py             # → out/audio.wav (-14.1 LUFS, true peak -1.1 dBFS)
node ft.mjs sheet examples/arclaw-mainnet 20         # contact sheet
node ft.mjs render examples/arclaw-mainnet           # → out/arclaw-mainnet.mp4 (about 53 MB: the halftone and grain)
```
