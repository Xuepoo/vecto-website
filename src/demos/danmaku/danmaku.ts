import { Entity, type Bounds, type IRenderer } from '@vectojs/core';
import type { DanmakuType } from './corpus';
import { danmakuBitmap } from './bitmap';

/**
 * One comment. Pure pixels by default (`interactive = false`) so a stage holding
 * thousands of them still projects only a handful of DOM nodes — the demo hit-
 * tests them manually instead. Scrolling comments move themselves left; top/
 * bottom comments sit centered until they expire.
 */
export class Danmaku extends Entity {
  text = '';
  color = '#ffffff';
  fontSize = 22;
  type: DanmakuType = 'scroll';
  speed = 0; // px/ms (scroll only)
  measuredWidth = 0;
  bornAt = 0;
  expireAt = 0; // ms timestamp (fixed types)
  hovered = false;
  liked = false;
  likes = 0;

  constructor() {
    super();
    this.interactive = false;
  }

  get font(): string {
    return `600 ${this.fontSize}px "Inter", system-ui, sans-serif`;
  }

  /** Origin is the lane's vertical center; box extends half a line up and down. */
  getBounds(): Bounds {
    const h = this.fontSize * 1.2;
    return { x: -6, y: -h / 2, width: this.measuredWidth + 12, height: h };
  }

  isPointInside(gx: number, gy: number): boolean {
    const h = this.fontSize * 1.2;
    return (
      gx >= this.x - 6 &&
      gx <= this.x + this.measuredWidth + 6 &&
      gy >= this.y - h / 2 &&
      gy <= this.y + h / 2
    );
  }

  render(r: IRenderer): void {
    if (this.hovered) {
      r.beginPath();
      r.roundRect(-6, -this.fontSize * 0.62, this.measuredWidth + 12, this.fontSize * 1.24, 7);
      r.fill('rgba(37, 99, 235, 0.28)');
      r.stroke('rgba(124, 179, 255, 0.95)', 1.5);
    }
    // The comment is a pre-rasterized bitmap — one GPU blit instead of per-frame
    // fillText, which is what lets the stage hold thousands at once.
    const bmp = danmakuBitmap(this.text, this.color, this.fontSize);
    if (bmp) r.drawImage(bmp.canvas, 0, -bmp.cssH / 2, bmp.cssW, bmp.cssH);
    else r.fillText(this.text, 0, this.fontSize * 0.34, this.font, this.color);
    if (this.liked) {
      r.fillText(
        '♥',
        this.measuredWidth + 6,
        this.fontSize * 0.34,
        `${this.fontSize}px system-ui`,
        '#ff6b9d',
      );
    }
  }
}
