---
title: 'Mathematical Foundations'
description: 'The mathematical and physical principles underpinning the VectoJS rendering engine: Virtual Math Trees, semantic accessibility projection, Lie groups, split layouts, spline hit-testing, set-difference wrapping, ODE animation, and spatial culling.'
order: 2
---

# Mathematical Foundations

VectoJS treats UI rendering not as a series of CSS styling cascade resolutions, but as a pure **geometric and algebraic computation problem**. By converting layout, culling, hit-testing, text wrapping, and animation into formal mathematical systems, the engine bypasses the browser's DOM and layout recalculation pipelines entirely.

This document details the eight mathematical and engineering pillars that serve as the foundation of the VectoJS runtime.

---

## 1. The Virtual Math Tree (VMT)

Instead of maintaining a heavy tree of browser DOM nodes, VectoJS operates on the **Virtual Math Tree (VMT)**. The VMT is a pure in-memory **algebraic and coordinate scene graph** rather than a representation of markup elements.

### Pure-Memory Algebraic Representation

In a traditional UI, layouts are resolved by a browser's reflow engine, which calculates cascading box models and updates CSS render layers. In the VMT, every visual element (an _Entity_) is represented as a localized coordinate system, mapped to its parent through affine algebraic relations:

$$\mathbb{T}_{\text{child}} = \mathbf{M}_{\text{local}} \cdot \mathbb{T}_{\text{parent}}$$

Since there is no underlying HTML markup node or CSS cascade resolution, the tree structure remains extremely lightweight. Traversals and operations do not touch browser APIs, enabling complex parent-child relations to be resolved in microseconds.

### Zero-GC Allocation Strategy

To sustain ultra-high rendering throughput (e.g., animating 100,000 active nodes at 60 FPS), the VMT eliminates runtime memory allocations.

- **Object Pool Recycling**: Entities, vectors, and matrices are pre-allocated in structured object pools and recycled.
- **Flat Scalar Arrays**: Coordinates and transform parameters are packed into contiguous TypedArrays, allowing high-performance layout pipelines to read and write directly to memory without triggering Javascript's garbage collector.

---

## 2. Semantic Shadow DOM (a11yRoot)

Canvas-based UI engines historically suffer from the "black box" deficiency: they are completely invisible to screen readers, cannot be audited by automated accessibility engines, and break native browser features like copy-paste or Input Method Editor (CJK IME) composition.

VectoJS resolves this via the **Semantic Shadow DOM** (or `a11yRoot`).

### Active Accessibility Projection

While VectoJS renders all graphics directly inside a single `<canvas>` element, it maintains an invisible, high-fidelity **Semantic Shadow DOM** layered in absolute position directly above the canvas coordinate space.

```text
┌────────────────────────────────────────────────────────┐
│  Semantic Shadow DOM (a11yRoot: <button>, <input>...)  │  <-- Interactive/A11y Layer
├────────────────────────────────────────────────────────┤
│  WebGL / Canvas 2D Graphics Canvas Layer               │  <-- High-Performance Graphics
└────────────────────────────────────────────────────────┘
```

For every interactive entity in the Virtual Math Tree, the engine projects a corresponding semantic HTML element (e.g., `<button>` for buttons, `<input>` for input fields, `<a>` for links) to the shadow root. These DOM nodes are fully transparent but match the physical boundaries, nesting order, and interactive state of the corresponding Canvas elements.

### Testing and Screen Reader Integrity

Because the shadow DOM is composed of standard, native HTML tags:

- **Screen Readers**: Accessibility tools interact with the native semantic tags, speaking descriptions, and reading states.
- **Automated Testing**: Frameworks like Playwright or AI Agents can locate and query Canvas-based UI components using standard query mechanisms like `page.getByRole('button', { name: 'Submit' })`.
- **IME Composition**: CJK input methods function natively because they interact with a real `<input>` tag inside the shadow layer, which then streams composed strings down to VectoJS's rendering engine in real-time.

---

## 3. Affine Transformations & $SE(2)$ Lie Group Theory

VectoJS completely abandons CSS layout properties like `absolute`, `relative`, or `flex` positioning. Instead, the spatial relationship of every node in the Virtual Math Tree is compressed into a $3 \times 3$ homogeneous **affine transformation matrix** in the Euclidean plane.

