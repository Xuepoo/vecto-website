import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';

// HAST plugin: transforms `> [!NOTE]` etc. into <div class="callout callout-note">
const calloutsPlugin = {
  name: 'callouts',
  element: {
    filter: ['blockquote'],
    visit(node) {
      const KINDS = new Set(['note', 'tip', 'warning', 'caution', 'important']);
      // Find first <p> child (skip whitespace text nodes)
      const fp = node.children.find((c) => c.type === 'element' && c.tagName === 'p');
      if (!fp) return;
      // Find first non-empty text child in the paragraph
      const ftIdx = fp.children.findIndex((c) => c.type === 'text' && c.value.trim());
      if (ftIdx === -1) return;
      const ft = fp.children[ftIdx];
      const m = ft.value.match(/^\[!([A-Z]+)\]/i);
      if (!m || !KINDS.has(m[1].toLowerCase())) return;
      const kind = m[1].toLowerCase();
      const rest = ft.value.slice(m[0].length).trimStart();
      // Strip the marker from the first text node
      const newFpChildren = rest
        ? fp.children.map((c, i) => (i === ftIdx ? { ...c, value: rest } : c))
        : fp.children.filter((_, i) => i !== ftIdx);
      // Drop the first paragraph entirely if it's now empty
      const fpEmpty = newFpChildren.every((c) => c.type === 'text' && !c.value.trim());
      const newFp = fpEmpty ? null : { ...fp, children: newFpChildren };
      const newChildren = node.children.map((c) => (c === fp ? newFp : c)).filter(Boolean);
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['callout', `callout-${kind}`] },
        children: newChildren,
      };
    },
  },
};

// Static site dogfooding VectoUI. No UI framework — pages are plain HTML/CSS and
// each demo is vanilla TS bundled by Astro's Vite pipeline. Deploys to Cloudflare
// Pages as a static `dist/`.
export default defineConfig({
  site: 'https://vecto-ui.xuepoo.xyz',
  trailingSlash: 'always',
  server: { port: 1111 },
  integrations: [sitemap()],
  markdown: {
    processor: satteri({ hastPlugins: [calloutsPlugin] }),
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: false,
    },
  },
});
