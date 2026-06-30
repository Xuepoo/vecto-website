---
title: 'Events & Hit-Testing'
description: 'How pointer and keyboard events flow through the VectoUI entity tree: capture, bubble, VectoUIEvent, form change payloads, and findEntityAt.'
order: 5
---

# Events & Hit-Testing

VectoUI uses a DOM-like **capture + bubble** event model. If you have used browser `addEventListener`, the mechanics are identical — but the tree traversal runs over the Virtual Math Tree rather than the DOM.

## Try it live

<figure class="sandbox">
  <div class="sandbox-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="sandbox-label">live · vecto-ui@0.9</span></div>
  <iframe src="/sandbox/events.html" class="sandbox-frame" loading="lazy" title="Events & Hit-Testing interactive example" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption>Three custom Entity subclasses — hover to scale, click to count. Each wires <code>on('hover')</code>, <code>on('pointerleave')</code>, and <code>on('click')</code>.</figcaption>
</figure>

## The event lifecycle

When the user clicks (or taps, or hovers) on the canvas, the Scene:

1. Calls `findEntityAt(x, y)` to find the **target** — the topmost entity whose `isPointInside()` returns `true`.
2. Builds the **event path**: `[target, parent, grandparent, …, root]`.
3. Runs the **capture phase**: fires listeners registered with `{ capture: true }` starting from the root down to the target.
4. Runs the **bubble phase**: fires listeners (default phase) from the target back up to the root.

<figure>
  <img src="/images/event-capture-bubble.svg" alt="Diagram showing capture phase descending root→button (blue arrow) and bubble phase ascending button→root (orange arrow), with the button node highlighted as target" class="diagram" />
  <figcaption>Capture fires root → target; bubble fires target → root. The target receives both.</figcaption>
</figure>

## Listening for events

```typescript
entity.on(event, callback, options?)
entity.off(event, callback, options?)
```

The default phase is **bubble**. Pass `{ capture: true }` to intercept during the capture phase:

```typescript
// Bubble phase (default) — fires after children
btn.on('click', (e) => console.log('button clicked'));

// Capture phase — fires before children (interceptor pattern)
card.on(
  'click',
  (e) => {
    console.log('card sees click first');
    e.stopPropagation(); // prevents bubble reaching card again
  },
  { capture: true },
);
```

Available event types:

| Event            | Trigger                                    |
| ---------------- | ------------------------------------------ |
| `'click'`        | Pointer press + release on the same entity |
| `'hover'`        | Pointer enters the entity                  |
| `'pointerdown'`  | Pointer pressed                            |
| `'pointerup'`    | Pointer released                           |
| `'pointermove'`  | Pointer moved (while over the entity)      |
| `'pointerleave'` | Pointer left the entity                    |
| `'wheel'`        | Mouse wheel / trackpad scroll              |
| `'keydown'`      | Key pressed (while the entity holds focus) |
| `'keyup'`        | Key released                               |
| `'change'`       | Form control value changed                 |
| `'focus'`        | Shadow DOM node gained focus               |
| `'blur'`         | Shadow DOM node lost focus                 |

## VectoUIEvent

The callback receives a `VectoUIEvent` with these members:

```typescript
interface VectoUIEvent {
  type: string; // event name
  target: Entity; // entity where the event originated
  currentTarget: Entity; // entity whose listener is currently running

  bubbles: boolean;

  // Propagation control
  stopPropagation(): void; // stop after current node
  stopImmediatePropagation(): void; // also skip remaining listeners on this node
  preventDefault(): void;

  defaultPrevented: boolean;

  // Pointer events
  clientX: number;
  clientY: number;

  // Wheel events
  deltaX: number;
  deltaY: number;

  // Keyboard events
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;

  // The original native DOM event
  nativeEvent?: Event;
}
```

## `emit()` vs `dispatchEvent()`

VectoUI has two dispatch paths:

| Method                               | What it does                                                                |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `entity.emit(event, payload)`        | Fires **this entity's own bubble-phase listeners only**. No tree traversal. |
| `entity.dispatchEvent(vectoUIEvent)` | Full DOM-like **capture + bubble** traversal across the tree.               |

`emit()` is how built-in components signal their own state changes internally (e.g., a `Toggle` emitting its own `'change'`). You almost never call `dispatchEvent()` directly — the `Scene` calls it for pointer and keyboard events coming from the browser.

```typescript
// Correct: listen to a button's click in bubble phase
btn.on('click', (e) => {
  /* ... */
});

// Correct: intercept a subtree's clicks before children handle them
container.on(
  'click',
  (e) => {
    if (isLocked) e.stopPropagation();
  },
  { capture: true },
);

// Correct: a component emitting its own state change (internal use)
this.emit('change', { value: this._value });
```

## Form change event payloads

Form controls (`Input`, `TextArea`, `Checkbox`, `Toggle`, `Slider`, `Dropdown`) emit a `'change'` event with typed payloads:

**`Input` and `TextArea`:**

```typescript
{
  value: string;
  selectionStart?: number;   // caret / selection start offset
  selectionEnd?: number;     // caret / selection end offset
  composition?: {
    start: number;
    length: number;
  } | null;                  // active IME pre-edit range, or null
}
```

**`Checkbox` and `Toggle`:**

```typescript
{
  checked: boolean;
}
```

**`Slider`:**

```typescript
{
  value: number;
}
```

**`Dropdown`:**

```typescript
{
  value: string;
}
```

Example — reading a text input value:

```typescript
const input = new Input({ width: 300, placeholder: 'Search…' });
input.on('change', (e) => {
  const { value, selectionStart } = e;
  console.log(`"${value}" — caret at ${selectionStart}`);
});
```

