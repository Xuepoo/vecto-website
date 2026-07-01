---
title: '@vectojs/core API Reference'
description: 'Complete API reference for Scene, Entity, LayoutEngine, renderers, particles, text, and math utilities.'
order: 1
---

# `@vectojs/core` API Reference

The zero-DOM rendering engine behind Vecto. A `Scene` owns a tree of `Entity`
nodes (the **Virtual Math Tree**), drives a `requestAnimationFrame` loop, paints
through a backend-agnostic `IRenderer` (Canvas 2D by default), and projects a
transparent ARIA/automation shadow layer so the canvas stays accessible and
agent-drivable.

> This file is generated from the published `.d.ts` (public surface) and the
> `packages/core/src` source (behavior). Signatures here override anything in the
> narrative `docs/usage/*` guides — in particular the real constructor is
> `new Scene(canvasElement, options)`, **not** the `{ canvasId }` form some older
> prose shows.

## Entry points & module map

`@vectojs/core` ships one side-effecting main entry plus three tree-shakeable
subpaths:

| Import                   | Contents                                                                                                                                              | Side effect                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@vectojs/core` (`.`)    | Everything: `Scene`, `Entity`, all entities, renderers, layout, text.                                                                                 | On import, auto-registers **both** pluggable backends (WebGL point renderer + WebGPU particle manager). |
| `@vectojs/core/layout`   | `LayoutEngine`, `PreparedText`, `createCanvasMeasurer`, `LayoutResultBuffer`, `LayoutWorkerManager`, `computeLineSegments`, layout types.             | None.                                                                                                   |
| `@vectojs/core/renderer` | `IRenderer`, `CanvasRenderer`, `SVGRenderer`, `PointRenderer`, `createWebGLPointRenderer`, `WebGPUParticleSystemManager`, `parseColorToRGBA`, `RGBA`. | None.                                                                                                   |
| `@vectojs/core/text`     | `MSDFFont`, `MSDFTextEntity`, `SVGEntity`, `ArabicShaper`, `BidiResolver`, MSDF types.                                                                | None.                                                                                                   |

**Gotcha:** the backend auto-registration lives only in the `.` entry
(`Scene.registerWebGLPointRendererCreator(createWebGLPointRenderer)` and
`Scene.registerWebGPUParticleSystemManager(WebGPUParticleSystemManager)` run on
import). If you construct a `Scene` after importing only subpaths, register the
backends yourself or `pointBackend: 'webgl'` / WebGPU particles silently fall
back.

---

## Scene

```ts
new Scene(canvas: HTMLCanvasElement, options?: SceneOptions)
```

Top-level orchestrator. One `Scene` per `<canvas>`. Add `Entity` objects with
`add()`, then `start()` the loop.

```ts
const scene = new Scene(document.querySelector('canvas')!);
scene.add(new CircleEntity().setPosition(100, 100));
scene.start();
```

The Scene appends two transparent sibling `<div>`s into the canvas's
**parent** element (for the a11y shadow layer at `z-index:10` and the DOM-portal
layer at `z-index:9`), and forces the parent to `position:relative` if it is
`static`. In SSR/Node (no `document`) the a11y/portal projection degrades to a
no-op so headless layout / `toSVG()` still work.

### SceneOptions

| Option                 | Type                          | Default          | Effect                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pointBackend`         | `'canvas' \| 'webgl'`         | `'canvas'`       | Backend for `getBatchCircle()`/`getBatchRect()` point clouds. `'webgl'` stacks a WebGL2 canvas (`z-index:5`) drawing all such primitives in a few draw calls (10–100× for 100k+). Auto-falls back to `'canvas'` if WebGL2 is unavailable. The GL layer composites **above** the 2D content, so its points do not interleave per-entity with 2D draws. |
| `particleBackend`      | `'auto' \| 'webgpu' \| 'cpu'` | `'auto'`         | `ComputeParticleEntity` backend. `'auto'` tries WebGPU, falls back to CPU on failure/absence. `'cpu'` forces the CPU sim (sets `webgpuDisabled`).                                                                                                                                                                                                     |
| `maxFPS`               | `number`                      | `60`             | Frame-rate cap. `0` = uncapped (native refresh). Continuous animations still run, just less often. (Internally `0` under `NODE_ENV=test`/`VITEST`.) Also settable live via `scene.maxFPS`.                                                                                                                                                            |
| `respectReducedMotion` | `boolean`                     | `true`           | When the OS requests `prefers-reduced-motion`, cap to `REDUCED_MOTION_FPS` (30) — or the lower of that and `maxFPS`. `false` ignores the OS setting.                                                                                                                                                                                                  |
| `a11ySyncInterval`     | `number`                      | `0`              | Throttle the a11y shadow-DOM sync to at most once per N ms. `0` = sync every rendered frame. A small value (e.g. `100`) keeps the a11y layer eventually consistent during heavy animation while sparing per-frame DOM writes. Also live via `scene.a11ySyncInterval`.                                                                                 |
| `debugA11y`            | `boolean`                     | `false`          | Render shadow nodes with a blue dashed outline (dev aid) instead of `opacity:0`. They stay clickable by automation either way.                                                                                                                                                                                                                        |
| `renderer`             | `IRenderer`                   | `CanvasRenderer` | Custom renderer (e.g. `ThreeRenderer` from `@vectojs/three`).                                                                                                                                                                                                                                                                                         |
| `disableWindowResize`  | `boolean`                     | `false`          | Skip the auto `window` resize listener. Use inside a custom layout container / offscreen canvas, then drive size with `resize(w, h)`.                                                                                                                                                                                                                 |

