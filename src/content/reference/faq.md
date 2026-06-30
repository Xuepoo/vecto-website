---
title: 'FAQ'
description: 'Frequently asked questions about VectoUI — architecture decisions, performance, accessibility, and troubleshooting.'
order: 3
---

# Frequently Asked Questions

## Architecture

### Why canvas instead of the DOM?

The DOM renders a flat list of CSS-styled boxes. For high-density UIs — thousands of individually animated items, physics simulations, or tight layout math — the browser's layout engine becomes the bottleneck. A canvas context is a blank buffer: VectoUI draws precisely what the math says, at predictable cost. You trade declarative CSS for predictable performance and complete layout control.

### How does accessibility work if everything is drawn on canvas?

`Scene` maintains a **shadow DOM** — a transparent overlay of real `<button>`, `<input>`, `<a>`, and `<div>` elements positioned exactly above every interactive entity. These invisible nodes receive all real pointer, keyboard, and focus events from the browser, which are then re-dispatched into the VectoUI event system. Screen readers, browser DevTools, and automation frameworks (Playwright's `page.getByRole()`) see the shadow nodes and work normally without any special adapters.

Set `entity.interactive = true` to project a shadow node. Override `getA11yAttributes()` to control the tag and ARIA attributes:

```typescript
getA11yAttributes() {
  return { tag: 'button', role: 'button', label: 'Submit form' };
}
```

### Is there a React / Vue / Svelte integration?

Not yet as first-party packages. Because VectoUI owns a `<canvas>` element, it integrates with any framework exactly like a WebGL library would — mount the canvas, initialize a `Scene` in a lifecycle hook (`useEffect`, `onMounted`, etc.), and tear it down on unmount.

```typescript
// React example
import { useEffect, useRef } from 'react';
import { Scene } from '@vecto-ui/core';

export function VectoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scene = new Scene(canvasRef.current!, { maxFPS: 60 });
    scene.start();
    return () => scene.destroy();
  }, []);
  return <canvas ref={canvasRef} />;
}
```

---

## Performance

### How many entities can VectoUI handle at 60 fps?

It depends on backend and workload:

| Backend                        | Typical capacity at 60 fps      |
| ------------------------------ | ------------------------------- |
| Canvas2D (default)             | ~5,000–20,000 simple entities   |
| WebGL `pointBackend: 'webgl'`  | ~100,000–500,000 batch circles  |
| WebGPU `ComputeParticleEntity` | 100,000–1,000,000 GPU particles |

The Canvas2D number assumes entities with simple `fill`/`stroke` calls. Entities that use `fillText` or complex paths are slower. Enable `getBatchCircle()` / `getBatchRect()` for point-cloud data, and use `ComputeParticleEntity` for particle systems.

### What is the `pointBackend: 'webgl'` option?

When set, the `Scene` stacks a transparent WebGL2 canvas over the main Canvas2D canvas. Entities that implement `getBatchCircle()` are pulled out of the 2D render tree and drawn in a single instanced draw call on the WebGL layer. This yields 10–100× throughput for particle-like entities (circles, dots) while the 2D canvas handles text, images, and complex shapes.

### What is `renderMode: 'onDemand'`?

In `'onDemand'` mode the `rAF` loop only wakes when `scene.markDirty()` is called or an `animate()` tween is in progress. Idle scenes cost exactly zero CPU and GPU. Use this for mostly-static UIs — dashboards, forms, menus.

```typescript
scene.renderMode = 'onDemand';
entity.on('click', () => {
  entity.animate({ x: entity.x + 50 }, 300); // triggers dirty automatically
});
```

### Why is my FPS low when testing in Node.js / headless?

Headless Chrome uses a software rasterizer (Swiftshader or CPU Canvas2D). FPS reported there is a floor, not a realistic number. Always measure on real GPU hardware. Export the FPS from the scene's `onFrame` callback and collect numbers in-browser.

> [!TIP]
> Use the **Export report** button in the Nexus demo to get a real GPU measurement with your current hardware and browser. Copy-paste those numbers into your PRs instead of headless FPS.

---

## The Entity API

### What is `clipChildren`?

Setting `clipChildren = true` clips all children to the entity's `[0,0]–[width,height]` box during Canvas2D rendering. This is how `ScrollView` implements overflow: the content child is translated by the scroll offset, and everything outside the viewport is invisible. It is Canvas2D-only; WebGL/WebGPU rendering is unaffected.

### What is `a11yFullViewport`?

Normally a shadow DOM node is only projected when `entity.interactive && entity.width > 0`. For entities that cover the entire viewport (an infinite-canvas graph, a full-screen gesture recognizer) there is no meaningful bounding box. Setting `a11yFullViewport = true` creates a 100vw × 100vh shadow node behind all other shadow nodes, so on-top components remain clickable while the surface entity receives global pointer events.

### My `Entity.update()` animation is twice as fast as expected — why?

> [!CAUTION] > `Entity.update(dt, time)` receives **dt in milliseconds**, not seconds. This is the single most common VectoUI gotcha. `dt` at 60 fps ≈ 16.7, not 0.017.

A common mistake when porting from physics libraries that use seconds:

```typescript
// Wrong: treats ms as seconds → 1000× too fast
this.x += velocity * dt;

// Correct: convert to seconds, or use ms units
this.x += velocity * (dt / 1000);
```

Spring physics (`SpringPhysics`, `ScrollView`) internally use `dt / 1000` to convert before running their simulations.

### What is the difference between `emit()` and `dispatchEvent()`?

- `entity.emit(event, payload)` — fires the entity's own **bubble-phase** listeners only. No tree traversal. This is a component-internal path (e.g., a form control emitting its own `change`).
- `entity.dispatchEvent(event)` — runs the full DOM-like **capture + bubble** traversal: capture goes root → target, bubble goes target → root. This is how `Scene` dispatches pointer events.

---

## Accessibility & Automation

### How do I make a component work with Playwright's `page.getByRole()`?

Return the correct tag and role from `getA11yAttributes()`:

```typescript
// Accessible button
getA11yAttributes() { return { tag: 'button', role: 'button', label: 'Send' }; }

// Accessible link
getA11yAttributes() { return { tag: 'a', role: 'link', label: 'Home', href: '/' }; }

// Accessible text field
getA11yAttributes() { return { tag: 'input', inputType: 'text', placeholder: 'Search…' }; }
```

Built-in components (`Button`, `Input`, `Link`, etc.) do this automatically.

### The shadow node position looks wrong — entities are offset

Two common causes:

1. **The canvas parent is not `position: relative`** — `Scene` enforces this automatically on every frame, but if another CSS rule forces `position: static` after the scene starts, the absolutely-positioned shadow nodes will be offset relative to the wrong containing block.
2. **`a11yOffsetX` / `a11yOffsetY`** — if you previously set these as a workaround, try removing them first to see if the underlying positioning is actually correct.

Enable `debugA11y: true` in the `SceneOptions` to see translucent highlight boxes over each shadow node:

```typescript
const scene = new Scene(canvas, { debugA11y: true });
```

---

## WebGPU Particles

### `ComputeParticleEntity` shows nothing — what's wrong?

The most common causes:

1. **`initRandomParticles()` was not called** — without initializing particle data, all positions are `(0,0)` and sizes are `0`.
2. **WebGPU is not available** — the scene silently falls back to the CPU/Canvas2D path; make sure `particleBackend: 'webgpu'` is set and your browser supports WebGPU.
3. **The canvas size is `0×0`** — call `scene.resize(w, h)` (or ensure the canvas has dimensions) before the first frame.

### How does the CPU fallback work?

When WebGPU is unavailable (or fails), `Scene` calls `entity.updateCPU(dt, mouseX, mouseY, width, height)` each frame and renders each particle as a circle through `fillCircle`. The physics model is identical to the GPU shader — spring-to-origin, mouse repulsion within 120 px, explosion impulse within 150 px, velocity cap, boundary bounce. The only difference is throughput: CPU handles ~10,000 particles smoothly; GPU handles 100,000–1,000,000.

### Can I read back particle positions from the GPU?

Not directly — the particle state lives in a WebGPU storage buffer. To read it back you would need to issue a `copyBufferToBuffer` + `mapAsync` round-trip, which stalls the GPU pipeline. Instead, keep a CPU-side `particleData` Float32Array in sync if you need positions on the CPU. `setOrigins()`, `setPositions()`, and `setVelocities()` write to `particleData` and set `needsInit = true`, which uploads to the GPU storage buffer on the next frame.

> [!NOTE] > `mapAsync` + `copyBufferToBuffer` readback intentionally blocks the pipeline. For collision detection or spatial queries at scale, run those on the CPU path using `SpatialHashGrid`, or express them as additional WebGPU compute passes.

---

## Troubleshooting

### `Scene` is running but nothing appears on screen

Check in order:

1. Is `scene.start()` called?
2. Does the canvas have non-zero `width` and `height` CSS and HTML attributes?
3. Is the entity added to the scene via `scene.add(entity)` (not just constructed)?
4. Does the entity's `render()` method actually call `renderer.fill()` or `renderer.stroke()`? An empty `render()` draws nothing.
5. Is `entity.opacity` > 0?

### My scroll wheel event doesn't reach the `ScrollView`

The `ScrollView` calls `e.preventDefault()` on `wheel` events to prevent page scroll. If the shadow node's wheel listener fires but the scroll view doesn't react, verify that `ScrollView.add(child)` was used (not `entity.add(child)` directly bypassing the content wrapper), and that the canvas parent doesn't have `overflow: hidden` blocking pointer events.

### TypeScript reports `Cannot find name 'GPUDevice'`

Add `@webgpu/types` to your project:

```bash
bun add -d @webgpu/types
```

Then add to `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["@webgpu/types"] } }
```
