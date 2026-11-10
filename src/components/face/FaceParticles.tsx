/**
 * FaceParticles — the living orb that forms into a face, built from particles.
 *
 * The ORB is the resting living state: a dense, glowing, undulating sphere of
 * blood-orange particles with lobed displacement waves. To interact, the AI
 * gathers those same particles into a FACE on the FLAME 2023 surface. No
 * wireframe; form comes from particle density. A dark fill occludes the far
 * side once formed. Internal geometry (eyeballs) is never drawn, so nothing
 * forms "inside" the head during the morph.
 *
 * uMorph 0→1 = orb→face. Region hiding is non-destructive (filters drawn points
 * by their source triangle). Palette: blood orange (#C13D0A → #FFC873).
 *
 * Voice: on the orb, sound radiates from the centre facing the viewer out to the
 * edges. waveRef holds a short history of the voice (newest first); each point
 * reads the moment that matches its angular distance from that centre, so every
 * syllable travels outward as a ring, and the glow rides the same ring. Pitch
 * stretches the orb taller as the voice rises. The face keeps a subtle swell.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALWAYS_HIDDEN_REGIONS,
  type ParticleGeometry,
} from '../../face/flameMesh';
import { ORB_TINTS, type OrbState } from '../../face/orbState';
import type { VoiceFeatures } from '../../face/voiceAnalyser';
import { WAVE_SAMPLES, type VoiceWave } from '../../face/voiceWave';

const MORPH_DURATION = 3.6; // seconds for a full orb⇄face form (slow, deliberate)
const SURFACE_AREA_BUDGET = 55_000; // area-weighted fill particles
const PER_FACE_MIN = 4; // extra fill per face → feature-dense regions get more detail
// Points per latitude band in the orb pairing. Small bands let random fill
// sampling reorder neighbouring bands (visible as sheared slices mid-morph);
// large bands mix latitudes. ~2,200 measured best on the FLAME 2023 head.
const ORB_BAND_SIZE = 2200;
// Face displacement while speaking with waves off (waves on uses 0.05). Kept
// low because point brightness tracks displacement; higher washes the face out.
const SPEAKING_DISPLACE = 0.015;
// Orb stretch per unit of intonation (pitch -1..1): taller as the voice rises.
const PITCH_STRETCH = 0.1;
// Extra wave-pattern speed at full voice flow (1 = twice as fast).
const FLOW_SPEEDUP = 1.6;
// Outward push of a full-strength voice ring, in orb units (radius 1.3).
const RIPPLE_STRENGTH = 0.28;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shared preamble — orb→face morph + displacement.
const displaceGLSL = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uDisplaceScale;
  uniform float uMorph;
  uniform float uOrbRadius;
  uniform float uOrbWave;
  uniform float uVoicePitch;   // intonation, -1..1 (see face/voiceAnalyser.ts)
  uniform float uPitchStretch; // orb stretch per unit of intonation
  // Voice history, newest first, sampled at a fixed rate (see face/voiceWave.ts).
  uniform float uWave[${WAVE_SAMPLES}];
  uniform float uWaveBright[${WAVE_SAMPLES}];
  uniform float uRippleStrength;

  attribute vec3 aNormal;
  attribute vec3 aOrb;     // unit sphere direction (Fibonacci)
  attribute float aHot;    // opening seams (lip line, nostrils) — subtle definition
  attribute float aAnchor; // 1 = sits on a FLAME vertex (feature definition)
  varying float vDisplace;
  varying float vHot;
  varying float vAnchor;
  varying float vM;        // this vertex's own settled amount (stagger applied)
  varying float vRipBright; // voice brightness carried by the outgoing ring

  // Linear read of the voice history at x = 0 (now) .. 1 (oldest).
  float waveAt(float x) {
    float f = clamp(x, 0.0, 1.0) * float(${WAVE_SAMPLES - 1});
    int i = int(floor(f));
    int j = min(i + 1, ${WAVE_SAMPLES - 1});
    return mix(uWave[i], uWave[j], fract(f));
  }
  float brightAt(float x) {
    float f = clamp(x, 0.0, 1.0) * float(${WAVE_SAMPLES - 1});
    int i = int(floor(f));
    int j = min(i + 1, ${WAVE_SAMPLES - 1});
    return mix(uWaveBright[i], uWaveBright[j], fract(f));
  }

  float surfaceWave(vec3 p, float tw) {
    return
      0.55 * sin(3.0 * p.x * 2.0 + tw * 0.7) *
             cos(2.0 * p.y * 2.0 + tw * 0.5) +
      0.30 * sin(5.0 * p.z * 2.0 + tw * 1.1) *
             sin(4.0 * p.y * 2.0 + tw * 0.9) +
      0.15 * cos(7.0 * p.x * 2.0 - tw * 0.6);
  }

  vec3 displaced(out float d) {
    // Staggered formation: crown (high latitude) settles first, sweeping down to
    // the neck, so the face materializes in a flowing wave, not all at once.
    const float STAGGER = 0.45;
    float stagger = (1.0 - aOrb.y) * 0.5;                          // 0 top .. 1 bottom
    float m = clamp(uMorph * (1.0 + STAGGER) - stagger * STAGGER, 0.0, 1.0);
    vM = m;

    // Intonation stretches the orb taller (and slightly narrower) as pitch rises.
    float sy = uVoicePitch * uPitchStretch;
    vec3 orbPos = aOrb * uOrbRadius * vec3(1.0 - 0.4 * sy, 1.0 + sy, 1.0 - 0.4 * sy);
    vec3 base   = mix(orbPos, position, m);
    // Opposed aOrb/aNormal pass through zero mid-morph; normalize() would give NaN
    // and drop the point, so fall back to the surface normal there.
    vec3 dirRaw = mix(aOrb, aNormal, m);
    float dirLen = length(dirRaw);
    vec3 dir    = dirLen > 1e-3 ? dirRaw / dirLen : aNormal;
    vec3 coord  = mix(aOrb, position, m);
    d = surfaceWave(coord, uTime);
    // Lively swell on the orb, settling to a still face (or idle waves if on).
    float amp = uAmplitude * (uOrbWave * (1.0 - m) + uDisplaceScale * m);

    // Voice ring: angular distance from the orb point facing the viewer (0) to
    // the far pole (1) picks how long ago this point hears the voice, so sound
    // spreads from the centre outward. Rings soften as they travel. Orb only.
    vec3 vdir = normalize((modelViewMatrix * vec4(aOrb, 0.0)).xyz);
    float x = acos(clamp(vdir.z, -1.0, 1.0)) / 3.14159265;
    float orbW = 1.0 - m;
    float ripple = waveAt(x) * (1.0 - 0.45 * x) * orbW * uRippleStrength;
    vRipBright = brightAt(x) * (1.0 - 0.45 * x) * orbW;

    // Color brightness tracks actual displacement, ring included, so the glow
    // moves with the motion: the orb glows, the face is base.
    vDisplace = d * amp + ripple * 0.8;
    return base + dir * (d * amp) + aOrb * ripple;
  }
`;

const pointsVertex = /* glsl */ `
  ${displaceGLSL}
  uniform float uPointBase;

  void main() {
    float d;
    vec3 pos = displaced(d);
    vHot = aHot;
    vAnchor = aAnchor;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    // Anchors (on FLAME vertices) render larger to define features on the face.
    float anchorSize = mix(0.75, 1.7, vAnchor * uMorph);
    float boost = anchorSize + vHot * 0.3 * uMorph;
    gl_PointSize = (uPointBase + max(vDisplace, 0.0) * 2.0) * boost * (3.0 / -mv.z);
  }
`;

const pointsFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uMorph;
  uniform vec3 uTint;      // orb-state tint (see face/orbState.ts)
  uniform float uTintMix;  // 0 = untinted blood orange
  uniform float uVoiceBright; // spectral brightness, 0..1 (face only)
  varying float vDisplace;
  varying float vRipBright;
  varying float vAnchor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    float falloff = 1.0 - smoothstep(0.1, 0.5, r);

    vec3 base   = vec3(0.76, 0.24, 0.04);  // #C13D0A blood orange
    vec3 bright = vec3(1.00, 0.78, 0.45);  // #FFC873 glowing highlight
    // Crisp consonants lift the glow: on the orb inside the travelling ring, on
    // the face as a small overall lift so it never washes out.
    float t     = clamp(vDisplace * 5.0 + vRipBright * 0.5 + uVoiceBright * 0.15 * uMorph, 0.0, 1.0);
    vec3 color  = mix(mix(base, bright, t), uTint, uTintMix);

    // On the face, anchors are fuller than fill (feature definition).
    float aMul = mix(0.55, 0.95, vAnchor * uMorph);
    gl_FragColor = vec4(color, falloff * aMul * uOpacity);
  }
`;

// Fill uses the morphed/displaced vertex position (the 5023-vertex mesh).
const surfaceVertex = /* glsl */ `
  ${displaceGLSL}
  void main() {
    float d;
    vec3 pos = displaced(d);
    vHot = aHot;
    vAnchor = aAnchor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Opaque dark interior. Each fragment draws only once its own vertices have
// landed, so the occluder grows down behind the staggered formation wave instead
// of appearing everywhere at a global threshold while the lower head is still in
// flight (which left dark patches off the surface).
const fillFragment = /* glsl */ `
  varying float vM;
  void main() {
    if (vM < 0.995) discard;
    gl_FragColor = vec4(0.030, 0.012, 0.005, 1.0);
  }
`;

interface FaceParticlesProps {
  faceGeometry: ParticleGeometry | null;
  amplitudeRef: React.MutableRefObject<number>;
  /** 0..1: how much the voice speeds up the flowing wave pattern. */
  flowRef: React.MutableRefObject<number>;
  /** Voice history driving the outward rings, read per frame. */
  waveRef: React.MutableRefObject<VoiceWave>;
  /** Read per frame (no re-render), like amplitudeRef. */
  orbStateRef: React.MutableRefObject<OrbState>;
  /** Live prosody features, read per frame (no re-render). */
  voiceRef: React.MutableRefObject<VoiceFeatures>;
  wavesOn: boolean;
  fillOn: boolean;
  hiddenRegions: ReadonlySet<string>;
  forming: boolean;
  scrub: number | null;
}

/** Hot opening vertices — lip seam (mid-line of lips) + nostrils (bottom of nose). */
function buildHot(geo: ParticleGeometry): Float32Array {
  const n = geo.positions.length / 3;
  const hot = new Float32Array(n);
  const pos = geo.positions;
  const yOf = (i: number): number => pos[i * 3 + 1];

  const lips = geo.regions['lips'];
  if (lips && lips.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of lips) {
      const y = yOf(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const mid = (lo + hi) / 2;
    const band = (hi - lo) * 0.22;
    for (const i of lips) if (Math.abs(yOf(i) - mid) < band) hot[i] = 1;
  }

  const nose = geo.regions['nose'];
  if (nose && nose.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of nose) {
      const y = yOf(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const thr = lo + (hi - lo) * 0.3;
    for (const i of nose) if (yOf(i) < thr) hot[i] = 1;
  }

  return hot;
}

/** Fibonacci unit-sphere direction for index i of n. */
function fib(i: number, n: number, out: Float32Array, o: number): void {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = ga * i;
  out[o] = Math.cos(th) * r;
  out[o + 1] = y;
  out[o + 2] = Math.sin(th) * r;
}

/**
 * Pair each point with an evenly spread sphere direction so that neighbours on
 * the face stay neighbours on the orb (no crisscrossing paths).
 *
 * Both sets are cut into equal-count latitude bands, and inside each band both
 * are ordered by longitude and matched by rank. Matching on latitude alone is not
 * enough: consecutive Fibonacci points are 137.5° apart in longitude, which
 * scattered adjacent face particles across the whole orb and smeared features
 * into horizontal bands mid-morph.
 *
 * Only the particles that are drawn are paired, so hidden regions (the eyeballs
 * are ~11% of the particles) leave no hole in the orb.
 */
function pairToOrb(positions: Float32Array, subset: ArrayLike<number>, out: Float32Array): void {
  const n = subset.length;
  const sphere = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) fib(i, n, sphere, i * 3);

  const latP = new Float32Array(n);
  const lonP = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const o = subset[k] * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    latP[k] = y / (Math.hypot(x, y, z) || 1);
    lonP[k] = Math.atan2(z, x);
  }
  const lonS = (i: number): number => Math.atan2(sphere[i * 3 + 2], sphere[i * 3]);

  const byLatP = Array.from({ length: n }, (_, k) => k).sort((a, b) => latP[b] - latP[a]);
  // Fibonacci y already descends with index, so sphere indices are latitude-ordered.
  const bands = Math.max(1, Math.round(n / ORB_BAND_SIZE));
  for (let b = 0; b < bands; b++) {
    const s = Math.floor((b * n) / bands);
    const e = Math.floor(((b + 1) * n) / bands);
    const pts = byLatP.slice(s, e).sort((a, c) => lonP[a] - lonP[c]);
    const sph: number[] = [];
    for (let i = s; i < e; i++) sph.push(i);
    sph.sort((a, c) => lonS(a) - lonS(c));
    for (let k = 0; k < pts.length; k++) {
      const o = subset[pts[k]] * 3;
      const so = sph[k] * 3;
      out[o] = sphere[so];
      out[o + 1] = sphere[so + 1];
      out[o + 2] = sphere[so + 2];
    }
  }
}

interface SurfaceData {
  positions: Float32Array;
  normals: Float32Array;
  hot: Float32Array;
  anchor: Float32Array; // 1 = on a FLAME vertex (defines features), 0 = fill (texture)
  srcFace: Uint32Array;
  count: number;
}

/**
 * Particle set = vertex ANCHORS (one per FLAME vertex — define features, since
 * the mesh concentrates vertices there) + FILL samples across the triangles
 * (texture). Orb directions are assigned per visible set by pairToOrb.
 */
function sampleSurface(geo: ParticleGeometry, areaBudget: number, perFaceMin: number): SurfaceData {
  const pos = geo.positions;
  const nrm = geo.normals;
  const faces = geo.faces;
  const hotV = buildHot(geo);
  const nv = pos.length / 3;
  const F = faces.length / 3;

  // One representative face per vertex (for region-hide of anchors).
  const vertexFace = new Uint32Array(nv);
  const seen = new Uint8Array(nv);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k];
      if (!seen[v]) {
        seen[v] = 1;
        vertexFace[v] = f;
      }
    }
  }

  const area = new Float32Array(F);
  let total = 0;
  for (let f = 0; f < F; f++) {
    const a = faces[f * 3] * 3;
    const b = faces[f * 3 + 1] * 3;
    const c = faces[f * 3 + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    area[f] = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    total += area[f];
  }

  const counts = new Int32Array(F);
  let nFill = 0;
  for (let f = 0; f < F; f++) {
    counts[f] = perFaceMin + Math.round((areaBudget * area[f]) / (total || 1));
    nFill += counts[f];
  }

  const N = nv + nFill;
  const positions = new Float32Array(N * 3);
  const normals = new Float32Array(N * 3);
  const hot = new Float32Array(N);
  const anchor = new Float32Array(N);
  const srcFace = new Uint32Array(N);

  let p = 0;
  // Anchors: one particle exactly on each FLAME vertex.
  for (let v = 0; v < nv; v++) {
    const o = p * 3;
    positions[o] = pos[v * 3];
    positions[o + 1] = pos[v * 3 + 1];
    positions[o + 2] = pos[v * 3 + 2];
    normals[o] = nrm[v * 3];
    normals[o + 1] = nrm[v * 3 + 1];
    normals[o + 2] = nrm[v * 3 + 2];
    hot[p] = hotV[v];
    anchor[p] = 1;
    srcFace[p] = vertexFace[v];
    p++;
  }

  // Fill: texture between the anchors.
  for (let f = 0; f < F; f++) {
    const ia = faces[f * 3];
    const ib = faces[f * 3 + 1];
    const ic = faces[f * 3 + 2];
    for (let j = 0; j < counts[f]; j++) {
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      const o = p * 3;
      positions[o] = pos[ia * 3] * w + pos[ib * 3] * u + pos[ic * 3] * v;
      positions[o + 1] = pos[ia * 3 + 1] * w + pos[ib * 3 + 1] * u + pos[ic * 3 + 1] * v;
      positions[o + 2] = pos[ia * 3 + 2] * w + pos[ib * 3 + 2] * u + pos[ic * 3 + 2] * v;
      let nx = nrm[ia * 3] * w + nrm[ib * 3] * u + nrm[ic * 3] * v;
      let ny = nrm[ia * 3 + 1] * w + nrm[ib * 3 + 1] * u + nrm[ic * 3 + 1] * v;
      let nz = nrm[ia * 3 + 2] * w + nrm[ib * 3 + 2] * u + nrm[ic * 3 + 2] * v;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals[o] = nx / nl;
      normals[o + 1] = ny / nl;
      normals[o + 2] = nz / nl;
      hot[p] = hotV[ia] * w + hotV[ib] * u + hotV[ic] * v;
      anchor[p] = 0;
      srcFace[p] = f;
      p++;
    }
  }

  return { positions, normals, hot, anchor, srcFace, count: N };
}