Note: `renderMode` is a **public field** (default `'always'`), not a constructor
option — set `scene.renderMode = 'onDemand'` after construction.

### Public fields

```ts
scene.canvas: HTMLCanvasElement
scene.width: number
scene.height: number
scene.overlayRoot: Entity          // children drawn above the main tree, bypassing clip bounds
scene.renderMode: 'always' | 'onDemand'   // default 'always'
scene.maxFPS: number               // default 60
scene.respectReducedMotion: boolean
scene.a11ySyncInterval: number
scene.particleBackend: 'auto' | 'webgpu' | 'cpu'
scene.webgpuDisabled: boolean      // getter true when _disabled OR particleBackend === 'cpu'
scene.a11yNeedsReorder: boolean
```

### renderMode, maxFPS, and the idle auto-throttle

- **`renderMode: 'always'` (default)** — re-render every frame, capped by the
  effective FPS.
- **`renderMode: 'onDemand'`** — only render when the scene is _dirty_ (see
  `markDirty()`) or an `animate()` tween is pending. Idle frames cost ~0. Ideal
  for static / event-driven UIs.

**Idle auto-throttle (the key gotcha).** A scene is considered **static** when it
is not dirty AND no node in the main/overlay tree has a pending `animate()`
tween. In `'always'` mode with `maxFPS > 0`, a static scene is throttled to
**~2 fps** to save battery/GPU. The `dirty` flag is reset to `false` at the end
of every rendered frame (post-render), so:

> If you hand-animate by mutating `entity.x` etc. inside a custom `update()`,
> calling `markDirty()` **inside** `update()` does not help — the post-render
> reset wipes it, and the next frame's static check sees `dirty === false` and
> throttles you to 2 fps. Either drive motion through `entity.animate()` (which
> keeps the scene non-static while the tween runs), or call `scene.markDirty()` > **between** frames (from an event handler, a separate `rAF`, or a timer) so the
> flag survives into the next loop iteration.

`effectiveMaxFPS` = `maxFPS`, further lowered to 30 (`REDUCED_MOTION_FPS`) when
the OS requests reduced motion and `respectReducedMotion` is on. `0` means
uncapped.

### Lifecycle methods

```ts
scene.add(entity: Entity): this              // attach to the scene root
scene.remove(entity: Entity): this           // detach + recursively tear down its a11y shadow nodes
scene.start(): void                          // begin the rAF loop; idempotent; warns once if width/height is 0
scene.stop(): void                           // halt after the current frame; start() resumes
scene.destroy(): void                        // tear down loop, listeners, a11y/portal/GL/GPU DOM
scene.markDirty(): void                      // request a redraw next frame (meaningful in onDemand + escapes idle throttle)
scene.resize(width: number, height: number): void   // set viewport; resizes renderer + GL layer; marks dirty
scene.showOverlay(overlay: Entity): void     // add to overlayRoot (drawn on top, no clip)
scene.hideOverlay(overlay: Entity): void
scene.detachA11y(entity: Entity): void       // remove shadow nodes for a subtree WITHOUT removing it from the tree
```

> **`resize(w, h)` must run before particle sims.** Width/height come from
> `window.innerWidth/innerHeight` unless `disableWindowResize` is set, in which
> case they fall back to `canvas.width || canvas.clientWidth || 0`. A `0×0`
> viewport means particles simulate in a zero box and may not render.
> `start()` logs a one-time warning when width or height is 0.
>
> **`syncA11y` only creates/updates, never prunes** within a frame. If a
> component swaps out interactive _child_ entities each frame, call
> `detachA11y(child)` before discarding them or their `<a>`/control shadow nodes
> leak. (`remove()` already prunes recursively.)

