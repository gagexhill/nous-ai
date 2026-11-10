# AGENTS.md

- Read [OPERATIONS.md](OPERATIONS.md) before changing setup or runtime behavior.
- Keep Nous a standalone browser viewer using React, Three.js, React Three Fiber and TypeScript. Optional Face mode uses compatible FLAME data. MediaPipe Face Landmarker is a future input direction.
- Preserve the resting orb, reversible staggered morph, manual scrub, blood-orange palette, occluding fill, region hiding, drag/zoom, warm state tints and local voice interaction. Keep internal eyeball masks in `ALWAYS_HIDDEN_REGIONS` and out of the HUD.
- Preserve the WebGL probe, lazy mount, fallback and rendering limits. Keep HUD and canvas input compatible with orbit controls.
- Keep microphone and narration audio in the browser. Speak must bind a voice the browser identifies as local and decline when none is available.
- Keep third-party model inputs and generated meshes out of Git. Accept only data-only mesh files at runtime. Confirm rights before distributing assets.
- Run tests, typecheck, build and affected browser interactions with and without compatible mesh files. Label simulated and device-observed results separately.
- Run dependency checks locally. Scheduling hosted update or validation jobs requires explicit Owner direction.
