# Operations

## Run locally

The [README](README.md#-getting-started) owns the install and build commands. Use the version in [.node-version](.node-version) and install from the npm lockfile. Vite serves the viewer locally and builds static files in `dist/`.

A clean checkout starts in Orb mode. Microphone access requires browser permission and a secure context such as localhost or HTTPS. Narration is read from a file selected on the device. Speak uses browser voices that report local synthesis. Install a local system voice if the browser exposes none.

## Optional Face mode

Use a verified, compatible FLAME mesh and its region masks that you have rights to use. Put these data-only files under `public/flame/` and reload. For a production build, supply them before building. Keep that directory out of source control.

| File | Format |
| --- | --- |
| `meta.json` | Object with positive integer `vertexCount` and `faceCount` and finite three-element `boundsMin` and `boundsMax` arrays |
| `vertices.bin` | Little-endian float32 XYZ triples in vertex order |
| `faces.bin` | Little-endian uint32 triangle triples with zero-based vertex indices |
| `regions.json` | Object mapping supported region names to zero-based vertex indices, including both internal eyeball masks |

[The loader](src/face/flameMesh.ts) owns the supported region names, checks file shapes and requests only same-origin data. An absent or invalid mesh leaves Orb mode available. The viewer ships without a converter or archives. FLAME 2023 Open has its own [upstream terms](https://flame.is.tue.mpg.de/modellicense.html). Verify the terms for the exact model and masks separately and retain any required notices before distributing them or their derivatives.

## Verify

Run `npm test`, `npm run typecheck`, and `npm run build`. In a browser, check the orb without mesh files and repeat with compatible data to exercise Face mode. Cover morph reversal, manual scrub, region hiding, drag and zoom, WebGL fallback, microphone permission and stop, narration playback and stop, and Speak/Stop with a local voice. An empty or remote-only voice list must leave Speak disabled. Check keyboard reach, focus, contrast and controls at a narrow viewport and 200 percent zoom.