### Other Scene methods

```ts
scene.getRenderer(): IRenderer
scene.getRoot(): Entity
scene.render(renderer: IRenderer, dt = 0, time = 0): void   // draw the whole graph to a renderer (used by toSVG/custom loops)
scene.toSVG(): string                        // render once through SVGRenderer → flat SVG XML
scene.findEntityAt(x, y): Entity | null      // topmost entity whose isPointInside() returns true (depth-first, front-to-back; no interactive filter)
scene.getA11yElement(entityId: string): HTMLElement | undefined
scene.getA11yTree(): A11yTreeNode[]          // nested snapshot of the projected shadow nodes (id/tag/role/label/value/...)
```

### Pluggable backend registry (static)

```ts
Scene.registerWebGLPointRendererCreator(creator: WebGLPointRendererCreator): void
Scene.registerWebGPUParticleSystemManager(managerClass: any): void
```

Called automatically by the `.` entry. The relevant interfaces
(`IWebGLPointRenderer`, `IWebGPUParticleSystemManager`,
`WebGLPointRendererCreator`) are exported for custom backends. WebGPU device loss
is auto-recovered with exponential backoff (3 retries) before permanently
disabling WebGPU.

---

## Entity (abstract)

Base class for every node in the Virtual Math Tree. Subclass and implement
`isPointInside` and `render`.

```ts
abstract class Entity {
  abstract isPointInside(globalX: number, globalY: number): boolean; // MUST implement
  abstract render(renderer: IRenderer): void; // MUST implement
}
```

### Public properties

| Property                     | Type             | Default         | Notes                                                                                                                              |
| ---------------------------- | ---------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | `string`         | `entity_<rand>` | Used as the shadow node id / `data-vecto-id`.                                                                                      |
| `children`                   | `Entity[]`       | `[]`            |                                                                                                                                    |
| `parent`                     | `Entity \| null` | `null`          |                                                                                                                                    |
| `scene`                      | getter           | —               | Walks the parent chain to the owning `Scene` (or `null`).                                                                          |
| `x`, `y`                     | `number`         | `0`             | Local position.                                                                                                                    |
| `scaleX`, `scaleY`           | `number`         | `1`             | Local scale.                                                                                                                       |
| `rotation`                   | `number`         | `0`             | Local rotation, radians.                                                                                                           |
| `opacity`                    | `number`         | `1`             | Multiplied via `setGlobalAlpha` during render.                                                                                     |
| `interactive`                | `boolean`        | `false`         | Setter side-effect: flags `a11yNeedsReorder` + `markDirty()`. Gates a11y projection (with `width`).                                |
| `width`, `height`            | `number`         | `0`             | Hit box / a11y shadow box size (× scale).                                                                                          |
| `clipChildren`               | `boolean`        | `false`         | Clip children to `[0,0]–[width,height]` (Canvas2D only); how scroll/overflow containers work.                                      |
| `a11yOffsetX`, `a11yOffsetY` | `number`         | `0`             | Nudge the shadow node relative to the entity's global position.                                                                    |
| `a11yFullViewport`           | `boolean`        | `false`         | Project a viewport-filling shadow node even with `width === 0`; mounted **behind** all others so on-top components stay clickable. |
| `isDOMPortal`                | `boolean`        | `false`         | Marks `DOMPortalEntity`; portals are skipped by a11y sync.                                                                         |

> **A11y projection requires a box.** A shadow node is only created when
> `interactive && (width > 0 || a11yFullViewport)`. An interactive entity with
> `width: 0` and no `a11yFullViewport` gets **no** shadow node — set `width`/
> `height`.

### Tree & transform methods

```ts
add(child: Entity): this                     // also flags a11yNeedsReorder + markDirty
remove(child: Entity): this
setPosition(x: number, y: number): this
getGlobalPosition(): Point                   // world position; accumulates translate→scale→rotate up to (excluding) root
getWorldScale(): { x: number; y: number }    // product of own + ancestor scale (excl. root)
getWorldRotation(): number                   // sum of own + ancestor rotation (excl. root), radians
getBounds(): Bounds | null                   // local AABB for culling; null (default) = never culled
destroy(): void                              // clear animations + listeners, detach from parent
```

### Animation

```ts
animate(targetProps: Partial<this>, durationMs: number): this
hasPendingAnimations(): boolean
```

