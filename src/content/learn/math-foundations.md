---
title: 'Mathematical Foundations'
description: 'The mathematical and physical principles underpinning the VectoUI rendering engine: linear algebra, spline geometry, spatial hashing, set-difference wrapping, and numerical differential solvers.'
order: 2
---

# Mathematical Foundations

VectoUI treats UI rendering not as a series of CSS styling cascade resolutions, but as a pure **geometric and algebraic computation problem**. By converting layout, culling, hit-testing, text wrapping, and animation into formal mathematical systems, the engine bypasses the browser's layout recalculation entirely.

This document details the five mathematical pillars that serve as the foundation of the VectoUI runtime.

---

## 1. Affine Transformations & $SE(2)$ Group Theory

At the core of the Virtual Math Tree (VMT) is the composition of 2D space coordinate transforms. Instead of relying on CSS positioning, VectoUI models every node's transform as a homogeneous $3 \times 3$ matrix representing an **affine transformation** in the Euclidean plane.

### The Transformation Matrix

An entity's translation $(t_x, t_y)$, scale $(s_x, s_y)$, and rotation $\theta$ (in radians) are combined into a single matrix $M \in \text{Aff}(2)$:

$$M = \begin{bmatrix} s_x \cos\theta & -s_y \sin\theta & t_x \\ s_x \sin\theta & s_y \cos\theta & t_y \\ 0 & 0 & 1 \end{bmatrix}$$

### Cascading Transforms (Matrix Multiplication)

When traversing the node tree, children inherit their parent's coordinate space. Because matrix multiplication is associative, the global transform matrix $M_{\text{global}}$ for any nested entity is calculated by multiplying the local matrix with the parent's accumulated global matrix:

$$M_{\text{global}} = M_{\text{parent}} \times M_{\text{local}}$$

This is executed during the pre-order depth-first traversal (DFS) render pass. VectoUI does this directly on scalar float variables (avoiding heap allocations) to optimize calculation throughput:

```typescript
// Scalar multiplication of 3x3 transformation matrix
const globalX = parent.m00 * local.x + parent.m01 * local.y + parent.m02;
const globalY = parent.m10 * local.x + parent.m11 * local.y + parent.m12;
```

### Closed-Form Inverse Transforms (Cramer's Rule)

