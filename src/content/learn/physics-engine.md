---
title: 'Physics & Animation'
description: 'Apply spring physics, velocity, and force-directed simulation to any entity in the VMT.'
order: 4
---

# Physics & Animation

VectoJS goes beyond static layout. Because the UI lives in a Virtual Math Tree, you can apply **continuous force-directed physics** to any component — including standard `Button`s and `Input`s.

## Built-in Tweening: `entity.animate()`

The simplest motion tool. `animate()` queues smooth ease-out tweens on any numeric property:

```typescript
button.animate({ x: 200, opacity: 0.5 }, 500);

// Chains are sequential, not concurrent:
button.animate({ x: 400 }, 300).animate({ y: 200 }, 300).animate({ opacity: 0 }, 200);
```

While a tween is running, the scene is kept non-static — no need to call `markDirty()`. When the tween settles, `hasPendingAnimations()` returns `false`.

> [!TIP]
> Chains are sequential (`animate` returns `this`), not concurrent. To animate multiple properties simultaneously, pass them all in one `animate()` call.

## SpringPhysics

`SpringPhysics` is a damped spring for smooth, physical-feeling numeric transitions:

```typescript
import { SpringPhysics } from '@vectojs/core';

const spring = new SpringPhysics(0);   // initial value = 0
spring.stiffness = 180;
spring.damping = 18;

// Set target at any time (e.g. on hover)
spring.target = 1.0;

// In your entity's update():
update(dt: number) {
  spring.update(dt);
  this.opacity = spring.value;
  if (!spring.isAtRest()) this.scene?.markDirty();
}
```

Use `SpringPhysics` instead of `animate()` when the target changes continuously (cursor tracking, scroll momentum, interactive drag).

## Manual Physics on Entities

Every `Entity` has `x`/`y` and `update(dt, time)`. You can implement any physics model by overriding `update`:

```typescript
import { Entity } from '@vectojs/core';
import type { IRenderer } from '@vectojs/core/renderer';

class BallEntity extends Entity {
  vx = (Math.random() - 0.5) * 200;
  vy = (Math.random() - 0.5) * 200;
  friction = 0.97;

  constructor(public radius: number) {
    super();
    this.width = this.height = radius * 2;
  }

  applyForce(fx: number, fy: number) {
    this.vx += fx;
    this.vy += fy;
  }

  override update(dt: number) {
    super.update(dt); // advance queued animate() tweens
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= this.friction;
    this.vy *= this.friction;
  }

  isPointInside(gx: number, gy: number) {
    const { x, y } = this.getGlobalPosition();
    const cx = x + this.radius,
      cy = y + this.radius;
    return (gx - cx) ** 2 + (gy - cy) ** 2 <= this.radius ** 2;
  }

  render(r: IRenderer) {
    r.beginPath();
    r.arc(this.radius, this.radius, this.radius, 0, Math.PI * 2);
    r.fill('#6366f1');
  }
}
```

## Elastic Boundaries

Bounce entities off the viewport edges with a simple dampening factor:

```typescript
const BOUNCE = 0.75;

override update(dt: number) {
  super.update(dt);
  this.x += this.vx * dt;
  this.y += this.vy * dt;

  const { width, height } = this.scene!;

  if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx) * BOUNCE; }
  if (this.x + this.width > width) {
    this.x = width - this.width;
    this.vx = -Math.abs(this.vx) * BOUNCE;
  }
  if (this.y < 0) { this.y = 0; this.vy = Math.abs(this.vy) * BOUNCE; }
  if (this.y + this.height > height) {
    this.y = height - this.height;
    this.vy = -Math.abs(this.vy) * BOUNCE;
  }
}
```

This is exactly how the **Nexus** particle demo was built — simulating 15,000+ interacting nodes at smooth 60 FPS.

## SpatialHashGrid: O(1) Neighbor Queries

For N-body interactions (repulsion, collision), a naive O(N²) loop breaks down above ~1000 nodes. Use `SpatialHashGrid` for O(1) average-case neighbor lookups:

```typescript
import { SpatialHashGrid } from '@vectojs/core';

const grid = new SpatialHashGrid(64); // cell size in world units

// Every frame: rebuild grid, then query
for (const ball of balls) {
  grid.insert(ball.id, ball.x, ball.y, ball.width, ball.height);
}

for (const ball of balls) {
  const nearby = grid.query(ball.x - 50, ball.y - 50, 100, 100);
  for (const otherId of nearby) {
    if (otherId === ball.id) continue;
    // apply repulsion between ball and balls[otherId]
  }
}

grid.clear(); // call once per frame before re-inserting
```

The hash grid is exactly what the `ComputeParticleEntity` uses internally for its CPU simulation path. For very large counts (50k+), consider the WebGPU compute path instead.

> [!WARNING]
> Rebuild the hash grid every frame. Stale grid data from a previous frame will produce incorrect neighbor queries and phantom collisions.

## High-Throughput Particles: `ComputeParticleEntity`

For tens of thousands of particles with spring-to-origin + mouse repulsion, use `ComputeParticleEntity`. It automatically uses WebGPU compute shaders when available, falling back to CPU:

```typescript
import { ComputeParticleEntity } from '@vectojs/core';

const particles = new ComputeParticleEntity({
  maxParticles: 15000,
  springK: 0.05,
  damping: 0.95,
  size: 3,
  color: '#6366f1',
});

// Scatter particles across the viewport
particles.initRandomParticles(scene.width, scene.height);
scene.add(particles);
scene.start();

// Animate particles toward new origin positions (e.g. spell out text)
particles.setOrigins(newPositions);
```

> [!CAUTION]
> Always call `scene.resize(width, height)` or let the Scene auto-resize before `initRandomParticles`. A `0×0` viewport produces no initial positions and particles will never move.

See the [Core API Reference](/reference/core-api/) for the full `ComputeParticleEntity` memory layout and WebGPU internals.