Queues a tween; multiple calls **chain sequentially**. Only numeric properties
interpolate. Easing is a fixed ease-out (`p * (2 - p)`). A running `animate()`
keeps the scene non-static (escapes the idle throttle) and freezes a11y sync
until it settles.

### Events (`VectoEvent` / capture + bubble)

```ts
type VectoEvent =
  | 'click' | 'hover' | 'pointerdown' | 'pointerup' | 'pointermove' | 'pointerleave'
  | 'change' | 'focus' | 'blur' | 'wheel' | 'keydown' | 'keyup';

on(event: VectoEvent, cb: (e: any) => void, options?: { capture?: boolean }): this
off(event: VectoEvent, cb: (e: any) => void, options?: { capture?: boolean }): this
emit(event: VectoEvent, payload: any): void          // self-only, bubble-phase listeners (legacy/component-internal)
dispatchEvent(event: VectoJSEvent): void             // DOM-style capture (root→target) then bubble (target→root)
```

- `on`/`off` default to the **bubble** phase; pass `{ capture: true }` for the
  capture phase. Bubble listeners also fire for the legacy `emit()` path.
- `VectoJSEvent<N>` wraps a `nativeEvent` and adds `target`, `currentTarget`,
  `bubbles`, `stopPropagation()`, `stopImmediatePropagation()`,
  `preventDefault()`, and pass-throughs (`deltaX/Y`, `clientX/Y`, `key`,
  `defaultPrevented`). A non-bubbling event still runs the capture phase but only
  fires its target in the bubble phase.
- `'change'` from a form-control shadow `<input>` carries
  `{ value, checked, selectionStart, selectionEnd, composition }` where
  `composition` is `{ start, length } | null` for the active IME pre-edit.
  `'wheel'` carries the native `WheelEvent` (call `preventDefault()` to stop page
  scroll).

### A11y / batching hooks (override to opt in)

```ts
getA11yAttributes(): A11yAttributes          // default {} → a plain transparent <div>
getBatchCircle(): BatchCircle | null         // { radius, color } → renderer fillCircle fast-path (uniform-scale leaves)
getBatchRect(): BatchRect | null             // { width, height, color } → GPU instanced rect (WebGL pointBackend only)
update(dt: number, time: number): void       // optional override; dt is MILLISECONDS, time is performance.now(); default advances queued tweens
```

`getBatchCircle`/`getBatchRect` are read **every frame** (animated color/radius
honored). A batched leaf skips its own `save/translate/scale/rotate/render/
restore`; runs of same-color siblings coalesce into one `fill()`.

---

## Layout engine (cold/hot split) — `@vectojs/core/layout`

`LayoutEngine` separates the expensive **cold** pass (segment + measure, via
`Intl.Segmenter`) from the cheap **hot** pass (wrap + position arithmetic), so
resize/reflow/animation does not re-measure.

```ts
new LayoutEngine(maxWidth: number, maxHeight: number, measurer?: GlyphMeasurer | null)

// Cold: segment + measure once → reusable PreparedText
prepare(text, fontAtlas, fontSize = 32): PreparedText
prepareRich(spans: StyledSpan[], fontAtlas, baseFontSize = 32, baseStyle?: TextStyle): PreparedText

// Hot: place a PreparedText into positioned glyphs (reads engine maxWidth/maxHeight)
layoutPrepared(prepared, exclusionMask?, exclusions?: ExclusionRect[]): LayoutResult
layoutPreparedIntoBuffer(prepared, buffer: LayoutResultBuffer, exclusionMask?): void   // zero-GC

// One-shot (cold+hot together)
layoutText(text, fontAtlas, fontSize = 32, exclusionMask?): LayoutResult
layoutTextIntoBuffer(text, fontAtlas, fontSize, buffer, exclusionMask?): void
```

- **Streaming memoization.** `prepare`/`prepareRich` cache per-paragraph results,
  so re-preparing growing text (e.g. an LLM token stream) only measures new
  paragraphs.
- **Rich text.** `StyledSpan = { text, style?: TextStyle }`; `TextStyle =
{ fontSize?, color?, bold?, italic?, href? }`. A mid-word style change is
  honored per-glyph. `fontSize` affects measured width + line height; the rest is
  render metadata carried to the nodes (`PreparedGlyph.style` → `LayoutNode.style`).
- **Exclusions (exclusion shapes).** `computeLineSegments(top, bottom, maxWidth,
exclusions: ExclusionRect[]): LineSegment[]` is the pure, testable core: the
  free `[x0,x1)` intervals on a line band after subtracting overlapping rects.
  O(n log n). Passing `[]`/omitting leaves the single-column path byte-identical.

