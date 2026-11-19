"""arclaw mainnet launch: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 0.125 s).
Run: python examples/arclaw-mainnet/sound.py   (writes out/audio.wav, prints LUFS and true peak)

Every visual event in scene.js has a sound at the same scene time. One-shots are the app's own (lib/sfx.ts, as in
examples/arclaw-launch); under them a harder beat than the first launch: the claw's moves hit on the kick, MAINNET
types over a riser and everything lands on the drop.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftsynth import rng  # noqa: E402
from ftextras import stamp, glitch_burst, tick  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
LOOK, OPEN1, SLAM1, GRAB1, YANK = [at(0, 8), at(0, 12)], at(0, 14), at(1), at(1, 12), at(2)
BOXIN, DESC2, GRIP2, POP, TUG, TEAR = at(2, 2), at(2, 9), at(2, 14), at(3), at(3, 6), at(3, 8)
DEAL = at(3, 10)
DEALS = [DEAL, DEAL + step * 2, DEAL + step * 4]
FLIPS = [at(4), at(4, 4), at(4, 8)]
CARDSOUT, MACH, GAME0, GAME1, MOUT = at(4, 14), at(5), at(5, 5), at(5, 15), at(6)
HALF, TEN, BUILD, DROP = at(6, 4), at(6, 10), at(7), at(8)
LETTERS = [BUILD + i * step * 2 for i in range(7)]
WORD, LIVE, TOKEN, URL = at(8, 4), at(8, 8), at(8, 14), at(9, 2)
CUTS = [at(1), at(2), at(5), at(6), at(8)]


# ── the site's own sound effects (lib/sfx.ts), ported note for note so the video sounds like the app.
# tone() is an oscillator with an exponential envelope and pitch glide, hiss() is filtered white noise. Same recipes
# and relative levels; only the motor takes a length here, since the video's claw runs for seconds.
def _env(n, att, peak, dec):
    t = np.arange(n) / SR
    up = 1e-4 * (peak / 1e-4) ** np.clip(t / att, 0, 1)
    down = peak * (1e-4 / peak) ** np.clip((t - att) / dec, 0, 1)
    e = np.where(t < att, up, down)
    e[t > att + dec] = 0
    return e


def _osc(kind, ph):
    if kind == 'sine':
        return np.sin(ph)
    x = (ph / (2 * np.pi)) % 1.0
    if kind == 'triangle':
        return 4 * np.abs(x - 0.5) - 1
    if kind == 'square':
        return np.where(x < 0.5, 1.0, -1.0)
    return 2 * x - 1  # sawtooth


def tone(freq, kind='sine', attack=0.004, peak=0.5, decay=0.25, to=None):
    t = tarr(attack + decay + 0.05)
    f = freq * (to / freq) ** np.clip(t / (attack + decay), 0, 1) if to else np.full_like(t, freq)
    return _osc(kind, 2 * np.pi * np.cumsum(f) / SR) * _env(len(t), attack, peak, decay)


def hiss(duration=0.2, peak=0.4, attack=0.005, kind='bandpass', freq=2000, to=None, q=1.0):
    n = int((attack + duration + 0.05) * SR)
    src = rng.standard_normal(n)

    def band(fc):
        if kind == 'bandpass':
            bw = fc / q
            return filt(src, 'bandpass', (max(20, fc - bw / 2), min(SR / 2 - 100, fc + bw / 2)))
        return filt(src, kind, fc)

    if to is None:
        out = band(freq)
    else:
        # the biquad's exponential frequency ramp, in short crossfaded steps
        out, step = np.zeros(n), int(0.012 * SR)
        win = np.hanning(step * 2)
        for k in range(0, n, step):
            fc = freq * (to / freq) ** min(1, k / (duration * SR))
            a = max(0, k - step)
            seg = band(fc)[a: k + step]
            w = win[: len(seg)] if k >= step else win[step: step + len(seg)]
            out[a: a + len(seg)] += seg * w
    # a band-pass passes less energy than the browser's unity-peak biquad; lift it back
    return out * _env(n, attack, peak, duration) * (1.6 if kind == 'bandpass' else 1.0)


def mix(*parts):
    """parts: (offset seconds, signal)."""
    n = max(int(o * SR) + len(s) for o, s in parts)
    out = np.zeros(n)
    for o, s in parts:
        out[int(o * SR): int(o * SR) + len(s)] += s
    return out


def motor(d=1.0, f0=70, f1=92):
    """The gantry motor: a low buzzing saw through a lowpass, rising a little."""
    t = tarr(d + 0.05)
    f = f0 + (f1 - f0) * np.clip(t / (d * 0.9), 0, 1)
    g = np.interp(t, [0, 0.08, d * 0.8, d], [1e-4, 0.16, 0.16, 1e-4])
    return filt(_osc('saw', 2 * np.pi * np.cumsum(f) / SR), 'lowpass', 520) * g


SFX = {
    'coin': lambda: mix((0, tone(2637, 'triangle', peak=0.3, decay=0.35)), (0.002, tone(3951, peak=0.18, decay=0.28)),
                        (0.09, tone(1760, 'triangle', peak=0.16, decay=0.2)), (0.22, hiss(0.12, 0.12, freq=900, to=300))),
    'drop': lambda: mix((0, hiss(0.4, 0.16, freq=1800, to=500, q=2)), (0.38, tone(140, peak=0.4, decay=0.16, to=70))),
    'grip': lambda: mix((0, tone(1800, 'square', peak=0.08, decay=0.03)), (0.05, tone(1400, 'square', peak=0.07, decay=0.03))),
    'box': lambda: mix((0, tone(180, peak=0.5, decay=0.18, to=110)), (0, hiss(0.12, 0.12, kind='lowpass', freq=1200))),
    'tear': lambda: mix(*[(i * 0.035, hiss(0.06, 0.18, freq=2400 + i * 500, q=3)) for i in range(6)],
                        (0, hiss(0.3, 0.12, kind='highpass', freq=3000, to=6000))),
    'deal': lambda: hiss(0.09, 0.2, freq=3200, to=1800, q=0.8),
    'flip': lambda: mix((0, tone(900, 'triangle', peak=0.12, decay=0.04)), (0.01, hiss(0.12, 0.16, freq=2600, to=4200, q=0.9))),
    'rare': lambda: mix(*[(i * 0.07, tone(f, 'triangle', peak=0.22, decay=0.45)) for i, f in enumerate([784, 988, 1319])]),
    'jackpot': lambda: mix((0, tone(196, peak=0.3, decay=1.1)),
                           *[(i * 0.08, tone(f, 'triangle', peak=0.24, decay=0.7)) for i, f in enumerate([523, 659, 784, 1047, 1319])],
                           (0.45, tone(2093, peak=0.12, decay=0.9))),
    'open': lambda: tone(660, peak=0.12, decay=0.09, to=880),
}


def sfx(name):
    return SFX[name]()



# ── bar 0: the claw comes down and looks around
m.add(0.1, motor(1.3, 64, 96), 0.9, 0, 0.1)
m.add(1.0, sfx('drop'), 0.6, 0, 0.15)
for i, tl in enumerate([0.5] + LOOK):
    m.add(tl, sfx('grip'), 0.7, [0, -0.4, 0.4][i], 0.1)
m.add(OPEN1, sfx('open'), 0.9, 0, 0.2)
m.riser(1.0, SLAM1, f0=200, f1=3000, gain=0.07)

# ── bar 1-2: the slam, the grab, the yank
m.impact(SLAM1, gain=0.7)
stamp(m, SLAM1, pitch=90, gain=0.6)
m.add(GRAB1 - 0.16, sfx('drop'), 0.4, 0, 0.1)
m.add(GRAB1, sfx('grip'), 1.1, 0, 0.1)
stamp(m, GRAB1, pitch=120, gain=0.4)
m.add(YANK, motor(0.4, 110, 160), 0.8, 0, 0.1)
m.whoosh(YANK, 0.45, 300, 4000, gain=0.25)

# ── bar 2-3: the box, the claw comes back, the lid comes off, the pack
m.add(BOXIN + 0.22, sfx('box'), 1.2, 0, 0.2)
m.impact(BOXIN + 0.22, gain=0.45, bright=False)
m.add(DESC2, motor(GRIP2 - DESC2, 80, 100), 0.7, 0, 0.1)
m.add(GRIP2, sfx('grip'), 1.0, 0, 0.1)
for k in range(8):
    x = k / 8
    m.add(GRIP2 + 0.1 + (POP - GRIP2 - 0.1) * x, sfx('box'), 0.1 + 0.2 * x, (rng.random() - 0.5) * 0.4)
m.add(POP, sfx('box'), 1.1, 0, 0.2)
m.add(POP + 0.02, sfx('open'), 1.0, -0.2, 0.3)
m.whoosh(POP, 0.4, 400, 5000, gain=0.2)
m.add(TUG, sfx('tear'), 0.35, 0.2, 0.15)
m.add(TEAR, sfx('tear'), 1.1, 0.25, 0.2)

# ── bar 3-4: deal, flips, the jackpot
for i, td in enumerate(DEALS):
    m.add(td, sfx('deal'), 1.1, [-0.6, 0.6, 0][i], 0.15)
for i, tf in enumerate(FLIPS[:2]):
    m.add(tf + 0.08, sfx('flip'), 1.1, [-0.5, 0.0][i], 0.15)
J = FLIPS[2]
m.riser(J - 0.35, J, f0=500, f1=7000, gain=0.1)
m.add(J + 0.08, sfx('flip'), 1.2, 0.5, 0.15)
m.add(J + 0.1, sfx('jackpot'), 1.1, 0.1, 0.45)
m.impact(J + 0.1, gain=0.5, bright=False)
m.whoosh(CARDSOUT, 0.5, 2000, 300, gain=0.18)

# ── bar 5: the machines, the middle one plays
for i in range(3):
    m.add(MACH + i * step * 1.5 + 0.1, sfx('box'), 0.8, [-0.5, 0, 0.5][i], 0.1)
g = lambda p: GAME0 + p * (GAME1 - GAME0)  # noqa: E731
m.add(g(0.0), motor(g(0.2) - g(0.0), 90, 110), 0.4, 0, 0.1)
m.add(g(0.22), sfx('drop'), 0.35, 0, 0.1)
m.add(g(0.43), sfx('grip'), 0.6, 0, 0.1)
m.add(g(0.6), motor(g(0.8) - g(0.6), 80, 100), 0.4, 0, 0.1)
m.add(g(0.86), sfx('grip'), 0.4, 0, 0.1)
m.add(g(0.95), sfx('box'), 0.5, 0, 0.15)

# ── bar 6: the two promises, each on a squeeze
for tp in (HALF, TEN):
    m.add(tp - 0.18, sfx('grip'), 0.9, 0, 0.1)
    m.impact(tp, gain=0.55)
    stamp(m, tp, pitch=100, gain=0.5)

# ── bar 7: MAINNET types out over a riser
for i, tl in enumerate(LETTERS):
    m.add(tl, tick(2200 + i * 160), 0.5, (i - 3) * 0.12, 0.1)
    m.add(tl, sfx('grip'), 0.35, 0, 0.05)
m.riser(BUILD, DROP, f0=200, f1=9000, gain=0.22)
m.roll(DROP - m.bar / 2, DROP - 0.02, n=16, gain=(0.08, 0.4))

# ── bar 8-9: the drop, the claw becomes the mark, the end card
m.impact(DROP, gain=1.0)
m.kick(DROP, 0.9, dec=0.6, f0=150, f1=38)
m.bass(DROP, 28, gain=0.5, dec=1.2)
m.add(DROP + 0.32, sfx('box'), 0.9, 0, 0.25)
m.add(WORD, sfx('rare'), 1.0, 0, 0.45)
m.add(LIVE, pluck(midi(67), dec=0.6), 0.25, 0, 0.4)
m.add(TOKEN, sfx('coin'), 0.7, 0, 0.35)
m.add(URL, blip(1760), 0.25, -0.2, 0.3)
m.add(URL + 0.15, blip(2349), 0.22, 0.2, 0.3)

# ── the cuts: a glitch burst on each
for c in CUTS:
    m.add(c - 0.03, glitch_burst(0.22), 0.25, 0, 0.1)

# ── the music
m.pad(0.0, chord('Em9', 2), dur=SLAM1, att=0.8, gain=0.12, cutoff=600)
m.pad(SLAM1, chord('Em9', 3), dur=POP - SLAM1, att=0.2, gain=0.12, cutoff=900)
m.pad(POP, chord('Cmaj9', 3), dur=J + 0.1 - POP, att=0.2, gain=0.12, cutoff=1100)
m.pad(J + 0.1, chord('Gmaj9', 3), dur=MOUT - J - 0.1, att=0.2, gain=0.14, cutoff=1500)
m.pad(MOUT, chord('Am9', 3), dur=BUILD - MOUT, att=0.2, gain=0.13, cutoff=1200)
m.pad(BUILD, chord('Cmaj9', 3), dur=DROP - BUILD, att=0.6, gain=0.12, cutoff=900)
m.pad(DROP, chord('Gmaj9', 3), dur=m.dur - DROP, att=0.1, gain=0.18, cutoff=1800)

m.drums(0, kick=[0, 4, 8, 12], hat_gain=0.0, root=None)
m.drums(1, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.06, root=40)
m.drums(2, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.06, root=36)
for b in (3, 4):
    m.drums(b, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.065, root=[36, 43][b - 3])
m.drums(5, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 1), hat_gain=0.05, root=43)
m.drums(6, kick=[0, 4, 8, 12], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.06, root=45)
m.drums(7, kick=[0, 4, 8, 12], hats=range(0, 16, 1), hat_gain=0.06, root=48)
m.drums(8, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.06, root=43)
m.drums(9, kick=[0], hats=range(0, 8, 2), hat_gain=0.04, root=43)

m.render(drive=2.8, peak=float(sys.argv[1]) if len(sys.argv) > 1 else 0.66)
