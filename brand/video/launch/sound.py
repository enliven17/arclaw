"""arclaw launch: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 0.125 s).
Run: python examples/arclaw-launch/sound.py   (writes out/audio.wav, prints LUFS and true peak; the square cut reuses it)

Every visual event in scene.js has a sound here at the same scene time:
motor whir on the descent, clank on the grab, cable strain on the lift, thud when the box lands and when the lid pops,
foil crinkle as the pack rises, a rip on the tear, swishes on the deal, snaps on the flips, a bright sting on the
jackpot, thumps as the machines land, a coin clink in the slot, and a light beat underneath.
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


# ── custom one-shots (numpy, deterministic through ftsynth's seeded rng)
def noise(d):
    return rng.standard_normal(int(d * SR))


def motor(d, f0, f1, load=0.0):
    """Claw motor: a geared hum (saw-ish with a whine an octave and a fifth up), pitch gliding f0 -> f1."""
    t = tarr(d)
    f = f0 + (f1 - f0) * (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    hum = np.tanh(2.2 * (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph)))
    whine = np.sin(ph * 6.02) * 0.25
    gear = filt(noise(d), 'bandpass', (f0 * 8, f0 * 22)) * (0.5 + 0.5 * np.sin(ph * 0.5)) * 0.6
    wob = 1 + 0.08 * np.sin(2 * np.pi * 7 * t) + load * 0.12 * np.sin(2 * np.pi * 13 * t)
    env = np.minimum(1, t / 0.06) * np.minimum(1, (d - t) / 0.12)
    return filt((hum + whine + gear) * wob, 'lowpass', 2600) * env


def clank(f=420, dec=0.32, bright=1.0):
    """Metal on metal: inharmonic partials, fast decay, a noise transient."""
    t = tarr(dec * 3)
    parts = [(1.0, 1.0), (2.76, 0.6), (5.4, 0.4 * bright), (8.93, 0.25 * bright), (13.3, 0.12 * bright)]
    s = sum(a * np.sin(2 * np.pi * f * r * t + r) * np.exp(-t / (dec / (1 + r * 0.25))) for r, a in parts)
    hit = filt(noise(0.03), 'highpass', 1800) * np.exp(-tarr(0.03) / 0.006)
    s[: len(hit)] += hit * 1.4
    return s / 2.2


def thud(f=70, dec=0.22, paper=0.4):
    """Cardboard on a floor: a low body thump plus a dry papery slap."""
    t = tarr(0.6)
    body = np.sin(2 * np.pi * (f * (1 + 0.6 * np.exp(-t / 0.03))) * t) * np.exp(-t / dec)
    slap = filt(noise(0.6), 'bandpass', (300, 2400)) * np.exp(-t / 0.035) * paper
    return body + slap


def crinkle(d, density=55, seed_gain=1.0):
    """Foil crinkle: sparse bright crackles."""
    out = np.zeros(int(d * SR))
    n = int(d * density)
    for _ in range(n):
        i = int(rng.random() * (len(out) - 1400))
        L = int(SR * (0.002 + rng.random() * 0.012))
        g = filt(rng.standard_normal(L), 'highpass', 2500 + rng.random() * 3500) * np.exp(-np.arange(L) / (L * 0.25))
        out[i:i + L] += g * (0.3 + rng.random()) * seed_gain
    return out


def rip(d=0.38):
    """The tear: a dense granular crackle under a falling band of noise."""
    t = tarr(d)
    band = np.zeros_like(t)
    seg = int(0.02 * SR)
    for k in range(0, len(t), seg):  # stepped band-pass sweep: 5 kHz down to 1.2 kHz
        x = k / len(t)
        lo = 5200 - 4000 * x
        chunk = filt(rng.standard_normal(seg * 2), 'bandpass', (lo * 0.6, lo * 1.4))[:seg]
        band[k:k + seg] += chunk[: len(band[k:k + seg])]
    env = np.minimum(1, t / 0.01) * np.exp(-t / (d * 0.5))
    return band * env * 0.8 + crinkle(d, 260)[: len(t)] * 0.9


def swish(d=0.22, f0=900, f1=5200):
    return sweep_sig(d, f0, f1, whoosh_env, 0.8)


def snap():
    """Card flip landing: a dry paper snap."""
    t = tarr(0.08)
    return filt(rng.standard_normal(len(t)), 'bandpass', (1500, 6000)) * np.exp(-t / 0.012)


def coin_clink():
    t = tarr(1.2)
    parts = [(2350, 1.0, 0.35), (3870, 0.7, 0.28), (5230, 0.5, 0.2), (7110, 0.3, 0.12)]
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in parts) / 2


def creak(d):
    """Cable strain: a slow, stretched, rubbing tone with a tremble."""
    t = tarr(d)
    f = 180 + 60 * (t / d)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t))
    s += filt(noise(d), 'bandpass', (700, 1500)) * 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * 23 * t))
    return s * np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.15)


# ── bar 0-1: the descent and the grab
m.add(0.05, motor(GRAB - 0.15, 85, 150), 0.16, 0, 0.15)
m.whoosh(0.1, 1.7, 300, 1800, 0.07, wet=0.2)
m.add(0.45, clank(1300, 0.08, 0.5), 0.05, -0.3)             # prongs click open
m.add(GRAB - 0.12, clank(900, 0.06), 0.06, 0.2)             # prongs snap shut, off screen
m.add(GRAB, clank(380, 0.4), 0.42, 0, 0.25)                  # the grab
m.kick(GRAB, 0.55, dec=0.3, f0=140, f1=40)
m.add(GRAB + 0.02, creak(LIFT - GRAB + 0.3), 0.1, 0.1, 0.2)  # the cable takes the weight
m.add(LIFT, motor(1.2, 120, 70, load=1.0), 0.17, 0, 0.15)   # the lift, under load
m.add(LIFT + 0.1, creak(1.0), 0.06, -0.15, 0.2)
m.whoosh(LIFT, 0.9, 200, 1400, 0.08)

# ── bar 2: release, the box lands, the claw leaves, the box trembles
m.add(RELEASE, clank(1100, 0.1), 0.12, 0.1)
m.add(LAND, thud(68, 0.24, 0.5), 0.55, 0, 0.15)
m.kick(LAND, 0.35, dec=0.25)
m.add(LAND + 0.1, motor(0.75, 110, 190), 0.1, 0, 0.1)
m.whoosh(LAND + 0.25, 0.6, 600, 3200, 0.07)
for k in range(16):                                          # rattle, faster and louder into the pop
    x = k / 16
    tk = TREMBLE + (POP - TREMBLE) * (1 - (1 - x) ** 1.5)
    m.add(tk, thud(110 + 40 * rng.random(), 0.05, 0.8), 0.05 + 0.12 * x, (rng.random() - 0.5) * 0.4)
m.riser(TREMBLE, POP, f0=250, f1=4500, gain=0.14)

# ── bar 3: the lid pops, the pack rises, the strip rips
m.add(POP, thud(90, 0.2, 0.9), 0.5, 0, 0.3)
m.kick(POP, 0.6, dec=0.4)
m.whoosh(POP, 0.7, 800, 5000, 0.12, pan=-0.3)
m.add(POP + 0.12, crinkle(0.9, 45), 0.22, 0.1, 0.25)
m.whoosh(POP + 0.12, 0.8, 300, 2600, 0.1)
m.add(TUG, crinkle(TEAR - TUG, 120), 0.25, 0.2, 0.2)
m.add(TEAR, rip(), 0.55, 0.25, 0.25)
m.whoosh(TEAR + 0.05, 0.45, 4000, 1200, 0.08, pan=0.5)

# ── bars 4-6: deal, flips, the jackpot
for i, td in enumerate(DEALS):
    m.add(td, swish(0.26), 0.2, [-0.6, 0.6, 0][i], 0.2)
    m.add(td + 0.62, snap(), 0.12, [-0.5, 0.5, 0][i])
m.whoosh(DEAL + 0.05, 0.7, 2000, 300, 0.06)                  # the empty pack drops away
for i, tf in enumerate(FLIPS[:2]):
    m.add(tf, swish(0.18, 1500, 7000), 0.14, [-0.5, 0.0][i], 0.2)
    m.add(tf + 0.17, snap(), 0.2, [-0.5, 0.0][i])
    m.add(tf + 0.17, pluck(midi([64, 67][i]), 0.4), 0.16, [-0.5, 0.0][i], 0.35)
J = FLIPS[2]
m.riser(J - 0.4, J, f0=500, f1=7000, gain=0.12)
m.add(J, swish(0.22, 1500, 7000), 0.16, 0.5, 0.2)
m.add(J + 0.12, snap(), 0.24, 0.5)
m.impact(J + 0.12, gain=0.55, bright=False)
for k, n in enumerate([76, 79, 83, 88]):                     # the sting: a bright rising arpeggio of bells
    m.add(J + 0.12 + k * 0.045, bell(midi(n), 1.4), 0.2 - k * 0.02, 0.4 - k * 0.15, 0.5)
m.add(J + 0.12, bell(midi(64), 2.2), 0.12, 0, 0.6)

# ── bars 7-8: the machines, the coin
m.whoosh(MACH - 0.4, 0.7, 2500, 400, 0.1)                   # the cards drop away
for i in range(3):
    t0 = MACH + i * m.step * 1.5
    m.add(t0 + 0.12, thud(60, 0.25, 0.25), 0.3, [-0.5, 0, 0.5][i], 0.15)
m.whoosh(COIN - 0.42, 0.42, 1200, 5200, 0.06)
for k in range(5):                                           # the coin spinning as it falls
    m.add(COIN - 0.4 + k * 0.08, clank(5200, 0.02, 0.3), 0.025, 0)
m.add(COIN, coin_clink(), 0.3, 0, 0.35)
m.add(COIN + 0.06, clank(2600, 0.05), 0.08, 0)
m.add(COIN + 0.13, clank(3100, 0.04), 0.05, 0)
m.add(COIN + 0.25, motor(1.3, 160, 210), 0.06, 0, 0.1)       # the little claw inside goes for a box

# ── bars 9-10: the lockup
m.whoosh(END - 0.4, 0.6, 3000, 300, 0.08)
m.add(END + 0.18, clank(620, 0.25), 0.18, 0, 0.35)           # the mark lands
m.kick(END + 0.18, 0.4, dec=0.5)
m.whoosh(END + 0.45, 0.6, 600, 3500, 0.07)
m.add(END + 0.5, bell(midi(76), 1.8), 0.16, -0.2, 0.5)
m.add(END + 0.9, bell(midi(83), 1.8), 0.12, 0.2, 0.5)

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