### Key layout types

- `GlyphAtlas` — `{ [char]: { width, baseSize, ast } }` pre-measured metrics.
- `GlyphMeasurer` — `{ measure(char, fontSize): number }`; supply your own or use
  `createCanvasMeasurer(fontFamily?, baseSize?)` (offscreen `measureText`,
  linear-scaled + cached; returns `null` in DOM-free envs → engine keeps a
  `0.5em` fallback).
- `PreparedText` → `PreparedParagraph[]` → `PreparedWord[]` → `PreparedGlyph[]`.
- `LayoutResult` — `{ nodes: LayoutNode[], totalWidth, totalHeight,
fallbackToCanvas? }`; `LayoutNode` is one positioned glyph.
- `LayoutResultBuffer` — flat typed-array result (`xs/ys/ws/hs`, `chars`,
  `count`, `CAPACITY = 16384`); `reset()` before reuse, `toLayoutResult()` to
  materialize.
- `LayoutWorkerManager.getInstance()` — singleton for off-thread layout;
  `queueLayout(entityId, text, { fontId, fontSize, maxWidth, maxHeight, callback,
... })` / `cancelLayout(entityId)`. Used by `MSDFTextEntity`.

---

## Renderers — `@vectojs/core/renderer`

### IRenderer

Backend-agnostic drawing surface every `Entity.render` receives.

```ts
interface IRenderer {
  clear(): void;
  save(): void;
  restore(): void;
  translate(x, y): void;
  scale(x, y): void;
  rotate(angle): void; // radians, clockwise
  setGlobalAlpha(alpha): void; // [0,1]
  clip(x, y, width, height): void; // intersect clip rect (wrap in save/restore)

  beginPath(): void;
  moveTo(x, y): void;
  lineTo(x, y): void;
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y): void;
  closePath(): void;
  arc(x, y, radius, startAngle, endAngle, counterclockwise?): void;
  roundRect(x, y, width, height, radii: number | number[]): void;

  drawImage(source: CanvasImageSource, dx, dy, dw, dh): void;
  fill(colorOrGradient: string | any): void;
  stroke(colorOrGradient: string | any, lineWidth = 1): void;
  fillText(text, x, y, font, color): void; // font = CSS shorthand, e.g. '16px monospace'

  fillCircle(cx, cy, radius, color, alpha = 1): void; // order-preserving same-style batch
  flush(): void; // commit pending batch (no-op when idle)
  createLinearGradient(x0, y0, x1, y1, colorStops: { stop; color }[]): any;
}
```

`fillCircle` coalesces consecutive same-`color`/`alpha` calls into one path,
committed on `flush()` (or when style changes). The Scene flushes at the end of
each sibling group and each frame, preserving painter's order.

### CanvasRenderer

```ts
new CanvasRenderer(canvas: HTMLCanvasElement)
```

Default `IRenderer`. Applies `devicePixelRatio` scaling on construction. Caps
each batched `fill()` at `MAX_BATCH = 64` sub-paths (a single Canvas2D `fill()` is
superlinear in sub-path count). Get a handle via `scene.getRenderer()`.

### SVGRenderer

```ts
new SVGRenderer(width: number, height: number)
toXMLString(): string
```

Software `IRenderer` that records draws into a flat SVG string (matrix/alpha/clip
stacks, gradient dedup). Backs `scene.toSVG()`. `SVGLinearGradient` is the
gradient descriptor type.

### WebGL point layer

```ts
createWebGLPointRenderer(canvas: HTMLCanvasElement): PointRenderer | null   // null if WebGL2 / shader unavailable

interface PointRenderer {
  resize(width, height): void;                 // logical size; applies DPR
  begin(): void;                               // reset per-frame buffers
  addCircle(x, y, radius, color, alpha?): void;        // world coords
  addRect(x, y, width, height, color, alpha?, rotation?): void;
  setTexture(source: TexImageSource): void;
  addSprite(x, y, width, height, u0, v0, u1, v1, color?, alpha?, rotation?): void;
  setMSDFTexture(source: TexImageSource, distanceRange: number): void;
  addGlyph(x, y, width, height, u0, v0, u1, v1, color?, alpha?, rotation?): void;
  flush(): void;                               // clear + draw all accumulated primitives
  destroy(): void;
}
```

