/**
 * Knowledge Graph — an infinite pan/zoom canvas rendering the VectoJS ecosystem as a
 * hub-and-cluster graph: a real, labeled backbone (root -> 4 packages -> ~20 concepts)
 * surrounded by thousands of synthetic satellite nodes, colored per cluster. The
 * satellites are rendered by several `ComputeParticleEntity` instances (the SAME
 * WebGL-batched engine primitive that renders 150k points in the Nexus demo) — one
 * per cluster color, since particle color is a per-system, not per-particle,
 * property. The backbone (a few dozen nodes) is drawn directly with plain
 * fillCircle/fillText calls; that's cheap enough it doesn't need batching.
 *
 * Hit-testing for hover does NOT walk the particle buffers — it queries a spatial
 * hash built over a flat position array that this module owns as the single source
 * of truth (also used to seed every particle system), so hover stays O(1)-average
 * regardless of node count.
 */
import { Scene, Entity, ComputeParticleEntity } from '@vectojs/core';
import type { IRenderer } from '@vectojs/core';
import { buildLayout, CLUSTERS, type GraphLayout } from './graph/layout';
import { SpatialHash } from './graph/spatial-hash';
import { FrameMeter } from './frame-meter';
import { keepSceneLive } from './keep-live';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

function ctext(
  r: IRenderer,
  text: string,
  cx: number,
  y: number,
  font: string,
  px: number,
  color: string,
): void {
  r.fillText(text, cx - text.length * px * 0.27, y, font, color);
}

/** Draws the real backbone (root/hub/concept nodes + their connecting edges) and the
 * dim/highlight overlay on hover. Satellite dots are NOT drawn here — those are the
 * ComputeParticleEntity layers, added to the scene underneath this one. */
class GraphBackbone extends Entity {
  layout: GraphLayout;
  hoverIdx: number | null = null; // index into layout.nodes, or null
  zoom = 1;

  constructor(layout: GraphLayout) {
    super();
    this.layout = layout;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: -100000, y: -100000, width: 200000, height: 200000 };
  }
  isPointInside(): boolean {
    return false; // hover is driven externally via the spatial hash, not engine hit-testing
  }
  update(): void {
    /* static layout — nothing to simulate here */
  }

  private neighborsOf(idx: number): number[] {
    const out: number[] = [];
    for (const e of this.layout.edges) {
      if (e.a === idx) out.push(e.b);
      else if (e.b === idx) out.push(e.a);
    }
    return out;
  }

  render(r: IRenderer): void {
    const { nodes, edges, clusters } = this.layout;
    const hovered = this.hoverIdx;
    const hoverSet = new Set<number>();
    if (hovered !== null) {
      hoverSet.add(hovered);
      for (const n of this.neighborsOf(hovered)) hoverSet.add(n);
    }
    const dimmed = hovered !== null;

    // Edges (backbone only — one path, one stroke call regardless of count)
    r.beginPath();
    for (const e of edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      r.moveTo(a.x, a.y);
      r.lineTo(b.x, b.y);
    }
    r.stroke(dimmed ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.28)', 1.2 / this.zoom);

    // Highlighted edges redrawn brighter on top
    if (dimmed) {
      r.beginPath();
      for (const e of edges) {
        if (hoverSet.has(e.a) && hoverSet.has(e.b)) {
          const a = nodes[e.a];
          const b = nodes[e.b];
          r.moveTo(a.x, a.y);
          r.lineTo(b.x, b.y);
        }
      }
      r.stroke('rgba(226,232,240,0.85)', 1.6 / this.zoom);
    }

    // Backbone nodes
    const labelZoomOk = this.zoom > 0.6;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const isHot = hoverSet.has(i);
      const alpha = !dimmed || isHot ? 1 : 0.16;
      const col = clusters[n.cluster]?.color ?? '#94a3b8';
      const ringColor = n.kind === 'root' ? '#ffffff' : col;
      r.fillCircle(n.x, n.y, n.r, n.kind === 'root' ? '#0d1424' : '#0a0e1a', alpha);
      r.beginPath();
      r.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      r.stroke(ringColor, (n.kind === 'root' ? 2.5 : 1.6) / this.zoom);
      if (n.kind === 'root' || isHot) {
        r.fillCircle(n.x, n.y, n.r * 0.4, col, alpha);
      }

      const showLabel = n.label && (n.kind === 'root' || n.kind === 'hub' || labelZoomOk || isHot);
      if (showLabel && n.label) {
        const font =
          n.kind === 'root'
            ? `800 ${16 / this.zoom}px Inter, system-ui`
            : n.kind === 'hub'
              ? `700 ${12 / this.zoom}px Inter, system-ui`
              : `500 ${9.5 / this.zoom}px Inter, system-ui`;
        const fpx =
          n.kind === 'root' ? 16 / this.zoom : n.kind === 'hub' ? 12 / this.zoom : 9.5 / this.zoom;
        ctext(
          r,
          n.label,
          n.x,
          n.y + n.r + fpx * 1.15,
          font,
          fpx,
          !dimmed || isHot ? '#e2e8f0' : 'rgba(226,232,240,0.35)',
        );
      }
    }
  }
}

