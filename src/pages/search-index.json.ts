import { getCollection, render } from 'astro:content';
import type { APIRoute } from 'astro';

export interface SearchEntry {
  title: string;
  /** Short body excerpt for body-text search. Not displayed but matched. */
  snippet?: string;
  href: string;
  section: string;
  /** Depth: 0 = page title, 1+ = heading level */
  depth: number;
}

// Extract plain-text snippet for each heading section from raw markdown.
// Returns a map of heading slug → first ~140 chars of body text under it.
function extractSnippets(body: string): Map<string, string> {
  const out = new Map<string, string>();
  // Split on ATX headings (##, ###, ####)
  const parts = body.split(/^#{1,4} .+$/m);
  const headingMatches = [...body.matchAll(/^#{1,4} (.+)$/gm)];

  for (let i = 0; i < headingMatches.length; i++) {
    const headingText = headingMatches[i][1].trim();
    const slug = headingText
      .toLowerCase()
      .replace(/[`*_[\]()]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const body = parts[i + 1] ?? '';
    // Strip markdown syntax and collapse whitespace
    const plain = body
      .replace(/```[\s\S]*?```/g, '') // fenced code blocks
      .replace(/`[^`]*`/g, '') // inline code (removes tags inside backticks too)
      .replace(/<[^>]+>/g, '') // residual HTML tags
      .replace(/^\|.+\|$/gm, '') // table rows
      .replace(/^\s*[-:]+\s*\|/gm, '') // table dividers
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text only
      .replace(/[#>*_~|\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    if (plain) out.set(slug, plain);
  }
  return out;
}

export const GET: APIRoute = async () => {
  const [learnEntries, refEntries] = await Promise.all([
    getCollection('learn'),
    getCollection('reference'),
  ]);

  const index: SearchEntry[] = [];

  for (const entry of learnEntries) {
    const base = `/learn/${entry.id}/`;
    const snippets = extractSnippets(entry.body ?? '');
    index.push({ title: entry.data.title, href: base, section: 'Learn', depth: 0 });
    const { headings } = await render(entry);
    for (const h of headings) {
      if (h.depth > 3) continue;
      index.push({
        title: h.text,
        snippet: snippets.get(h.slug),
        href: `${base}#${h.slug}`,
        section: `Learn › ${entry.data.title}`,
        depth: h.depth,
      });
    }
  }

  for (const entry of refEntries) {
    const base = `/reference/${entry.id}/`;
    const snippets = extractSnippets(entry.body ?? '');
    index.push({ title: entry.data.title, href: base, section: 'Reference', depth: 0 });
    const { headings } = await render(entry);
    for (const h of headings) {
      if (h.depth > 3) continue;
      index.push({
        title: h.text,
        snippet: snippets.get(h.slug),
        href: `${base}#${h.slug}`,
        section: `Reference › ${entry.data.title}`,
        depth: h.depth,
      });
    }
  }

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
};
