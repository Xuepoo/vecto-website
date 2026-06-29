/**
 * VectoUI homepage hero — dogfooded entirely in VectoUI.
 *
 * One <canvas>, zero per-element DOM. A glowing neural field (hundreds of real
 * entities) sits behind an elegant serif title, a tagline, two CTAs, and a live
 * glass stats card. The card's contrast IS the pitch: hundreds of canvas
 * entities, a handful of real DOM nodes. The two buttons are real, operable
 * ARIA shadow nodes (Playwright / an AI agent can getByRole().click() them).
 */
import { Scene, Entity, LayoutEngine, type GlyphMeasurer, type IRenderer } from '@vecto-ui/core';
import { Button } from '@vecto-ui/ui';
import { keepSceneLive } from './demos/keep-live';

const GITHUB = 'https://github.com/Xuepoo/vecto-ui';
const ACCENT = '#5b9cff';
const ACCENT_BRIGHT = '#7cb3ff';
const TITLE_FONT = '"Playfair Display", Georgia, serif';

const pointer = { x: -1e9, y: -1e9 };
const field = { w: 1280, h: 760 };

/** A drifting, twinkling background star — a real entity (so the count is honest). */
class Star extends Entity {
  private vx: number;
  private vy: number;
  private r: number;
  private phase: number;
  private speed: number;
  private base: number;
  private tint: string;

  constructor() {
    super();
    this.interactive = false;
    this.r = 0.4 + Math.random() * 1.5;
    this.vx = (Math.random() - 0.5) * 0.06;
    this.vy = (Math.random() - 0.5) * 0.06;
    this.phase = Math.random() * Math.PI * 2;
    this.speed = 0.0008 + Math.random() * 0.0014;
    this.base = 0.25 + Math.random() * 0.5;
    this.tint = Math.random() < 0.7 ? '#cfe0ff' : Math.random() < 0.5 ? ACCENT : '#a7b8e8';
  }

  scatter(): void {
    this.x = Math.random() * field.w;
    this.y = Math.random() * field.h;
  }

  getBounds(): null {
    return null;
  }
  isPointInside(): boolean {
    return false;
  }

  update(dt: number, time: number): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < 0) this.x += field.w;
    else if (this.x > field.w) this.x -= field.w;
    if (this.y < 0) this.y += field.h;
    else if (this.y > field.h) this.y -= field.h;
    // subtle parallax toward the pointer
    const dx = pointer.x - this.x;
    const dy = pointer.y - this.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 26000) {
      this.x += (dx / 1600) * (this.r * 0.4);
      this.y += (dy / 1600) * (this.r * 0.4);
    }
    this.phase += this.speed * dt;
    void time;
  }

  render(r: IRenderer): void {
    const a = this.base * (0.55 + 0.45 * Math.sin(this.phase));
    r.fillCircle(0, 0, this.r, this.tint, a);
  }
}

/** A glowing "neuron": warm core, blue halo, radiating filaments — the synapse look. */
class Neuron extends Entity {
  private filaments: Array<{ dx: number; dy: number; mx: number; my: number }> = [];
  private radius: number;
  private phase = Math.random() * Math.PI * 2;
  // home is a fraction of the field box so it repositions on resize
  constructor(
    private fx: number,
    private fy: number,
    scale: number,
  ) {
    super();
    this.interactive = false;
    this.radius = 40 * scale;
    const n = 11 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const len = (110 + Math.random() * 200) * scale;
      const mx = Math.cos(ang) * len * 0.5 + (Math.random() - 0.5) * 44;
      const my = Math.sin(ang) * len * 0.5 + (Math.random() - 0.5) * 44;
      this.filaments.push({ dx: Math.cos(ang) * len, dy: Math.sin(ang) * len, mx, my });
    }
  }

  place(): void {
    this.x = this.fx * field.w;
    this.y = this.fy * field.h;
  }

  getBounds(): null {
    return null;
  }
  isPointInside(): boolean {
    return false;
  }

  update(dt: number): void {
    this.phase += 0.0012 * dt;
  }

  render(r: IRenderer): void {
    const pulse = 0.7 + 0.3 * Math.sin(this.phase);
    // Filaments: a gentle quadratic curve out to each endpoint, with an end node.
    for (const f of this.filaments) {
      r.beginPath();
      r.moveTo(0, 0);
      // approximate a curve with two segments via the mid control point
      r.lineTo(f.mx, f.my);
      r.lineTo(f.dx, f.dy);
      r.stroke(`rgba(91, 156, 255, ${0.06 * pulse})`, 1);
      r.fillCircle(f.dx, f.dy, 1.6, ACCENT, 0.5 * pulse);
    }
    // Blue halo: layered translucent circles (fake bloom).
    for (let i = 8; i >= 1; i--) {
      const rr = (this.radius * i) / 2.0;
      r.fillCircle(0, 0, rr, '#3b82f6', (0.06 * pulse * (9 - i)) / 8);
    }
    // Warm core.
    r.fillCircle(0, 0, this.radius * 0.5, '#fcd9a8', 0.55 * pulse);
    r.fillCircle(0, 0, this.radius * 0.24, '#ffffff', 0.9 * pulse);
  }
}

