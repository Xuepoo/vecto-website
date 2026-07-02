---
title: 'Introduction to VectoJS'
description: 'What VectoJS is, why it exists, how its architecture differs from DOM-based frameworks, and when to use it.'
order: 1
---

# Introduction to VectoJS

**VectoJS** is a mathematical UI rendering engine for the browser. It uses a pure JavaScript entity tree (the _Virtual Math Tree_) to compute layout, applies physics and animations entirely in memory, then paints the result to a `<canvas>`. There is no DOM involvement in the render path — no layout reflows, no style recalculations, no composite layers.

At the same time, VectoJS is fully accessible: for every interactive component, the engine projects an invisible real DOM node (a `<button>`, `<input>`, `<a>`, etc.) positioned over the canvas, so screen readers, keyboard navigation, and Playwright tests work without any extra adapters.

## What problem does it solve?

The browser's DOM is a general-purpose document renderer. It is excellent for text, flowing content, and moderate amounts of interactive elements. It becomes a bottleneck when:

- You need **thousands of individually animated items** (charts, particle UIs, node graphs).
- Layout has **tight math constraints** — spring physics, force-directed graphs, precision coordinate systems.
- You target environments where **CSS layout is unavailable** — WebGL scenes, offscreen canvas, server-side SVG export.

VectoJS trades the convenience of declarative CSS for predictable performance and complete layout control.

## How it differs from other canvas frameworks

Most canvas libraries give you a drawing API and leave layout, hit-testing, and accessibility to you. VectoJS provides a full component stack:

| Layer             | VectoJS                                                | Typical Canvas Lib  |
| ----------------- | ------------------------------------------------------ | ------------------- |
| **Layout**        | Pure-math entity tree, no reflow                       | Manual              |
| **Hit-testing**   | Per-entity `isPointInside()`, O(N) depth-first         | Manual              |
| **Events**        | DOM-like capture + bubble                              | Manual or callbacks |
| **Accessibility** | Automatic shadow DOM projection                        | Not provided        |
| **Text**          | Full LayoutEngine: wrapping, BiDi, Arabic, MSDF        | `fillText` only     |
| **Animation**     | Queued tweens, spring physics                          | External library    |
| **Components**    | Button, Input, Toggle, Dropdown, ScrollView, Markdown… | Not provided        |

## Core Engine Concepts

VectoJS is built upon eight fundamental mathematical and architectural pillars. For developers moving from a traditional DOM or standard game loop mindset, these concepts establish the foundational "UI as an algebraic equation" mental model.

Through our **Hybrid Indexed Structure**, each pillar is linked to both its rigorous mathematical theory and its practical implementation guide:

### 1. The Virtual Math Tree (VMT)

The core tree architecture replacing the traditional browser DOM. It is a pure in-memory, algebraic scene graph of positioned localized coordinate systems. In the VMT, UI hierarchy, transform cascades, and drawing states are entirely resolved as contiguous data models in memory, resulting in Zero-GC pressure and constant-time layout traversal even with over 100,000 active nodes.

