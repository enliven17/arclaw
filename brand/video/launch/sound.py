"""arclaw launch: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 0.125 s).
Run: python examples/arclaw-launch/sound.py   (writes out/audio.wav, prints LUFS and true peak; the square cut reuses it)

Every visual event in scene.js has a sound here at the same scene time, and every one-shot is the app's own
(lib/sfx.ts, ported below): the motor, the drop whistle, the grip clicks, the box knock, the tear, deals and flips,
the jackpot chime, the coin. A light beat and pads underneath.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftsynth import rng  # noqa: E402

m = Mix.from_project(__file__)
at = m.at
GRAB, LIFT, RELEASE, LAND, TREMBLE, POP, TUG, TEAR = at(1), at(1, 2), at(2), at(2, 2), at(2, 8), at(3), at(3, 10), at(3, 12)
DEAL = at(4)
DEALS = [DEAL, DEAL + m.step * 2, DEAL + m.step * 4]       # left, right, middle
FLIPS = [at(4, 12), at(5), at(5, 6)]
MACH, COIN, END = at(7), at(8), at(9, 4)


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


# ── bar 0-1: the descent and the grab
m.add(0.05, motor(GRAB - 0.2, 70, 96), 0.9, 0, 0.1)
m.add(GRAB - 0.38, sfx('drop'), 0.9, 0, 0.15)                # the whistle down, landing on the grab
m.add(GRAB, sfx('grip'), 1.0, 0.1, 0.1)
m.kick(GRAB, 0.45, dec=0.3, f0=140, f1=40)
m.add(LIFT, motor(RELEASE - LIFT, 62, 80), 1.0, 0, 0.1)      # the lift, under load: a little lower

# ── bar 2: release, the box lands, the claw leaves, the box trembles
m.add(RELEASE, sfx('grip'), 0.8, -0.1, 0.1)
m.add(LAND, sfx('box'), 1.1, 0, 0.15)
m.kick(LAND, 0.3, dec=0.25)
m.add(LAND + 0.1, motor(0.75, 80, 110), 0.6, 0, 0.1)
for k in range(12):                                          # the box rattles, faster and louder into the pop
    x = k / 12
    tk = TREMBLE + (POP - TREMBLE) * (1 - (1 - x) ** 1.5)
    m.add(tk, sfx('box'), 0.12 + 0.3 * x, (rng.random() - 0.5) * 0.4)
m.riser(TREMBLE, POP, f0=250, f1=4500, gain=0.1)

# ── bar 3: the lid pops, the box drops away, the pack rises, the strip tears
m.add(POP, sfx('box'), 1.2, 0, 0.2)
m.add(POP + 0.02, sfx('open'), 1.0, -0.2, 0.3)
m.kick(POP, 0.5, dec=0.4)
m.add(POP + 0.1, sfx('drop'), 0.5, 0, 0.1)                   # the empty box falls out of the frame
m.add(TUG, sfx('tear'), 0.35, 0.2, 0.15)                     # a first tug on the strip
m.add(TEAR, sfx('tear'), 1.1, 0.25, 0.2)

# ── bars 4-6: deal, flips, the jackpot
for i, td in enumerate(DEALS):
    m.add(td, sfx('deal'), 1.1, [-0.6, 0.6, 0][i], 0.15)
for i, tf in enumerate(FLIPS[:2]):
    m.add(tf + 0.1, sfx('flip'), 1.1, [-0.5, 0.0][i], 0.15)
J = FLIPS[2]
m.riser(J - 0.4, J, f0=500, f1=7000, gain=0.1)
m.add(J + 0.1, sfx('flip'), 1.2, 0.5, 0.15)
m.add(J + 0.12, sfx('jackpot'), 1.1, 0.1, 0.45)
m.impact(J + 0.12, gain=0.45, bright=False)

# ── bars 7-8: the machines, the coin, the little claw's game
for i in range(3):
    t0 = MACH + i * m.step * 1.5
    m.add(t0 + 0.12, sfx('box'), 0.7, [-0.5, 0, 0.5][i], 0.1)
m.add(COIN - 0.22, sfx('coin'), 1.2, 0, 0.3)                 # it pings as it falls, the slot swallows it on the beat
GAME0, GAME1 = COIN + 0.2, END - 0.45                        # scene.js machines(): `play` runs over this span
g = lambda p: GAME0 + p * (GAME1 - GAME0)  # noqa: E731
m.add(g(0.0), motor(g(0.2) - g(0.0), 90, 110), 0.5, 0, 0.1)  # across to the pile
m.add(g(0.22), sfx('drop'), 0.45, 0, 0.1)                    # down onto the top box
m.add(g(0.43), sfx('grip'), 0.7, 0, 0.1)
m.add(g(0.6), motor(g(0.8) - g(0.6), 80, 100), 0.5, 0, 0.1)  # carrying it to the chute
m.add(g(0.86), sfx('grip'), 0.5, 0, 0.1)
m.add(g(0.95), sfx('box'), 0.6, 0, 0.15)                     # into the chute

# ── bars 9-10: the lockup
m.add(END + 0.18, sfx('box'), 0.9, 0, 0.25)                  # the mark lands
m.kick(END + 0.18, 0.35, dec=0.5)
m.add(END + 0.5, sfx('rare'), 1.0, 0, 0.45)

# ── the music: a light beat and one chord per section
m.pad(0.0, chord('Em9', 2), dur=GRAB, att=0.9, gain=0.12, cutoff=600)
m.pad(GRAB, chord('Em9', 3), dur=POP - GRAB, att=0.4, gain=0.13, cutoff=900)
m.pad(POP, chord('Cmaj9', 3), dur=DEAL - POP, att=0.3, gain=0.13, cutoff=1100)
m.pad(DEAL, chord('Am9', 3), dur=J + 0.12 - DEAL, att=0.3, gain=0.13, cutoff=1200)
m.pad(J + 0.12, chord('Gmaj9', 3), dur=MACH - J - 0.12, att=0.2, gain=0.16, cutoff=1700)
m.pad(MACH, chord('Cmaj9', 3), dur=END - MACH, att=0.3, gain=0.14, cutoff=1400)
m.pad(END, chord('Gmaj9', 3), dur=m.dur - END, att=0.5, gain=0.16, cutoff=1500)

m.drums(1, hats=range(4, 16, 2), hat_gain=0.05)
m.drums(2, kick=[0, 8], hats=range(0, 16, 2), hat_gain=0.06, root=40)
m.drums(3, kick=[0, 10], snare=[8], hats=range(0, 16, 2), hat_gain=0.06, root=36)
for b in (4, 5, 6):
    m.drums(b, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.07, root=[45, 45, 43][b - 4])
for b in (7, 8):
    m.drums(b, kick=[0, 6, 10], snare=[4, 12], hats=range(0, 16, 1), hat_gain=0.055, root=[36, 36][b - 7])
m.drums(9, kick=[0], hats=range(8, 16, 2), hat_gain=0.04, root=43)
m.drums(10, hats=range(0, 8, 2), hat_gain=0.03)

m.render(drive=2.8, peak=float(sys.argv[1]) if len(sys.argv) > 1 else 0.56)
