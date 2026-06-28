/**
 * AI Chat — streaming Markdown rendered entirely in VectoUI. The transcript is
 * one <canvas>: each assistant reply streams in token-by-token through the
 * engine's incremental Markdown component (headings, lists, code, tables,
 * quotes, images — and SVG-rendered math / mermaid / abc via the rich blocks).
 * Prebaked answers play with zero config; a settings panel can point it at a
 * local Ollama. DOM is used only for the prompt + controls.
 */
import { Scene } from '@vecto-ui/core';
import { Markdown, ScrollView, Stack, type MarkdownTheme } from '@vecto-ui/ui';
import { MessageView } from './chat/message-view';
import { pacedTokens } from './chat/stream';
import { SAMPLES } from './chat/corpus';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const THEME: MarkdownTheme = {
  textColor: '#d7e0f0',
  headingColor: '#ffffff',
  codeColor: '#a5d6ff',
  codeBgColor: 'rgba(124, 179, 255, 0.08)',
  quoteBorderColor: '#3b82f6',
  quoteTextColor: '#9fb0cc',
  hrColor: 'rgba(255,255,255,0.12)',
  bodyFont: 'Inter, system-ui, sans-serif',
  codeFont: 'ui-monospace, "Cascadia Code", monospace',
  fontSize: 15,
};

const DEFAULT_ANSWER = `I'm a prebaked demo running entirely on canvas, so I don't have a live model
wired in by default. Try one of the **sample questions**, or open **Settings** to
point me at a local **Ollama** instance.

Either way, every reply is laid out incrementally by VectoUI's Markdown engine —
no DOM nodes per token.`;

function initChat(): void {
  const canvas = $<HTMLCanvasElement>('chat-canvas');
  const stage = $('chat-stage');
  if (!canvas || !stage) return;

  const scene = new Scene(canvas, { maxFPS: 60 });
  const scroll = new ScrollView({ width: stage.clientWidth, height: stage.clientHeight });
  const transcript = new Stack({ direction: 'vertical', gap: 28, align: 'start' });
  transcript.setPosition(28, 24);
  scroll.add(transcript);
  scene.add(scroll);

  let contentWidth = 0;
  const computeWidth = () => Math.min(760, stage.clientWidth - 56);

  const scrollToBottom = () => {
    // Set the *real* bottom offset (0 when content fits). Poking targetY with a
    // huge sentinel like -1e9 made the ScrollView's spring compute an enormous
    // force before it clamped, sending content.y to ±hundreds of thousands.
    const contentBottom = transcript.y + transcript.height;
    const overflow = Math.max(0, contentBottom - stage.clientHeight);
    (scroll as unknown as { targetY: number }).targetY = -overflow;
  };
  const reflow = (block?: Stack) => {
    block?.layout();
    transcript.layout();
    scroll.updateContentSize();
    scrollToBottom();
  };

  const roleLabel = (role: 'You' | 'VectoUI'): Markdown =>
    new Markdown(`**${role}**`, {
      maxWidth: contentWidth,
      theme: { ...THEME, headingColor: role === 'You' ? '#7cb3ff' : '#86efac' },
    });

  const addBlock = (role: 'You' | 'VectoUI'): Stack => {
    const block = new Stack({ direction: 'vertical', gap: 8, align: 'start' });
    block.add(roleLabel(role));
    transcript.add(block);
    return block;
  };

  const addUser = (text: string): void => {
    const block = addBlock('You');
    block.add(new Markdown(text, { maxWidth: contentWidth, theme: THEME }));
    reflow(block);
  };

  let abort: AbortController | null = null;
  const streamAssistant = async (answer: string, tps: number): Promise<void> => {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const block = addBlock('VectoUI');
    const mv = new MessageView(contentWidth, THEME, undefined, () => reflow(block));
    block.add(mv.stack);
    reflow(block);
    let raw = '';
    for await (const tok of pacedTokens(answer, tps, signal)) {
      if (signal.aborted) break;
      raw += tok;
      mv.update(raw);
    }
  };

  const answerFor = (q: string): string => {
    const hit = SAMPLES.find((s) => s.q.toLowerCase() === q.toLowerCase());
    return hit ? hit.a : DEFAULT_ANSWER;
  };

  const tps = (): number => Number($<HTMLInputElement>('chat-tps')?.value ?? 24);

  const ask = (q: string): void => {
    addUser(q);
    void streamAssistant(answerFor(q), tps());
  };

  // ---- prompt bar ----
  const form = $<HTMLFormElement>('chat-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('chat-input');
    const text = input?.value.trim();
    if (!text) return;
    if (input) input.value = '';
    ask(text);
  });

  // ---- sample question chips ----
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
    el.addEventListener('click', () => ask(el.textContent?.trim() || ''));
  }

  // ---- token/s readout ----
  const tpsOut = $('out-tps');
  $<HTMLInputElement>('chat-tps')?.addEventListener('input', (e) => {
    if (tpsOut) tpsOut.textContent = `${(e.target as HTMLInputElement).value} tok/s`;
  });

  // ---- new chat ----
  $('chat-new')?.addEventListener('click', () => {
    abort?.abort();
    while (transcript.children.length) transcript.remove(transcript.children[0]);
    transcript.layout();
    scroll.updateContentSize();
  });

  const fit = (): void => {
    contentWidth = computeWidth();
    scene.resize(stage.clientWidth, stage.clientHeight);
    (scroll as unknown as { width: number; height: number }).width = stage.clientWidth;
    (scroll as unknown as { width: number; height: number }).height = stage.clientHeight;
    scroll.updateContentSize();
  };

  if (location.search.includes('debug')) {
    Object.assign(window as unknown as Record<string, unknown>, {
      __Scene: Scene,
      __Markdown: Markdown,
      __Stack: Stack,
      __transcript: transcript,
      __scroll: scroll,
    });
  }

  window.addEventListener('resize', () => requestAnimationFrame(fit));
  fit();
  scene.start();

  // Greet with the first sample so the canvas isn't empty on load.
  ask(SAMPLES[0].q);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChat);
else initChat();