### The Transformation Matrix

An entity's translation $(t_x, t_y)$, scale $(s_x, s_y)$, and rotation $\theta$ (in radians) are combined into a single matrix $M \in \text{Aff}(2)$:

$$M = \begin{bmatrix} s_x \cos\theta & -s_y \sin\theta & t_x \\\\ s_x \sin\theta & s_y \cos\theta & t_y \\\\ 0 & 0 & 1 \end{bmatrix}$$

### Cascading Transforms (Matrix Multiplication)

When traversing the node tree, children inherit their parent's coordinate space. Because matrix multiplication is associative, the global transform matrix $M_{\text{global}}$ for any nested entity is calculated by multiplying the parent's accumulated global matrix with the local matrix:

$$M_{\text{global}} = M_{\text{parent}} \times M_{\text{local}}$$

This is executed during the pre-order depth-first traversal (DFS) render pass. VectoJS does this directly on scalar float variables (avoiding heap allocations) to optimize calculation throughput:

```typescript
// Scalar multiplication of 3x3 transformation matrix
const globalX = parent.m00 * local.x + parent.m01 * local.y + parent.m02;
const globalY = parent.m10 * local.x + parent.m11 * local.y + parent.m12;
```

### Closed-Form Inverse Transforms (Cramer's Rule)