One WebGL2 canvas, four batched programs: points (round, AA'd via `gl_PointSize`),
rects (expanded triangles), textured sprites, and MSDF glyphs (median-of-3
distance reconstruction, crisp at any zoom). `color` tints; white texels pass
through unchanged. Sprite/glyph adds are no-ops until their texture is set. The
Scene routes `getBatchCircle`/`getBatchRect` (and CPU particles, MSDF text) here
when `pointBackend: 'webgl'`.

> Entity hooks `getBatchCircle()` → `{ radius, color }` and `getBatchRect()` →
> `{ width, height, color }` are the per-entity opt-ins that feed this layer.

### parseColorToRGBA

```ts
parseColorToRGBA(css: string): RGBA           // RGBA = [number, number, number, number] in [0,1]
```

Fast paths for `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` and `rgb()`/`rgba()`; other
forms (named, `hsl()`, …) resolve via a cached 1×1 canvas when a DOM exists.
Results are **cached and shared by identity — treat the returned array as
read-only.** No-DOM unparseable input → opaque black `[0,0,0,1]`.

---

## ComputeParticleEntity — high-throughput particle layer

```ts
new ComputeParticleEntity(options?: ComputeParticleOptions)
```

| Option          | Default     | Meaning                                                               |
| --------------- | ----------- | --------------------------------------------------------------------- |
| `maxParticles`  | `10000`     | Particle count.                                                       |
| `springK`       | `0.05`      | Spring pull back to origin (clamped 0–10).                            |
| `damping`       | `0.95`      | Velocity damping (0–1).                                               |
| `bounceDamping` | `0.5`       | Boundary bounce energy retained (0–1).                                |
| `maxVelocity`   | `500`       | Speed clamp.                                                          |
| `size`          | `4`         | Base particle size (px).                                              |
| `color`         | `'#00f0ff'` | CSS color (`baseColor`).                                              |
| `pointerEvents` | `false`     | Whether the layer captures hit events (`isPointInside` returns this). |

### Per-particle memory layout

`particleData: Float32Array` of length `maxParticles × PARTICLE_STRIDE_FLOATS`
(`PARTICLE_STRIDE_FLOATS = 8`). Per particle, 8 floats:

| Offset const                 | Index | Field                                                                 |
| ---------------------------- | ----- | --------------------------------------------------------------------- |
| `PARTICLE_OFFSET_POSITION_X` | 0     | position.x                                                            |
| `PARTICLE_OFFSET_POSITION_Y` | 1     | position.y                                                            |
| `PARTICLE_OFFSET_VELOCITY_X` | 2     | velocity.x                                                            |
| `PARTICLE_OFFSET_VELOCITY_Y` | 3     | velocity.y                                                            |
| `PARTICLE_OFFSET_ORIGIN_X`   | 4     | origin.x (spring anchor)                                              |
| `PARTICLE_OFFSET_ORIGIN_Y`   | 5     | origin.y                                                              |
| `PARTICLE_OFFSET_SIZE`       | 6     | size                                                                  |
| `PARTICLE_OFFSET_LIFE`       | 7     | life: `-1` = perpetual, `>=0` decays at `0.5/s`, `0` = dead (skipped) |

### Methods

```ts
initRandomParticles(width, height): void      // scatter across the box; life = -1 (perpetual); marks dirty
setOrigins(points: Float32Array | number[], requestPositionReset = true): void
setPositions(positions: Float32Array | number[]): void
setVelocities(velocities: Float32Array | number[]): void
triggerExplosion(x, y, force): void           // queues an impulse for the next step (radius 150px)
updateCPU(dt, mouseX, mouseY, width, height): void   // CPU sim step; dt in SECONDS, clamped [0,0.1]
destroyGPUResources(): void
```

CPU sim per step: spring-to-origin + mouse repulsion (within 120px of a live
cursor; cursor "off" is `< -9000`) + pending explosion (within 150px) → integrate
→ velocity clamp → boundary bounce + clamp → life decay. NaN-guarded.

### WebGPU vs CPU

When `particleBackend` allows it and a WebGPU device initializes, the Scene runs
compute + render passes on the GPU; otherwise it calls `updateCPU` and draws
through `fillCircle` / the WebGL point layer. **`gpuStorageBuffer` is the backend
indicator** — truthy means the WebGPU path is active for that entity; `null`
means CPU. GPU resources (`gpuStorageBuffer`, `gpuUniformBuffer`,
`computeBindGroup`, `renderBindGroup`) and `needsInit` are public for backend
authors.

> WebGPU init is lazy (first frame a `ComputeParticleEntity` appears) and async,
> with device-loss auto-recovery. Set viewport via `resize(w, h)` before relying
> on the sim — a `0×0` box produces no motion.

---

## Text & Bidi — `@vectojs/core/text`

### MSDFFont

```ts
new MSDFFont(data: MSDFFontData)
MSDFFont.parse(json: string | MSDFFontData): MSDFFont   // reads msdf-atlas-gen JSON
font.getGlyph(unicode: number): MSDFGlyphDef | undefined
font.layout(text, fontSizePx, opts?: MSDFLayoutOptions): MSDFLayoutResult   // honors \n, kerning, letterSpacing
font.distanceRange / font.atlasWidth / font.atlasHeight
```

Parses the de-facto `msdf-atlas-gen` JSON and lays text into CSS-pixel quads with
atlas UVs (y-down local space; v=0 at atlas top). Pair `layout()` with the WebGL
backend's `setMSDFTexture` + `addGlyph` for resolution-independent GPU text. Types:
`MSDFFontData`, `MSDFAtlasInfo`, `MSDFMetrics`, `MSDFGlyphDef`, `MSDFBounds`,
`MSDFKerning`, `PositionedGlyph`, `MSDFLayoutResult`, `MSDFLayoutOptions`.

### MSDFTextEntity

```ts
new MSDFTextEntity(text: string, options: MSDFTextEntityOptions)
// options: { font: MSDFFont, texture: TexImageSource, fallbackFont?, fontSize?, color?, lineHeight?, letterSpacing? }
setText(text: string): void
```

Renders crisp MSDF glyphs through the WebGL point layer when the scene runs
`pointBackend: 'webgl'`; otherwise falls back to Canvas2D `fillText` with
`fallbackFont`. Layout is computed **off-thread** via `LayoutWorkerManager` and
applied on callback, calling `markDirty()` — so text appears one async tick after
construction/`setText`.

### TextEntity & GridTextEntity (from `.`)

```ts
new TextEntity(text: string, atlas: GlyphAtlas, maxWidth: number, fontSize = 32)
text.setText(text): this        // cold pass (re-segment + re-measure), then reflow
text.setMaxWidth(maxWidth): this // hot pass only — reuses cached PreparedText (cheap responsive resize)

new GridTextEntity(_atlas: any, fontSize = 10)
grid.updateGrid(ascii: string[])   // monospace cell grid; interactive=false (a11y off for perf)
```

### Bidi / shaping

```ts
ArabicShaper.shapeArabic(text: string): ShapedResult   // { shapedText, indexMap: Int32Array } — presentation-form joining
BidiResolver.getBaseLevel(text: string): number
BidiResolver.resolveLevels(text: string): Uint8Array
BidiResolver.reorderVisual(nodes: any[], baseLevel: number): void
```

Lightweight built-in bidi: range-based direction classes (Hebrew/Arabic R/AL,
EN/AN digits) and Arabic contextual presentation-form selection. `indexMap` maps
shaped indices back to the source string for hit-testing / caret mapping.

---

## Other entities (from `.`)

### SplineEntity + loadSpline

```ts
loadSpline(url: string): Promise<SplineDocument>     // fetch + parse a vectomancy Spline JSON (browser)
new SplineEntity(doc: SplineDocument, opts?: SplineOptions)
polySegmentToBezier(seg: SplineSegment): BezierControlPoints
```

Renders native vectomancy piecewise-cubic `Spline`/`Polyline` documents. Bounds
come from `bounding_box` (or computed from segment endpoints) so it participates
in viewport culling.

| `SplineOptions` | Default     | Effect                                                                                         |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `lineWidth`     | `2`         | Stroke width (local units).                                                                    |
| `cache`         | `true`      | Bake to an `OffscreenCanvas` once and blit each frame (per-frame Bézier stroking without it).  |
| `defaultColor`  | `'#e2e8f0'` | Used when an equation's `color_rgb` is `null`.                                                 |
| `hitTest`       | `'curve'`   | `'curve'` = precise (within `lineWidth/2 + hitTolerance` of a curve); `'aabb'` = bounding box. |
| `hitTolerance`  | `0`         | Extra pick padding in `'curve'` mode.                                                          |

Public: `doc`, `lineWidth`, `defaultColor`, `hitTolerance`, `showBounds`
(default `false`, draws a debug outline). `SplineColor` is `[r,g,b]` (0–1), a
linear-gradient descriptor, or `null`.

### DOMPortalEntity

```ts
new DOMPortalEntity(domElement: HTMLElement, width?, height?, id?)
```

Projects a **real** DOM element positioned/transformed to track the entity
(`matrix(...)` + z-index from paint order) in the portal layer. A leaf node —
`add()` warns and child entities are unsupported. Forwards native pointer/wheel/
focus events as `VectoJSEvent`s. Uses a `ResizeObserver` to cache intrinsic size
(`cachedWidth`/`cachedHeight`) when `width`/`height` are 0. `destroy()` detaches
listeners, the observer, and removes the element.

### SVGEntity (from `@vectojs/core/text`)

```ts
new SVGEntity(svgSource: string, id?)
setSVGSource(svgSource: string): void
```

Rasterizes an SVG string to an `ImageBitmap`/image and blits it, re-rasterizing at
a target scale (LOD) so it stays sharp when zoomed. AABB hit-test in local space.

---

## Math utilities (from `.`)

```ts
new SpatialHashGrid(cellSize = ...)
grid.insert(id, x, y, w, h): void   // safe to call every frame (re-keys old cells)
grid.remove(id): void
grid.query(x, y, w, h): Set<string> // O(k) cells + results; O(1) avg for small uniform entities
grid.clear(): void                  // call once per frame before re-inserting dynamics

new SpringPhysics(initial: number)
spring.value / spring.target / spring.velocity
spring.stiffness / spring.damping / spring.mass
spring.update(dt): void
spring.isAtRest(): boolean
```

---

## a11yRoot & the agent contract

Every interactive entity that has a box projects a **transparent ARIA shadow
node** into the Scene's `a11yRoot` div (above the canvas, `pointerEvents:auto` so
automation/AT can interact; `opacity:0` unless `debugA11y`). Each node carries
`id` + `data-vecto-id`, plus the role/label/state from
`Entity.getA11yAttributes()`.

