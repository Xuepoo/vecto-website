---
title: 'Text & Typography'
description: "VectoJS's text system: cold/hot LayoutEngine split, streaming for LLM output, rich text with mixed styles, MSDF fonts, Arabic/BiDi, and exclusion shapes."
order: 7
---

# Text & Typography

VectoJS ships a full-featured text engine built around two key ideas: **separating measurement from layout** (so resize is cheap), and **memoizing at the paragraph level** (so token-by-token streaming is O(new tokens), not O(document)).

## Try it live

<figure class="sandbox">
  <div class="sandbox-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="sandbox-label">live · vectojs@0.9</span></div>
  <iframe src="/sandbox/text-streaming.html" class="sandbox-frame" loading="lazy" title="Text streaming interactive example" sandbox="allow-scripts allow-same-origin"></iframe>
  <figcaption><code>label.append(chunk)</code> called every 30 ms — O(changed paragraph), not O(document). Click Replay to restart the stream.</figcaption>
</figure>

## Choosing the right component

| Scenario                                      | Use              |
| --------------------------------------------- | ---------------- |
| Static or simple dynamic text                 | `Text`           |
| Mixed styles (bold, italic, links, colors)    | `RichText`       |
| Markdown documents                            | `Markdown`       |
| Resolution-independent GPU text (game UI, 3D) | `MSDFTextEntity` |
| Monospace grid (terminal)                     | `GridTextEntity` |
| Custom text backed by vector atlas            | `TextEntity`     |

`Text`, `RichText`, and `Markdown` live in `@vectojs/ui`. The rest are in `@vectojs/core`.

---

## Text

Single and multi-line text with automatic wrapping. Under the hood it runs the core `LayoutEngine` (same segmentation pipeline as every other text component).

```typescript
import { Text } from '@vectojs/ui';

const label = new Text('Hello, world', {
  font: '400 16px Inter', // CSS shorthand
  color: '#e2e8f0',
  maxWidth: 300, // wrap at 300px; omit for no wrapping
  lineHeight: 24, // line advance in px
  preserveLeadingSpaces: false,
});

label.setPosition(40, 40);
scene.add(label);
```

### Cold vs hot updates

`Text` has three mutation methods with very different costs:

```typescript
label.setText('New content'); // EXPENSIVE — cold pass: re-segment + re-measure
label.append(' more tokens'); // EFFICIENT — only the last paragraph is re-measured
label.setMaxWidth(200); // CHEAP — hot pass: re-wrap only, no re-measure
```

Use this distinction when streaming text token by token:

```typescript
// Wrong — rebuilds the full measured text on every token
for await (const token of stream) {
  label.setText((accumulated += token)); // O(document) per token → slow
}

// Correct — only the changed paragraph is re-measured
for await (const token of stream) {
  label.append(token); // O(new tokens) per token → efficient
}
```

When the user resizes the window, call `setMaxWidth(newWidth)` — it reflows with the cached measured text, so it is safe to call on every resize event.

---

## RichText

Multi-style inline text: bold, italic, colored, differently-sized, and linked runs, all flowing together on shared baselines.

```typescript
import { RichText } from '@vectojs/ui';
import type { StyledSpan } from '@vectojs/core';

const spans: StyledSpan[] = [
  { text: 'Build ' },
  { text: 'fast', style: { bold: true, color: '#00f0ff' } },
  { text: ' UIs with ', style: { italic: true } },
  { text: 'VectoJS', style: { bold: true, href: 'https://vectojs.xuepoo.xyz/' } },
  { text: '.' },
];

const rich = new RichText(spans, {
  font: '16px Inter',
  color: '#e2e8f0',
  maxWidth: 600,
  linkColor: '#38bdf8',
  onLinkClick: (href) => window.open(href, '_blank'),
});

scene.add(rich.setPosition(40, 40));
```

### `TextStyle` fields

```typescript
interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fontSize?: number; // overrides base font size for this run
  href?: string; // makes the run a link
}
```

> [!NOTE] > `bold` and `italic` affect rendering only, not measured width (bold strokes extend beyond the advance width slightly). `fontSize` **does** affect both measured width and line height, so mixing sizes on one line works correctly — each line's height is determined by its tallest glyph.

### Streaming `appendSpans()`

Like `Text.append()`, `appendSpans()` reuses unchanged leading paragraphs:

```typescript
const rich = new RichText([]);
scene.add(rich);

for await (const token of llmStream) {
  rich.appendSpans([{ text: token, style: { color: '#a5f3fc' } }]);
}
```

### Exclusion shapes (text flowing around obstacles)

Pass `exclusions` to make text flow around rectangular obstacles — CSS-like floats:

```typescript
const rich = new RichText(spans, {
  maxWidth: 500,
  exclusions: [
    { x: 0, y: 60, width: 120, height: 120 }, // avoid a 120×120 image at (0, 60)
  ],
});

// Later, update dynamically:
rich.setExclusions([{ x: 0, y: 60, width: 120, height: 120 }]);
```