## Hit-testing: how the Scene finds the target

`scene.findEntityAt(x, y)` walks the tree **depth-first in reverse child order** (topmost-drawn children are tested first):

1. The overlay root is checked before the main root, so overlays (dropdowns, modals) always win.
2. Children are traversed in **reverse** — the last child added (rendered on top) is hit-tested first.
3. There is **no interactive filter**: a non-interactive entity can still be returned if `isPointInside()` returns `true`. Interactive filtering only affects shadow DOM projection, not hit-testing.
4. The traversal returns the first entity whose `isPointInside()` returns `true`, regardless of whether it has any listeners.

```typescript
// This works — returns the entity under the cursor
const hit = scene.findEntityAt(pointerX, pointerY);
if (hit) console.log('hit', hit.id);
```

## Stopping propagation

```typescript
child.on('click', (e) => {
  e.stopPropagation(); // parent won't see this click in bubble phase
});

// stopImmediatePropagation also stops other listeners on the same node
child.on('click', (e) => {
  e.stopImmediatePropagation();
});
child.on('click', () => {
  // This second listener on 'child' is NOT called if the first stops immediate propagation
});
```

## Wheel events and `preventDefault()`

The `Scene` forwards `wheel` events from the canvas. Call `e.preventDefault()` to stop the page from scrolling:

```typescript
myScroller.on('wheel', (e) => {
  this.scrollY += e.deltaY;
  e.preventDefault(); // stops the browser scroll
  this.scene?.markDirty();
});
```

> [!NOTE] > `ScrollView` calls `e.preventDefault()` automatically on wheel events, except when `Ctrl` is held (allowing browser zoom). If you build a custom scroll container, follow the same pattern.

## Keyboard events

Keyboard events are delivered to the entity that holds focus (via its shadow DOM node). They propagate up the tree with normal capture/bubble:

```typescript
inputEntity.on('keydown', (e) => {
  if (e.key === 'Enter') submitForm();
  if (e.key === 'Escape') cancelForm();
});
```

For global shortcuts (not tied to a focused element), listen on the `Scene`'s root or use a native `document.addEventListener`:

```typescript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
```

## Capture phase patterns

### Click-outside to close

```typescript
scene.add(overlay); // a dropdown, modal backdrop, etc.

// Root capture: fires before any entity handles the click
scene.getRoot().on(
  'click',
  (e) => {
    if (!overlay.isPointInside(e.clientX, e.clientY)) {
      closeOverlay();
    }
  },
  { capture: true },
);
```

### Locking a subtree

```typescript
panel.on(
  'click',
  (e) => {
    if (disabled) e.stopPropagation(); // all children are blocked
  },
  { capture: true },
);
```

## Full example: hover card

```typescript
import { Entity } from '@vecto-ui/core';
import type { IRenderer } from '@vecto-ui/core/renderer';

class HoverCard extends Entity {
  private hovered = false;

  constructor(private label: string) {
    super();
    this.width = 200;
    this.height = 80;
    this.interactive = true;

    this.on('hover', () => {
      this.hovered = true;
      this.animate({ scaleX: 1.04, scaleY: 1.04 }, 120);
    });

    this.on('pointerleave', () => {
      this.hovered = false;
      this.animate({ scaleX: 1, scaleY: 1 }, 120);
    });

    this.on('click', () => {
      console.log(`${this.label} clicked`);
    });
  }

  isPointInside(gx: number, gy: number): boolean {
    const p = this.getGlobalPosition();
    return gx >= p.x && gx <= p.x + this.width && gy >= p.y && gy <= p.y + this.height;
  }

  getA11yAttributes() {
    return { tag: 'button' as const, role: 'button', label: this.label };
  }

  render(renderer: IRenderer) {
    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, this.height, 12);
    renderer.fill(this.hovered ? '#1e293b' : '#0f172a');
    renderer.stroke('rgba(255,255,255,0.12)', 1);
    renderer.fillText(this.label, 16, 28, '600 18px Inter', '#f8fafc');
  }
}
```

## Troubleshooting

### A click fires but the wrong entity is the target

`findEntityAt` traverses children in **reverse** order (last added = tested first). If two entities overlap, the one added later wins. To make an entity always win, `add()` it after the others. To make it always lose, `add()` it before.

If the wrong entity intercepts during the **capture phase**, check for `stopPropagation()` calls on ancestors — a capture listener that stops propagation will prevent the event from ever reaching the intended target.

### Event listeners fire once but then stop

Event listeners added with `on()` are permanent until `off()` is called. If listeners appear to stop, check:

1. The entity was removed from the scene (`scene.remove(entity)` destroys it and its listeners).
2. A parent listener calls `e.stopPropagation()` before the event reaches your entity.
3. You accidentally called `off()` — sometimes via a cleanup function that runs earlier than expected.

### Wheel events fire but the page still scrolls

`wheel` events from the canvas bubble to the browser even if you listen to them on an entity. You must explicitly call `e.preventDefault()` to stop the page scroll:

```typescript
myEntity.on('wheel', (e) => {
  // ... handle scroll ...
  e.preventDefault(); // ← required to stop the browser scroll
});
```

Note: `ScrollView` does this automatically for its own wheel events (except with `Ctrl` held).

### `e.clientX` / `e.clientY` are `0` for keyboard events

`clientX`/`clientY` are pointer-event fields and are `0` for keyboard events. For keyboard events, use `e.key`, `e.shiftKey`, `e.ctrlKey`, `e.metaKey`.

> **Next:** [Physics & Animation](/learn/physics-engine/) — springs, spatial hashing, and the `update()` loop.
