# Neutrino · 音源

A browser-based **wavetable synthesizer** with a Vital-inspired signal-flow UI and a Japanese-dusk (Mt. Fuji at sunset) theme. Built with React + the Web Audio API — no plugins, no installs for players. Just open it and make sound.

## Features

- **3 oscillators** (sine / triangle / saw / square) with per-oscillator octave, semitone, fine tune, level, pan and **unison** (up to 8 voices with detune + spread)
- **2 filters** in series — LP12, LP24, HP, BP, notch, ladder, comb, formant — with a **live filter-response graph** drawn over the real output spectrum
- **ADSR envelope** with a live editor
- **3 LFOs** with animated scopes and moving playheads
- **Modulation matrix** — drag a source chip (LFO / Envelope / Macro / Velocity / Keytrack / Mod Wheel) onto any destination; modulation depth shows as a live ring on the target knob
- **4 macros** and an **XY pad** (in earlier builds) for hands-on control
- **FX**: reverb, ping-pong delay, chorus, distortion, bitcrusher, 3-band EQ
- **Arpeggiator** with up / down / up-down / random / as-played modes
- **12 presets**, polyphony modes (poly / mono / legato), voice count, undo/redo
- Playable with mouse or **computer keyboard** (A–L white keys, W E T Y U sharps)

## Run it

### Play online
If GitHub Pages is enabled (see below), the live version is at:

```
https://<your-username>.github.io/<your-repo>/
```

> Click anywhere / play a key first — browsers block audio until the page has been interacted with.

### Run locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

To make a production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the built site locally
```

## Deploy to GitHub Pages (automatic)

This repo ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys on every push to `main`. To turn it on:

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push any commit to `main` (or re-run the workflow from the **Actions** tab).

The site publishes to `https://<user>.github.io/<repo>/`. The workflow injects the repo name as the asset base path automatically, so it works without any config edits.

## Tech

- **React 18** + **Vite**
- **Web Audio API** for all DSP — a `SynthEngine` class owns the audio graph and runs a ~90 Hz control-rate modulation loop that drives the matrix
- No audio libraries; everything (oscillators, per-voice filters, reverb IR, delay, chorus, waveshaping) is built on native Web Audio nodes

## Project structure

```
.
├── index.html            # Vite entry
├── src/
│   ├── main.jsx          # React root
│   ├── NeutrinoSynth.jsx # the whole synth (engine + UI)
│   └── index.css         # global reset
├── vite.config.js
└── .github/workflows/deploy.yml
```

## License

MIT — see [LICENSE](LICENSE). Do whatever you like; attribution appreciated.