The engine computes free horizontal intervals per line band (`computeLineSegments`) and fills each interval independently. BiDi reordering applies to the whole logical line after interval placement.

---

## Markdown

Renders Markdown into a VMT subtree using the `marked` library (GFM flavour).

```typescript
import { Markdown } from '@vectojs/ui';

const md = new Markdown('# Hello\n\nThis is **rich** text.', {
  maxWidth: 700,
  theme: {
    headingColor: '#f8fafc',
    codeColor: '#a5f3fc',
    bodyFont: 'Inter, sans-serif',
  },
});

scene.add(md.setPosition(40, 40));
```

Supported tokens: headings (h1–h6), paragraphs, fenced code blocks with keyword highlighting, blockquotes, ordered/unordered lists, horizontal rules, inline code/bold/italic/links, and GFM tables (rendered via the `Table` component).

### Streaming Markdown

For LLM output, use `appendMarkdown()` — never loop `setContent(fullText)`:

```typescript
const md = new Markdown('', { maxWidth: 700 });
scene.add(md);

for await (const token of llmStream) {
  md.appendMarkdown(token);
}
```

`appendMarkdown()` re-lexes the full buffer, diffs tokens against the last render, reuses unchanged entity prefix, and updates the last paragraph in-place. Cost is O(changed paragraph). `setContent()` does a full rebuild and is O(document) — use it only for one-shot replacement.

---

## How the LayoutEngine works

Understanding the cold/hot split helps you make the right call for performance.

### Cold pass — measure once

`prepare(text)` and `prepareRich(spans)` segment text into paragraphs, apply Arabic shaping and BiDi, segment into words and graphemes with `Intl.Segmenter`, and measure each glyph's advance width. The result (`PreparedText`) is cached by paragraph content at the given font size.

**This is the expensive step.** Only run it when content changes.

### Hot pass — position always

`layoutPrepared(prepared)` takes the cached `PreparedText` and applies wrap constraints (`maxWidth`, `maxHeight`, exclusion shapes) to produce positioned `LayoutNode[]`. This is pure arithmetic — no segmentation, no measurement.

`setMaxWidth()` only runs the hot pass, reusing the cached `PreparedText`. This is why responsive reflow is cheap: you can call it on every pixel of a resize drag without jank.

### Paragraph-level memoization

The cache key is `fontSize + paragraphText` (for plain text) or `fontSize + paragraphText + styleSig` (for rich text). When you append one token to a document with many paragraphs:

1. All unchanged paragraphs are **cache hits** — returned by reference instantly.
2. Only the last (changed) paragraph is re-measured.

This turns streaming cost from O(document length) to O(tokens in the current paragraph).

---

## MSDF fonts

Multi-channel Signed Distance Field fonts render crisp text at any zoom level without rasterization artifacts. Use them for game-style UIs, zoomed interfaces, or high-DPR displays.

### Generating an atlas

Install `msdf-atlas-gen` and run:

```bash
msdf-atlas-gen -font myfont.ttf -type msdf -format png -imageout atlas.png -json atlas.json
```

This produces `atlas.png` (the glyph texture) and `atlas.json` (glyph metrics, advance widths, UV bounds).

### Loading in VectoJS

```typescript
import { MSDFFont, MSDFTextEntity } from '@vectojs/core/text';

// Parse the JSON
const fontData = await fetch('/fonts/atlas.json').then((r) => r.json());
const font = MSDFFont.parse(fontData);

// Load the texture image
const img = new window.Image();
img.src = '/fonts/atlas.png';
await new Promise((r) => (img.onload = r));

// Create the text entity
const msdfText = new MSDFTextEntity('Hello GPU text', {
  font,
  texture: img, // TexImageSource
  fontSize: 48,
  color: '#ffffff',
  letterSpacing: 0,
  fallbackFont: 'sans-serif', // used when pointBackend is not 'webgl'
});

scene.add(msdfText.setPosition(40, 40));
```

`MSDFTextEntity` offloads layout to a background `LayoutWorkerManager` worker (debounced, zero-copy via `Float32Array` transfer). Text appears one async tick after construction or `setText()`. When `pointBackend: 'webgl'` is set on the scene, glyphs are drawn via the WebGL MSDF program; otherwise the entity falls back to native `fillText`.

### `MSDFFont.layout()` directly

If you are building a custom renderer or need the glyph quads yourself:

```typescript
const result = font.layout('Hello', 48);
// result.glyphs: PositionedGlyph[]
// Each glyph: { char, x, y, w, h, u0, v0, u1, v1 }

for (const g of result.glyphs) {
  renderer.setMSDFTexture(texture, font.distanceRange);
  renderer.addGlyph(g.x, g.y, g.w, g.h, g.u0, g.v0, g.u1, g.v1, '#fff');
}
```