/** Per-face visibility from always-hidden + user-hidden regions (face hidden if all 3 verts are). */
function faceVisibility(geo: ParticleGeometry, hidden: ReadonlySet<string>): Uint8Array {
  const n = geo.positions.length / 3;
  const vis = new Uint8Array(n).fill(1);
  const list = [...ALWAYS_HIDDEN_REGIONS, ...(hidden ? Array.from(hidden) : [])];
  for (const region of list) {
    const idxs = geo.regions[region];
    if (idxs) for (const i of idxs) vis[i] = 0;
  }
  const F = geo.faces.length / 3;
  const fv = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    const a = geo.faces[f * 3];
    const b = geo.faces[f * 3 + 1];
    const c = geo.faces[f * 3 + 2];
    fv[f] = vis[a] && vis[b] && vis[c] ? 1 : 0;
  }
  return fv;
}

function makeOrbGeometry(): ParticleGeometry {
  // Feed a built-in sphere through the same sampler and shaders as Face mode.
  const sphere = new THREE.SphereGeometry(1, 32, 24);
  const geometry = {
    positions: new Float32Array(sphere.getAttribute('position').array),
    normals: new Float32Array(sphere.getAttribute('normal').array),
    faces: new Uint32Array(sphere.getIndex()!.array),
    regions: {},
  };
  sphere.dispose();
  return geometry;
}

