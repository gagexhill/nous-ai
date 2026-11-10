/**
 * ReactorCanvas — R3F Canvas wrapper for the particle viewer.
 *
 * Perf contract:
 *   - dpr={[1, 1.5]}: caps DPR at 1.5.
 *   - frameloop="always": continuous render (reliable painting).
 *   - Low-end (hardwareConcurrency < 4): no Bloom.
 *
 * WebGL probe: probes via getContext() only — never calls loseContext()
 * (that poisons Chrome's GPU process and breaks the real Canvas context).
 *
 * Resilience: webGLAvailable() probes before mounting R3F; Canvas is
 * lazy-mounted; CanvasErrorBoundary catches R3F throws → CSS glow fallback.
 */

import {
  Component,
  Suspense,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type ErrorInfo,
} from 'react';

import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

// ── WebGL availability probe ──────────────────────────────────────────────────

function webGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return ctx !== null;
  } catch {
    return false;
  }
}

// ── CSS-only fallback backdrop (blood-orange) ─────────────────────────────────

function ReactorFallback({ reason }: { reason: string }): React.ReactElement {
  useEffect(() => {
    console.info('[ReactorCanvas] mode=fallback reason=' + reason);
  }, [reason]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: [
          'radial-gradient(ellipse 70% 65% at 50% 50%,',
          '  rgba(193,61,10,0.12) 0%,',
          '  rgba(193,61,10,0.06) 40%,',
          '  transparent 70%)',
        ].join(''),
      }}
    />
  );
}

// ── ErrorBoundary around the R3F Canvas ──────────────────────────────────────

interface ErrorBoundaryState {
  crashed: boolean;
}

class CanvasErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(
      '[ReactorCanvas] mode=crashed — R3F error, falling back to CSS glow:',
      error.message,
      info.componentStack?.slice(0, 200),
    );
  }

  render(): ReactNode {
    if (this.state.crashed) {
      return <ReactorFallback reason="r3f-throw" />;
    }
    return this.props.children;
  }
}

// ── First-frame logger — lives inside Canvas so useFrame() works ─────────────

function FirstFrameLogger(): null {
  const logged = useRef(false);

  useFrame(() => {
    if (!logged.current) {
      logged.current = true;
      console.info('[ReactorCanvas] mode=webgl — first frame rendered, orb is painting');
    }
  });

  return null;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function isLowEnd(): boolean {
  return (navigator.hardwareConcurrency ?? 4) < 4;
}

function Scene({ children }: { children: ReactNode }): React.ReactElement {
  const low = useMemo(() => isLowEnd(), []);

  return (
    <>
      <FirstFrameLogger />
      {children}
      {!low && (
        <EffectComposer>
          <Bloom intensity={1.1} luminanceThreshold={0.22} luminanceSmoothing={0.85} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

// ── Canvas wrapper ────────────────────────────────────────────────────────────

interface ReactorCanvasProps {
  /** Scene content (the face, the orb, …) rendered inside the resilient Canvas. */
  children: ReactNode;
}

function LazyCanvas({ children }: ReactorCanvasProps): React.ReactElement {
  const [probeResult, setProbeResult] = useState<'pending' | 'ok' | 'unavailable'>('pending');

  useEffect(() => {
    const ok = webGLAvailable();
    setProbeResult(ok ? 'ok' : 'unavailable');
    if (!ok) {
      console.info('[ReactorCanvas] mode=fallback reason=webgl-probe-failed');
    }
  }, []);

  if (probeResult === 'unavailable') {
    return <ReactorFallback reason="webgl-probe-failed" />;
  }

  if (probeResult === 'pending') {
    return (
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    );
  }

  return (
    <CanvasErrorBoundary>
      <Canvas
        dpr={[1, 1.5]}
        frameloop="always"
        camera={{ position: [0, 0, 3.2], fov: 55 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // OrbitControls receives drag and scroll input.
          pointerEvents: 'auto',
        }}
      >
        <Suspense fallback={null}>
          <Scene>{children}</Scene>
        </Suspense>
      </Canvas>
    </CanvasErrorBoundary>
  );
}

export function ReactorCanvas({ children }: ReactorCanvasProps): React.ReactElement {
  return <LazyCanvas>{children}</LazyCanvas>;
}