/** Background container: a faint grid plus the stars + neurons (added as children). */
class NeuralField extends Entity {
  public stars: Star[] = [];
  public neurons: Neuron[] = [];

  constructor(starCount: number) {
    super();
    this.interactive = false;
    for (let i = 0; i < starCount; i++) {
      const s = new Star();
      this.stars.push(s);
      this.add(s);
    }
    const spots: Array<[number, number, number]> = [
      [0.82, 0.26, 1.5],
      [0.16, 0.7, 1.3],
      [0.9, 0.82, 0.9],
      [0.08, 0.2, 0.8],
      [0.62, 0.92, 0.7],
      [0.4, 0.12, 0.6],
    ];
    for (const [fx, fy, sc] of spots) {
      const nu = new Neuron(fx, fy, sc);
      this.neurons.push(nu);
      this.add(nu);
    }
  }

  place(): void {
    for (const s of this.stars) s.scatter();
    for (const n of this.neurons) n.place();
  }

  count(): number {
    return this.stars.length + this.neurons.length;
  }

  getBounds(): null {
    return null;
  }
  isPointInside(): boolean {
    return false;
  }

  render(r: IRenderer): void {
    // Faint square grid.
    const step = 64;
    for (let x = 0; x <= field.w; x += step) {
      r.beginPath();
      r.moveTo(x, 0);
      r.lineTo(x, field.h);
      r.stroke('rgba(120, 150, 210, 0.035)', 1);
    }
    for (let y = 0; y <= field.h; y += step) {
      r.beginPath();
      r.moveTo(0, y);
      r.lineTo(field.w, y);
      r.stroke('rgba(120, 150, 210, 0.035)', 1);
    }
  }
}

/** One title glyph: an elegant serif letter filled with a white→steel gradient. */
class TitleGlyph extends Entity {
  constructor(
    private char: string,
    public size: number,
  ) {
    super();
    this.interactive = false;
    this.width = size * 0.6;
    this.height = size;
  }

  getBounds() {
    return { x: 0, y: -this.height, width: this.width, height: this.height };
  }
  isPointInside(): boolean {
    return false;
  }

  render(r: IRenderer): void {
    const grad = r.createLinearGradient(0, -this.size, 0, 0, [
      { stop: 0, color: '#ffffff' },
      { stop: 0.55, color: '#dbe6fb' },
      { stop: 1, color: '#8ea6d6' },
    ]);
    r.fillText(this.char, 0, 0, `800 ${this.size}px ${TITLE_FONT}`, grad);
  }
}

/** The title block — one {@link TitleGlyph} per character, re-centered on resize. */
class Title extends Entity {
  private glyphs: TitleGlyph[] = [];
  private engine = new LayoutEngine(1e9, 1e9, this.measurer());

  constructor(private text: string) {
    super();
    this.interactive = false;
    for (const ch of text) {
      const g = new TitleGlyph(ch, 110);
      this.glyphs.push(g);
      this.add(g);
    }
  }