---

## Arabic and bidirectional text

Arabic and bidirectional text are handled **automatically** inside `prepare()` and `prepareRich()`. You do not need to call any shaping APIs yourself.

### What happens internally

1. **Arabic shaping** (`ArabicShaper.shapeArabic`): substitutes Arabic characters with their contextual presentation forms (initial/medial/final/isolated) and applies Lam-Alef ligatures. The `indexMap` tracks shaped→source index for caret hit-testing.

2. **BiDi level assignment** (`BidiResolver.resolveLevels`): assigns a nesting level (0 = LTR, 1 = RTL, higher = deeper embed) to each character using UAX#9 rules. Embed controls (LRE/RLE/PDF) are honored.

3. **Visual reordering** (`BidiResolver.reorderVisual`): at the end of each line, reverses runs from the highest level down to 1, producing correct visual word order.

This means a `Text` or `RichText` with Arabic or Hebrew content just works:

```typescript
const arabic = new Text('مرحبا بك في VectoJS', { font: '20px sans-serif', color: '#f8fafc' });
const hebrew = new RichText([{ text: 'שלום ' }, { text: 'VectoJS', style: { bold: true } }]);
```

> [!NOTE]
> Newlines (`\n`) always reset the Arabic shaping context and BiDi state. Soft-wrapped lines within the same paragraph share one shaping pass, so multi-line Arabic paragraphs shape correctly across wraps.

---

## Helper functions

`measureText`, `wrapLines`, and `fontSizePx` are exported from `@vectojs/ui` for use in custom components.

```typescript
import { measureText, wrapLines, fontSizePx } from '@vectojs/ui';

// Rendered pixel width, LRU-cached (cap 1000)
const w = measureText('Hello world', '600 16px Inter');

// Greedy word-wrap — returns string[]
const lines = wrapLines('A longer text that wraps', '16px sans-serif', 200);

// Extract the px size from a CSS font shorthand
const size = fontSizePx('600 16px Inter'); // → 16
```

`measureText` shapes Arabic text via `ArabicShaper` before measuring, so it returns the correct visual width for Arabic runs.

---

## Performance guide

| Scenario                              | Best approach                                                 |
| ------------------------------------- | ------------------------------------------------------------- |
| Static text, set once                 | `new Text(content, opts)` — one cold pass                     |
| Append-only streaming (LLM)           | `text.append(token)` or `md.appendMarkdown(token)`            |
| Responsive resize                     | `text.setMaxWidth(newW)` — hot pass only                      |
| 10,000+ glyphs/frame (e.g. data grid) | `LayoutResultBuffer` + `layoutPreparedIntoBuffer()` — zero GC |
| Resolution-independent text           | `MSDFTextEntity` + `pointBackend: 'webgl'`                    |
| Arabic / Hebrew / RTL                 | Any `Text`/`RichText`/`Markdown` — automatic                  |
| Text flowing around images            | `RichText` + `exclusions: ExclusionRect[]`                    |

## Troubleshooting

### Text appears too wide or at the wrong position

`measureText` and the `LayoutEngine` both use a canvas `measureText` call with the exact CSS font string. If the font family has not loaded yet (e.g., a web font), the browser substitutes a fallback font with different metrics, causing a mismatch between layout and render.

Ensure web fonts are loaded before constructing `Text` or `RichText`:

```typescript
await document.fonts.ready;
const label = new Text('Hello', { font: '16px Inter' });
```

### `append()` is slower than expected for long documents

`append()` memoizes at the **paragraph level** (split by `\n`). If your entire document is one long paragraph with no newlines, every `append()` call remeasures the whole paragraph.

For streaming content, insert a newline after each paragraph to allow the cache to split them:

```typescript
md.appendMarkdown(chunk);
// If the LLM output naturally has paragraphs, the memoization works automatically.
// If it is one endless run-on sentence, performance degrades to O(document).
```

### `MSDFTextEntity` text is missing for the first frame

`MSDFTextEntity` lays text off-thread via `LayoutWorkerManager`. The result arrives one async tick after construction or `setText()`. This is by design — the entity calls `scene.markDirty()` when the layout callback fires, triggering a repaint.

If using `renderMode: 'onDemand'`, this repaint will happen correctly. If you need text to appear synchronously (e.g., in a screenshot test), wait for the next `rAF` after `scene.start()`.

### RichText exclusions are not applied

Exclusion shapes only work with `layoutPrepared()`, not with `layoutPreparedIntoBuffer()`. If you are using a custom zero-GC rendering path with the buffer, exclusions are silently ignored. Use `layoutPrepared()` for exclusion support.

> **Next:** [Accessibility](/learn/accessibility/) — how the shadow DOM makes your canvas UI screen-reader and agent-drivable.
