import { defineConfig } from 'astro/config';

// Static site dogfooding VectoUI. No UI framework — pages are plain HTML/CSS and
// each demo is vanilla TS bundled by Astro's Vite pipeline. Deploys to Cloudflare
// Pages as a static `dist/`.
export default defineConfig({
  site: 'https://vecto-ui.xuepoo.xyz',
  trailingSlash: 'always',
  server: { port: 1111 },
});
