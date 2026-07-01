---
title: 'Layout and Typography on Canvas: Fast Text Without Reflow'
description: 'How VectoJS handles web layout and typography without the DOM — a mathematical layout engine, cold/hot text measurement, streaming updates, and text that flows around shapes. No reflow, no layout shift.'
date: 2026-07-01
author: Xuepoo
tags: [typography, layout, performance]
---

Two of the hardest problems on the web are the two you notice least when they work: **laying out a page** and **setting text on it**. When they go wrong, users feel it immediately — content jumps as fonts load, scrolling stutters, and a resize repaints the world. Google even scores it: **Cumulative Layout Shift (CLS)** is a Core Web Vital precisely because unstable layout is such a common, measurable failure.

VectoJS treats layout and typography as _mathematics_ rather than as a cascade of style rules. This post explains what that buys you — and why it matters for both users and search rankings. (If you're new to the philosophy, start with [Rethinking Frontend](/blog/rethinking-frontend/).)

## Why the DOM makes layout and text expensive

In a traditional page, layout is an emergent property of the browser's engine. You set styles; the engine decides positions. That indirection is the source of three chronic problems:

1. **Reflow and layout thrashing.** Reading a layout value (`offsetHeight`) after writing a style forces the browser to synchronously recompute geometry. Do it in a loop and frame times collapse.
2. **Layout shift.** Late-arriving images, ads, or web fonts nudge everything below them. That's the CLS you get penalized for.
3. **Font loading flashes.** FOUT and FOIT (flash of unstyled / invisible text) exist because the browser must lay text out before it knows the font's true metrics.

None of these are bugs. They're the cost of letting a document engine own your geometry.

## Layout as math, not cascade

VectoJS renders everything to a single `<canvas>`, so there is no document engine to negotiate with. Layout is computed in plain TypeScript, in memory, and then painted **once** per frame. Containers like stacks and flows position their children with arithmetic you can read and predict — every entity has a position, a scale, and a rotation expressed as a transform matrix.

Because the geometry lives in your own data structures, a resize doesn't trigger a cascade of reflows across a document tree. It re-runs one layout pass and repaints. There is no hidden feedback loop between reading and writing, so **layout thrashing is structurally impossible** — you can't accidentally interleave measurement and mutation when measurement is just a function call.

The math behind those transforms — and the closed-form inverse used to turn a click back into an entity's local space — is covered in [Mathematical Foundations](/learn/math-foundations/).

## Typography: separate measurement from layout

Text is where most canvas frameworks give up and fall back to the DOM. VectoJS doesn't. Its text engine is built on one decisive idea: **separate measuring glyphs from placing them.**

The `LayoutEngine` splits every text update into a _cold_ pass and a _hot_ pass:

- **Cold pass** — segment the string and measure each run's glyphs. This is the expensive part, and it only runs when the _content_ changes.
- **Hot pass** — given cached measurements, wrap the text to a width. This is cheap, so re-wrapping on every resize frame costs almost nothing.

```typescript
import { Text } from '@vectojs/ui';

const para = new Text('Streaming from the model…', {
  font: '400 16px Inter',
  maxWidth: 640, // wrap width — a pure layout constraint
  lineHeight: 24,
});
scene.add(para);

para.setMaxWidth(480); // HOT: re-wrap only, no re-measure
para.setText('New content'); // COLD: re-segment + re-measure
```

That single split is why VectoJS text reflows smoothly under a drag-to-resize while the DOM equivalent would be re-measuring the whole paragraph on every pointer move. The full component matrix — `Text`, `RichText`, `Markdown`, `MSDFTextEntity` — is documented in [Text & Typography](/learn/text-typography/).

## Streaming text is O(new tokens), not O(document)

Large-language-model output arrives token by token. The naive approach — re-set the full string on every token — makes each update cost more than the last, because the whole document is re-measured every time. VectoJS memoizes at the **paragraph** level:

```typescript
para.append(' one more chunk'); // only the last paragraph is re-measured
```

`append()` is O(changed paragraph), so a 10,000-word transcript streams at a constant per-token cost. This is the same machinery that lets our [AI Chat demo](/demos/chat/) render streaming Markdown — code blocks, tables, and math — entirely on canvas without the layout melting down.

## Text that flows around shapes

Here's something the DOM can't do without heavy hacks: wrap a paragraph around an arbitrary obstacle. VectoJS models a line of text as a closed interval and each obstacle as a subtraction, then solves the **set difference** to find the runs of free space:

$$I_{\text{allowed}} = I_0 \setminus \bigcup_{k=1}^{K} E_k$$

The result is real magazine-style text flow around images and callouts, computed with interval algebra instead of a reflow engine. The derivation lives in the [Set-Difference Algebra](/learn/math-foundations/) section of the math foundations.

## Rich text, Markdown, and going resolution-independent

The same layout core powers higher-level components:

- **`RichText`** — mixed styles, inline links, and colors in one measured run.
- **`Markdown`** — full documents, including GFM tables, that stream in incrementally.
- **`MSDFTextEntity`** — multi-channel signed-distance-field glyphs that stay crisp at any zoom, for game UIs and 3D scenes.
- **BiDi and shaping** — right-to-left scripts like Arabic and Hebrew are reordered and shaped in the layout engine, not bolted on.

## Why this matters — for users and for SEO

When layout is deterministic and text measurement is cached, three things follow: there is **no layout shift** (nothing to penalize your Core Web Vitals), there is **no reflow tax** on animation, and there is **no font-loading flash** because you control when and how metrics are applied. You trade the browser's convenient-but-opaque layout engine for arithmetic you own end to end.

That's the same trade at the heart of the whole framework: stop fighting the document, and start treating the interface as a mathematical canvas. If this resonated, the companion essays [Rethinking Frontend](/blog/rethinking-frontend/) and [Beyond JSX and Templates](/blog/beyond-jsx/) make the broader case.

## Related reading

- [Rethinking Frontend: The VectoJS Philosophy](/blog/rethinking-frontend/) — why we abandoned the DOM.
- [Beyond JSX and Templates](/blog/beyond-jsx/) — the pure-TypeScript developer experience.
- [Text & Typography](/learn/text-typography/) — the full text-engine reference.
- [Mathematical Foundations](/learn/math-foundations/) — transforms, hit-testing, and set-difference text flow.