`A11yAttributes`:

```ts
{
  tag?: 'div' | 'a' | 'button' | 'img' | 'input' | 'textarea';   // default 'div'
  role?, label?, href?, src?, alt?, inputType?, placeholder?, value?,
  checked?, disabled?, expanded?, controls?, haspopup?, selected?,
  activedescendant?, valuemin?, valuemax?
}
```

The sync applies these to a real element (a true `<button>`, `<a href>`, `<img>`,
`<input>`/`<textarea>` with IME-aware `change`/`focus`/`blur`, etc.), with dirty
checking to minimize DOM writes. Non-natively-focusable interactive roles
(`button`, `switch`, `checkbox`, `link`, `slider`, …) get `tabindex="0"` and
Enter/Space → `click`. This is the "**canvas performance AND DOM-grade
accessibility**" story: visuals are 100% GPU/canvas, yet a Playwright/agent
`getByRole('button', { name })` resolves the shadow node and clicks it.

**Controls & gotchas:**

- `data-vecto-id` on each shadow node mirrors the entity `id` — the stable handle
  for automation selectors.
- `a11ySyncInterval` throttles sync during heavy animation (it freezes entirely
  while an `animate()` tween runs, then catches up at rest).
- `debugA11y: true` shows the nodes (blue dashed) for development.
- `detachA11y(entity)` prunes a subtree's shadow nodes without removing the
  entity; `remove()` prunes automatically. Per-frame sync **creates/updates but
  never prunes**, so manage churn of interactive children explicitly.
