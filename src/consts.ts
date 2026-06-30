/** Site-wide constants, demo registry, and docs navigation (single source of truth). */
export const VERSIONS = {
  core: '0.9.2',
  ui: '0.4.2',
} as const;

export const SITE = {
  title: 'VectoUI',
  description: 'A mathematical UI rendering framework driven by Vectomancy',
  github: 'https://github.com/Xuepoo/vecto-ui',
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
      'Tens of thousands of particles simulated on a WebGPU compute pass — springing into the word “VectoUI”, flowing away from your cursor, with a transparent CPU fallback.',
    tag: 'WebGPU · Compute · particles',
  },
  {
    slug: 'chat',
    title: 'AI Chat — streaming Markdown',
    description:
      'A chat client whose entire transcript is rendered on canvas: Markdown streams in token-by-token, with code, tables, images, and SVG-rendered math, Mermaid, and ABC notation. Plays prebaked answers with zero config, or point it at a local Ollama.',
    tag: 'Streaming · Markdown · a11y',
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
  { slug: 'core-api', title: '@vecto-ui/core' },
  { slug: 'ui-components', title: '@vecto-ui/ui' },
  { slug: 'three', title: '@vecto-ui/three' },
  { slug: 'faq', title: 'FAQ' },
];
