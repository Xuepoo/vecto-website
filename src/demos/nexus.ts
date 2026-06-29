/**
 * Nexus — a WebGPU particle field. The stage is one VectoUI <canvas> running a
 * ComputeParticleEntity: tens of thousands of particles spring toward origins
 * sampled from the word "VectoUI" and flow away from the cursor as it passes. The
 * Scene runs the simulation on a WebGPU compute pass when available
 * (dispatchWorkgroups), falling back to a CPU step otherwise — the HUD names
 * which, so this honestly dogfoods the engine's WebGPU backend.
 */
import { Scene, ComputeParticleEntity } from '@vecto-ui/core';
import { FrameMeter } from './frame-meter';
import { keepSceneLive } from './keep-live';
import { sampleTextPoints } from './nexus/text-shape';
import { setupReporter } from './report';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;
const SHAPE_TEXT = 'VectoUI';
const FLOATS = 8; // per particle: pos.xy, vel.xy, origin.xy, size, life

function initNexus(): void {
  const canvas = $<HTMLCanvasElement>('nexus-canvas');
  const stage = $('stage');
  if (!canvas || !stage) return;

  // WebGPU compute drives the particles when available (core@0.9.2 fixed the
  // vertex storage-binding bug that used to blank the field); pointBackend 'webgl'
  // gives the CPU fallback a fast GPU-instanced point draw rather than per-particle
  // fillCircle. The HUD reports which compute backend actually ran.
  const scene = new Scene(canvas, { maxFPS: 60, pointBackend: 'webgl' });

  const meter = new FrameMeter();
  scene.add(meter);
  // The field animates every frame, so keep it live (defeats the 0.9.2 idle throttle).
  keepSceneLive(scene);

  let particles: ComputeParticleEntity | null = null;
  let count = 60000;
  let springK = 0.5;
  let damping = 0.85;
  let shape: 'text' | 'free' = 'text';

  /**
   * Lay the particles' spring origins onto the sampled text pixels AND seed their
   * positions there (with a little jitter), so the word is formed instantly. The
   * engine's spring integration is gentle, so relying on it to pull a full-screen
   * scatter into the letters would take many seconds; seeding positions makes the
   * shape immediate while the spring still handles cursor-repel and explosion reform.
   */
  const applyShape = (): void => {
    if (!particles || shape !== 'text') return;
    const pts = sampleTextPoints(SHAPE_TEXT, stage.clientWidth, stage.clientHeight);
    if (pts.length < 2) return;
    const n = pts.length / 2;
    const d = particles.particleData;
    for (let i = 0; i < particles.maxParticles; i++) {
      const p = (i % n) * 2;
      d[i * FLOATS] = pts[p] + (Math.random() - 0.5) * 3; // pos.x
      d[i * FLOATS + 1] = pts[p + 1] + (Math.random() - 0.5) * 3; // pos.y
      d[i * FLOATS + 2] = 0; // vel.x
      d[i * FLOATS + 3] = 0; // vel.y
      d[i * FLOATS + 4] = pts[p]; // origin.x
      d[i * FLOATS + 5] = pts[p + 1]; // origin.y
    }
    particles.needsInit = true; // re-upload to the GPU buffer on the next frame
  };

  const build = (): void => {
    if (particles) scene.remove(particles);
    particles = new ComputeParticleEntity({
      maxParticles: count,
      size: 1.5,
      color: '#7cb3ff',
      springK,
      damping,
      bounceDamping: 0.6,
      maxVelocity: 180,
    });
    scene.add(particles);
    particles.initRandomParticles(stage.clientWidth, stage.clientHeight);
    applyShape();
  };

  const fit = (): void => {
    scene.resize(stage.clientWidth, stage.clientHeight);
    if (!particles) build();
    else {
      particles.initRandomParticles(stage.clientWidth, stage.clientHeight);
      applyShape();
    }
  };

  // ---- zoom + pan (CSS transform on the canvas; the stage clips the overflow) ----
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const applyView = (): void => {
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };
  const clampPan = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    panX = Math.min(0, Math.max(w - w * zoom, panX));
    panY = Math.min(0, Math.max(h - h * zoom, panY));
  };
  // Cursor position in stage (untransformed) space, and the world (scene) point it maps to.
  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const sr = stage.getBoundingClientRect();
    return { sx: e.clientX - sr.left, sy: e.clientY - sr.top };
  };
  const toWorld = (sx: number, sy: number) => ({ wx: (sx - panX) / zoom, wy: (sy - panY) / zoom });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const { sx, sy } = stagePoint(e);
      const { wx, wy } = toWorld(sx, sy);
      zoom = Math.min(8, Math.max(1, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      panX = sx - wx * zoom; // keep the point under the cursor fixed
      panY = sy - wy * zoom;
      if (zoom === 1) {
        panX = 0;
        panY = 0;
      }
      clampPan();
      applyView();
    },
    { passive: false },
  );

  // Pointer drag pans; a click that didn't drag sends a gentle pulse at that world point.
  let down = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    down = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (zoom > 1) {
      panX += dx;
      panY += dy;
      clampPan();
      applyView();
    }
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = zoom > 1 ? 'grabbing' : 'default';
  });
  canvas.addEventListener('pointerup', (e) => {
    down = false;
    canvas.style.cursor = zoom > 1 ? 'grab' : 'default';
    if (!moved) {
      const { sx, sy } = stagePoint(e);
      const { wx, wy } = toWorld(sx, sy);
      particles?.triggerExplosion(wx, wy, 45);
    }
  });
  canvas.addEventListener('dblclick', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
  });

  window.addEventListener('resize', () => requestAnimationFrame(fit));

  // ---- HUD ----
  // Compute backend: WebGPU once the engine bug above is fixed, CPU for now.
  // (Rendering is always the WebGL point backend configured on the Scene.)
  const backend = (): string => (particles?.gpuStorageBuffer ? 'WebGPU' : 'CPU · WebGL');
  const set = (id: string, v: string) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  window.setInterval(() => {
    set('hud-particles', (particles?.maxParticles ?? 0).toLocaleString());
    set('hud-fps', String(Math.round(meter.fps)));
    set('hud-backend', backend());
    set('hud-dom', String(document.querySelectorAll('[data-vecto-id]').length));
  }, 500);

  // ---- controls ----
  const bind = (
    id: string,
    ev: 'input' | 'change' | 'click',
    fn: (el: HTMLInputElement) => void,
  ) => {
    const el = $<HTMLInputElement>(id);
    if (!el) return;
    el.addEventListener(ev, () => fn(el));
    if (ev !== 'click') fn(el);
  };
  bind('ctl-count', 'change', (el) => {
    count = Number(el.value);
    const o = $('out-count');
    if (o) o.textContent = count.toLocaleString();
    build();
  });
  // Live readout while dragging (rebuild only on release, above).
  bind('ctl-count', 'input', (el) => {
    const o = $('out-count');
    if (o) o.textContent = Number(el.value).toLocaleString();
  });
  bind('ctl-spring', 'input', (el) => {
    springK = Number(el.value);
    if (particles) particles.springK = springK;
    const o = $('out-spring');
    if (o) o.textContent = springK.toFixed(2);
  });
  bind('ctl-damping', 'input', (el) => {
    damping = Number(el.value);
    if (particles) particles.damping = damping;
    const o = $('out-damping');
    if (o) o.textContent = damping.toFixed(2);
  });
  bind('ctl-shape', 'change', (el) => {
    shape = el.checked ? 'text' : 'free';
    if (!particles) return;
    if (shape === 'text') applyShape();
    else {
      particles.initRandomParticles(stage.clientWidth, stage.clientHeight);
      particles.needsInit = true;
    }
  });
  // Frame cap (default 60 so the GPU isn't pegged; "Max" reveals the real ceiling).
  bind('ctl-fpscap', 'change', (el) => {
    scene.maxFPS = Number(el.value);
  });
  // Reform: snap the cloud back into the word (also handy after toggling Free).
  $('ctl-reform')?.addEventListener('click', () => {
    if (!$<HTMLInputElement>('ctl-shape')?.checked) {
      const cb = $<HTMLInputElement>('ctl-shape');
      if (cb) cb.checked = true;
      shape = 'text';
    }
    applyShape();
  });

  // ---- export a real-browser performance report ----
  const reportBtn = $('ctl-report');
  const reportPanel = $('report-panel');
  const reportPre = $('report-pre');
  if (reportBtn && reportPanel && reportPre) {
    setupReporter({
      button: reportBtn,
      panel: reportPanel,
      pre: reportPre,
      seconds: 4,
      frameSampler: { start: () => meter.startSampling(), stop: () => meter.stopSampling() },
      extra: () => ({
        particles: particles?.maxParticles ?? 0,
        backend: backend(),
        shape,
        springK,
        frameCap: scene.maxFPS >= 1000 ? 'max' : scene.maxFPS,
      }),
    });
  }

  // fit() resizes the Scene first (so updateCPU/compute get real bounds) then builds.
  fit();
  scene.start();

  if (location.search.includes('debug')) {
    const w = window as unknown as { __nexus: () => ComputeParticleEntity | null; __scene: Scene };
    w.__nexus = () => particles;
    w.__scene = scene;
    const hint = document.querySelector('.nexus-hint');
    window.setInterval(() => {
      const sc = scene as unknown as {
        width: number;
        height: number;
        gpuCanvas: HTMLCanvasElement | null;
        device: unknown;
      };
      const g = sc.gpuCanvas;
      // Decisive test: copy the WebGPU canvas into a 2D canvas and count the
      // pixels it actually drew. Tells us if the GPU render produced anything.
      let litGpu = -1;
      let litMain = -1;
      const sample = (src: HTMLCanvasElement | null): number => {
        if (!src || !src.width) return -1;
        const off = document.createElement('canvas');
        off.width = 300;
        off.height = 160;
        const o = off.getContext('2d');
        if (!o) return -1;
        try {
          o.drawImage(src, 0, 0, off.width, off.height);
        } catch {
          return -2;
        }
        const d = o.getImageData(0, 0, off.width, off.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] + d[i + 1] + d[i + 2] > 24 || d[i + 3] > 24) lit++;
        return lit;
      };
      litGpu = sample(g);
      litMain = sample(canvas);
      const gr = g?.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const txt =
        `dpr ${window.devicePixelRatio} · scene ${sc.width}x${sc.height} · gpu=${!!sc.device}\n` +
        `gpuCanvas ${g?.width}x${g?.height} @ ${
          gr ? `${Math.round(gr.left)},${Math.round(gr.top)}` : 'NONE'
        } · litPx ${litGpu}\n` +
        `2dCanvas ${Math.round(cr.width)}x${Math.round(cr.height)} · litPx ${litMain}`;
      if (hint) {
        (hint as HTMLElement).style.whiteSpace = 'pre';
        hint.textContent = txt;
      }
    }, 700);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNexus);
else initNexus();
