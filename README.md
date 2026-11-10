# 🎭 Nous — A Voice-Reactive Particle Viewer

> A voice can give a shape rhythm. Nous turns it into a living orb that can gather into a face.

<div align="center">

![Nous](https://img.shields.io/badge/Nous-particle%20viewer-E2571F)
![Node.js](https://img.shields.io/badge/Node.js-22.23.2-339933)
![React](https://img.shields.io/badge/React-19.3.1-61DAFB)
![Three.js](https://img.shields.io/badge/Three.js-0.187.0-000000)
![React Three Fiber](https://img.shields.io/badge/R3F-9.8.2-000000)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6)
![Vite](https://img.shields.io/badge/Vite-6.4.5-646CFF)
[![MIT License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Owned and maintained by Gage Hill

[Run locally](#-getting-started) · [Operations](OPERATIONS.md)

</div>

---

## 📌 Table of Contents

- [Project Overview](#-project-overview)
- [The Problem It Solves](#-the-problem-it-solves)
- [Core Concept](#-core-concept-voice-into-motion)
- [The Viewer Surface](#-the-viewer-surface)
- [Tech Stack](#-tech-stack)
- [Project Architecture](#-project-architecture)
- [Key Features](#-key-features)
- [How It Works](#-how-it-works--under-the-hood)
- [Getting Started](#-getting-started)
- [File Structure](#-file-structure)
- [Concepts & References](#-concepts--references)
- [About the Owner](#-about-the-owner)

## 🌐 Project Overview

Nous is an interactive 3D particle viewer. Its blood-orange orb responds to a microphone or narration file. With compatible FLAME data installed, the same particles can gather into a face.

## 🔍 The Problem It Solves

Static visualizers lose much of the character in a voice. Nous uses loudness, pitch, brightness and syllable timing to drive motion and warmth. The viewer needs only a browser and runs without an account or backend.

## 🧬 Core Concept: Voice into Motion

```text
Microphone or local file -> Web Audio -> voice features -> orb shader
Optional FLAME mesh -----------------------------------> face morph
```

1. Web Audio analyses the microphone or local file as it plays.
2. The viewer records a short history of loudness and brightness and draws it as outward-moving rings.
3. A browser-provided local speech voice can animate the orb through speech events.
4. With Face mode enabled, the renderer pairs orb particles with mesh positions for a reversible morph.

## 🎛 The Viewer Surface

| Mode | Behavior |
| --- | --- |
| Orb | Starts with a procedural sphere and supports microphone, narration and local speech |
| Face | Uses optional FLAME data for form and return, manual scrub, occluding fill and region controls |
| WebGL fallback | Shows a static glow and keeps the audio controls available |

## 🛠 Tech Stack

| Technology | Version | Role |
| --- | --- | --- |
| Node.js | 22.23.2 | Local tooling |
| React | 19.3.1 | Viewer and control panel |
| Three.js | 0.187.0 | Geometry and shaders |
| React Three Fiber | 9.8.2 | React renderer for Three.js |
| Drei | 10.7.9 | Orbit controls |
| React Three Postprocessing | 3.2.2 | Bloom |
| TypeScript | 5.9.3 | Type checking |
| Vite | 6.4.5 | Local server and static build |

## 🏗 Project Architecture

```text
src/
├── App.tsx                       Viewer state and input lifecycle
├── face/                         Audio, speech and optional FLAME loading
└── components/
    ├── reactor/ReactorCanvas.tsx  WebGL and static fallback
    ├── face/FaceParticles.tsx     Shared orb and face shader
    └── ui/ControlPanel.tsx        Viewer controls
```

The app passes motion state to the renderer and status to the control panel. Mesh files are read from the viewer's origin when available.

## ✨ Key Features

- **Voice-reactive orb** — Loudness swells the orb, pitch changes its shape, and syllables travel outward as rings.
- **Optional face morph** — Form and reverse the face, scrub manually, and hide individual regions.
- **Local media** — Narration and microphone audio stay in the browser. Speak uses an explicitly local voice.
- **Interactive view** — Drag to rotate and scroll to zoom.

## ⚙ How It Works — Under the Hood

### Local voice selection

The selector filters the browser's inventory before applying language preferences.

```ts
const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService === true);
```

### Optional face data

Missing mesh metadata leaves the procedural orb in place.

```ts
const metadata = await fetchAsset(`${BASE}/meta.json`, signal, true);
if (metadata.status === 404) return null;
const meta: FlameMeta = await metadata.json();
```

## 🚀 Getting Started

### Prerequisites

Use Node.js 22.23.2 with npm and a current WebGL-capable browser.

```sh
node --version
npm --version
```

### Installation

```sh
npm ci
npm run dev
```

### Build for Production

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

> The orb works without model files. Face mode requires [compatible local FLAME data](OPERATIONS.md#optional-face-mode). Speak requires an installed local browser voice.

- [Operations](OPERATIONS.md) owns setup and validation.
- [Repository guidance](AGENTS.md) owns contributor constraints.
- [Devlog](DEVLOG.md) records completed decisions.

## 📁 File Structure

```text
src/               Viewer source
test/              Local speech regression tests
.githooks/         Optional secret scanning hook
index.html         Browser entry document
package.json       Scripts and dependencies
package-lock.json  Locked dependencies
tsconfig.json      TypeScript configuration
vite.config.ts     Build configuration
```

## 📚 Concepts & References

| Concept | Applied In |
| --- | --- |
| Browser audio analysis | [Voice analyser](src/face/voiceAnalyser.ts) |
| Local speech synthesis | [Speech driver](src/face/speechDriver.ts) |
| Particle morph and shading | [Renderer](src/components/face/FaceParticles.tsx) |
| Mesh and mask contract | [FLAME loader](src/face/flameMesh.ts) |
| FLAME model terms | [Upstream model license](https://flame.is.tue.mpg.de/modellicense.html) |

## 👤 About the Owner

<div align="center">

Gage Hill · Project maintainer

[GitHub profile](https://github.com/gagexhill)

</div>

---

<div align="center">

A voice in motion.

Copyright (c) 2026 Gage Hill. Licensed under the [MIT License](LICENSE).

</div>