To reverse-map coordinates (e.g., translating screen-space mouse clicks or 3D raycast coordinates back into a local entity's coordinate space), VectoJS computes the inverse matrix $M_{\text{global}}^{-1}$.

Instead of running slow Gauss-Jordan elimination, VectoJS solves the inverse analytically using **Cramer's Rule** for $3 \times 3$ matrices:

$$M^{-1} = \frac{1}{\det(M)} \begin{bmatrix} m_{11}m_{22} - m_{12}m_{21} & m_{02}m_{21} - m_{01}m_{22} & m_{01}m_{12} - m_{02}m_{11} \\\\ m_{12}m_{20} - m_{10}m_{22} & m_{00}m_{22} - m_{02}m_{20} & m_{02}m_{10} - m_{00}m_{12} \\\\ m_{10}m_{21} - m_{11}m_{20} & m_{01}m_{20} - m_{00}m_{21} & m_{00}m_{11} - m_{01}m_{10} \end{bmatrix}$$

Since the third row of our homogeneous matrix is always $\begin{bmatrix} 0 & 0 & 1 \end{bmatrix}$, the determinant reduces to:

$$\det(M) = m_{00} \cdot m_{11} - m_{01} \cdot m_{10}$$

If $\det(M) \neq 0$, the inverse coordinates are solved in constant time ($O(1)$) with zero heap allocation.

---

## 4. Cold/Hot Split Layout Engine

Text rendering on the web is notoriously slow. In traditional browsers, modifying even a single character can trigger a massive reflow (recalculating widths, segmenting words, and querying OS-level font caches) across the entire document. VectoJS resolves this via the **Cold/Hot Split Layout Engine**.

### Cold Path: Segmentation and Measurement

The expensive aspects of text processing—tokenization (using `Intl.Segmenter` for word boundaries), BiDi (bidirectional text) sorting, and measuring glyph boundaries using canvas contexts—are isolated into the **Cold Pass**.

- Runs **only** when the actual text content changes.
- Measures and constructs a flat, cacheable layout map.
- The results are stored inside a localized, immutable `PreparedText` representation.

### Hot Pass: Math-Only Wrapping and Alignment

When a text block is resized (e.g., dragging the window or animating a responsive layout card), VectoJS triggers the **Hot Pass**:

- Avoids all `Intl.Segmenter` or canvas measurement API queries.
- Reads cached glyph widths directly from the `PreparedText` map.
- Computes line breaks, vertical wrapping offsets, and paragraph margins using ultra-fast, pure-integer mathematical bounds.

By splitting layout into a cold metadata pass and a hot positioning pass, reflow costs are bounded to $O(\text{word count})$ rather than $O(\text{character count})$, completely eliminating layout layout thrashing. Combined with **Paragraph-level Memoization**, it drops the time complexity of LLM streaming text layouts from $O(\text{Total Document})$ to $O(\text{New Tokens})$.

---

## 5. Set-Difference Algebra for Text Flows

Traditional web browsers wrap text around obstacles (such as float images or inline callouts) using complex CSS layout calculations. VectoJS models text flow mathematically as **Interval Subtraction Set Theory** over the real number line.

### Line-Interval Splitting

For a given line at vertical coordinate $Y$ and height $H$, the total wrap width is represented as a single closed interval $I_0 = [0, \text{maxWidth}]$.

If $K$ obstacle shapes (`ExclusionRect`) overlap with the Y-range $[Y, Y+H]$, each obstacle represents a subtraction interval $E_k = [x_{s,k}, x_{e,k}]$:

<img src="/images/set-difference-intervals.svg" alt="Diagram showing three horizontal interval bars: the total line interval spanning 0 to maxWidth, an obstacle interval xs1 to xe1 in the middle, and the resulting set difference as two separate segments avoiding the obstacle" class="diagram" />

The available segments $I_{\text{allowed}}$ for placing text glyphs are solved by computing the set difference:

$$I_{\text{allowed}} = I_0 \setminus \bigcup_{k=1}^{K} E_k$$

### Algorithm Execution

The engine runs this set-difference arithmetic:

1. Gathers all exclusion intervals overlapping the Y-span.
2. Merges overlapping exclusion intervals into a sorted list of disjoint intervals.
3. Subtracts these intervals from $[0, \text{maxWidth}]$ to yield a list of valid sub-intervals.
4. Wraps text tokens into these sub-intervals sequentially.

This allows complex typographic wrapping to be solved as a deterministic, flat interval-subtraction pass rather than recursive trial-and-error rendering.

---

## 6. Parametric Spline Geometry & Analytical Hit-Testing

Traditional canvas frameworks hit-test curves by drawing them invisibly and reading color pixels, or checking if clicks lie inside the rectangular bounding box (AABB) enclosing the curve. The former is slow, and the latter is highly inaccurate.

VectoJS (via the Vectomancy engine) solves this analytically. A cubic Bézier curve segment is represented as a parametric vector function $P(t)$ for $t \in [0, 1]$:

$$P(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3$$

Where $P_0, P_1, P_2, P_3 \in \mathbb{R}^2$ are the control points.

### The Minimum Distance Problem

To determine if a pointer click $C(x, y)$ hits the spline curve within a tolerance threshold $\epsilon$, the engine solves for the minimum distance:

$$\text{find } t \in [0, 1] \text{ that minimizes } f(t) = \|P(t) - C\|^2$$

Expanding this leads to finding the roots of the derivative:

$$f'(t) = 2(P(t) - C) \cdot P'(t) = 0$$

Since $P(t)$ is a cubic polynomial (degree 3) and $P'(t)$ is quadratic (degree 2), their dot product $f'(t)$ yields a **5th-degree polynomial**. By Abel-Ruffini's theorem, a general 5th-degree polynomial cannot be solved algebraically in radicals.

### Numerical Root Finding

To solve this efficiently at runtime, VectoJS combines two numerical techniques:

1. **Bézier Subdivision (Interval Halving)**: The curve is subdivided into segments using de Casteljau's algorithm to approximate the closest interval.
2. **Newton-Raphson Iteration**: Once a close interval $t_k$ is found, the root is refined iteratively:
   $$t_{k+1} = t_k - \frac{f'(t_k)}{f''(t_k)}$$

This converges to float-level precision in $3$ to $5$ iterations, checking if the final distance $\|P(t_{\text{min}}) - C\| \le \frac{\text{lineWidth}}{2} + \epsilon$. This guarantees pixel-perfect click detection along complex vector shapes.

---

## 7. Differential Equations & Semi-Implicit Euler Solvers

CSS animations operate on fixed time scales ($t \in [0, 1]$). If the target position changes mid-flight (e.g., following a cursor), the bezier curve must be recalculated, resulting in visual jumps or momentum loss.

VectoJS solves this using **ordinary differential equations (ODE)** simulating a physical mass-spring-damper system.

### The Governing Equation

The movement of an animated value $x(t)$ (position, scale, or opacity) toward its target value $x_{\text{target}}$ is governed by Hooke's Law with damping:

$$m \frac{d^2x}{dt^2} + c \frac{dx}{dt} + k(x - x_{\text{target}}) = 0$$

Where:

- $m$ is the mass (inertia).
- $c$ is the damping coefficient (friction).
- $k$ is the spring stiffness (attraction force).

### Numerical Integration (Semi-Implicit Euler)

To solve this equation step-by-step at runtime, VectoJS uses a **Semi-implicit Euler integration** solver. Unlike explicit Euler (which is unstable and accumulates energy error), the semi-implicit solver calculates velocity using the current state and then computes position using the _next_ velocity:

$$v_{t+\Delta t} = v_t + \frac{-k(x_t - x_{\text{target}}) - c v_t}{m} \Delta t$$

$$x_{t+\Delta t} = x_t + v_{t+\Delta t} \Delta t$$

Where $\Delta t$ is the frame time step (in seconds).

Because the solver calculates forces dynamically based on the current value $x_t$ and velocity $v_t$ relative to $x_{\text{target}}$, the target can move dynamically (e.g., dragging, mouse hover, or responsive reflow). The system naturally adapts, conserving momentum and bringing elements to a rest state smoothly with organic damping.

---

## 8. Spatial Hashing & $O(1)$ Viewport Culling

In a scene containing $N$ entities, testing which elements are hovered or visible inside the viewport naively requires an $O(N)$ sweep. At $N = 100,000$, this drops frame rates significantly.

VectoJS maps the 2D infinite coordinate plane to a **Spatial Hash Grid** to bound complexity.

<figure>
  <iframe src="/sandbox/diagram-spatial-hash.html" class="diagram-frame" loading="lazy" title="A spatial hash grid where a moving cursor only tests its own cell and eight neighbours, rendered live by VectoJS" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption>Only the cursor's cell and its eight neighbours are ever hit-tested — the rest of the grid is skipped. <em>(Rendered live by VectoJS.)</em></figcaption>
</figure>

### The Hash Function

The coordinate space is divided into a grid of cells of size $S$. Any entity's bounding box maps to a set of integer cell coordinates $(i, j) \in \mathbb{Z}^2$:

$$i = \left\lfloor \frac{x}{S} \right\rfloor, \quad j = \left\lfloor \frac{y}{S} \right\rfloor$$

These grid coordinates are mapped to a 1D hash table index:

$$H(i, j) = (i \cdot p_1 \oplus j \cdot p_2) \pmod M$$

Where $p_1 = 73856093$ and $p_2 = 19349663$ are large prime numbers, and $M$ is the hash table capacity.

### Complexity Reduction

- **Viewport Culling**: Instead of checking every entity, the engine queries the hash cells intersecting the viewport bounds. Offscreen entities are skipped entirely.
- **Hit-Testing**: A mouse hover only tests collision against entities in the cell containing the cursor and its immediate neighbors.
- _Result_: Spatial query time is reduced from **$O(N)$** to **$O(1)$ average complexity**, keeping pan and zoom smooth at massive scales.

---

## Summary of Mathematical Advantages

| Dimension         | Browser / DOM              | VectoJS                      | Math Principle                 |
| ----------------- | -------------------------- | ---------------------------- | ------------------------------ |
| **Scene Graph**   | HTML DOM Tree              | Virtual Math Tree (VMT)      | Contiguous Memory Scene Graph  |
| **Accessibility** | Browser Reflow Tree        | Semantic Shadow DOM          | High-Fidelity DOM Projection   |
| **Transforms**    | CSS Layout Engine          | 3x3 Homogeneous Matrices     | Linear Algebra / $SE(2)$ Group |
| **Reflow**        | Single-Threaded Reflow     | Cold/Hot Split Layout        | Cached Word Segmentation       |
| **Text wrap**     | Reflow trial-and-error     | Segment Interval Subtraction | Set Difference Algebra         |
| **Picking**       | Bounding box / DOM overlay | Analytical Polynomial Solver | Newton-Raphson Iteration       |
| **Animation**     | Cubic Bezier timelines     | Mass-Spring-Damper Solver    | Second-Order ODE Integration   |
| **Culling**       | Render tree comparison     | 2D Hash Mapping              | Spatial Hash Indexing          |

> **Next:** [Getting Started](/learn/getting-started/) — install the packages and write your first scene.