- 📖 **Mathematical Theory**: [Mathematical Foundations: VMT](./math-foundations.md#1-the-virtual-math-tree-vmt)
- 🛠️ **Practical Implementation**: [Core Scene Architecture Guide](./core-scene.md)

### 2. Semantic Shadow DOM (a11yRoot)

Our protective "escape hatch" for Canvas accessibility and testing limitations. To bridge the canvas "black box" deficiency, VectoJS dynamically projects a transparent layer of semantic HTML tags (`<button>`, `<input>`, `<a>`, etc.) absolutely positioned directly above the canvas coordinates. This makes standard Playwright testing selectors (e.g., `getByRole`), screen readers, and native CJK Input Method Editor (IME) compositions work perfectly out of the box.

- 📖 **Mathematical Theory**: [Mathematical Foundations: a11yRoot](./math-foundations.md#2-semantic-shadow-dom-a11yroot)
- 🛠️ **Practical Implementation**: [Accessibility & Automation Guide](./accessibility.md)

### 3. Affine Transformations & $SE(2)$ Lie Group

VectoJS rejects CSS layout properties like `absolute` or `flex` positioning. Instead, all translation, scaling, and rotation vectors are compressed into a homogeneous $3 \times 3$ affine transform matrix. Spatial nesting accumulates via matrix multiplications during DFS traversal. Global click events are solved backwards through analytic inversion in $O(1)$ time complexity using **Cramer's Rule**.

- 📖 **Mathematical Theory**: [Mathematical Foundations: $SE(2)$ Lie Group](./math-foundations.md#3-affine-transformations--se2-lie-group-theory)

### 4. Cold/Hot Split Layout Engine

A typographic architecture that overcomes the browser’s single-threaded reflow layout bottleneck. VectoJS isolates expensive dictionary segmentation and character measurement into the **Cold Pass** (executed only on content change). The responsive bounds wrapping and refitting run in the **Hot Pass** using cached width tables in pure mathematical time, capping LLM text appending complexity to $O(\text{New Tokens})$.

- 📖 **Mathematical Theory**: [Mathematical Foundations: Cold/Hot Split](./math-foundations.md#4-coldhot-split-layout-engine)
- 🛠️ **Practical Implementation**: [Text & Typography Guide](./text-typography.md)

### 5. Set-Difference Algebra for Text Flows

To wrap text around arbitrary shapes and callouts, VectoJS bypasses empirical trial-and-error wrapping. It models text wrapping as **Interval Subtraction Set Theory**. The line width represents a closed interval $I_0 = [0, \text{maxWidth}]$ and obstacles represent subtraction intervals $E_k$, solving the allowed writing space deterministically:
$$I_{\text{allowed}} = I_0 \setminus \bigcup E_k$$

- 📖 **Mathematical Theory**: [Mathematical Foundations: Set-Difference Algebra](./math-foundations.md#5-set-difference-algebra-for-text-flows)

### 6. Analytical Spline Hit-Testing

Traditional canvas systems click-test curves using pixel color reads or inaccurate rectangular bounding boxes (AABBs). VectoJS introduces computational geometry, formulating click distance as finding roots of a **5th-degree polynomial derivative (Quintic Equation)**. It combines Bézier subdivision and **Newton-Raphson iterations** to converge to float-precision pixel-perfect detection in 3–5 cycles.

- 📖 **Mathematical Theory**: [Mathematical Foundations: Spline Root-Finding](./math-foundations.md#6-analytical-spline-hit-testing)

### 7. Semi-Implicit Euler ODE Dynamics

CSS easing timers break and jump visually when state transitions are interrupted. VectoJS handles transitions as simulated physical mass-spring-damper systems governed by second-order **Ordinary Differential Equations (ODEs)**. Integrated at runtime via a stable **Semi-Implicit Euler solver**, animated components conserve physical momentum and smoothly adapt to dynamic target changes.

- 📖 **Mathematical Theory**: [Mathematical Foundations: ODE Dynamics](./math-foundations.md#7-semi-implicit-euler-ode-dynamics)
- 🛠️ **Practical Implementation**: [Physics Engine Integration](./physics-engine.md)

### 8. Spatial Hashing Grid Culling

To prevent $O(N)$ traversal overhead in dense interactive scenes, VectoJS discretization maps the 2D infinite plane to a grid, using prime numbers to construct a 1D spatial hash table. Mouse hover searches and viewport culling query only the target cells and their immediate 8 neighbors, dropping culling and picking complexity to a constant average of **$O(1)$**.

- 📖 **Mathematical Theory**: [Mathematical Foundations: Spatial Hashing](./math-foundations.md#8-spatial-hashing-grid-culling)
- 🛠️ **Practical Implementation**: [Hardware Performance Optimization](./performance.md)

## Architecture overview

<img src="/images/vmt-architecture.svg" alt="Architecture overview: Scene drives an Entity tree through the rAF loop, physics, and IRenderer backends (Canvas2D, WebGL, WebGPU), projecting an A11y shadow DOM layer and consuming @vectojs/ui components" class="diagram" />

### The Virtual Math Tree (VMT)

The `Scene` contains a tree of `Entity` objects. Each entity has:

- **Position** (`x`, `y`), **scale** (`scaleX`, `scaleY`), **rotation** (radians), **opacity**.
- A **children** array — nesting works the same as the DOM.
- A **hit box** (`width`, `height`) for event routing.
- An `update(dt, time)` hook for per-frame logic.
- A `render(renderer)` hook that draws the entity in its _local coordinate space_.

The Scene walks the tree every frame: translate → scale → rotate for each entity's local transform, call `render()`, then restore. Children inherit their parent's transform automatically.

### The render loop

<figure>
  <iframe src="/sandbox/diagram-pipeline.html" class="diagram-frame" loading="lazy" title="The VectoJS render loop: the six stages of one dirty frame, rendered live by VectoJS" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption>One requestAnimationFrame tick: update, cull, render, flush WebGL batches, then sync the A11y shadow DOM. <em>(Rendered live by VectoJS.)</em></figcaption>
</figure>

### The A11y shadow layer

A transparent `<div>` lives above the canvas (`z-index: 10`). When an entity has `interactive = true`, the `Scene` creates a real DOM element inside this div — a `<button>`, `<input>`, `<a>`, `<img>`, or `<div role="...">` — and positions it over the entity's canvas box on every frame.

Screen readers discover these real elements. Playwright's `page.getByRole('button', { name })` finds them. IME input goes directly into the real `<input>`. The canvas draws what the shadow element reports.

### Rendering backends

| Backend           | When                        | Capability                            |
| ----------------- | --------------------------- | ------------------------------------- |
| `CanvasRenderer`  | Default                     | Canvas 2D; `devicePixelRatio` scaling |
| WebGL point layer | `pointBackend: 'webgl'`     | Batch circles/rects + MSDF glyphs     |
| WebGPU compute    | `particleBackend: 'webgpu'` | 100k–1M particles on the GPU          |
| `SVGRenderer`     | `scene.toSVG()`             | Headless SVG export                   |

## Packages

| Package          | Contents                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `@vectojs/core`  | `Scene`, `Entity`, `LayoutEngine`, text/MSDF, particles, renderers, math utilities          |
| `@vectojs/ui`    | High-level components: `Button`, `Input`, `Toggle`, `Markdown`, `ScrollView`, `Dropdown`, … |
| `@vectojs/three` | Three.js / WebGL 3D renderer adapter                                                        |

## Features

### ECS architecture

Every object in VectoJS is an `Entity` in the Virtual Math Tree. You add behavior by subclassing `Entity` and overriding `update(dt)` and `render(renderer)`. There are no opaque component registries — the entity tree is a plain JavaScript object graph with deterministic traversal order and full transform inheritance (translate → scale → rotate).

### Zero DOM

The entire UI tree lives inside a single `<canvas>` element. No matter how many animated objects, buttons, or text blocks the scene contains, the DOM node count stays flat. Browser CSS layout never fires for canvas content — VectoJS's own math engine replaces the box model entirely.

### Hot/cold LayoutEngine with bidirectional text support

Text layout runs in two phases. `prepare()` (cold) measures glyph widths and builds the span tree — expensive, run once per content change. `layoutPrepared()` (hot) applies line-break constraints to a prepared result — cheap, runs on every resize. This makes responsive text reflow essentially free. The Unicode Bidirectional Algorithm (BiDi) handles Arabic, Hebrew, and mixed-direction paragraphs correctly.

### WebGL and WebGPU hardware acceleration

Same-color, same-alpha shapes on the WebGL point layer are coalesced into a single `gl.drawArrays()` call. WebGPU compute shaders simulate up to 1,000,000 spring particles on the GPU, bypassing the CPU entirely. VectoJS avoids the overhead of rendering massive numbers of DOM nodes by keeping everything on the canvas. Peak measured: 150,000 particles at 238 fps on a mid-range desktop GPU.

### `a11yRoot` — full parity with standard web pages

A transparent overlay `<div>` positioned above the canvas holds a real `<button>`, `<input>`, `<a>`, or `<img>` element for each interactive entity, repositioned every frame to match that entity's canvas coordinates. Screen readers, keyboard navigation, Playwright, Selenium, and AI agents all operate through these real DOM nodes while the visual result comes from the canvas. No accessibility adapters or ARIA hacks are required.

### Low memory footprint

A single DOM node carries style state, layout state, event listener chains, and accessibility data. VectoJS with 10,000 entities allocates a handful of real DOM nodes: the `<canvas>` element, the `a11yRoot` overlay, and shadow nodes only for currently-interactive entities. Particle simulation data lives in a contiguous `Float32Array` — no per-particle heap objects, no garbage collection pressure.

### Highly customizable

`Entity` is an open base class. `render(renderer: IRenderer)` gives access to path drawing, gradients, image compositing, and clipping. Effects that require CSS hacks — irregular shapes, canvas-to-canvas blending, pixel-perfect concave hit testing — are straightforward in VectoJS because the render path is plain JavaScript with no style system in the way.

### Built-in component library

`@vectojs/ui` ships `Button`, `Input`, `Toggle`, `Slider`, `Dropdown`, `ScrollView`, `Table`, `Markdown`, `Modal`, `Stack`, `Flow`, and more. Every component is a plain `Entity` subclass — extend it, override `render()`, change layout behavior, or compose components freely.

### Native Markdown rendering optimized for streaming

The `Markdown` component renders GitHub Flavored Markdown (tables, task lists, fenced code, links, images) via VectoJS's LayoutEngine. `appendMarkdown(delta)` processes only the changed paragraph boundary on each call — O(changed paragraph), not O(document). Suitable for LLM token streaming at hundreds of tokens per second. Math (via MathJax), Mermaid diagrams, and ABC musical notation are exported to SVG and rendered as engine `Image` entities.

### High compatibility

VectoJS produces a `<canvas>` element that fits anywhere: React `useEffect`, Vue `onMounted`, Angular `ngAfterViewInit`, or a plain `<script>`. It does not conflict with surrounding CSS layout. `scene.resize()` handles responsive layouts; device pixel ratio scaling is automatic. Libraries like React, Vue, and Angular can import VectoJS directly.

### Configurable maxFPS with idle throttling

`new Scene(canvas, { maxFPS: 60 })` caps the render loop. When the scene has no pending animation and no `markDirty()` call arrives between frames, the engine auto-throttles to ~2 fps — conserving CPU and battery without any application code change. Useful for settings panels, idle states, and background tabs.

### Three.js adapter for 3D effects

`ThreeAdapter` renders a full VectoJS scene onto an offscreen canvas and uploads it as a `THREE.CanvasTexture` on any Three.js mesh. UV coordinates from Three.js raycasts are mapped back through VectoJS's hit-test system, so canvas buttons and inputs work on 3D surfaces and in WebXR sessions.

### Zero-GC and contiguous memory

Particle data lives in a `Float32Array` with 8 floats per particle (position, velocity, origin, size, life). No per-frame heap allocations during particle updates. The WebGL layer reuses typed array views rather than creating new arrays each draw call, keeping the garbage collector idle during heavy animation.

### O(1) spatial indexing and viewport culling

A constant-time spatial hash indexes all entities by position. Before calling `render()`, the engine checks `getBounds()` and skips every entity outside the current viewport. A scene with one million entities draws only the visible subset — scrolling and zooming cost nothing for offscreen content.

### Multi-threaded computation

The `LayoutEngine` can offload glyph measurement and line-breaking to a Web Worker via `LayoutWorkerManager`, keeping long text layout off the main thread. WebGPU compute passes run the particle simulation on the GPU entirely in parallel with the JavaScript render loop.

### Intelligent graphics batching

Consecutive same-color, same-alpha sibling entities on the WebGL point layer merge into a single `gl.drawArrays()` call. Opt in with `getBatchCircle()` or `getBatchRect()` on leaf entities. A scene with tens of thousands of similar shapes can issue fewer than 10 draw calls.

### Native mathematical curve rendering

The `IRenderer` interface exposes Bézier path commands (`moveTo`, `lineTo`, `bezierCurveTo`, `arcTo`). Vectomancy — the curve engine underlying VectoJS — approximates arbitrary parametric and spline curves as polylines with configurable precision, enabling smooth shapes that canvas `arc()` alone cannot express.

### 2.5D pseudo-3D depth sorting

An optional depth pass orders entities by their `z` property before rendering, enabling parallax layering, card stacking, isometric game views, and depth-of-field composition without needing a real WebGL depth buffer.

### Small bundle with modular imports

`@vectojs/core` is split into subpath exports: `@vectojs/core/layout` (LayoutEngine only), `@vectojs/core/renderer` (Canvas2D renderer only). WebGL and WebGPU backends register via `Scene.registerWebGL()` / `Scene.registerWebGPU()` — omit them for a pure Canvas2D build with no GPU code in the bundle. Users can choose not to import specific modules they don't need.

### Automation and framework friendly

The `a11yRoot` shadow layer means Playwright's `page.getByRole('button', { name })` finds VectoJS buttons by ARIA role — test automation is identical to testing a standard webpage. Selenium, Cypress, and AI agent frameworks work the same way. React, Vue, Angular, and Svelte can all import VectoJS directly.

---

## Use cases

VectoJS solves problems where the DOM breaks down. These are the environments it was designed for.

### Data visualization and real-time dashboards

Charts, topology viewers, and tables that update on every data tick. Adding 800 animated graph nodes does not trigger browser layout recalculation because no DOM nodes are allocated for canvas entities — entity state lives in plain JS objects and memory usage stays bounded as data streams grow.

**Examples:** financial deep order book terminals, K8s pod topology viewers, live network graphs, high-frequency trading dashboards, real-time analytics.

### Streaming rendering — LLM clients, danmaku, live feeds

Paragraph-level memoization makes text append O(changed paragraph), not O(document). The `Markdown` component's `appendMarkdown()` re-lexes only the last token boundary and updates the visible result with a single `markDirty()` call.

DOM-based danmaku solutions choke past ~200 concurrent comment elements because each element triggers a layout pass. VectoJS danmaku sustains 5,000+ live comments at 60 fps because canvas entities have no layout cost.

**Examples:** LLM chat clients, real-time video comment overlays (danmaku/Niconico-style), K8s event feeds, live stream chatrooms.

### Infinite canvases and knowledge graphs

Collaborative whiteboards, node-edge knowledge graphs, and design tools use VectoJS's O(1) spatial index to cull offscreen entities entirely. Users can pan and zoom through millions of nodes without the browser re-rendering what is not visible. The `a11yRoot` shadow layer keeps keyboard navigation working even on canvases with thousands of interactive nodes.

**Examples:** collaborative whiteboards, knowledge graphs, mind maps, Figma/Miro/Excalidraw-style design tools.

### Web games and interactive media

VectoJS's `update(dt)` loop, spring physics, `ComputeParticleEntity`, and `animate()` tweens provide the primitives a browser game needs without a full game engine. Game controls still work via keyboard and can be tested by automation tools because interactive entities project real ARIA shadow nodes.

The same architecture works for educational explainer animations — a web-native alternative to Remotion and Manim that runs directly in the browser without a video pipeline.

**Examples:** OSU!-style rhythm games, physics sandboxes, educational animations, interactive course materials.

### Web-based text editors and developer tools

Canvas-based editors like `vscode.dev` use canvas because the browser's text layout engine cannot be controlled at the character level. VectoJS provides the layout engine, input handling via real `<input>` shadow nodes for IME, and the accessibility layer a full editor needs — without writing a bespoke canvas framework from scratch.

**Examples:** code editors, rich-text editors, terminal emulators, diff viewers.

### Privacy-sensitive and scraping-resistant interfaces

Because VectoJS renders content to a pixel buffer rather than a DOM tree, there is no structured HTML for scraping bots to parse. This property is valuable for premium content protection, anti-bot surfaces, and CAPTCHA-alternative applications. Advanced implementations can take this further with pixel-level watermarking and anti-cheat layers.

### WebXR and immersive spatial UIs

`ThreeAdapter` renders a full VectoJS scene as a `THREE.CanvasTexture` on any Three.js mesh. In a WebXR session, a VectoJS panel can float as a 3D plane in the user's field of view, with pointer-event routing via UV raycasting from XR controllers.

**Examples:** VR/AR spatial dashboards, in-world terminal screens, head-up display instrument clusters.

### Everything a Pretext-style renderer handles, and more

VectoJS covers everything Pretext can render — mathematical curves, Bézier-spline paths, parametric shapes, precise coordinate-system layouts — and adds an event system, accessibility layer, component library, and physics engine on top. If you were using Pretext for interactive or web-targeted output, VectoJS is the natural upgrade path.

### Advanced and unconventional interactive websites

Tech-focused product sites and portfolio pages that want to go beyond what CSS alone can produce: physics-driven layouts, cursor-reactive particle fields, magnetic typography, real-time generative art integrated with page content. VectoJS makes these possible while keeping the surrounding HTML/CSS structure intact — the canvas sits inside a normal webpage.

---

## When not to use VectoJS

VectoJS is a **low-level building block**, not a page framework. It is not the right tool when:

- You are building a mostly-text website or blog (use HTML + CSS).
- Your UI is data-driven forms with standard validation (use React/Vue/Svelte).
- You need SEO crawlability of rendered content (use SSR HTML).
- You do not need custom layout math or high entity counts.

VectoJS shines when you need **canvas-level control** with **production-grade infrastructure** (events, accessibility, text, physics) that you would otherwise build yourself.

## Challenges

### Map the architecture

Trace the full path from a user clicking the canvas to a frame being painted and the screen reader being updated. Describing this end-to-end path cements your mental model before writing any code.

- Start at the raw `pointerdown` event on the `<canvas>` element and name every system that handles it before an entity's `on('click')` callback fires.
- Identify where in the loop `markDirty()` matters and what happens if it is never called after the click changes state.
- Locate where `syncA11y()` is called relative to `render()` and explain why order matters for users relying on a screen reader.

### Identify use cases

Given three app descriptions, decide whether VectoJS is the right tool for each and justify your reasoning using the trade-offs described in this page.

- **App A**: A company blog with long-form articles, images, and a comment section. The content is mostly static text, refreshed by a CMS on each page load.
- **App B**: A real-time network topology viewer displaying 800+ animated nodes and edges, with physics-based layout that updates on every data tick.
- **App C**: A multi-step employee onboarding form: 6 pages of dropdowns, text fields, file uploads, and standard form validation with server-side errors.

### Benchmark in mind

Before running any profiler, predict which of the three scenarios below would benefit from `renderMode: 'onDemand'` instead of a continuous 60 fps loop, and explain what `onDemand` saves.

- A data visualization that shows a static snapshot of last month's sales, with one "Refresh" button that fetches new data.
- A particle simulation where 10,000 dots move and collide every frame.
- A settings panel (toggles and sliders) that the user opens occasionally and interacts with for 30 seconds before closing.

## Next steps

- [Mathematical Foundations](/learn/math-foundations/) — the linear algebra, spline geometry, and ODE solvers powering VectoJS.
- [Getting Started](/learn/getting-started/) — install and create your first scene.
- [Core Scene](/learn/core-scene/) — the render loop, entities, and transforms in depth.
