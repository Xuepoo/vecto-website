---
title: 'Performance'
description: 'Render modes, the idle auto-throttle, WebGL batch rendering, viewport culling, text performance, and how to measure real GPU throughput.'
order: 7
---

# Performance

VectoJS is designed to be fast by default, but several opt-in mechanisms unlock significantly higher throughput. This page explains the knobs available, the hidden pitfall that catches most developers, and how to measure performance accurately.

## Render modes

The `Scene` supports two render modes, set via `scene.renderMode` after construction:

```typescript
scene.renderMode = 'always'; // default — rerender every frame
scene.renderMode = 'onDemand'; // rerender only when dirty or tweening
```

### `'always'` mode

The rAF loop fires every frame, capped by `maxFPS` (default 60). Use this for:

- Continuous animation (particle sims, physics)
- Real-time data feeds
- Any scene where something is always moving

### `'onDemand'` mode

The rAF loop only renders when `scene.markDirty()` has been called since the last frame, or when an `animate()` tween is in progress. Idle frames cost **zero CPU and GPU**. Use this for:

- Static or event-driven UIs (dashboards, forms, menus)
- Scenes that animate in response to user actions but are otherwise still

```typescript
scene.renderMode = 'onDemand';

button.on('click', () => {
  button.animate({ scaleX: 1.1, scaleY: 1.1 }, 100).animate({ scaleX: 1, scaleY: 1 }, 100);
  // animate() marks dirty automatically while the tween runs
});

input.on('change', () => {
  scene.markDirty(); // repaint to show new caret/selection state
});
```

## The idle auto-throttle (the hidden pitfall)

This is the most common performance trap in VectoJS.

In `'always'` mode, a scene is considered **static** when:

- The `dirty` flag is `false`, AND
- No entity has a pending `animate()` tween.

A static scene is throttled to **~2 fps** to save battery and GPU. The `dirty` flag is reset to `false` at the end of every rendered frame (post-render).

**The trap:** if you hand-animate by mutating `entity.x` inside a custom `update()` method, calling `markDirty()` inside `update()` does not keep the scene alive. The flag is set during `update()`, then cleared by the post-render reset, then the static check sees `dirty = false` and throttles to 2 fps.

```typescript
// Wrong: markDirty() inside update() is wiped by the post-render reset
class Spinner extends Entity {
  update(dt: number, time: number) {
    super.update(dt, time);
    this.rotation += dt * 0.003;
    this.scene?.markDirty(); // ← too late; cleared before next static check
  }
}
```

**Fix — option A:** Use `animate()` for the motion instead of manual mutations. A running tween keeps the scene alive automatically:

```typescript
// Correct: animate() keeps hasPendingAnimations() true
entity.animate({ rotation: Math.PI * 2 }, 1000);
```

**Fix — option B:** Call `markDirty()` **between frames** — from an event handler, a `setInterval`, or a separate `requestAnimationFrame` that fires after the scene's own rAF:

```typescript
// Correct: call markDirty between frames (not inside update)
setInterval(() => scene.markDirty(), 16); // external driver
```

**Fix — option C:** Switch to `renderMode: 'always'` and set `maxFPS` to prevent the static throttle (the idle throttle only applies when `maxFPS > 0`; setting `maxFPS = 0` uncaps and always rerenders):

```typescript
scene.maxFPS = 0; // uncapped — never throttles to 2 fps
```

## `maxFPS` and reduced motion

```typescript
const scene = new Scene(canvas, {
  maxFPS: 60, // frame rate cap; 0 = uncapped
  respectReducedMotion: true, // default: true
});
```

When `respectReducedMotion: true` (default) and the user has enabled "reduce motion" in their OS accessibility settings, the effective FPS is capped at **30** (or the lower of `maxFPS` and 30). You can disable this with `respectReducedMotion: false`, but doing so ignores an explicit user preference.

`maxFPS` is also settable live: `scene.maxFPS = 30` for battery-saving mode.