export function FaceParticles({
  faceGeometry,
  amplitudeRef,
  flowRef,
  waveRef,
  orbStateRef,
  voiceRef,
  wavesOn,
  fillOn,
  hiddenRegions,
  forming,
  scrub,
}: FaceParticlesProps): React.ReactElement {
  const geo = useMemo(() => faceGeometry ?? makeOrbGeometry(), [faceGeometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmplitude: { value: 1.0 },
      uDisplaceScale: { value: 0.0 },
      uPointBase: { value: 2.0 },
      uOpacity: { value: 1.0 },
      uMorph: { value: 0.0 },
      uOrbRadius: { value: 1.3 },
      uOrbWave: { value: 0.16 },
      uTint: { value: new THREE.Vector3(...ORB_TINTS.idle.color) },
      uTintMix: { value: 0.0 },
      uVoicePitch: { value: 0.0 },
      uPitchStretch: { value: PITCH_STRETCH },
      uVoiceBright: { value: 0.0 },
      uWave: { value: new Float32Array(WAVE_SAMPLES) as Float32Array },
      uWaveBright: { value: new Float32Array(WAVE_SAMPLES) as Float32Array },
      uRippleStrength: { value: RIPPLE_STRENGTH },
    }),
    [],
  );

  const materials = useMemo(() => {
    const points = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const fill = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: surfaceVertex,
      fragmentShader: fillFragment,
      transparent: false,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    return { points, fill };
  }, [uniforms]);

  // Dense surface particles + the 5023-vertex fill shell (stable per mesh).
  const data = useMemo(() => {
    const surf = sampleSurface(geo, SURFACE_AREA_BUDGET, PER_FACE_MIN);
    return {
      surf,
      pAttr: {
        pos: new THREE.BufferAttribute(surf.positions, 3),
        norm: new THREE.BufferAttribute(surf.normals, 3),
        hot: new THREE.BufferAttribute(surf.hot, 1),
        anchor: new THREE.BufferAttribute(surf.anchor, 1),
      },
      fAttr: {
        pos: new THREE.BufferAttribute(geo.positions, 3),
        norm: new THREE.BufferAttribute(geo.normals, 3),
        hot: new THREE.BufferAttribute(buildHot(geo), 1),
        anchor: new THREE.BufferAttribute(new Float32Array(geo.positions.length / 3), 1),
      },
    };
  }, [geo]);

  // Rebuild draw indices and the orb pairing when the hidden-region set changes,
  // so the orb stays whole whatever is hidden.
  const geometries = useMemo(() => {
    const fv = faceVisibility(geo, hiddenRegions);

    const { surf, pAttr, fAttr } = data;
    const pIdx: number[] = [];
    for (let i = 0; i < surf.count; i++) if (fv[surf.srcFace[i]]) pIdx.push(i);
    const orb = new Float32Array(surf.count * 3);
    pairToOrb(surf.positions, pIdx, orb);

    const points = new THREE.BufferGeometry();
    points.setAttribute('position', pAttr.pos);
    points.setAttribute('aNormal', pAttr.norm);
    points.setAttribute('aOrb', new THREE.BufferAttribute(orb, 3));
    points.setAttribute('aHot', pAttr.hot);
    points.setAttribute('aAnchor', pAttr.anchor);
    points.setIndex(new THREE.BufferAttribute(new Uint32Array(pIdx), 1));

    const fIdx: number[] = [];
    for (let f = 0; f < fv.length; f++) {
      if (fv[f]) fIdx.push(geo.faces[f * 3], geo.faces[f * 3 + 1], geo.faces[f * 3 + 2]);
    }
    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', fAttr.pos);
    fill.setAttribute('aNormal', fAttr.norm);
    // The first nv particles are the vertex anchors. A drawn fill triangle has
    // only visible vertices, whose anchors are drawn and paired, so each fill
    // vertex reuses its anchor's orb direction and travels the same path.
    fill.setAttribute('aOrb', new THREE.BufferAttribute(orb.slice(0, geo.positions.length), 3));
    fill.setAttribute('aHot', fAttr.hot);
    fill.setAttribute('aAnchor', fAttr.anchor);
    fill.setIndex(new THREE.BufferAttribute(new Uint32Array(fIdx), 1));

    return { points, fill };
  }, [geo, data, hiddenRegions]);

  const group = useRef<THREE.Group>(null);
  const tintTarget = useMemo(() => new THREE.Vector3(), []);
  const cur = useRef(0);
  const tween = useRef({ from: 0, to: 0, p: 1, duration: MORPH_DURATION });
  useEffect(() => {
    const to = forming ? 1 : 0;
    // Scale by the distance left, so reversing mid-morph keeps the same pace
    // instead of replaying a full-length ease over a short distance.
    const duration = MORPH_DURATION * Math.max(0.15, Math.abs(to - cur.current));
    tween.current = { from: cur.current, to, p: 0, duration };
  }, [forming]);

  useFrame((_, delta) => {
    let m: number;
    if (scrub !== null) {
      m = scrub;
    } else {
      const t = tween.current;
      t.p = Math.min(1, t.p + delta / t.duration);
      m = t.from + (t.to - t.from) * easeInOut(t.p);
    }
    cur.current = m;
    uniforms.uMorph.value = m;
    // A louder voice makes the surface flow faster, not just swell bigger; the
    // phase only ever advances, so the pattern speeds up without jumping.
    uniforms.uTime.value += delta * (1 + FLOW_SPEEDUP * flowRef.current);
    uniforms.uAmplitude.value = 1.0 + amplitudeRef.current * 1.5;

    // Ease the state tint, and while speaking give the otherwise still face a
    // small displacement floor so the speech pulse is visible on it.
    const state = orbStateRef.current;
    const tint = ORB_TINTS[state];
    const k = 1 - Math.exp(-delta * 6);
    uniforms.uTint.value.lerp(tintTarget.fromArray(tint.color), k);
    uniforms.uTintMix.value += (tint.mix - uniforms.uTintMix.value) * k;
    const voiceActive = state === 'speaking' || state === 'listening';
    const scaleTarget = wavesOn ? 0.05 : voiceActive ? SPEAKING_DISPLACE : 0;
    uniforms.uDisplaceScale.value += (scaleTarget - uniforms.uDisplaceScale.value) * k;
    uniforms.uWave.value = waveRef.current.level;
    uniforms.uWaveBright.value = waveRef.current.bright;

    // Ease intonation and brightness so the shape and glow glide between syllables.
    const v = voiceRef.current;
    uniforms.uVoicePitch.value += (v.pitch - uniforms.uVoicePitch.value) * (1 - Math.exp(-delta * 3));
    uniforms.uVoiceBright.value +=
      (v.brightness - uniforms.uVoiceBright.value) * (1 - Math.exp(-delta * 5));

    if (group.current) {
      group.current.rotation.y =
        wavesOn && m >= 0.999 ? Math.sin(uniforms.uTime.value * 0.25) * 0.18 : 0;
    }
  });

  return (
    <group ref={group}>
      {fillOn && <mesh geometry={geometries.fill} material={materials.fill} />}
      <points geometry={geometries.points} material={materials.points} />
    </group>
  );
}
