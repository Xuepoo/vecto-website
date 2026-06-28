/**
 * Fetch demo media that is too large to track in git (the pre-commit large-file
 * guard caps tracked files at 500 KB). Run by `bun run build` and `bun run dev`;
 * idempotent — skips anything already on disk. Keeps the repo lean while the
 * deployed site stays self-contained.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface Asset {
  path: string;
  url: string;
  note: string;
}

const ASSETS: Asset[] = [
  {
    path: 'public/demos/sample.mp4',
    url: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4',
    note: 'Sintel trailer © Blender Foundation, CC BY 3.0',
  },
];

for (const a of ASSETS) {
  if (existsSync(a.path)) {
    console.log(`✓ ${a.path} (already present)`);
    continue;
  }
  mkdirSync(dirname(a.path), { recursive: true });
  console.log(`↓ ${a.path}  ←  ${a.url}  (${a.note})`);
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${a.url}`);
  await Bun.write(a.path, res);
  console.log(`✓ ${a.path}`);
}