## WebGL batch rendering

For entities that are circles or rectangles positioned by your code (not by a physics sim), the WebGL batch layer is 10–100× faster than individual `render()` calls.

### Enabling the batch layer

```typescript
const scene = new Scene(canvas, {
  pointBackend: 'webgl', // stacks a WebGL2 canvas over Canvas2D
});
```

### Opting an entity in

Override `getBatchCircle()` or `getBatchRect()` instead of `render()`:

```typescript
class Dot extends Entity {
  radius = 4;
  color = '#00f0ff';

  // These are read every frame — animated values work.
  getBatchCircle() {
    return { radius: this.radius, color: this.color };
  }

  // Still required (but never called when getBatchCircle is set)
  isPointInside() {
    return false;
  }
  render() {}
}
```

The Scene reads `getBatchCircle()` / `getBatchRect()` every frame and feeds the world-space coordinates (calculated from the accumulated transform matrix) to the WebGL layer. Consecutive entities returning the **same color and alpha** coalesce into a single GPU draw call.

**Constraints:**

- The entity must be a **leaf** (no children).
- The entity's scale must be **uniform** (`scaleX === scaleY`).
- Requires `pointBackend: 'webgl'` on the Scene.

The WebGL layer composites **above** the Canvas2D content (`z-index: 5`), so batch primitives always draw on top of 2D content, regardless of tree order.

### `getBatchRect()` for rectangles

```typescript
getBatchRect() {
  return { width: this.width, height: this.height, color: this.color };
}
```

Batch rects also support per-entity `rotation` (the Scene passes the world-space rotation angle to the WebGL layer).

## Viewport culling with `getBounds()`

By default, every entity runs `update()` and `render()` every frame, even if it is completely off-screen. Override `getBounds()` to return a local-space bounding box and the Scene will skip offscreen entities entirely:

```typescript
getBounds() {
  return { x: 0, y: 0, width: this.width, height: this.height };
}
```

`UIComponent` already implements this — all `@vectojs/ui` components participate in culling automatically. For raw `Entity` subclasses with a fixed size, add `getBounds()` for free performance on large scenes.

At 60 fps with 5,000 entities and 90% offscreen, culling reduces render calls from 5,000 to ~500 per frame.

## A11y sync throttling

On every rendered frame, the `Scene` syncs all interactive entities' positions and states to their shadow DOM nodes. With hundreds of interactive entities animating simultaneously, this DOM write overhead can dominate frame time.

Throttle with `a11ySyncInterval`:

```typescript
const scene = new Scene(canvas, {
  a11ySyncInterval: 100, // sync at most once per 100 ms
});
// Or set live:
scene.a11ySyncInterval = 100;
```

The sync also **freezes entirely while any `animate()` tween is running** and resumes when the tween settles, preventing layout thrash during kinetic animations. For most UIs, `a11ySyncInterval: 100` is imperceptible to users while cutting sync overhead by ~6×.

## Text performance

### `setMaxWidth()` — the hot path for reflow

The `LayoutEngine` separates measurement (cold) from layout (hot). When the window resizes and text needs to reflow:

```typescript
// Wrong: rebuilds the full measured text on every resize event
window.addEventListener('resize', () => {
  label.setText(label.text); // cold pass — re-segments and re-measures
});

// Correct: reuses cached measurements, only recalculates line breaks
window.addEventListener('resize', () => {
  label.setMaxWidth(newWidth); // hot pass — cheap
});
```

The hot path is O(word count), not O(glyph count), and avoids all `Intl.Segmenter` and canvas `measureText` calls.

### `LayoutResultBuffer` — zero-GC text at scale

For data-dense UIs (data grids, terminals, log viewers) with thousands of glyphs per frame, the standard `layoutPrepared()` path allocates a `LayoutNode` object per glyph. Use `LayoutResultBuffer` instead:

```typescript
import { LayoutEngine, LayoutResultBuffer, createCanvasMeasurer } from '@vectojs/core/layout';

const engine = new LayoutEngine(400, Infinity, createCanvasMeasurer());
const buffer = new LayoutResultBuffer(); // reuse across frames (CAPACITY = 16384)

function renderRow(text: string) {
  const prepared = engine.prepare(text, {}, 14);
  buffer.reset();
  engine.layoutPreparedIntoBuffer(prepared, buffer);
  // buffer.xs, buffer.ys, buffer.ws, buffer.hs, buffer.chars — flat typed arrays
  for (let i = 0; i < buffer.count; i++) {
    renderer.fillText(buffer.chars[i], buffer.xs[i], buffer.ys[i], '14px monospace', '#e2e8f0');
  }
}
```

The buffer path produces zero heap allocations per frame. Constraints: single-column only (no BiDi visual reordering, no exclusion rects). Use `layoutPrepared()` when you need those features.

## CPU Calculation vs. Rendering Bottlenecks

In a traditional browser DOM framework, performance bottlenecks almost always lie in the browser’s **rendering and reflow layout pipeline** (DOM manipulations, style recalculation, and painting). However, because VectoJS bypasses the DOM entirely and processes layout, culling, and interactions mathematically in memory, the performance bottleneck shifts from the GPU/rendering layer directly to **JavaScript single-threaded CPU computation**.

When rendering tens of thousands or hundreds of thousands of active nodes, CPU-side mathematical operations can easily exceed the frame budget of $16.67\text{ ms}$ (required for 60 FPS), while the underlying Canvas2D or WebGL graphics rasterizer remains idling.

VectoJS addresses these computation bottlenecks from first principles by providing dedicated **"Escape Hatches"** to bypass CPU single-thread limitations.

---

### 1. High-Density Physics & Particle Simulations ($N$-Body Computation)

**The Bottleneck**: Simulating spring physics, mouse gravity attraction, or inter-particle collision queries for thousands of entities inside Javascript's main thread is computationally prohibitive. At $N = 10,000$ particles, the naive $O(N^2)$ distance query or even standard $O(N)$ integrations will saturate a single CPU thread, causing frame rates to collapse well below 60 FPS.

**The Escape Hatch: WebGPU Compute Shaders (`ComputeParticleEntity`)**
To bypass CPU execution entirely, VectoJS provides `ComputeParticleEntity`. Under the hood:

- The physics equations (Euler integration, spring tension, and field attraction forces) are compiled into **WGSL (WebGPU Shading Language) Compute Shaders**.
- At runtime, the data remains resident on GPU VRAM, allowing the WebGPU compute pass to parallelize the simulation across thousands of GPU cores.
- This architecture offloads CPU calculation entirely to the GPU, enabling smooth 60 FPS simulations of **100,000 to 1,000,000 physical particles** concurrently.

---

### 2. High-Density Text Measuring and Typographical Reflow

**The Bottleneck**: Dynamic text layout is one of the most expensive CPU tasks in frontend engineering. It requires dictionary-based word tokenization (`Intl.Segmenter`), BiDi sorting, and browser-level font width measurements (calling the canvas `measureText` API). Attempting to calculate text layouts for tens of thousands of glyphs in a single frame (such as in financial terminals, active log streams, or data grids) will freeze the JS main thread on the "Cold Pass" measurement pipeline.

**The Escape Hatch: Multi-Threaded Workers, Split Layouts & Zero-GC Memory**
VectoJS provides three levels of text optimization:

- **Off-Thread Layouts (`LayoutWorkerManager`)**: Extremely expensive multi-line typographical layouts can be fully delegated to a pool of background Web Workers. The worker performs segmentation and glyph measurement on background threads, returning a serialized transform coordinate buffer to the main thread, keeping the main UI thread completely responsive.
- **Cold/Hot Separation**: VectoJS separates layouts into "Cold" (text parsing & glyph width measurement) and "Hot" (wrapping computations). When text wraps due to resize, the cold results are reused, avoiding all browser measurement APIs and bringing resize layout complexity to pure $O(\text{word count})$.
- **Zero-GC TypedArray Buffers (`LayoutResultBuffer`)**: To prevent garbage collection (GC) pauses caused by allocating thousands of temporary layout node objects, developers can use the `LayoutResultBuffer` API. This writes layout coordinates directly into pre-allocated, flat TypedArrays, achieving zero heap allocations per frame.

