/**
 * AI Chat — streaming Markdown rendered entirely in VectoUI. The transcript is
 * one <canvas>: each assistant reply streams in token-by-token through the
 * engine's incremental Markdown component (headings, lists, code, tables,
 * quotes, images — and SVG-rendered math / mermaid / abc via the rich blocks).
 *
 * Two modes, chosen by the Settings panel:
 *   • No model name  → prebaked sample answers, paced by the Speed slider.
 *   • Model name set → live streaming from an OpenAI-compatible endpoint
 *                      (defaults to a local Ollama at /v1/chat/completions).
 * DOM is used only for the prompt + controls.
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

// ── Live-model config (read from the Settings panel on every send) ────────────
type ChatRole = 'system' | 'user' | 'assistant';
interface ChatMsg {
  role: ChatRole;
  content: string;
}
interface ModelConfig {
  baseUrl: string;
  model: string;
  key: string;
  system: string;
  temperature: number;
  topK: number;
}

function readConfig(): ModelConfig {
  const val = (id: string) => $<HTMLInputElement>(id)?.value.trim() ?? '';
  const baseUrl = (val('cfg-baseurl') || 'http://localhost:11434/v1').replace(/\/+$/, '');
  return {
    baseUrl,
    model: val('cfg-model'),
    key: val('cfg-key'),
    system: ($<HTMLTextAreaElement>('cfg-system')?.value ?? '').trim(),
    temperature: Number(val('cfg-temp')) || 0.7,
    topK: Number(val('cfg-topk')) || 0,
  };
}

/**
 * Stream a reply from an OpenAI-compatible Chat Completions endpoint (Ollama,
 * LM Studio, llama.cpp, vLLM, OpenRouter…). Parses SSE `data:` frames and feeds
 * each `delta.content` to `onToken`. Throws on a non-OK response or a network /
 * CORS failure so the caller can show a setup hint.
 */
async function streamLive(
  cfg: ModelConfig,
  history: ChatMsg[],
  signal: AbortSignal,
  onToken: (t: string) => void,
): Promise<void> {
  const messages: ChatMsg[] = [
    ...(cfg.system ? [{ role: 'system' as const, content: cfg.system }] : []),
    ...history,
  ];
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: true,
    temperature: cfg.temperature,
  };
  if (cfg.topK > 0) body.top_k = cfg.topK;

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 240)}` : ''}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content ?? '';
        if (delta) onToken(delta);
      } catch {
        /* keep-alive comment or partial frame — ignore */
      }
    }
  }
}

function liveErrorNote(cfg: ModelConfig, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return [
    `> ⚠️ **Couldn't reach the model** at \`${cfg.baseUrl}\`.`,
    '>',
    '> Check that the server is running and the **model name** is correct. For a local',
    '> **Ollama**, the browser also needs CORS permission — start it like this:',
    '>',
    '> ```',
    `> OLLAMA_ORIGINS='*' ollama serve`,
    `> ollama pull ${cfg.model || 'llama3.2'}`,
    '> ```',
    '>',
    `> _${msg}_`,
  ].join('\n');
}

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

  // Conversation history sent to a live model (cleared by "New chat").
  const history: ChatMsg[] = [];

  const reflow = (block?: Stack) => {
    block?.layout();
    transcript.layout();
    scroll.updateContentSize();
    scroll.scrollToBottom(); // public API (0.9.2) — clamps internally, no spring blow-up
    // Wake the render loop on every content change; when streaming stops and the
    // transcript is idle, the engine's auto-throttle (0.9.2) lets it drop to ~2 FPS.
    scene.markDirty();
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
  const streamAssistant = async (userText: string): Promise<void> => {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const block = addBlock('VectoUI');
    const mv = new MessageView(contentWidth, THEME, undefined, () => reflow(block));
    block.add(mv.stack);
    reflow(block);

    const cfg = readConfig();
    let raw = '';
    const onToken = (t: string) => {
      raw += t;
      mv.update(raw);
    };

    if (cfg.model) {
      try {
        await streamLive(cfg, history, signal, onToken);
      } catch (err) {
        if (!signal.aborted && (err as Error)?.name !== 'AbortError') {
          raw += (raw ? '\n\n' : '') + liveErrorNote(cfg, err);
          mv.update(raw);
        }
      }
    } else {
      for await (const tok of pacedTokens(answerFor(userText), () => tps(), signal)) {
        if (signal.aborted) break;
        onToken(tok);
      }
    }

    if (raw && !signal.aborted) history.push({ role: 'assistant', content: raw });
  };

  const answerFor = (q: string): string => {
    const hit = SAMPLES.find((s) => s.q.toLowerCase() === q.toLowerCase());
    return hit ? hit.a : DEFAULT_ANSWER;
  };

  const tps = (): number => Number($<HTMLInputElement>('chat-tps')?.value ?? 24);

  const ask = (q: string): void => {
    addUser(q);
    history.push({ role: 'user', content: q });
    void streamAssistant(q);
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
    history.length = 0;
    while (transcript.children.length) transcript.remove(transcript.children[0]);
    transcript.layout();
    scroll.updateContentSize();
    scene.markDirty();
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
