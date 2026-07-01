/**
 * Shared "immersive" (zoom-in) mode for the demo pages. Adds a toggle button to any
 * element marked `data-immersive`; toggling pins that element to fill the viewport
 * and hides the surrounding page chrome, for a distraction-free view of the core
 * demo. The demos already refit on `window` 'resize', so we dispatch one after the
 * layout settles. Esc exits.
 */
const EXPAND_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/></svg>`;

function initImmersive(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-immersive]');
  for (const target of targets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-immersive-btn';
    btn.setAttribute('aria-label', 'Toggle immersive view');
    btn.title = 'Immersive view — Esc to exit';
    btn.innerHTML = EXPAND_ICON;
    target.appendChild(btn);

    const setOpen = (open: boolean): void => {
      target.classList.toggle('is-immersive', open);
      document.body.classList.toggle('immersive-lock', open);
      btn.innerHTML = open ? CLOSE_ICON : EXPAND_ICON;
      btn.title = open ? 'Exit immersive view (Esc)' : 'Immersive view — Esc to exit';
      // Let the new layout settle, then let the demo refit to the new size.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    };

    btn.addEventListener('click', () => setOpen(!target.classList.contains('is-immersive')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && target.classList.contains('is-immersive')) setOpen(false);
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initImmersive);
else initImmersive();
