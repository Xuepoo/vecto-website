---
title: 'Particle Systems'
description: 'ComputeParticleEntity: WebGPU compute particles, CPU fallback, the 8-float memory layout, mouse interaction, and triggerExplosion.'
order: 6
---

# Particle Systems

`ComputeParticleEntity` is VectoUI's high-throughput particle layer. It runs a spring physics simulation entirely on the GPU via a WebGPU compute pass, with a transparent CPU fallback for browsers that do not support WebGPU. A single entity can simulate and render **100,000 to 1,000,000 particles** at 60 fps on modern hardware.

## Try it live

<figure class="sandbox">
  <div class="sandbox-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="sandbox-label">live · vecto-ui@0.9</span></div>
  <iframe src="/sandbox/particles.html" class="sandbox-frame" loading="lazy" title="Particle System interactive example" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption>8,000 spring particles with mouse repulsion. Move your cursor across the canvas — particles scatter 120 px away. Click to trigger an explosion impulse.</figcaption>
</figure>

## Particles vs `getBatchCircle`

|             | `ComputeParticleEntity`                       | `getBatchCircle` on a custom entity        |
| ----------- | --------------------------------------------- | ------------------------------------------ |
| Physics     | Built-in (spring, mouse repulsion, explosion) | Manual — you update position in `update()` |
| Backend     | WebGPU compute or CPU                         | WebGL point layer                          |
| Throughput  | 100k–1M                                       | 10k–100k                                   |
| When to use | Self-contained physics fields                 | Point clouds you control directly          |

If you need a particle field that springs into formations, reacts to the cursor, and triggers explosions, `ComputeParticleEntity` is the right tool. If you just want to render many dots at positions you control, implement `getBatchCircle()` on a custom entity.

## Basic setup

```typescript
import { Scene, ComputeParticleEntity } from '@vecto-ui/core';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;

const scene = new Scene(canvas, {
  particleBackend: 'auto', // 'webgpu' | 'cpu' | 'auto' (default: tries WebGPU, falls back)
  pointBackend: 'webgl', // needed for CPU fallback rendering
  maxFPS: 60,
});

const particles = new ComputeParticleEntity({
  maxParticles: 50_000,
  springK: 0.05, // spring pull toward origin (0–10)
  damping: 0.95, // velocity damping per step (0–1)
  bounceDamping: 0.5, // energy retained on boundary bounce (0–1)
  maxVelocity: 500, // speed clamp
  size: 3, // base particle radius in px
  color: '#00f0ff',
  pointerEvents: false, // true → entity captures hit events
});

scene.add(particles);
scene.start();

// IMPORTANT: resize before calling initRandomParticles
scene.resize(window.innerWidth, window.innerHeight);

// Scatter particles across the viewport
particles.initRandomParticles(scene.width, scene.height);

window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
});
```

> [!CAUTION] > `resize(w, h)` must be called **before** `initRandomParticles`. A `0×0` viewport means all particle positions default to `(0, 0)` and the simulation has no boundary to bounce off. `scene.start()` logs a one-time warning if width or height is zero.

## The 8-float memory layout

Each particle is 8 consecutive `float32` values in `entity.particleData`:

| Offset constant              | Index | Field      | Notes                                                        |
| ---------------------------- | ----- | ---------- | ------------------------------------------------------------ |
| `PARTICLE_OFFSET_POSITION_X` | 0     | position.x | Current world-space x                                        |
| `PARTICLE_OFFSET_POSITION_Y` | 1     | position.y | Current world-space y                                        |
| `PARTICLE_OFFSET_VELOCITY_X` | 2     | velocity.x |                                                              |
| `PARTICLE_OFFSET_VELOCITY_Y` | 3     | velocity.y |                                                              |
| `PARTICLE_OFFSET_ORIGIN_X`   | 4     | origin.x   | Spring rest/anchor point                                     |
| `PARTICLE_OFFSET_ORIGIN_Y`   | 5     | origin.y   |                                                              |
| `PARTICLE_OFFSET_SIZE`       | 6     | size       | Per-particle size override                                   |
| `PARTICLE_OFFSET_LIFE`       | 7     | life       | `-1` = perpetual; `≥0` decays at 0.5/s; `0` = dead (skipped) |

You can read and write `particleData` directly to set up custom formations. After writing, set `needsInit = true` to trigger a GPU upload on the next frame.

## Forming text shapes and patterns

`setOrigins()` is the primary way to make particles spring into a formation. Pass a flat `Float32Array` of alternating `[x0, y0, x1, y1, …]` pairs — one per particle:

```typescript
// Arrange 10,000 particles in a grid
const N = 10_000;
const cols = 100;
const origins = new Float32Array(N * 2);

for (let i = 0; i < N; i++) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  origins[i * 2] = 100 + col * 8; // x
  origins[i * 2 + 1] = 100 + row * 8; // y
}

particles.setOrigins(origins); // also uploads particleData to GPU
```

