---
title: 'UI Components'
description: 'Overview of the @vectojs/ui component library: forms, layout containers, overlays, and rich content.'
order: 5
---

# UI Components

The `@vectojs/ui` package provides a set of ready-to-use, production-quality components built on top of `@vectojs/core`. Every component renders entirely on canvas; accessibility comes from the automatic A11y shadow DOM layer.

## All Components Extend `UIComponent`

<figure>
  <img src="/images/entity-hierarchy.svg" alt="Entity class hierarchy showing all built-in UI components" class="diagram" />
  <figcaption>Every component inherits position, scale, rotation, animate(), and the full event system from Entity.</figcaption>
</figure>

`UIComponent` extends `Entity` and adds a shared box model with AABB hit-testing. All inherited props (`x`, `y`, `width`, `height`, `opacity`, `interactive`, `animate`, `on`/`off`) work on every component.

> **Note on `interactive`:** Most form components (`Button`, `Input`, `Text`, etc.) set `this.interactive = true` in their constructors. `Card` is decorative by default — it becomes interactive only when you pass a `label` option.

## Layout Containers

### `Stack`

A flexbox-like container — positions children sequentially along a main axis:

```typescript
import { Stack } from '@vectojs/ui';
import { Button, Text } from '@vectojs/ui';

const col = new Stack({ direction: 'vertical', gap: 12 });
col.add(new Text('Hello'));
col.add(new Button('Click me'));
scene.add(col.setPosition(40, 40));
```

Supports `direction`, `gap`, `align` (cross-axis), and optional `wrap` with `maxWidth`/`maxHeight`.

### `Flow`

A `Stack` pre-wired as `{ direction: 'horizontal', wrap: true }` — for chip rows and tag clouds:

```typescript
import { Flow } from '@vectojs/ui';

const tags = new Flow({ gap: 8, maxWidth: 400 });
for (const label of ['TypeScript', 'WebGPU', 'Canvas']) {
  tags.add(new Button(label, { bg: '#1e293b', padding: 6 }));
}
scene.add(tags.setPosition(20, 20));
```

### `Card`

A rounded background panel — add children on top:

```typescript
import { Card } from '@vectojs/ui';

const card = new Card({
  width: 300,
  height: 200,
  bg: 'rgba(15, 23, 42, 0.8)',
  border: 'rgba(255, 255, 255, 0.1)',
  radius: 16,
  label: 'Settings panel', // makes it interactive + role="group"
});
card.add(toggle.setPosition(24, 24));
scene.add(card.setPosition(100, 100));
```

## Form Controls

All form controls project a real, transparent shadow DOM node. Agents and screen readers interact through those native elements; the canvas renders the visuals.

### `Button`

```typescript
import { Button } from '@vectojs/ui';

const btn = new Button('Save', {
  bg: '#2563eb',
  hoverBg: '#3b82f6',
  onClick: () => save(),
});
scene.add(btn.setPosition(20, 20));
```

Auto-sizes to label. Projects `<button>` → `getByRole('button', { name: 'Save' })`.

### `Input` (single-line)

```typescript
import { Input } from '@vectojs/ui';

const input = new Input({
  width: 300,
  placeholder: 'Search…',
  onChange: (value) => console.log(value),
});
scene.add(input.setPosition(20, 80));
```

Backed by a **real transparent `<input>`** — the browser handles all typing, IME, clipboard, and undo natively. The canvas only draws the visual. IME composition underlines, caret blink, and RTL selection are all rendered.

### `TextArea` (multi-line)

Same model as `Input`, backed by a `<textarea>`. Supports `lineHeight`, vertical scroll-to-caret, and `lineOfOffset(offset)` for caret-to-line mapping.

### `Toggle`

```typescript
import { Toggle } from '@vectojs/ui';

const toggle = new Toggle({
  label: 'Dark mode',
  checked: false,
  accent: '#6366f1',
  onChange: (checked) => applyTheme(checked),
});
```

Projects `role="switch"` with `aria-checked`. Both canvas clicks and keyboard activation (Enter/Space on the shadow div) route through the same `onChange` callback.

