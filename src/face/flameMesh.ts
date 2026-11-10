/**
 * FLAME mesh loader.
 *
 * Loads optional local, data-only mesh files and builds the geometry the
 * face renderer needs:
 *   - centered + uniformly scaled vertex positions (head at origin, ~TARGET tall)
 *   - per-vertex normals (for displacing particles along the surface)
 *   - triangle faces + region masks (for occlusion fill and region hiding)
 *
 * The binaries are little-endian, matching numpy's default on x86.
 */

import * as THREE from 'three';

interface FlameMeta {
  vertexCount: number;
  faceCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface ParticleGeometry {
  /** Centered + scaled vertex positions, Float32 (N*3). */
  positions: Float32Array;
  /** Per-vertex normals, Float32 (N*3). */
  normals: Float32Array;
  /** Triangle indices, Uint32 (M*3). */
  faces: Uint32Array;
  /** FLAME region name → vertex indices (for non-destructive hiding). */
  regions: Record<string, number[]>;
}

/**
 * Internal geometry that is never part of the visible face surface (the eyeball
 * spheres sitting inside the sockets). Always hidden so they don't show through
 * during the morph or on the settled face. Not offered as user toggles.
 */
export const ALWAYS_HIDDEN_REGIONS = ['left_eyeball', 'right_eyeball'] as const;

/** Stable FLAME region names (matches FLAME_masks). Used to build the hide UI. */
export const FLAME_REGIONS = [
  'face',
  'eye_region',
  'left_eye_region',
  'right_eye_region',
  'left_eyeball',
  'right_eyeball',
  'nose',
  'lips',
  'forehead',
  'left_ear',
  'right_ear',
  'scalp',
  'neck',
  'boundary',
] as const;

const BASE = `${import.meta.env.BASE_URL ?? '/'}flame`;
/** Target world-space size of the head's largest extent. */
const TARGET = 2.2;

async function fetchAsset(path: string, signal: AbortSignal, optional = false): Promise<Response> {
  const res = await fetch(path, {
    signal,
    mode: 'same-origin',
    redirect: 'error',
    headers: path.endsWith('.json') ? { Accept: 'application/json' } : undefined,
  });
  if (!res.ok && !(optional && res.status === 404)) {
    throw new Error(`FLAME asset fetch failed: ${path} (${res.status})`);
  }
  return res;
}

export async function loadFlameGeometry(signal: AbortSignal): Promise<ParticleGeometry | null> {
  const metadata = await fetchAsset(`${BASE}/meta.json`, signal, true);
  if (metadata.status === 404) return null;
  const meta: FlameMeta = await metadata.json();
  if (!meta || !Number.isSafeInteger(meta.vertexCount) || meta.vertexCount <= 0
    || !Number.isSafeInteger(meta.faceCount) || meta.faceCount <= 0
    || !validBounds(meta.boundsMin) || !validBounds(meta.boundsMax)
    || meta.boundsMin.some((value, axis) => value > meta.boundsMax[axis])) {
    throw new Error('Invalid FLAME mesh metadata');
  }
  const [vBuf, fBuf, rawRegions] = await Promise.all([
    fetchAsset(`${BASE}/vertices.bin`, signal).then((r) => r.arrayBuffer()),
    fetchAsset(`${BASE}/faces.bin`, signal).then((r) => r.arrayBuffer()),
    fetchAsset(`${BASE}/regions.json`, signal).then((r) => r.json()),
  ]);

  if (vBuf.byteLength !== meta.vertexCount * 12 || fBuf.byteLength !== meta.faceCount * 12) {
    throw new Error('FLAME mesh buffers do not match the metadata counts');
  }
  const rawPositions = new Float32Array(vBuf);
  const faces = new Uint32Array(fBuf);
  if (!rawPositions.every(Number.isFinite) || faces.some((index) => index >= meta.vertexCount)) {
    throw new Error('Invalid FLAME mesh vertices or indices');
  }
  const regions = readRegions(rawRegions, meta.vertexCount);

  // Center on the bounds midpoint and scale so the largest extent == TARGET.
  const [minx, miny, minz] = meta.boundsMin;
  const [maxx, maxy, maxz] = meta.boundsMax;
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const extent = Math.max(maxx - minx, maxy - miny, maxz - minz);
  const scale = TARGET / extent;

  const positions = new Float32Array(rawPositions.length);
  for (let i = 0; i < rawPositions.length; i += 3) {
    positions[i] = (rawPositions[i] - cx) * scale;
    positions[i + 1] = (rawPositions[i + 1] - cy) * scale;
    positions[i + 2] = (rawPositions[i + 2] - cz) * scale;
  }
  if (!Number.isFinite(extent) || !positions.every(Number.isFinite)) {
    throw new Error('FLAME mesh bounds cannot be normalized');
  }

  // Vertex normals via Three.js (indexed geometry → smooth normals).
  const tmp = new THREE.BufferGeometry();
  tmp.setIndex(new THREE.BufferAttribute(faces, 1));
  tmp.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  tmp.computeVertexNormals();
  const normals = (tmp.attributes.normal as THREE.BufferAttribute).array as Float32Array;

  return { positions, normals, faces, regions };
}

function validBounds(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function readRegions(value: unknown, vertexCount: number): Record<string, number[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid FLAME region data');
  }
  const source = value as Record<string, unknown>;
  const regions: Record<string, number[]> = {};
  for (const region of FLAME_REGIONS) {
    if (!Object.hasOwn(source, region)) continue;
    const indices = source[region];
    if (!Array.isArray(indices)
      || !indices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < vertexCount)) {
      throw new Error(`Invalid FLAME region indices for ${region}`);
    }
    regions[region] = indices;
  }
  if (ALWAYS_HIDDEN_REGIONS.some((region) => !regions[region]?.length)) {
    throw new Error('FLAME region data must include the internal eyeball masks');
  }
  return regions;
}