`setOrigins(points, requestPositionReset = true)` — the second argument controls whether particles also teleport to their new origins (useful for instant formation changes) or spring toward them from their current positions.

To set positions without changing origins, use `setPositions()`. To set initial velocities (e.g., a burst outward from the center), use `setVelocities()`.

All three methods write to `particleData` and set `needsInit = true`, so the data is uploaded to the WebGPU storage buffer on the next frame.

## Mouse interaction

When `pointerEvents: true`, the `Scene` passes cursor coordinates to the particle sim. Particles within **120 px** of the cursor are repelled:

```typescript
const particles = new ComputeParticleEntity({
  maxParticles: 100_000,
  pointerEvents: true,
});
scene.add(particles);
```

The repulsion radius and force are fixed in the shader. When the cursor leaves the canvas, the repulsion point is set to `(-99999, -99999)` so no repulsion is applied.

## Triggering explosions

`triggerExplosion(x, y, force)` queues an impulse for the next simulation step. All particles within **150 px** of `(x, y)` receive an outward velocity kick scaled by `force`:

```typescript
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  particles.triggerExplosion(
    e.clientX - rect.left,
    e.clientY - rect.top,
    800, // force magnitude
  );
});
```

Only one explosion can be queued at a time — calling `triggerExplosion` before the previous one has been consumed overwrites it.

## WebGPU vs CPU fallback

The `particleBackend` option controls which path is used:

| Value              | Behavior                                              |
| ------------------ | ----------------------------------------------------- |
| `'auto'` (default) | Tries WebGPU; falls back to CPU on failure or absence |
| `'webgpu'`         | Requires WebGPU; throws if unavailable                |
| `'cpu'`            | Forces CPU sim; disables WebGPU even if available     |

**When WebGPU is active:** The sim runs as a compute shader on the GPU. Particle state lives in a WebGPU storage buffer. Renders via the WebGL point layer. Throughput: 100k–1M particles.

**When CPU fallback is active:** The `Scene` calls `entity.updateCPU(dt, mouseX, mouseY, width, height)` each frame (same physics model — spring, repulsion, explosion, velocity cap, bounce). Renders via `fillCircle()` on Canvas2D or the WebGL point layer. Throughput: ~10k particles.

> [!NOTE]
> You can check which path is active: `particles.gpuStorageBuffer !== null` means WebGPU is running. `null` means CPU.

Device loss is auto-recovered with exponential backoff (3 retries) before permanently disabling WebGPU for the session.

### Reading particle positions back from the GPU

The particle state lives in a GPU buffer. You cannot read it back cheaply — a `mapAsync` + `copyBufferToBuffer` round-trip stalls the pipeline. If you need positions on the CPU (e.g., for collision detection with non-particle entities), keep a CPU-side `Float32Array` in sync by writing to `particleData` yourself and using `setPositions()`.

For large-scale spatial queries entirely within the particle system, write additional WebGPU compute passes. For collision with other entities, use `SpatialHashGrid` on the CPU path.

## GPU resource management

```typescript
// Clean up GPU buffers when done (e.g. on page unload or component teardown)
particles.destroyGPUResources();
scene.remove(particles);
```

`scene.destroy()` also calls `destroyGPUResources()` on all particle entities, so you only need to call it manually for mid-session teardown.

## TypeScript types for WebGPU

If your project uses WebGPU APIs and TypeScript reports `Cannot find name 'GPUDevice'`:

```bash
bun add -d @webgpu/types
```

```json
{ "compilerOptions": { "types": ["@webgpu/types"] } }
```

## Troubleshooting

### Nothing appears on screen

Check in order:

1. **`initRandomParticles()` was not called** — without this, all particle positions are `(0, 0)` and sizes are `0`.
2. **`resize(w, h)` was not called before `initRandomParticles`** — particles scattered across a `0×0` box are invisible. Check `scene.width` and `scene.height` are non-zero.
3. **WebGPU unavailable and no CPU fallback** — if `particleBackend: 'webgpu'` was set explicitly, the scene throws if WebGPU fails. Use `'auto'` to get the CPU path.
4. **`pointBackend` not set to `'webgl'`** — the CPU fallback renders via `fillCircle`. Without `'webgl'`, CPU-path particles still appear on Canvas2D, but only if the canvas renderer is active.

### FPS is much lower than expected

- Verify WebGPU is actually active: `console.log(particles.gpuStorageBuffer !== null)`.
- In headless / CI environments, WebGPU and WebGL fall back to software renderers (Swiftshader). FPS in headless is not representative. Measure on real GPU hardware.
- Try reducing `maxParticles` for profiling — CPU throughput caps at ~10,000.

### Particles spring to `(0, 0)` instead of my formation

`setOrigins()` and `setPositions()` both set `needsInit = true`, which uploads `particleData` to the GPU buffer on the next frame. If you call them **before** `scene.start()`, make sure `start()` is called afterward so the upload happens.