---

### 3. Sea of Entities Interaction ($O(N^2)$ Complexity Catastrophe)

**The Bottleneck**: When you have $100,000$ active nodes, calculating mouse hover selection or entity-to-entity collisions naively requires nested loops. Testing every element against every other element represents a classic $O(N^2)$ complexity catastrophe. For $100,000$ nodes, $O(N^2)$ means **10 billion operations per frame**—instantly crashing the browser tab.

**The Escape Hatch: Spatial Hashing Grid (`SpatialHashGrid`)**
To solve this, VectoJS indexes all entities using an ultra-fast **Spatial Hashing Grid**:

- The 2D coordinate space is discretized into a dynamic hash table indexed by large primes.
- For click detection, the engine only queries the single cell containing the pointer coordinates and its 8 immediate neighboring cells.
- For local entity-to-entity interactions, elements only query their localized hash grid cells.
- This algorithms-based optimization reduces culling, picking, and local physics complexity from **$O(N)$ or $O(N^2)$ to an average of $O(1)$**, maintaining constant-time operations regardless of total scene density.

---

## Measuring real performance

> [!WARNING]
> Headless Chrome (used in CI and Node.js tests) runs a software rasterizer (Swiftshader). Canvas2D and WebGL ops execute on the CPU. FPS measured in headless is a **floor**, not a realistic number.

For accurate throughput numbers:

1. Run the demo in a real browser on real GPU hardware.
2. Use the **Export report** button in the Nexus demo to emit a machine-readable FPS record with your current GPU/browser combination.
3. When citing performance numbers in PRs or documentation, use in-browser measurements — not headless output.

For custom benchmarks, collect frame times in the `update()` loop:

```typescript
const samples: number[] = [];

class BenchEntity extends Entity {
  update(dt: number, time: number) {
    super.update(dt, time);
    if (samples.length < 300) samples.push(dt);
    if (samples.length === 300) {
      const avg = samples.reduce((a, b) => a + b) / samples.length;
      console.log(`avg frame: ${avg.toFixed(2)} ms  (${(1000 / avg).toFixed(1)} fps)`);
    }
  }
}
```

`dt` is in milliseconds; `1000 / dt` gives instantaneous FPS.

## Quick reference: which knob for which problem

| Symptom                                 | Fix                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Scene throttles to 2 fps when idle      | Expected — use `markDirty()` between frames, not inside `update()`     |
| Manually animated entity drops to 2 fps | Call `markDirty()` from an event handler or timer, not from `update()` |
| Static UI wastes battery                | Switch to `renderMode: 'onDemand'`                                     |
| 10k+ circles are slow                   | Add `pointBackend: 'webgl'` + implement `getBatchCircle()`             |
| Offscreen entities waste CPU            | Implement `getBounds()` on the entity                                  |
| DOM write overhead during animation     | Set `a11ySyncInterval: 100`                                            |
| Text reflow on resize is slow           | Use `setMaxWidth()` instead of `setText()`                             |
| 10k+ text glyphs cause GC pauses        | Use `LayoutResultBuffer` + `layoutPreparedIntoBuffer()`                |
| FPS looks wrong in CI                   | Measure on real GPU hardware — headless is a floor                     |
| 10k+ dynamic particles freeze CPU       | Use `ComputeParticleEntity` to offload physics simulation to WebGPU    |
| Multi-line text reflow freezes thread   | Delegate layouts off-thread using `LayoutWorkerManager`                |
| Sea of entities interaction is $O(N^2)$ | Implement a `SpatialHashGrid` to reduce complexity to average $O(1)$   |
