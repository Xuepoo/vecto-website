import { Scene, Entity, LayoutEngine, type GlyphMeasurer, type IRenderer } from '@vecto-ui/core';

const RENDER_WEIGHT = 800;

function boldMeasurer(): GlyphMeasurer | null {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const base = 100;
  const cache = new Map<string, number>();
  return {
    measure(char: string, fontSize: number): number {
      let w = cache.get(char);
      if (w === undefined) {
        ctx.font = `${RENDER_WEIGHT} ${base}px Outfit`;
        w = ctx.measureText(char).width;
        cache.set(char, w);
      }
      return w * (fontSize / base);
    },
  };
}

const pointer = { x: -1e9, y: -1e9, down: false };

class Glyph extends Entity {
  private homeX: number;
  private homeY: number;
  private vx = 0;
  private vy = 0;
  public size: number;
  private char: string;
  private color: string;
  private litUntil = 0;

  constructor(char: string, homeX: number, homeY: number, size: number, color: string) {
    super();
    this.char = char;
    this.homeX = homeX;
    this.homeY = homeY;
    this.size = size;
    this.color = color;
    this.x = homeX;
    this.y = homeY;
    this.width = size * 0.65;
    this.height = size;
    this.interactive = false;
  }

  centerX(): number {
    return this.x + this.width / 2;
  }
  centerY(): number {
    return this.y - this.height / 2;
  }

  lit(time: number): void {
    this.litUntil = time + 320;
  }

  isPointInside(gx: number, gy: number): boolean {
    return gx >= this.x && gx <= this.x + this.width && gy <= this.y && gy >= this.y - this.height;
  }

  update(dt: number, time: number): void {
    const frames = Math.min(dt, 48) / 16.67;

    const dx = this.centerX() - pointer.x;
    const dy = this.centerY() - pointer.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const radius = pointer.down ? 250 : 150;

    if (dist < radius) {
      const push = (1 - dist / radius) * (pointer.down ? 8 : 4);
      this.vx += (dx / dist) * push * frames;
      this.vy += (dy / dist) * push * frames;
    }

    this.vx += (this.homeX - this.x) * 0.05 * frames;
    this.vy += (this.homeY - this.y) * 0.05 * frames;
    this.vx *= 0.85;
    this.vy *= 0.85;
    this.x += this.vx * frames;
    this.y += this.vy * frames;

    const off = Math.hypot(this.x - this.homeX, this.y - this.homeY);
    const lit = time < this.litUntil;
    this._fill = lit ? '#38bdf8' : off > 4 ? '#818cf8' : this.color;
  }

  private _fill = '#e2e8f0';

  getBounds() {
    return { x: 0, y: -this.height, width: this.width, height: this.height };
  }

  render(r: IRenderer): void {
    r.fillText(this.char, 0, 0, `${RENDER_WEIGHT} ${this.size}px Outfit`, this._fill);
  }
}

class MagneticText extends Entity {
  private glyphs: Glyph[] = [];

  constructor(lines: { text: string; size: number }[], cx: number, topY: number) {
    super();
    this.interactive = false;
    const engine = new LayoutEngine(1e9, 1e9, boldMeasurer());

    let y = topY;
    for (const line of lines) {
      const prepared = engine.prepare(line.text, {}, line.size);
      const laid = engine.layoutPrepared(prepared);
      const lineWidth = laid.totalWidth;
      const startX = cx - lineWidth / 2;
      for (const node of laid.nodes) {
        if (node.char.trim().length === 0) continue;
        const g = new Glyph(
          node.char,
          startX + node.x,
          y + node.y + line.size,
          line.size,
          'rgba(255, 255, 255, 0.95)',
        );
        this.glyphs.push(g);
        this.add(g);
      }
      y += line.size * 1.6;
    }
  }

  hit(wx: number, wy: number, time: number): void {
    for (const g of this.glyphs) {
      if (g.isPointInside(wx, wy)) {
        g.lit(time);
        break;
      }
    }
  }

  isPointInside(): boolean {
    return false;
  }
  render(): void {}
}

function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const scene = new Scene(canvas);

  const setupScene = () => {
    scene.destroy(); // clear out previous entities on resize
    const cx = canvas.width / 2;
    // Position text relative to the screen dimensions
    const isMobile = window.innerWidth < 768;
    const text = new MagneticText(
      [
        { text: 'VectoUI', size: isMobile ? 64 : 110 },
        { text: 'PHYSICS DRIVEN GRAPHICS ENGINE', size: isMobile ? 14 : 20 },
      ],
      cx,
      canvas.height / 2 - (isMobile ? 80 : 120),
    );
    scene.add(text);
    scene.start();

    // Map pointer movements relative to the canvas bounding box
    const getCoords = (e: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const move = (e: PointerEvent) => {
      const coords = getCoords(e);
      pointer.x = coords.x;
      pointer.y = coords.y;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', (e) => {
      const coords = getCoords(e);
      pointer.down = true;
      pointer.x = coords.x;
      pointer.y = coords.y;
      text.hit(coords.x, coords.y, performance.now());
    });
    window.addEventListener('pointerup', () => (pointer.down = false));
    window.addEventListener('pointerleave', () => {
      pointer.x = -1e9;
      pointer.y = -1e9;
    });
  };

  setupScene();

  // Re-initialize layouts on resize so text remains perfectly centered
  let resizeTimeout: any;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      setupScene();
    }, 150);
  });
}

document.addEventListener('DOMContentLoaded', initHeroCanvas);
