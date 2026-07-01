---
title: 'Getting Started'
description: 'Install VectoJS, create a Scene, and build a complete settings panel with Input, Toggle, Slider, Button, and ScrollView.'
order: 2
---

# Getting Started

This guide walks you through installing VectoJS and building a complete interactive settings panel — a realistic example that exercises forms, layout, scrolling, and accessibility.

## Installation

```bash
bun add @vectojs/core @vectojs/ui
```

VectoJS is split into a core math engine and a high-level component library. Most apps import from both.

## HTML setup

VectoJS needs a `<canvas>` element with a positioned parent:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My VectoJS App</title>
    <style>
      body {
        margin: 0;
        overflow: hidden;
        background: #0a0a0f;
      }
      #app {
        position: relative;
        width: 100vw;
        height: 100vh;
      }
      #canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <canvas id="canvas"></canvas>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

The parent `<div id="app">` must be `position: relative` — VectoJS inserts its accessibility shadow layer as an absolute-positioned sibling of the canvas. The `Scene` enforces this automatically, but setting it explicitly prevents visual jumps.

## Creating the Scene

```typescript
// src/main.ts
import { Scene } from '@vectojs/core';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const scene = new Scene(canvas, {
  maxFPS: 60,
  pointBackend: 'canvas', // 'webgl' for large point clouds
});

scene.start();
```

> [!NOTE]
> The constructor is `new Scene(canvas: HTMLCanvasElement, options?)`. It takes a DOM element, not a `{ canvasId }` string.

## Try it live

<figure class="sandbox">
  <div class="sandbox-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="sandbox-label">live · vectojs@0.9</span></div>
  <iframe src="/sandbox/getting-started.html" class="sandbox-frame" loading="lazy" title="Getting Started interactive example" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption>Counter + Toggle + Slider — all running on canvas with no DOM components. Click and interact.</figcaption>
</figure>

## Your first component

Add a `Toggle` to verify everything is wired:

```typescript
import { Toggle } from '@vectojs/ui';

const toggle = new Toggle({
  label: 'Dark mode',
  checked: true,
  onChange: (checked) => console.log('dark mode:', checked),
});

toggle.setPosition(40, 40);
scene.add(toggle);
```

Open the browser and inspect the DOM — you will find a real `<div role="switch" aria-checked="true" aria-label="Dark mode">` above the canvas. A Playwright test calling `page.getByRole('switch', { name: 'Dark mode' }).click()` will work.

---

## Building a settings panel

Let us build something more complete: a scrollable settings panel with a text input, toggles, a slider, and a submit button. All state lives in a plain object; the components read from and write to it.

```typescript
import { Scene } from '@vectojs/core';
import { Stack, Card, Text, Input, Toggle, Slider, Button, ScrollView } from '@vectojs/ui';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const scene = new Scene(canvas, { maxFPS: 60 });

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  username: '',
  notifications: true,
  highPerformance: false,
  particleCount: 5000,
};

// ── Helper: section heading ───────────────────────────────────────────────────
function heading(text: string): Text {
  return new Text(text, { font: '600 13px Inter', color: '#64748b' });
}

// ── Username field ────────────────────────────────────────────────────────────
const usernameLabel = heading('USERNAME');

const usernameInput = new Input({
  width: 320,
  height: 40,
  placeholder: 'your-username',
  value: state.username,
  font: '16px Inter',
  onChange: (value) => {
    state.username = value;
  },
});

// ── Toggle: notifications ─────────────────────────────────────────────────────
const notifLabel = heading('NOTIFICATIONS');

const notifToggle = new Toggle({
  label: 'Email notifications',
  checked: state.notifications,
  accent: '#6366f1',
  onChange: (checked) => {
    state.notifications = checked;
  },
});

// ── Toggle: high performance ──────────────────────────────────────────────────
const perfToggle = new Toggle({
  label: 'High-performance mode',
  checked: state.highPerformance,
  accent: '#6366f1',
  onChange: (checked) => {
    state.highPerformance = checked;
  },
});

// ── Slider: particle count ────────────────────────────────────────────────────
const particleLabel = heading('MAX PARTICLES');

const particleCountDisplay = new Text(`${state.particleCount.toLocaleString()}`, {
  font: '600 14px Inter',
  color: '#00f0ff',
});

const particleSlider = new Slider({
  min: 1000,
  max: 50000,
  value: state.particleCount,
  width: 280,
  progressColor: '#6366f1',
});

particleSlider.on('change', (e) => {
  state.particleCount = e.value;
  particleCountDisplay.setText(e.value.toLocaleString());
});

// Lay out label + display side by side
const particleRow = new Stack({ direction: 'horizontal', gap: 12, align: 'center' });
particleRow.add(particleLabel);
particleRow.add(particleCountDisplay);

// ── Save button ───────────────────────────────────────────────────────────────
const saveBtn = new Button('Save settings', {
  bg: '#6366f1',
  hoverBg: '#818cf8',
  padding: 14,
  onClick: () => {
    console.log('Saved:', state);
    saveBtn.animate({ scaleX: 0.95, scaleY: 0.95 }, 80).animate({ scaleX: 1, scaleY: 1 }, 80);
  },
});

// ── Main layout stack ─────────────────────────────────────────────────────────
const content = new Stack({ direction: 'vertical', gap: 20 });
content.add(usernameLabel);
content.add(usernameInput);
content.add(notifLabel);
content.add(notifToggle);
content.add(perfToggle);
content.add(particleRow);
content.add(particleSlider);
content.add(saveBtn);

// ── Scrollable card ───────────────────────────────────────────────────────────
const PANEL_W = 400;
const PANEL_H = 480;
const PADDING = 24;

const scroll = new ScrollView({ width: PANEL_W - PADDING * 2, height: PANEL_H - PADDING * 2 });
content.setPosition(0, 0);
scroll.add(content);

const card = new Card({
  width: PANEL_W,
  height: PANEL_H,
  radius: 16,
  border: 'rgba(255,255,255,0.08)',
  label: 'Settings panel', // makes the card a role="group" landmark
});

const titleText = new Text('Settings', { font: '700 22px Inter', color: '#f8fafc' });
titleText.setPosition(PADDING, PADDING);
card.add(titleText);

scroll.setPosition(PADDING, PADDING + 40);
card.add(scroll);

// Centre the card on screen
const cx = (window.innerWidth - PANEL_W) / 2;
const cy = (window.innerHeight - PANEL_H) / 2;
card.setPosition(cx, cy);
scene.add(card);

scene.start();

// ── Responsive resize ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
  card.setPosition((window.innerWidth - PANEL_W) / 2, (window.innerHeight - PANEL_H) / 2);
});
```

