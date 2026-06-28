/**
 * Nexus — a WebGPU particle field. The stage is one VectoUI <canvas> running a
 * ComputeParticleEntity: tens of thousands of particles spring toward their
 * origins, scatter away from the cursor, and burst on click. The Scene runs the
 * simulation on a WebGPU compute pass when available (dispatchWorkgroups),
 * falling back to a CPU step otherwise — the HUD shows which. Dogfoods the
 * engine's WebGPU backend on real hardware.
 */
import { Scene, ComputeParticleEntity } from '@vecto-ui/core';
import { FrameMeter } from './frame-meter';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

function initNexus(): void {
  const canvas = $<HTMLCanvasElement>('nexus-canvas');
  const stage = $('stage');
  if (!canvas || !stage) return;

  const scene = new Scene(canvas, { maxFPS: 60 });
  const particles = new ComputeParticleEntity({
    maxParticles: 60000,
    size: 1.6,
    color: '#7cb3ff',
    springK: 0.035,
    damping: 0.86,
    bounceDamping: 0.6,
    maxVelocity: 800,
  });
  const meter = new FrameMeter();
  scene.add(particles);
  scene.add(meter);

  const fit = (): void => {
    scene.resize(stage.clientWidth, stage.clientHeight);
    particles.initRandomParticles(stage.clientWidth, stage.clientHeight);
  };

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    particles.triggerExplosion(e.clientX - r.left, e.clientY - r.top, 60000);
  });
  window.addEventListener('resize', () => requestAnimationFrame(fit));

  const backend = (): string => (particles.gpuStorageBuffer ? 'WebGPU' : 'CPU');
  const set = (id: string, v: string) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  window.setInterval(() => {
    set('hud-particles', particles.maxParticles.toLocaleString());
    set('hud-fps', String(Math.round(meter.fps)));
    set('hud-backend', backend());
    set('hud-dom', String(document.querySelectorAll('[data-vecto-id]').length));
  }, 500);

  fit();
  scene.start();
  window.setTimeout(() => {
    const gpu = !!(navigator as unknown as { gpu?: unknown }).gpu;
    console.log(`[nexus] backend=${backend()} navigator.gpu=${gpu}`);
  }, 2500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNexus);
else initNexus();
