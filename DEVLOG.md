# Devlog

## 2026-11-10 — Standalone distribution candidate

- The voice-reactive orb runs without model files. Face mode uses optional same-origin FLAME geometry and masks.
- Speech requires a browser-provided local voice. Voice inventory changes refresh control availability.
- The source tree excludes third-party binaries and executable model-conversion tooling. [Operations](OPERATIONS.md#optional-face-mode) owns the mesh data contract.

## 2026-11-10 - Personal open-source publication

- The Owner approved personal ownership and MIT licensing for the source. [LICENSE](LICENSE) owns the grant and copyright notice.
- The public repository starts from a fresh source snapshot. Optional mesh data retains its separate provenance and licensing requirements in [Operations](OPERATIONS.md#optional-face-mode).
- Dependency updates use local checks. Hosted update scheduling is disabled.