- `getA11yTree()` returns a nested `A11yTreeNode[]` snapshot for assertions;
  `getA11yElement(id)` fetches a specific shadow element.
- `a11yFullViewport` mounts a boundless interaction surface behind all others.

---

## Recommended docs-site pages (core)

- **Learn / Core concepts** — Scene, the Virtual Math Tree, the render loop,
  `IRenderer`, zero-DOM model.
- **Learn / Render modes & performance** — `always` vs `onDemand`, `maxFPS`, the
  idle 2-fps throttle and the `markDirty()`-between-frames rule, reduced motion.
- **Learn / Building a custom Entity** — `isPointInside`/`render`, transforms,
  `getBounds` culling, the `getBatchCircle`/`getBatchRect` fast-paths.
- **Learn / Events & hit-testing** — capture/bubble, `VectoJSEvent`,
  `findEntityAt`, form-control `change`/IME.
- **Learn / Accessibility & automation** — the shadow-DOM contract,
  `getByRole`-driven agents, `debugA11y`, throttling.
- **Learn / Text & typography** — the cold/hot `LayoutEngine` split, streaming
  memoization, MSDF text, exclusions/wrapping, bidi.
- **Learn / Particles** — `ComputeParticleEntity`, WebGPU vs CPU, the 8-float
  layout, `resize()`-first.
- **Reference / API** — this file (Scene, Entity, LayoutEngine, renderers,
  particles, text, math utilities).
- **Reference / Backend registry** — pluggable WebGL/WebGPU backends and module
  Built from the published `.d.ts` and `packages/core/src` source.