### What you get

- **`Stack`** positions children vertically with a 20 px gap — no manual `x`/`y` arithmetic.
- **`ScrollView`** clips and scrolls the content when it overflows the panel height.
- **`Card`** draws the rounded-rectangle background; with `label` set, it projects a `role="group"` landmark so screen readers announce the region.
- **`Input`** is backed by a real `<input>` shadow element — IME, clipboard, undo, and autofill all work.
- **`Button`** auto-sizes to the label and fires `onClick` from both canvas clicks and the shadow `<button>`.
- All components connect to your `state` object directly.

---

## Framework integration

VectoJS mounts on a `<canvas>`, so it integrates with any framework the same way a WebGL library does.

### React

```typescript
import { useEffect, useRef } from 'react';
import { Scene } from '@vectojs/core';
import { Button } from '@vectojs/ui';

export function VectoCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const scene = new Scene(ref.current!, { maxFPS: 60 });
    const btn = new Button('Click me');
    btn.setPosition(40, 40);
    scene.add(btn);
    scene.start();

    return () => scene.destroy();
  }, []);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}
```

### Vue 3

```typescript
<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { Scene } from '@vectojs/core';

const canvasRef = ref(null);
let scene;

onMounted(() => {
  scene = new Scene(canvasRef.value, { maxFPS: 60 });
  scene.start();
});

onUnmounted(() => scene?.destroy());
</script>

<template>
  <canvas ref="canvasRef" style="width:100%;height:100%" />
</template>
```

---

## Challenges

### Add a counter

Extend the settings panel so it tracks how many times the Save button has been clicked and displays the running total next to the button.

- Add a `clickCount` variable initialized to `0` in the state object.
- Create a `Text` entity that displays `'Saved 0 times'` and position it beside `saveBtn` using a horizontal `Stack`.
- Update the text on every click using `entity.setText(...)` and verify the count increments correctly after each press.

### Responsive layout

Make the panel reflow gracefully when the viewport is narrower than 480 px. The card should never overflow the window edges.

- In the `resize` event handler, compare `window.innerWidth` to `PANEL_W` and compute a clamped panel width that subtracts a minimum margin of 16 px on each side.
- Update `card.width`, the `ScrollView` width, and the `usernameInput` width to match the new panel width on every resize.
- Test by resizing the browser window to 320 px wide and confirming all content remains visible and nothing clips outside the card boundary.

### Theme toggle

Add a dark/light theme switch to the panel header that instantly updates the visual style of all components.

- Define two theme objects — one dark (current colors) and one light — each specifying values for card border color, heading text color, label text color, and button background.
- Add a `Toggle` with label `'Light mode'` above the `ScrollView` and wire its `change` event to apply the active theme's color values to every relevant entity.
- Ensure the card's `border` property and the `titleText` color both update when the theme changes, and call `scene.markDirty()` after each property update so the canvas repaints.

## Next steps

- [Core Scene](/learn/core-scene/) — the render loop, transform system, and idle throttle in depth.
- [Custom Entities](/learn/custom-entity/) — build your own canvas components.
- [Events & Hit-Testing](/learn/events/) — how pointer and keyboard events flow through the tree.
- [Core API Reference](/reference/core-api/) — full `Scene`, `Entity`, and `IRenderer` signatures.
