/** Site-wide constants and the demo registry (single source for the gallery + pages). */
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
];

export const demoBySlug = (slug: string): DemoMeta => {
  const d = DEMOS.find((x) => x.slug === slug);
  if (!d) throw new Error(`unknown demo: ${slug}`);
  return d;
};