  private measurer(): GlyphMeasurer | null {
    if (typeof document === 'undefined') return null;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    const cache = new Map<string, number>();
    return {
      measure: (char: string, fontSize: number): number => {
        const key = char;
        let w = cache.get(key);
        if (w === undefined) {
          ctx.font = `800 100px ${TITLE_FONT}`;
          w = ctx.measureText(char).width / 100;
          cache.set(key, w);
        }
        return w * fontSize;
      },
    };
  }

  place(cx: number, baselineY: number, size: number): void {
    const prepared = this.engine.prepare(this.text, {}, size);
    const laid = this.engine.layoutPrepared(prepared);
    const startX = cx - laid.totalWidth / 2;
    let i = 0;
    for (const node of laid.nodes) {
      const g = this.glyphs[i++];
      if (!g) break;
      g.size = size;
      g.width = node.width;
      g.height = size;
      g.x = startX + node.x;
      g.y = baselineY;
    }
  }

  count(): number {
    return this.glyphs.length;
  }
  isPointInside(): boolean {
    return false;
  }
  render(): void {}
}

/** Centered, letter-tracked single line of text (subtitle / hint). */
class TrackedText extends Entity {
  public cx = 0;
  constructor(
    private get: () => string,
    private font: string,
    private color: string,
    private tracking: number,
    private measure: (s: string, font: string) => number,
  ) {
    super();
    this.interactive = false;
  }
  getBounds(): null {
    return null;
  }
  isPointInside(): boolean {
    return false;
  }
  render(r: IRenderer): void {
    const text = this.get();
    const widths = [...text].map((c) => this.measure(c, this.font) + this.tracking);
    const total = widths.reduce((a, b) => a + b, 0) - this.tracking;
    let x = this.cx - total / 2;
    for (let i = 0; i < text.length; i++) {
      r.fillText(text[i], x, 0, this.font, this.color);
      x += widths[i];
    }
  }
}

/** Glassy live stats card: many canvas entities, a handful of DOM nodes, real FPS. */
class StatsCard extends Entity {
  private fps = 60; // smoothed instantaneous frame rate
  private displayFps = 60; // what we show — refreshed ~1Hz so the digit is readable
  private acc = 0; // throttles the entity / DOM-node recount
  private fpsAcc = 0; // throttles the FPS display refresh
  private entities = 0;
  private domNodes = 0;

  constructor(private getEntities: () => number) {
    super();
    this.interactive = false;
    this.width = 300;
    this.height = 150;
  }

  getBounds() {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }
  isPointInside(): boolean {
    return false;
  }

  update(dt: number): void {
    if (dt > 0) this.fps += (1000 / dt - this.fps) * 0.08;
    this.fpsAcc += dt;
    if (this.fpsAcc >= 1000) {
      this.fpsAcc = 0;
      this.displayFps = this.fps;
    }
    this.acc += dt;
    if (this.acc < 1000 && this.entities) return;
    this.acc = 0;
    this.entities = this.getEntities();
    this.domNodes = document.querySelectorAll('[data-vecto-id]').length;
  }

  private cell(r: IRenderer, x: number, y: number, label: string, value: string, color: string) {
    r.fillText(label, x, y, '600 11px Inter, sans-serif', 'rgba(148,163,184,0.85)');
    r.fillText(value, x, y + 30, '700 27px Inter, sans-serif', color);
  }

  render(r: IRenderer): void {
    r.beginPath();
    r.roundRect(0, 0, this.width, this.height, 16);
    r.fill('rgba(11, 17, 33, 0.62)');
    r.stroke('rgba(91, 156, 255, 0.22)', 1);
    const padX = 22;
    const colW = (this.width - padX * 2) / 2;
    this.cell(r, padX, 30, 'ENTITIES', this.entities.toLocaleString(), '#ffffff');
    this.cell(r, padX + colW, 30, 'DOM NODES', String(this.domNodes), ACCENT_BRIGHT);
    this.cell(r, padX, 96, 'FPS', `${Math.round(this.displayFps)}`, '#4ade80');
    r.fillText(
      'real ARIA shadow nodes · zero reflow',
      padX,
      this.height - 14,
      '500 10.5px Inter, sans-serif',
      'rgba(148,163,184,0.7)',
    );
  }
}

