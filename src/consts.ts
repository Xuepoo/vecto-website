/** Site-wide constants, demo registry, and docs navigation (single source of truth). */

/**
 * A per-build cache-busting token for unhashed static assets (`/css/*`). Astro
 * evaluates this ONCE at build time and bakes it into every generated page, so a
 * redeploy always produces a new `?v=` URL. This matters because `Cache-Control`
 * headers can't retroactively invalidate a copy a browser already cached under an
 * older policy — changing the URL is the only thing that guarantees every visitor
 * fetches the new file immediately, regardless of what they'd cached before.
 */
export const BUILD_ID = Date.now().toString(36);

export const VERSIONS = {
  core: '0.9.2',
  ui: '0.4.2',
} as const;

export const SITE = {
  title: 'VectoJS',
  description: 'A mathematical UI rendering framework driven by Vectomancy',
  github: 'https://github.com/vectojs/vectojs',
};

export interface DemoMeta {
  slug: string;
  title: string;
  description: string;
  tag: string;
}

export const DEMOS: DemoMeta[] = [
  {
    slug: 'danmaku',
    title: 'Danmaku at scale',
    description:
      'Thousands of live comments on one canvas — each individually interactive and accessible, where DOM-based danmaku chokes past ~200.',
    tag: 'Stress test · Interaction · a11y',
  },
  {
    slug: 'nexus',
    title: 'Nexus — a WebGPU particle field',
    description:
      'Tens of thousands of particles simulated on a WebGPU compute pass — springing into the word “VectoJS”, flowing away from your cursor, with a transparent CPU fallback.',
    tag: 'WebGPU · Compute · particles',
  },
  {
    slug: 'chat',
    title: 'AI Chat — streaming Markdown',
    description:
      'A chat client whose entire transcript is rendered on canvas: Markdown streams in token-by-token, with code, tables, images, and SVG-rendered math, Mermaid, and ABC notation. Plays prebaked answers with zero config, or point it at a local Ollama.',
    tag: 'Streaming · Markdown · a11y',
  },
  {
    slug: 'catch',
    title: 'Fruit Catch',
    description:
      'A falling-fruit catcher, osu!Catch-style: move the plate with your mouse or arrow keys to grab the fruit the goal asks for. Zero DOM — fruit, catcher, HUD, and win screen are one canvas Entity.',
    tag: 'Interaction · Game · Zero-DOM',
  },
  {
    slug: 'graph',
    title: 'Knowledge Graph',
    description:
      'An infinite pan/zoom canvas mapping the VectoJS ecosystem — real packages and concepts as a labeled backbone, surrounded by thousands of colored satellite nodes. Static layout, WebGL-batched, where DOM/SVG graph libraries choke past a couple thousand nodes.',
    tag: 'Infinite canvas · Scale · Graph',
  },
];

export const demoBySlug = (slug: string): DemoMeta => {
  const d = DEMOS.find((x) => x.slug === slug);
  if (!d) throw new Error(`unknown demo: ${slug}`);
  return d;
};

export interface DocPage {
  slug: string;
  title: string;
}

export const LEARN_PAGES: DocPage[] = [
  { slug: 'introduction', title: 'Introduction' },
  { slug: 'math-foundations', title: 'Mathematical Foundations' },
  { slug: 'getting-started', title: 'Getting Started' },
  { slug: 'core-scene', title: 'Core Scene' },
  { slug: 'custom-entity', title: 'Custom Entities' },
  { slug: 'events', title: 'Events & Hit-Testing' },
  { slug: 'physics-engine', title: 'Physics & Animation' },
  { slug: 'particles', title: 'Particle Systems' },
  { slug: 'performance', title: 'Performance' },
  { slug: 'text-typography', title: 'Text & Typography' },
  { slug: 'accessibility', title: 'Accessibility' },
  { slug: 'ui-components', title: 'UI Components' },
  { slug: 'cookbook', title: 'Cookbook' },
];

export const REFERENCE_PAGES: DocPage[] = [
  { slug: 'core-api', title: '@vectojs/core' },
  { slug: 'ui-components', title: '@vectojs/ui' },
  { slug: 'three', title: '@vectojs/three' },
  { slug: 'faq', title: 'FAQ' },
];