To reverse-map coordinates (e.g., translating screen-space mouse clicks or 3D raycast coordinates back into a local entity's coordinate space), VectoUI computes the inverse matrix $M_{\text{global}}^{-1}$.

Instead of running slow Gauss-Jordan elimination, VectoUI solves the inverse analytically using **Cramer's Rule** for $3 \times 3$ matrices:

$$
M^{-1} = \frac{1}{\det(M)} \begin{bmatrix}
m_{11}m_{22} - m_{12}m_{21} & m_{02}m_{21} - m_{01}m_{22} & m_{01}m_{12} - m_{02}m_{11} \\
m_{12}m_{20} - m_{10}m_{22} & m_{00}m_{22} - m_{02}m_{20} & m_{02}m_{10} - m_{00}m_{12} \\
m_{10}m_{21} - m_{11}m_{20} & m_{01}m_{20} - m_{00}m_{21} & m_{00}m_{11} - m_{01}m_{10}
\end{bmatrix}
$$

Since the third row of our homogeneous matrix is always $\begin{bmatrix} 0 & 0 & 1 \end{bmatrix}$, the determinant reduces to:

$$\det(M) = m_{00} \cdot m_{11} - m_{01} \cdot m_{10}$$

If $\det(M) \neq 0$, the inverse coordinates are solved in constant time ($O(1)$) with zero heap allocation.

---

## 2. Parametric Spline Geometry & Analytical Hit-Testing

Traditional canvas frameworks hit-test curves by drawing them invisibly and reading color pixels, or checking if clicks lie inside the rectangular bounding box (AABB) enclosing the curve. The former is slow, and the latter is highly inaccurate.

VectoUI (via the Vectomancy engine) solves this analytically. A cubic Bézier curve segment is represented as a parametric vector function $P(t)$ for $t \in [0, 1]$:

$$P(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3$$

Where $P_0, P_1, P_2, P_3 \in \mathbb{R}^2$ are the control points.

### The Minimum Distance Problem

To determine if a pointer click $C(x, y)$ hits the spline curve within a tolerance threshold $\epsilon$, the engine solves for the minimum distance:

$$\text{find } t \in [0, 1] \text{ that minimizes } f(t) = \|P(t) - C\|^2$$

Expanding this leads to finding the roots of the derivative:

$$f'(t) = 2(P(t) - C) \cdot P'(t) = 0$$

Since $P(t)$ is a cubic polynomial (degree 3) and $P'(t)$ is quadratic (degree 2), their dot product $f'(t)$ yields a **5th-degree polynomial**. By Abel-Ruffini's theorem, a general 5th-degree polynomial cannot be solved algebraically in radicals.

### Numerical Root Finding

To solve this efficiently at runtime, VectoUI combines two numerical techniques:

1. **Bézier Subdivision (Interval Halving)**: The curve is subdivided into segments using de Casteljau's algorithm to approximate the closest interval.
2. **Newton-Raphson Iteration**: Once a close interval $t_k$ is found, the root is refined iteratively:
   $$t_{k+1} = t_k - \frac{f'(t_k)}{f''(t_k)}$$

This converges to float-level precision in $3$ to $5$ iterations, checking if the final distance $\|P(t_{\text{min}}) - C\| \le \frac{\text{lineWidth}}{2} + \epsilon$. This guarantees pixel-perfect click detection along complex vector shapes.

---

## 3. Spatial Hashing & $O(1)$ Viewport Culling

In a scene containing $N$ entities, testing which elements are hovered or visible inside the viewport naively requires an $O(N)$ sweep. At $N = 100,000$, this drops frame rates significantly.

VectoUI maps the 2D infinite coordinate plane to a **Spatial Hash Grid** to bound complexity.

<img src="/images/spatial-hash-grid.svg" alt="3×3 spatial hash grid showing coordinate cells (0,0) through (2,2), with the active cursor cell (1,1) highlighted in blue, and annotations explaining the cell-key formula and O(1) lookup" class="diagram" />

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

## 4. Set-Difference Algebra for Text Flows

Traditional web browsers wrap text using line-breaking properties. However, wrapping text around irregular obstacles (such as float images or inline callouts) requires heavy browser reflow passes.

VectoUI models text flow mathematically as **Interval Subtraction Set Theory** over the real number line.

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

## 5. Differential Equations & Semi-Implicit Euler Solvers

CSS animations operate on fixed time scales ($t \in [0, 1]$). If the target position changes mid-flight (e.g., following a cursor), the bezier curve must be recalculated, resulting in visual jumps or momentum loss.

VectoUI solves this using **ordinary differential equations (ODE)** simulating a physical mass-spring-damper system.

### The Governing Equation

The movement of an animated value $x(t)$ (position, scale, or opacity) toward its target value $x_{\text{target}}$ is governed by Hooke's Law with damping:

$$m \frac{d^2x}{dt^2} + c \frac{dx}{dt} + k(x - x_{\text{target}}) = 0$$

Where:

- $m$ is the mass (inertia).
- $c$ is the damping coefficient (friction).
- $k$ is the spring stiffness (attraction force).

### Numerical Integration (Semi-Implicit Euler)

To solve this equation step-by-step at runtime, VectoUI uses a **Semi-implicit Euler integration** solver. Unlike explicit Euler (which is unstable and accumulates energy error), the semi-implicit solver calculates velocity using the current state and then computes position using the _next_ velocity:

$$v_{t+\Delta t} = v_t + \frac{-k(x_t - x_{\text{target}}) - c v_t}{m} \Delta t$$

$$x_{t+\Delta t} = x_t + v_{t+\Delta t} \Delta t$$

Where $\Delta t$ is the frame time step (in seconds).

Because the solver calculates forces dynamically based on the current value $x_t$ and velocity $v_t$ relative to $x_{\text{target}}$, the target can move dynamically (e.g., dragging, mouse hover, or responsive reflow). The system naturally adapts, conserving momentum and bringing elements to a rest state smoothly with organic damping.

---

## Summary of Mathematical Advantages

| Dimension      | Browser / DOM              | VectoUI                      | Math Principle                 |
| -------------- | -------------------------- | ---------------------------- | ------------------------------ |
| **Transforms** | CSS Layout Engine          | 3x3 Homogeneous Matrices     | Linear Algebra / $SE(2)$ Group |
| **Picking**    | Bounding box / DOM overlay | Analytical Polynomial Solver | Newton-Raphson Iteration       |
| **Culling**    | Render tree comparison     | 2D Hash Mapping              | Spatial Hash Indexing          |
| **Text wrap**  | Reflow trial-and-error     | Segment Interval Subtraction | Set Difference Algebra         |
| **Animation**  | Cubic Bezier timelines     | Mass-Spring-Damper Solver    | Second-Order ODE Integration   |

> **Next:** [Getting Started](/learn/getting-started/) — install the packages and write your first scene.
