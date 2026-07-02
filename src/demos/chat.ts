/**
 * AI Chat — streaming Markdown rendered entirely in VectoJS. The transcript is
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
import { Scene } from '@vectojs/core';
import { Markdown, ScrollView, Stack, type MarkdownTheme } from '@vectojs/ui';
import { MessageView } from './chat/message-view';
import { renderSpecial } from './chat/render-special';
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
  // A broad, concrete monospace stack. `ui-monospace` resolves inconsistently on
  // Linux, so we name widely-installed fixed-width fonts before the generic
  // fallback for more predictable glyph metrics across platforms.
  codeFont:
    'ui-monospace, "JetBrains Mono", "Fira Code", "Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", Menlo, Consolas, monospace',
  fontSize: 15,
};

const DEFAULT_ANSWER = `I'm a prebaked demo running entirely on canvas, so I don't have a live model
wired in by default. Try one of the **sample questions**, or open **Settings** to
point me at a local **Ollama** instance.

Either way, every reply is laid out incrementally by VectoJS's Markdown engine —
no DOM nodes per token.`;

// VectoJS's canvas text engine has no colour-emoji glyphs, so emoji from a live
// model render as a tofu box ("�"). Strip pictographic characters (and the emoji
// variation selector / ZWJ / flag pairs) before display — but leave arrows, dashes,
// and other text symbols the Markdown uses intact.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu;
const stripGlyphs = (s: string): string => s.replace(EMOJI_RE, '');

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
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cfg.baseUrl);
  const lines = [`> **Couldn't reach the model** at \`${cfg.baseUrl}\`.`, '>'];

  if (/\b404\b|not found/i.test(msg)) {
    lines.push(
      `> The endpoint returned **404** — the model id \`${cfg.model}\` likely doesn't`,
      '> exist here. Copy the exact id from your provider (e.g. OpenRouter lists it on',
      '> each model page).',
    );
  } else if (isLocal) {
    lines.push(
      '> For a local **Ollama**, the browser needs CORS permission — start it with:',
      '>',
      '> ```',
      `> OLLAMA_ORIGINS='*' ollama serve`,
      `> ollama pull ${cfg.model || 'llama3.2'}`,
      '> ```',
    );
  } else {
    lines.push(
      '> Check the **model id**, your **API key**, and that the **Base URL** ends in',
      "> `/v1`. A remote provider must also allow this site's origin (CORS) or the",
      '> browser will block the request.',
    );
  }

  lines.push('>', `> _${msg}_`);
  return lines.join('\n');
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
  // Chat-bubble width: narrower than the stage so "You" (right) and "VectoJS" (left)
  // sit on opposite sides with whitespace between them.
  const computeWidth = () => Math.min(600, Math.max(260, (stage.clientWidth - 56) * 0.82));

  // Conversation history sent to a live model. Persisted to sessionStorage so the
  // transcript survives navigating away and back (cleared by "New chat").
  const STORE_KEY = 'vecto-chat-history';
  const history: ChatMsg[] = [];
  const saveHistory = (): void => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(history));
    } catch {
      /* storage unavailable (private mode / quota) — non-fatal */
    }
  };
  const loadHistory = (): ChatMsg[] => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      const parsed = raw ? (JSON.parse(raw) as ChatMsg[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // Position each message: "You" hugs the right edge, "VectoJS" the left. The Stack
  // only hugs its content, so we override each block's x after the layout pass.
  type Positioned = {
    __role?: string;
    y: number;
    getBounds?: () => { width: number };
    setPosition: (x: number, y: number) => void;
  };
  const realignBlocks = (): void => {
    const avail = stage.clientWidth - 56;
    for (const child of transcript.children as unknown as Positioned[]) {
      if (!child.__role) continue;
      const w = child.getBounds?.().width ?? 0;
      const x = child.__role === 'You' && w > 0 ? Math.max(0, avail - w) : 0;
      child.setPosition(x, child.y);
    }
  };

  const reflow = (block?: Stack) => {
    block?.layout();
    transcript.layout();
    realignBlocks();
    scroll.updateContentSize();
    scroll.scrollToBottom(); // public API (0.1.0) — clamps internally, no spring blow-up
    // Wake the render loop on every content change; when streaming stops and the
    // transcript is idle, the engine's auto-throttle (0.1.0) lets it drop to ~2 FPS.
    scene.markDirty();
  };

  const roleLabel = (role: 'You' | 'VectoJS'): Markdown =>
    new Markdown(`**${role}**`, {
      maxWidth: contentWidth,
      theme: { ...THEME, headingColor: role === 'You' ? '#7cb3ff' : '#86efac' },
    });

  const addBlock = (role: 'You' | 'VectoJS'): Stack => {
    // "You" right-aligns its label + bubble, "VectoJS" left-aligns.
    const block = new Stack({
      direction: 'vertical',
      gap: 8,
      align: role === 'You' ? 'end' : 'start',
    });
    (block as unknown as { __role: string }).__role = role;
    block.add(roleLabel(role));
    transcript.add(block);
    return block;
  };

  const addUser = (text: string): void => {
    const block = addBlock('You');
    block.add(new Markdown(text, { maxWidth: contentWidth, theme: THEME }));
    reflow(block);
  };

  // Render a complete assistant message without streaming — used when restoring a
  // saved transcript on load.
  const renderAssistant = (text: string): void => {
    const block = addBlock('VectoJS');
    const mv = new MessageView(contentWidth, THEME, renderSpecial, () => reflow(block));
    block.add(mv.stack);
    mv.update(text);
    reflow(block);
  };

  let abort: AbortController | null = null;
  const streamAssistant = async (userText: string, persist: boolean): Promise<void> => {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const block = addBlock('VectoJS');
    const mv = new MessageView(contentWidth, THEME, renderSpecial, () => reflow(block));
    block.add(mv.stack);
    reflow(block);

    // Reserve this turn's slot in history up front, so the transcript stays in
    // alternating order even if a new question interrupts this stream mid-reply
    // (the partial answer keeps its place instead of leaving two "You" in a row).
    const msg: ChatMsg = { role: 'assistant', content: '' };
    if (persist) history.push(msg);

    const cfg = readConfig();
    let raw = '';
    const onToken = (t: string) => {
      raw += t;
      const shown = stripGlyphs(raw);
      msg.content = shown;
      mv.update(shown);
    };

    // Only call a live model for real, persisted turns; the on-load greeting always
    // plays a prebaked answer (history.slice drops the empty slot we just reserved).
    if (cfg.model && persist) {
      try {
        await streamLive(cfg, history.slice(0, -1), signal, onToken);
      } catch (err) {
        if (!signal.aborted && (err as Error)?.name !== 'AbortError') {
          raw += (raw ? '\n\n' : '') + liveErrorNote(cfg, err);
          const shown = stripGlyphs(raw);
          msg.content = shown;
          mv.update(shown);
        }
      }
    } else {
      for await (const tok of pacedTokens(answerFor(userText), () => tps(), signal)) {
        if (signal.aborted) break;
        onToken(tok);
      }
    }

    if (persist) saveHistory();
  };

  const answerFor = (q: string): string => {
    const hit = SAMPLES.find((s) => s.q.toLowerCase() === q.toLowerCase());
    return hit ? hit.a : DEFAULT_ANSWER;
  };

  const tps = (): number => Number($<HTMLInputElement>('chat-tps')?.value ?? 24);

  const ask = (q: string, persist = true): void => {
    addUser(q);
    if (persist) {
      history.push({ role: 'user', content: q });
      saveHistory();
    }
    void streamAssistant(q, persist);
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

  // ---- Base URL presets (OpenAI-compatible providers) ----
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-baseurl]')) {
    el.addEventListener('click', () => {
      const input = $<HTMLInputElement>('cfg-baseurl');
      if (input) input.value = el.getAttribute('data-baseurl') || '';
    });
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
    saveHistory();
    while (transcript.children.length) transcript.remove(transcript.children[0]);
    transcript.layout();
    scroll.updateContentSize();
    scene.markDirty();
  });

  // ---- copy last reply (canvas text isn't selectable, so offer an explicit copy) ----
  const copyBtn = $('chat-copy');
  copyBtn?.addEventListener('click', async () => {
    const last = [...history].reverse().find((m) => m.role === 'assistant' && m.content.trim());
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last.content);
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = prev;
      }, 1500);
    } catch {
      /* clipboard unavailable (insecure context / permission) */
    }
  });

  const fit = (): void => {
    contentWidth = computeWidth();
    scene.resize(stage.clientWidth, stage.clientHeight);
    (scroll as unknown as { width: number; height: number }).width = stage.clientWidth;
    (scroll as unknown as { width: number; height: number }).height = stage.clientHeight;
    scroll.updateContentSize();
    transcript.layout();
    realignBlocks();
    scene.markDirty();
  };

  if (location.search.includes('debug')) {
    Object.assign(window as unknown as Record<string, unknown>, {
      __Scene: Scene,
      __Markdown: Markdown,
      __Stack: Stack,
      __transcript: transcript,
      __scroll: scroll,
      __renderAssistant: renderAssistant,
    });
  }

  window.addEventListener('resize', () => requestAnimationFrame(fit));
  fit();
  scene.start();

  // Restore a saved transcript (survives navigation); otherwise greet with a sample.
  const saved = loadHistory();
  if (saved.length) {
    for (const m of saved) {
      if (m.role === 'assistant' && !m.content) continue; // drop empty interrupted slots
      history.push(m);
      if (m.role === 'user') addUser(m.content);
      else renderAssistant(m.content);
    }
    scene.markDirty();
  } else {
    ask(SAMPLES[0].q, false); // ephemeral greeting — not saved to the transcript
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChat);
else initChat();