### `Checkbox`

```typescript
import { Checkbox } from '@vectojs/ui';

const cb = new Checkbox({
  label: 'Subscribe to updates',
  checked: true,
  accent: '#2563eb',
  onChange: (checked) => setSubscribed(checked),
});
```

Backed by `<input type="checkbox">` — natively toggleable by keyboard and assistive tech.

### `Slider`

```typescript
import { Slider } from '@vectojs/ui';

const slider = new Slider({ min: 0, max: 100, value: 50, width: 200 });
slider.on('change', (e) => console.log(e.value));
```

Draggable thumb; value rounded to nearest integer. Projects `role="slider"`.

### `Dropdown`

```typescript
import { Dropdown } from '@vectojs/ui';

const dd = new Dropdown(['Small', 'Medium', 'Large'], { value: 'Medium' });
dd.on('change', (e) => setSize(e.value));
scene.add(dd.setPosition(20, 160));
```

Opens a floating overlay menu via `scene.showOverlay()`; closes on selection or Escape. Full ARIA combobox/listbox wiring.

## Text & Typography

### `Text`

Wrapping multi-line text with a cold/hot layout split:

```typescript
import { Text } from '@vectojs/ui';

const label = new Text('Hello, VectoJS!', {
  font: '600 18px "Outfit", sans-serif',
  color: '#e2e8f0',
  maxWidth: 400,
  lineHeight: 28,
});
```

- `setText(text)` — re-measures (cold pass).
- `append(text)` — streaming path; only re-measures the changed last paragraph.
- `setMaxWidth(w)` — reflow only, no re-measure (hot pass).

### `RichText`

Multi-style inline text with bold/italic/color/size runs, link hotspots, and exclusion shapes:

```typescript
import { RichText } from '@vectojs/ui';

const rich = new RichText(
  [
    { text: 'Zero DOM, ' },
    { text: 'accessible', style: { bold: true, color: '#38bdf8' } },
    { text: ' and agent-native.' },
  ],
  { maxWidth: 500 },
);
```

For streaming: use `appendSpans(newSpans)` — O(changed paragraph).

## Overlays

### `Modal`

```typescript
import { Modal } from '@vectojs/ui';

const modal = new Modal('Confirm Delete', {
  modalWidth: 420,
  modalHeight: 200,
});
scene.showOverlay(modal);

// From within: modal.close() animates and self-removes.
```

Spring-animated scale-in. Includes a built-in Close button.

### `ScrollView`

A clipped viewport with spring-physics scroll:

```typescript
import { ScrollView } from '@vectojs/ui';

const feed = new ScrollView({ width: 360, height: 600 });
for (const item of items) feed.add(new Card({ ... }));
scene.add(feed.setPosition(20, 20));
feed.scrollToBottom();  // e.g. for a chat log
```

Wheel, touch-drag, and programmatic `scrollTo(y)` all supported.

## Rich Content

### `Markdown`

Renders a Markdown string into a VMT subtree — headings, paragraphs, code blocks with syntax highlighting, tables, blockquotes, links, and inline formatting:

```typescript
import { Markdown } from '@vectojs/ui';

const doc = new Markdown('## Hello\n\nThis is **bold** and `code`.', {
  maxWidth: 700,
});
scene.add(doc.setPosition(40, 40));
```

For LLM streaming, use `appendMarkdown(chunk)` — it diffs the token stream and only rebuilds the last changed paragraph, keeping cost O(changed paragraph) not O(document).

```typescript
const md = new Markdown('', { maxWidth: 600 });
scene.add(md);
for await (const token of llmStream) {
  md.appendMarkdown(token);
}
```

<figure>
  <img src="/images/component-gallery.svg" alt="VectoJS component gallery showing Button, Text, Input, Card, ScrollView, Slider, Toggle, Checkbox, and Dropdown" class="diagram" />
  <figcaption>All components render entirely on canvas. Shadow DOM nodes (invisible) provide native accessibility and automation support.</figcaption>
</figure>

See the [UI Components Reference](/reference/ui-components/) for complete option signatures.
