/**
 * Split a (possibly partial, mid-stream) Markdown string into renderable
 * segments. Plain Markdown — including ordinary ```code``` fences — stays in
 * `markdown` segments rendered by the engine's Markdown component. Fenced blocks
 * tagged `mermaid`, `math`/`latex`, or `abc` are pulled out so the demo can
 * render them to SVG instead; `closed` is false while their closing fence hasn't
 * streamed in yet.
 */
export type SpecialType = 'mermaid' | 'math' | 'abc';

export type Segment =
  | { type: 'markdown'; text: string }
  | { type: SpecialType; code: string; closed: boolean };

const FENCE = /(?:^|\n)```(mermaid|math|latex|abc)[ \t]*\n([\s\S]*?)(\n```\n?|$)/g;

export function segmentMarkdown(md: string): Segment[] {
  if (md === '') return [];
  const out: Segment[] = [];
  let last = 0;
  FENCE.lastIndex = 0;

  const pushMarkdown = (text: string) => {
    if (text !== '') out.push({ type: 'markdown', text });
  };

  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(md)) !== null) {
    pushMarkdown(md.slice(last, m.index));
    const lang = m[1] === 'latex' ? 'math' : (m[1] as SpecialType);
    out.push({ type: lang, code: m[2], closed: m[3] !== '' });
    last = FENCE.lastIndex;
    if (m[3] === '') break; // unterminated block runs to the end of the input
  }
  pushMarkdown(md.slice(last));
  return out;
}
