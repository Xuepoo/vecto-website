/**
 * Prebaked questions + Markdown answers so the demo shows everything with zero
 * configuration. Each answer is streamed token-by-token at the chosen tokens/sec,
 * exercising the engine's incremental Markdown rendering plus the SVG-rendered
 * math / mermaid / abc blocks. Answers are about VectoUI itself.
 */
export interface QA {
  q: string;
  a: string;
}

export const SAMPLES: QA[] = [
  {
    q: 'What can I do with VectoUI?',
    a: `## What you can build with VectoUI

VectoUI renders an entire UI in **one \`<canvas>\`** — no per-element DOM — while
staying accessible and automatable. A few things it's good at:

- **Data-dense views**: thousands of live entities at 60fps (the danmaku demo holds
  ~5000 comments; the particle field, 150k points).
- **Rich streaming text** — like this message, laid out incrementally as tokens arrive.
- **Agent-driven UIs**: every interactive entity projects a real ARIA shadow node, so
  Playwright or an AI agent can \`getByRole().click()\` it.
- **Reflowing typography**: text re-wraps on resize and browser zoom — measure once,
  re-wrap for free.

> This whole reply is one canvas. The transcript holds a handful of DOM nodes, not
> one per token.

\`\`\`ts
import { Scene } from '@vecto-ui/core';
const scene = new Scene(canvas, { maxFPS: 60 });
scene.start();
\`\`\``,
  },
  {
    q: 'What is the underlying principle of VectoUI?',
    a: `## The underlying principle

Everything is **math on a canvas**. Layout, hit-testing, and animation are pure
functions over a virtual tree — the browser never reflows.

The render pipeline is a small DAG:

\`\`\`mermaid
graph LR
  A[Virtual tree] --> B[LayoutEngine]
  B --> C[Hit-test grid]
  B --> D[IRenderer]
  D --> E[Canvas2D / WebGL / WebGPU]
  A --> F[a11yRoot shadow DOM]
\`\`\`

Layout uses a **cold/hot split**: an expensive \`prepare()\` measures glyphs once, then
a cheap \`layoutPrepared()\` re-wraps on every resize. The relationship between font
size and the typeset width is effectively

\`\`\`math
W \\;=\\; \\sum_{i=1}^{n} a_i \\cdot s \\;+\\; (n-1)\\,t
\`\`\`

where \\(a_i\\) is each glyph's advance, \\(s\\) the scale, and \\(t\\) the tracking.`,
  },
  {
    q: 'What can VectoUI do that the DOM cannot?',
    a: `## Beyond the DOM

The DOM reflows and repaints on every change and chokes past a few hundred animated
nodes. VectoUI keeps the **node count flat** while animating thousands of things,
because they're not nodes at all — they're entries in a math tree.

It can also render things the DOM has no primitive for, like engraved music:

\`\`\`abc
X:1
T:VectoUI
M:4/4
K:C
C D E F | G A B c | c B A G | F E D C |
\`\`\`

…and it still exposes a semantic shadow layer for screen readers and agents. So you
get canvas performance **and** DOM-grade accessibility — not one or the other.`,
  },
];