function initGraph(): void {
  const canvas = $<HTMLCanvasElement>('graph-canvas');
  const stage = $('graph-stage');
  if (!canvas || !stage) return;

  const scene = new Scene(canvas, { maxFPS: 60, pointBackend: 'webgl' });
  const meter = new FrameMeter();
  scene.add(meter);
  keepSceneLive(scene);

  let layout = buildLayout(4000);
  let hash = new SpatialHash(layout.nodes, 60);
  const backbone = new GraphBackbone(layout);
  scene.add(backbone);

  // One ComputeParticleEntity per cluster color (particle color is a whole-system
  // property, not per-particle, so a multi-color cloud needs one system per color).
  let particleLayers: ComputeParticleEntity[] = [];

  const buildParticleLayers = (): void => {
    for (const p of particleLayers) scene.remove(p);
    particleLayers = CLUSTERS.map((cl, ci) => {
      const pts = layout.nodes.filter((n) => n.kind === 'satellite' && n.cluster === ci);
      const entity = new ComputeParticleEntity({
        maxParticles: Math.max(1, pts.length),
        size: 2.4,
        color: cl.color,
        springK: 0.2,
        damping: 0.9,
        bounceDamping: 0.6,
        maxVelocity: 40,
      });
      scene.add(entity);
      entity.initRandomParticles(stage.clientWidth, stage.clientHeight);
      // Seed both origin AND position to the target immediately — relying on the
      // spring to pull a random scatter into place would take many seconds (the
      // same lesson learned building the Nexus demo).
      const flat = new Float32Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) {
        flat[i * 2] = pts[i].x;
        flat[i * 2 + 1] = pts[i].y;
      }
      entity.setOrigins(flat, true);
      return entity;
    });
  };
  buildParticleLayers();

  function rebuildLayout(satelliteCount: number): void {
    layout = buildLayout(satelliteCount);
    hash = new SpatialHash(layout.nodes, 60);
    backbone.layout = layout;
    buildParticleLayers();
    // buildParticleLayers() just created brand-new ComputeParticleEntity instances,
    // which default to position (0,0) / scale 1 — they've never had the CURRENT
    // pan/zoom applied. Without this, moving the slider after any pan/zoom leaves
    // the satellites rendering at the raw, un-panned origin while the backbone
    // (never recreated) stays at the correct camera position — exactly the
    // "detached cluster of stray dots" bug.
    applyView();
  }

  // ---- pan + zoom ----
  // A CSS transform on the canvas element only repositions an ALREADY-RENDERED,
  // fixed-size bitmap — it can't reveal world content beyond whatever was drawn
  // into that buffer originally, which breaks a true infinite canvas. Real pan/zoom
  // has to be a per-frame render-time transform instead: the engine applies each
  // Entity's own translate(node.x, node.y) then scale(node.scaleX, node.scaleY)
  // before calling render() (confirmed straight from the compiled source), so
  // setting position/scale on the entities themselves re-projects raw world
  // coordinates (including negative ones) onto the canvas correctly every frame.
  let zoom = 1;
  let panX = 0; // world (0,0) projects to canvas pixel (panX, panY) at this zoom
  let panY = 0;
  const applyView = (): void => {
    backbone.setPosition(panX, panY);
    backbone.scaleX = zoom;
    backbone.scaleY = zoom;
    backbone.zoom = zoom;
    for (const p of particleLayers) {
      p.setPosition(panX, panY);
      p.scaleX = zoom;
      p.scaleY = zoom;
    }
    scene.markDirty();
  };
  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const sr = stage.getBoundingClientRect();
    return { sx: e.clientX - sr.left, sy: e.clientY - sr.top };
  };
  const toWorld = (sx: number, sy: number) => ({
    wx: (sx - panX) / zoom,
    wy: (sy - panY) / zoom,
  });
  const centerView = (): void => {
    zoom = 1;
    panX = stage.clientWidth / 2;
    panY = stage.clientHeight / 2;
    applyView();
  };

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const { sx, sy } = stagePoint(e);
      const { wx, wy } = toWorld(sx, sy);
      zoom = Math.min(6, Math.max(0.15, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      panX = sx - wx * zoom;
      panY = sy - wy * zoom;
      applyView();
    },
    { passive: false },
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;
  let lastLabelIdx: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      panX += dx;
      panY += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      applyView();
      return;
    }
    const { sx, sy } = stagePoint(e);
    const { wx, wy } = toWorld(sx, sy);
    const idx = hash.nearest(wx, wy, 14 / zoom);
    // Satellites never trigger the dim/highlight overlay (there's nothing
    // structural to highlight around them) — only backbone nodes do. The hover
    // LABEL, though, reflects whatever's nearest, satellite or not.
    const isSatellite = idx !== null && layout.nodes[idx].kind === 'satellite';
    const nextBackboneHover = isSatellite ? null : idx;
    if (nextBackboneHover !== backbone.hoverIdx) {
      backbone.hoverIdx = nextBackboneHover;
      scene.markDirty();
    }
    if (idx !== lastLabelIdx) {
      lastLabelIdx = idx;
      updateHoverLabel(idx);
    }
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
    canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('dblclick', () => {
    if (!moved) centerView();
  });

  function updateHoverLabel(idx: number | null): void {
    const el = $('graph-hover-label');
    if (!el) return;
    if (idx === null) {
      el.textContent = '';
      el.hidden = true;
      return;
    }
    const n = layout.nodes[idx];
    const cluster = layout.clusters[n.cluster]?.label ?? '';
    if (n.kind === 'satellite') {
      const parent = layout.nodes[n.parent];
      el.textContent = `${cluster} · ${parent?.label ?? 'node'}`;
    } else {
      el.textContent = n.label ?? n.kind;
    }
    el.hidden = false;
  }

  window.addEventListener('resize', () => {
    scene.resize(stage.clientWidth, stage.clientHeight);
    scene.markDirty();
  });

  // ---- HUD ----
  const set = (id: string, v: string) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  window.setInterval(() => {
    const satCount = layout.nodes.filter((n) => n.kind === 'satellite').length;
    set('hud-graph-fps', String(Math.round(meter.fps)));
    set('hud-graph-nodes', layout.nodes.length.toLocaleString());
    set('hud-graph-sats', satCount.toLocaleString());
    set('hud-graph-edges', layout.edges.length.toLocaleString());
    set('hud-graph-dom', String(document.querySelectorAll('[data-vecto-id]').length));
  }, 500);

  // ---- controls ----
  const slider = $<HTMLInputElement>('ctl-graph-count');
  const out = $('out-graph-count');
  if (slider) {
    slider.addEventListener('input', () => {
      if (out) out.textContent = Number(slider.value).toLocaleString();
    });
    slider.addEventListener('change', () => {
      rebuildLayout(Number(slider.value));
    });
    if (out) out.textContent = Number(slider.value).toLocaleString();
  }
  $('ctl-graph-reset')?.addEventListener('click', centerView);

  // ---- init ----
  scene.resize(stage.clientWidth, stage.clientHeight);
  centerView();
  scene.start();

  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) scene.start();
        else scene.stop();
      },
      { threshold: 0.01 },
    ).observe(stage);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scene.stop();
    else if (visible) scene.start();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGraph);
else initGraph();
