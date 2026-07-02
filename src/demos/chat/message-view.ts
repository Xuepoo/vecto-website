import { Entity } from '@vectojs/core';
import { Markdown, Stack, type MarkdownTheme } from '@vectojs/ui';
import { segmentMarkdown, type SpecialType } from './segment';
import { renderInlineMath } from './math-inline';

export type RenderSpecial = (
  type: SpecialType,
  code: string,
  maxWidth: number,
) => Promise<Entity | null>;

interface Slot {
  text: string; // last rendered source for this slot (markdown text, or special code+state)
  entity: Entity;
  md?: Markdown; // present for markdown slots so we can stream-append in place
}

const LABEL: Record<SpecialType, string> = { mermaid: 'diagram', math: 'equation', abc: 'score' };

/**
 * Renders one streaming assistant message. As raw Markdown accumulates it is
 * re-segmented (see {@link segmentMarkdown}); plain text flows through the
 * engine's incremental {@link Markdown.appendMarkdown} (append the delta, not
 * re-set the whole string — re-setting every token makes the layout grow without
 * bound), while mermaid / math / abc fences become SVG blocks via
 * {@link RenderSpecial} (a placeholder shows until the async render resolves).
 * The scene-graph children are only rebuilt when the segment set changes, so a
 * pure append just streams into the existing Markdown component.
 */
export class MessageView {
  readonly stack = new Stack({ direction: 'vertical', gap: 12, align: 'start' });
  private slots: Slot[] = [];

  constructor(
    private maxWidth: number,
    private theme: MarkdownTheme,
    private renderSpecial?: RenderSpecial,
    private onChange?: () => void,
  ) {}

  private mkMarkdown(text: string): Markdown {
    return new Markdown(text, { maxWidth: this.maxWidth, theme: this.theme });
  }

  update(raw: string): void {
    // Block $$…$$ is split out by segmentMarkdown (→ KaTeX SVG); inline $…$ inside
    // the remaining prose is converted to readable Unicode here, since it can't be
    // dropped as an SVG mid-paragraph.
    const segs = segmentMarkdown(raw).map((s) =>
      s.type === 'markdown' ? { ...s, text: renderInlineMath(s.text) } : s,
    );
    let structureChanged = segs.length !== this.slots.length;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prev = this.slots[i];

      if (seg.type === 'markdown') {
        if (prev?.md) {
          if (seg.text !== prev.text) {
            if (seg.text.startsWith(prev.text))
              prev.md.appendMarkdown(seg.text.slice(prev.text.length));
            else prev.md.setContent(seg.text);
            prev.text = seg.text;
          }
        } else {
          const md = this.mkMarkdown(seg.text);
          this.slots[i] = { text: seg.text, entity: md, md };
          structureChanged = true;
        }
        continue;
      }

      // special (mermaid / math / abc)
      const stateKey = `${seg.code}|${seg.closed}`;
      if (prev && !prev.md && prev.text === stateKey) continue; // unchanged special block
      const placeholder = this.mkMarkdown(`*rendering ${LABEL[seg.type]}…*`);
      const slot: Slot = { text: stateKey, entity: placeholder };
      this.slots[i] = slot;
      structureChanged = true;
      if (seg.closed && this.renderSpecial) {
        void this.renderSpecial(seg.type, seg.code, this.maxWidth).then((ent) => {
          if (ent && this.slots[i] === slot) {
            slot.entity = ent;
            this.rebuild();
          }
        });
      }
    }

    if (segs.length < this.slots.length) this.slots.length = segs.length;
    if (structureChanged) this.rebuild();
    else {
      this.stack.layout();
      this.onChange?.();
    }
  }

  private rebuild(): void {
    while (this.stack.children.length) this.stack.remove(this.stack.children[0]);
    for (const slot of this.slots) this.stack.add(slot.entity);
    this.stack.layout();
    this.onChange?.();
  }
}