function initHero(): void {
  const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement | null;
  const section = canvas?.parentElement as HTMLElement | null;
  if (!canvas || !section) return;

  // Cap the loop at 60 FPS: on a 240Hz panel the uncapped rAF kept the GPU out
  // of its idle clock state (fans spin up for no visible gain), and it made the
  // displayed FPS swing with each browser's refresh rate. 60 is plenty for this
  // slow ambient animation.
  const scene = new Scene(canvas, { disableWindowResize: true, a11ySyncInterval: 150, maxFPS: 60 });

  // a small measurer for tracked sans text
  const sansCtx = document.createElement('canvas').getContext('2d');
  const measureSans = (s: string, font: string): number => {
    if (!sansCtx) return s.length * 8;
    sansCtx.font = font;
    return sansCtx.measureText(s).width;
  };

  const bg = new NeuralField(560);
  scene.add(bg);

  const title = new Title('VectoUI');
  scene.add(title);

  const subtitle = new TrackedText(
    () => 'ZERO-DOM · ACCESSIBLE · AGENT-NATIVE',
    '600 19px Inter, sans-serif',
    '#aeb9d4',
    3,
    measureSans,
  );
  scene.add(subtitle);

  const demosBtn = new Button('→  Demos', {
    onClick: () => (location.href = './demos/'),
    bg: '#2563eb',
    hoverBg: '#3b82f6',
    font: '600 16px Inter, sans-serif',
    padding: 16,
    radius: 12,
  });
  const githubBtn = new Button('GitHub', {
    onClick: () => window.open(GITHUB, '_blank', 'noopener'),
    bg: 'rgba(255,255,255,0.06)',
    hoverBg: 'rgba(255,255,255,0.13)',
    font: '600 16px Inter, sans-serif',
    padding: 16,
    radius: 12,
  });
  scene.add(demosBtn);
  scene.add(githubBtn);

  const stats = new StatsCard(() => bg.count() + title.count() + 2);
  scene.add(stats);

  const layout = (w: number, h: number): void => {
    field.w = w;
    field.h = h;
    const mobile = w < 720;
    const titleSize = Math.min(mobile ? 68 : 132, w * 0.18);
    const cx = w / 2;

    const titleBaseline = h * 0.46;
    title.place(cx, titleBaseline, titleSize);

    subtitle.cx = cx;
    subtitle.setPosition(0, titleBaseline + titleSize * 0.42);

    const gap = 16;
    const ctaY = titleBaseline + titleSize * 0.42 + 56;
    const ctaW = demosBtn.width + gap + githubBtn.width;
    demosBtn.setPosition(cx - ctaW / 2, ctaY);
    githubBtn.setPosition(cx - ctaW / 2 + demosBtn.width + gap, ctaY);

    const margin = mobile ? 16 : 32;
    stats.setPosition(w - stats.width - margin, h - stats.height - margin);
  };

  const fit = (): void => {
    const w = section.clientWidth;
    const h = section.clientHeight;
    scene.resize(w, h);
    layout(w, h);
  };

  const pointerPos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  window.addEventListener('pointermove', (e) => {
    const p = pointerPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
  });
  window.addEventListener('pointerleave', () => {
    pointer.x = -1e9;
    pointer.y = -1e9;
  });

  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fit);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  field.w = section.clientWidth;
  field.h = section.clientHeight;
  bg.place();
  fit();
  scene.start();
  // The starfield drifts every frame; keep the scene live so 0.9.2's idle
  // auto-throttle doesn't drop it (and the on-canvas FPS readout) to ~2.
  keepSceneLive(scene);
}

function boot(): void {
  const start = () => initHero();
  if (document.fonts?.ready) document.fonts.ready.then(start);
  else start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
