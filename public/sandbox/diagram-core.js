// Shared runtime for VectoJS-rendered docs diagrams. Each diagram is one Entity
// drawn in a fixed design space; the Scene scales it (T·S·R) to fit the iframe
// and the loop pauses when the frame scrolls out of the parent viewport.
//
// `Scene` is passed in by the host page (which imports it from @vectojs/core via
// its own import map) so this helper carries no bare module specifiers of its own.

/** Approximate centered text — the renderer draws left-aligned and exposes no
 *  measureText, so we estimate glyph advance at ~0.54em (half = 0.27em/char). */
export function ctext(r, text, cx, y, font, fontPx, color) {
  r.fillText(text, cx - String(text).length * fontPx * 0.27, y, font, color);
}

/** Rounded rectangle with optional fill then stroke (same path, like canvas2d). */
export function box(r, x, y, w, h, radius, fill, stroke, sw) {
  r.beginPath();
  r.roundRect(x, y, w, h, radius);
  if (fill) r.fill(fill);
  if (stroke) r.stroke(stroke, sw);
}

/** Straight line segment. */
export function line(r, x0, y0, x1, y1, color, w) {
  r.beginPath();
  r.moveTo(x0, y0);
  r.lineTo(x1, y1);
  r.stroke(color, w);
}

/** Filled + outlined pulse dot (a travelling highlight). */
export function pulse(r, x, y, radius, color) {
  r.beginPath();
  r.arc(x, y, radius, 0, Math.PI * 2);
  r.stroke(color, 2);
  r.beginPath();
  r.arc(x, y, radius * 0.5, 0, Math.PI * 2);
  r.fill(color);
}

/**
 * Mount a design-space diagram Entity, scaling it to fit `app` and pausing the
 * render loop when the iframe leaves the parent viewport or the tab is hidden.
 */
export function mountDiagram(Scene, canvas, app, DW, DH, diagram, opts = {}) {
  const scene = new Scene(canvas, { renderMode: 'always', maxFPS: opts.maxFPS ?? 30 });
  scene.add(diagram);

  function fit() {
    // Logical (CSS) px — not the DPR-scaled canvas.width that scene.resize() sets.
    const W = app.offsetWidth;
    const H = app.offsetHeight;
    scene.resize(W, H);
    const s = Math.min(W / DW, H / DH);
    diagram.scaleX = diagram.scaleY = s;
    diagram.setPosition((W - DW * s) / 2, (H - DH * s) / 2);
    scene.markDirty();
  }
  window.addEventListener('resize', fit);
  requestAnimationFrame(fit);

  // Pause when the diagram scrolls out of the docs page / the tab is hidden.
  let running = false;
  const setRunning = (on) => {
    if (on === running) return;
    running = on;
    if (on) scene.start();
    else scene.stop();
  };
  setRunning(true);
  try {
    const frame = window.frameElement;
    if (frame && window.parent && window.parent.IntersectionObserver) {
      new window.parent.IntersectionObserver(
        (entries) => setRunning(entries[entries.length - 1].isIntersecting),
        { threshold: 0.01 },
      ).observe(frame);
    }
  } catch {
    /* cross-origin parent — the visibilitychange listener still applies */
  }
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  return scene;
}
