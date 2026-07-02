/**
 * Danmaku-at-scale demo. The stage is one VectoJS <canvas> holding thousands of
 * comment entities — smooth like a canvas-2D danmaku engine, yet every comment
 * is individually hit-tested (hover to freeze, click for a real action menu),
 * and the action menu's buttons are real ARIA shadow nodes an agent can drive.
 * A DOM control panel and an on-demand accessible list sit alongside.
 */
import { Scene } from '@vectojs/core';
import { Button } from '@vectojs/ui';
import { DanmakuEngine } from './danmaku/engine';
import { Danmaku } from './danmaku/danmaku';
import { rollComment } from './danmaku/corpus';
import { setupReporter } from './report';
import { keepSceneLive } from './keep-live';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

function initDanmaku(): void {
  const canvas = $<HTMLCanvasElement>('danmaku-canvas');
  const stage = $('stage');
  if (!canvas || !stage) return;

  const scene = new Scene(canvas, { disableWindowResize: true, a11ySyncInterval: 120, maxFPS: 60 });

  const measureCtx = document.createElement('canvas').getContext('2d');
  const measure = (text: string, font: string): number => {
    if (!measureCtx) return text.length * 12;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  };

  const engine = new DanmakuEngine(scene, measure);
  scene.add(engine);

  const fit = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    scene.resize(w, h);
    engine.resize(w, h);
  };

  // ---- per-comment interaction (manual hit-test; comments aren't DOM) ----
  const toStage = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let hovered: Danmaku | null = null;

  type Menu = { d: Danmaku; buttons: Button[] };
  let menu: Menu | null = null;
  const closeMenu = (): void => {
    if (!menu) return;
    for (const b of menu.buttons) scene.remove(b);
    menu.d.hovered = false;
    menu = null;
  };

  const toast = (msg: string): void => {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    window.setTimeout(() => t.classList.remove('show'), 1600);
  };

  const openMenu = (d: Danmaku): void => {
    closeMenu();
    d.hovered = true; // freeze while the menu is open
    const mk = (label: string, onClick: () => void) =>
      new Button(label, {
        onClick,
        bg: 'rgba(13, 19, 33, 0.96)',
        hoverBg: 'rgba(37, 99, 235, 0.92)',
        font: '600 13px Inter, system-ui, sans-serif',
        padding: 10,
        radius: 8,
      });
    const like = mk('♥ Like', () => {
      d.liked = !d.liked;
      d.likes += d.liked ? 1 : -1;
      toast(d.liked ? 'Liked ♥' : 'Unliked');
    });
    const copy = mk('⧉ Copy', () => {
      navigator.clipboard?.writeText(d.text).then(
        () => toast('Copied to clipboard'),
        () => toast('Copy blocked'),
      );
    });
    const report = mk('⚑ Report', () => {
      toast('Reported. Thanks for the feedback.');
      closeMenu();
    });
    const buttons = [like, copy, report];
    let bx = Math.max(8, Math.min(d.x, stage.clientWidth - 230));
    const by = Math.max(8, d.y - d.fontSize - 30);
    for (const b of buttons) {
      scene.add(b);
      b.setPosition(bx, by);
      bx += b.width + 8;
    }
    menu = { d, buttons };
  };

  canvas.addEventListener('pointermove', (e) => {
    const p = toStage(e);
    const hit = menu ? menu.d : engine.hitTest(p.x, p.y);
    if (hit !== hovered) {
      if (hovered && hovered !== menu?.d) hovered.hovered = false;
      hovered = hit;
      if (hovered) hovered.hovered = true;
      canvas.style.cursor = hovered ? 'pointer' : 'default';
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (hovered && hovered !== menu?.d) hovered.hovered = false;
    hovered = null;
    canvas.style.cursor = 'default';
  });
  canvas.addEventListener('click', (e) => {
    const p = toStage(e);
    const hit = engine.hitTest(p.x, p.y);
    if (hit) openMenu(hit);
    else closeMenu();
  });

  // ---- HUD ----
  const hudCount = $('hud-count');
  const hudFps = $('hud-fps');
  const hudDom = $('hud-dom');
  const hudPool = $('hud-pool');
  window.setInterval(() => {
    if (hudCount) hudCount.textContent = String(engine.active.length);
    if (hudFps) hudFps.textContent = String(Math.round(engine.fps));
    if (hudDom) hudDom.textContent = String(document.querySelectorAll('[data-vecto-id]').length);
    if (hudPool) hudPool.textContent = String(engine.created);
  }, 500);

  // ---- control panel ----
  // Apply each control's *current* value on init, not just on change: browsers
  // restore the last slider/select values across a reload, but that restore
  // fires no event — so without this the engine keeps its defaults while the UI
  // shows the restored value (the "displays 120 but actually 3000" bug).
  const bind = (id: string, ev: 'input' | 'change', fn: (el: HTMLInputElement) => void) => {
    const el = $<HTMLInputElement>(id);
    if (!el) return;
    el.addEventListener(ev, () => fn(el));
    fn(el);
  };
  bind('ctl-target', 'input', (el) => {
    engine.target = Number(el.value);
    const o = $('out-target');
    if (o) o.textContent = el.value;
  });
  bind('ctl-speed', 'input', (el) => {
    engine.speedScale = Number(el.value);
    const o = $('out-speed');
    if (o) o.textContent = `${Number(el.value).toFixed(1)}×`;
  });
  bind('ctl-opacity', 'input', (el) => {
    engine.danmakuOpacity = Number(el.value);
    const o = $('out-opacity');
    if (o) o.textContent = `${Math.round(Number(el.value) * 100)}%`;
  });
  bind('ctl-area', 'change', (el) => engine.setArea(el.value === 'top' ? 'top' : 'full'));
  bind('ctl-mode', 'change', (el) => {
    engine.mode = el.value === 'realistic' ? 'realistic' : 'stress';
    const lbl = $('lbl-target');
    if (lbl) lbl.textContent = engine.mode === 'realistic' ? 'Comments / min' : 'On-screen target';
  });

  const hideBtn = $<HTMLButtonElement>('ctl-hide');
  hideBtn?.addEventListener('click', () => {
    engine.hidden = !engine.hidden;
    hideBtn.textContent = engine.hidden ? 'Show' : 'Hide';
    hideBtn.classList.toggle('active', engine.hidden);
  });

  // ---- send your own ----
  const sendForm = $<HTMLFormElement>('sendbar');
  sendForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('send-input');
    const colorEl = $<HTMLInputElement>('send-color');
    const text = input?.value.trim();
    if (!text) return;
    engine.spawn({ text, color: colorEl?.value || '#ffffff', fontSize: 26, type: 'scroll' });
    if (input) input.value = '';
  });

  // ---- on-demand accessible list (bounded / virtualized projection) ----
  const a11yList = $('a11y-list');
  let a11yTimer = 0;
  bind('ctl-a11y', 'change', (el) => {
    if (!a11yList) return;
    if (el.checked) {
      a11yList.hidden = false;
      const rebuild = () => {
        const items = engine.active.slice(-40);
        a11yList.replaceChildren(
          ...items.map((d) => {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = d.text;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', `Like comment: ${d.text}`);
            btn.textContent = d.liked ? '♥' : '♡';
            btn.addEventListener('click', () => {
              d.liked = !d.liked;
              d.likes += d.liked ? 1 : -1;
              btn.textContent = d.liked ? '♥' : '♡';
            });
            li.append(span, btn);
            return li;
          }),
        );
      };
      rebuild();
      a11yTimer = window.setInterval(rebuild, 800);
    } else {
      a11yList.hidden = true;
      a11yList.replaceChildren();
      window.clearInterval(a11yTimer);
    }
  });

  // ---- video player + danmaku coupling ----
  const video = $<HTMLVideoElement>('stage-video');
  let videoFps = 0;
  const applyFpsCap = (val: string): void => {
    scene.maxFPS = val === 'video' ? videoFps || 60 : Number(val);
  };
  const fpscapSel = $<HTMLSelectElement>('ctl-fpscap');

  if (video) {
    const playBtn = $('v-play');
    const seek = $<HTMLInputElement>('v-seek');
    const timeEl = $('v-time');
    const muteBtn = $('v-mute');
    const fileInput = $<HTMLInputElement>('v-file');
    let seeking = false;

    const fmt = (s: number): string => {
      if (!isFinite(s)) return '0:00';
      return `${Math.floor(s / 60)}:${Math.floor(s % 60)
        .toString()
        .padStart(2, '0')}`;
    };

    // Detect the video's native fps (for "Match video") via requestVideoFrameCallback:
    // mediaTime is in media seconds, so this reads true fps regardless of playback rate.
    const detectFps = (): void => {
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (
          cb: (now: number, meta: { mediaTime: number }) => void,
        ) => number;
      };
      if (!v.requestVideoFrameCallback) return;
      let frames = 0;
      let startMedia = -1;
      const cb = (_now: number, meta: { mediaTime: number }): void => {
        if (startMedia < 0) startMedia = meta.mediaTime;
        else {
          frames++;
          const elapsed = meta.mediaTime - startMedia;
          if (elapsed >= 1) {
            videoFps = Math.max(1, Math.round(frames / elapsed));
            if (fpscapSel?.value === 'video') applyFpsCap('video');
            return;
          }
        }
        v.requestVideoFrameCallback?.(cb);
      };
      v.requestVideoFrameCallback?.(cb);
    };

    // Play/pause drives the danmaku stream (pause the video → freeze comments).
    video.addEventListener('play', () => {
      engine.paused = false;
      if (playBtn) playBtn.textContent = '❚❚';
    });
    video.addEventListener('pause', () => {
      engine.paused = true;
      if (playBtn) playBtn.textContent = '►';
    });
    playBtn?.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    video.addEventListener('timeupdate', () => {
      if (seek && !seeking && video.duration)
        seek.value = String((video.currentTime / video.duration) * 1000);
      if (timeEl) timeEl.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    });
    seek?.addEventListener('input', () => {
      seeking = true;
      if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
    });
    seek?.addEventListener('change', () => {
      seeking = false;
    });

    // Playback rate couples to danmaku motion so they stay in the video's time.
    bind('v-rate', 'change', (el) => {
      video.playbackRate = Number(el.value);
      engine.playbackRate = Number(el.value);
    });

    muteBtn?.addEventListener('click', () => {
      video.muted = !video.muted;
      muteBtn.textContent = video.muted ? '🔇' : '🔊';
    });

    // Fullscreen the whole stage so the danmaku overlay comes along (not just the video).
    $('v-full')?.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.requestFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(fit));

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
      video.src = URL.createObjectURL(file);
      videoFps = 0;
      video.play().catch(() => {});
      detectFps();
    });

    video.play().catch(() => {});
    detectFps();
  }

  // ---- frame cap (default 60; "Max" shows real-GPU headroom; "Match video" syncs) ----
  bind('ctl-fpscap', 'change', (el) => applyFpsCap(el.value));

  // ---- export a real-browser performance report ----
  const reportBtn = $('ctl-report');
  const reportPanel = $('report-panel');
  const reportPre = $('report-pre');
  if (reportBtn && reportPanel && reportPre) {
    setupReporter({
      button: reportBtn,
      panel: reportPanel,
      pre: reportPre,
      seconds: 4,
      frameSampler: {
        start: () => engine.startSampling(),
        stop: () => engine.stopSampling(),
      },
      extra: () => ({
        onScreen: engine.active.length,
        target: engine.target,
        poolCreated: engine.created,
        frameCap: scene.maxFPS >= 1000 ? 'max' : scene.maxFPS,
      }),
    });
  }

  // ---- boot ----
  window.addEventListener('resize', () => requestAnimationFrame(fit));
  fit();
  // Seed a few immediately so the stage isn't empty on first paint.
  for (let i = 0; i < 12; i++) engine.spawn(rollComment());
  scene.start();
  // Comments scroll every frame; keep the scene live so the 0.1.0 idle throttle
  // doesn't drop it to ~2 FPS. While paused we let it throttle to save resources.
  keepSceneLive(scene, () => !engine.paused);
}

function boot(): void {
  if (document.fonts?.ready) document.fonts.ready.then(initDanmaku);
  else initDanmaku();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
