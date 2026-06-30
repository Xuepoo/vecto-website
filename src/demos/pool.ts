// Pool CAPTCHA demo — pure canvas 2D, one DOM element (cue stick)

// ── Elements ──────────────────────────────────────────────────────────
const stage = document.getElementById('pool-stage') as HTMLDivElement;
const canvas = document.getElementById('pool-canvas') as HTMLCanvasElement;
const stick = document.getElementById('pool-stick') as HTMLDivElement;
const overlay = document.getElementById('pool-overlay') as HTMLDivElement;
const ovIcon = document.getElementById('pool-ov-icon') as HTMLElement;
const ovTitle = document.getElementById('pool-ov-title') as HTMLElement;
const ovSub = document.getElementById('pool-ov-sub') as HTMLElement;
const ovBtn = document.getElementById('pool-ov-btn') as HTMLButtonElement;
const attEl = document.getElementById('pool-attempts') as HTMLElement;

const ctx = canvas.getContext('2d')!;

// Offscreen cache for the static table (wood, rails, felt, pockets). Rebuilt only
// on resize, then blitted each frame — recreating four gradients per frame was the
// dominant per-frame cost and a source of page-scroll jank.
const tableCache = document.createElement('canvas');
const tableCtx = tableCache.getContext('2d')!;

// ── Sizing ────────────────────────────────────────────────────────────
let W = 0,
  H = 0;

function resize() {
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = W;
  canvas.height = H;
  buildTable();
}

// ── Table geometry (derived from W / H each frame) ────────────────────
const pad = () => Math.round(W * 0.038);
const rail = () => Math.round(W * 0.028);
const PL = () => pad() + rail();
const PT = () => pad() + rail();
const PR = () => W - pad() - rail();
const PB = () => H - pad() - rail();
const MX = () => (PL() + PR()) / 2;
const PKT_R = () => Math.max(10, Math.round(W * 0.018));
const BALL_R = () => Math.max(8, Math.round(W * 0.016));

function pockets(): [number, number][] {
  return [
    [PL(), PT()],
    [MX(), PT()],
    [PR(), PT()],
    [PL(), PB()],
    [MX(), PB()],
    [PR(), PB()],
  ];
}
const TARGET_POCKET = 2; // top-right

// ── Physics constants ──────────────────────────────────────────────────
const FRICTION = 0.988;
const BOUNCE_DAMP = 0.72;
const MAX_PULL = 90; // px of pull-back drag that maps to full power
const SPEED_FRAC = 0.07; // full-power launch speed = 7% of table width per frame
const MAX_ATT = 5;
const STOP_SPEED = 0.09;

// ── Types ──────────────────────────────────────────────────────────────
interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  name: 'cue' | 'target' | 'blocker';
  pocketed: boolean;
  pocketIdx: number;
}

type Phase = 'aim' | 'pulling' | 'rolling' | 'settling' | 'win' | 'fail';

// ── State ──────────────────────────────────────────────────────────────
let phase: Phase = 'aim';
let balls: Ball[];
let cue: Ball, tgt: Ball, blk: Ball;
let aimAngle = 0;
let pullBack = 0;
let dragging = false;
let attempts = 0;
let rollingFrames = 0;
let flashAlpha = 0;

// ── Ball factory ───────────────────────────────────────────────────────
function makeBall(x: number, y: number, color: string, name: Ball['name']): Ball {
  return { x, y, vx: 0, vy: 0, r: BALL_R(), color, name, pocketed: false, pocketIdx: -1 };
}

function resetBalls() {
  const pl = PL(),
    pt = PT(),
    pw = PR() - PL(),
    ph = PB() - PT();
  const cfgs: [[number, number], [number, number], [number, number]][] = [
    [
      [pl + pw * 0.17, pt + ph * 0.55],
      [pl + pw * 0.76, pt + ph * 0.28],
      [pl + pw * 0.44, pt + ph * 0.42],
    ],
    [
      [pl + pw * 0.15, pt + ph * 0.45],
      [pl + pw * 0.79, pt + ph * 0.22],
      [pl + pw * 0.48, pt + ph * 0.35],
    ],
    [
      [pl + pw * 0.2, pt + ph * 0.6],
      [pl + pw * 0.73, pt + ph * 0.3],
      [pl + pw * 0.41, pt + ph * 0.47],
    ],
  ];
  const [cc, tc, bc] = cfgs[Math.floor(Math.random() * cfgs.length)];
  cue = makeBall(cc[0], cc[1], '#f0f4f8', 'cue');
  tgt = makeBall(tc[0], tc[1], '#dc2626', 'target');
  blk = makeBall(bc[0], bc[1], '#1d4ed8', 'blocker');
  balls = [cue, tgt, blk];
}

// ── Physics ────────────────────────────────────────────────────────────
// Integrate one sub-step (dt = fraction of a frame): position + rail bounce only.
// Friction is applied once per frame in applyFriction so sub-stepping a fast ball
// doesn't compound the decay.
function moveBall(b: Ball, dt: number) {
  if (b.pocketed) return;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const pl = PL(),
    pt = PT(),
    pr = PR(),
    pb = PB(),
    r = b.r;
  if (b.x - r < pl) {
    b.x = pl + r;
    b.vx = Math.abs(b.vx) * BOUNCE_DAMP;
  }
  if (b.x + r > pr) {
    b.x = pr - r;
    b.vx = -Math.abs(b.vx) * BOUNCE_DAMP;
  }
  if (b.y - r < pt) {
    b.y = pt + r;
    b.vy = Math.abs(b.vy) * BOUNCE_DAMP;
  }
  if (b.y + r > pb) {
    b.y = pb - r;
    b.vy = -Math.abs(b.vy) * BOUNCE_DAMP;
  }
}

function applyFriction(b: Ball) {
  if (b.pocketed) return;
  b.vx *= FRICTION;
  b.vy *= FRICTION;
  if (Math.abs(b.vx) < STOP_SPEED) b.vx = 0;
  if (Math.abs(b.vy) < STOP_SPEED) b.vy = 0;
}

function resolveCollision(a: Ball, b: Ball) {
  if (a.pocketed || b.pocketed) return;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d >= a.r + b.r) return;
  const nx = dx / d,
    ny = dy / d;
  const ov = (a.r + b.r - d) / 2;
  a.x -= nx * ov;
  a.y -= ny * ov;
  b.x += nx * ov;
  b.y += ny * ov;
  const dot = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (dot >= 0) return;
  const j = dot * 0.95;
  a.vx += j * nx;
  a.vy += j * ny;
  b.vx -= j * nx;
  b.vy -= j * ny;
}

function checkPockets() {
  const ps = pockets();
  balls.forEach((b) => {
    if (b.pocketed) return;
    ps.forEach(([px, py], i) => {
      if (Math.hypot(b.x - px, b.y - py) < PKT_R() + b.r * 0.45) {
        b.pocketed = true;
        b.pocketIdx = i;
        b.vx = 0;
        b.vy = 0;
      }
    });
  });
}

function allStopped() {
  return balls.every((b) => b.pocketed || (b.vx === 0 && b.vy === 0));
}

// ── Phase control ──────────────────────────────────────────────────────
function showOverlay(type: 'win' | 'fail') {
  overlay.dataset.type = type;
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('pool-visible'));
}

function hideOverlay(cb: () => void) {
  overlay.classList.remove('pool-visible');
  overlay.addEventListener(
    'transitionend',
    () => {
      overlay.hidden = true;
      cb();
    },
    { once: true },
  );
}

function setPhase(p: Phase) {
  phase = p;
  if (p === 'aim') {
    stick.style.opacity = '1';
    canvas.style.cursor = 'grab';
  }
  if (p === 'rolling' || p === 'settling') {
    stick.style.opacity = '0';
    canvas.style.cursor = 'default';
    rollingFrames = 0;
  }
  if (p === 'win') {
    ovIcon.textContent = '✓';
    ovTitle.textContent = 'Human verified';
    ovSub.textContent = 'Shot confirmed · challenge passed';
    ovBtn.textContent = 'Continue →';
    showOverlay('win');
  }
  if (p === 'fail') {
    ovIcon.textContent = '✕';
    ovTitle.textContent = 'Challenge failed';
    ovSub.textContent = `All ${MAX_ATT} attempts used`;
    ovBtn.textContent = 'Try again';
    showOverlay('fail');
  }
}

function shoot() {
  const dir = aimAngle + Math.PI; // launch away from the pull side
  const speed = (pullBack / MAX_PULL) * (W * SPEED_FRAC);
  cue.vx = Math.cos(dir) * speed;
  cue.vy = Math.sin(dir) * speed;
  pullBack = 0;
  dragging = false;
  setPhase('rolling');
}

function failRound() {
  attempts++;
  if (attEl) attEl.textContent = String(attempts);
  if (attempts >= MAX_ATT) {
    setPhase('fail');
    return;
  }
  flashAlpha = 0.38;
  resetBalls();
  setPhase('aim');
}

ovBtn.addEventListener('click', () => {
  hideOverlay(() => {
    if (phase === 'fail') {
      attempts = 0;
      if (attEl) attEl.textContent = '0';
    }
    resize();
    resetBalls();
    setPhase('aim');
  });
});

// ── Input helpers ──────────────────────────────────────────────────────
function canvasXY(clientX: number, clientY: number): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [(clientX - r.left) * (W / r.width), (clientY - r.top) * (H / r.height)];
}

// Slingshot model: the cue points from the ball toward the cursor (the side you
// pull back to) and the ball launches in the opposite direction (see shoot()).
// Power grows with how far the cursor is pulled from the ball, so any real drag
// produces a real shot — a light pull taps, a long pull breaks hard.
function onMove(x: number, y: number) {
  if (phase !== 'aim' && phase !== 'pulling') return;
  aimAngle = Math.atan2(y - cue.y, x - cue.x);
  if (dragging) {
    pullBack = Math.max(0, Math.min(MAX_PULL, Math.hypot(x - cue.x, y - cue.y) - cue.r));
  }
}

function onDown(x: number, y: number) {
  if (phase !== 'aim' && phase !== 'pulling') return;
  dragging = true;
  phase = 'pulling';
  canvas.style.cursor = 'grabbing';
  onMove(x, y); // set aim + power from the press point immediately
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  if (phase === 'pulling' && pullBack > 2) shoot();
  else {
    phase = 'aim';
    pullBack = 0;
    canvas.style.cursor = 'grab';
  }
}

// ── Mouse events ───────────────────────────────────────────────────────
// mousedown on canvas; mousemove/mouseup on document so dragging outside canvas works
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  onDown(...canvasXY(e.clientX, e.clientY));
});
document.addEventListener('mousemove', (e) => {
  if (dragging || phase === 'aim') onMove(...canvasXY(e.clientX, e.clientY));
});
document.addEventListener('mouseup', () => onUp());

// ── Touch events ───────────────────────────────────────────────────────
canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onDown(...canvasXY(t.clientX, t.clientY));
  },
  { passive: false },
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onMove(...canvasXY(t.clientX, t.clientY));
  },
  { passive: false },
);

canvas.addEventListener(
  'touchend',
  (e) => {
    e.preventDefault();
    onUp();
  },
  { passive: false },
);

// ── Rendering ──────────────────────────────────────────────────────────
function lighten(hex: string, amt: number): string {
  return `rgb(${[1, 3, 5]
    .map((i) => Math.min(255, parseInt(hex.slice(i, i + 2), 16) + amt) | 0)
    .join(',')})`;
}

function drawTable(c: CanvasRenderingContext2D) {
  const [pl, pt, pr, pb, p] = [PL(), PT(), PR(), PB(), pad()];
  const [fw, fh] = [pr - pl, pb - pt];

  // Wood outer frame
  c.fillStyle = '#5c3a1e';
  c.beginPath();
  c.roundRect(p - 5, p - 5, W - (p - 5) * 2, H - (p - 5) * 2, 7);
  c.fill();

  // Rail
  const rg = c.createLinearGradient(0, 0, W, 0);
  rg.addColorStop(0, '#4a2e12');
  rg.addColorStop(0.5, '#3c2409');
  rg.addColorStop(1, '#4a2e12');
  c.fillStyle = rg;
  c.beginPath();
  c.roundRect(p, p, W - p * 2, H - p * 2, 4);
  c.fill();

  // Felt
  const fg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.55);
  fg.addColorStop(0, '#187a3a');
  fg.addColorStop(1, '#135228');
  c.fillStyle = fg;
  c.beginPath();
  c.roundRect(pl, pt, fw, fh, 2);
  c.fill();

  // Cushion edge line
  c.strokeStyle = '#1a9444';
  c.lineWidth = 2;
  c.strokeRect(pl + 1, pt + 1, fw - 2, fh - 2);

  // Center spot
  c.fillStyle = 'rgba(255,255,255,0.05)';
  c.beginPath();
  c.arc(W / 2, H / 2, 4, 0, Math.PI * 2);
  c.fill();
}

function drawPockets(c: CanvasRenderingContext2D) {
  const pr = PKT_R();
  pockets().forEach(([px, py], i) => {
    if (i === TARGET_POCKET) {
      const g = c.createRadialGradient(px, py, 1, px, py, pr * 3);
      g.addColorStop(0, 'rgba(251,191,36,0.6)');
      g.addColorStop(1, 'rgba(251,191,36,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, pr * 3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fbbf24';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(px, py, pr + 5, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#010308';
    c.beginPath();
    c.arc(px, py, pr, 0, Math.PI * 2);
    c.fill();
  });
}

// Render the static table + pockets into the offscreen cache (resize only).
function buildTable() {
  tableCache.width = W;
  tableCache.height = H;
  drawTable(tableCtx);
  drawPockets(tableCtx);
}

function drawBall(b: Ball) {
  if (b.pocketed) return;
  const { x, y, r, color } = b;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.04, x, y, r);
  g.addColorStop(0, color === '#f0f4f8' ? '#ffffff' : lighten(color, 65));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Dashed line from the cue ball in the LAUNCH direction (where the ball will go),
// with an arrowhead so the direction is unambiguous.
function drawAimGuide() {
  if ((phase !== 'aim' && phase !== 'pulling') || cue.pocketed) return;
  const sa = aimAngle + Math.PI; // launch direction
  const len = Math.hypot(PR() - PL(), PB() - PT());
  const x1 = cue.x + Math.cos(sa) * len;
  const y1 = cue.y + Math.sin(sa) * len;
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cue.x + Math.cos(sa) * (cue.r + 2), cue.y + Math.sin(sa) * (cue.r + 2));
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

// Pulsing ring on the cue ball while idle — invites the player to grab and pull it.
function drawCueHint() {
  if (phase !== 'aim' || dragging || cue.pocketed) return;
  const t = (performance.now() % 1400) / 1400;
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.5;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, cue.r + 4 + t * 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// While pulling: a bold launch arrow (length + colour track power) plus a power
// bar and a "release to shoot" prompt, so the gesture and its effect are obvious.
function drawPower() {
  if (phase !== 'pulling' || pullBack < 1 || cue.pocketed) return;
  const pct = Math.min(1, pullBack / MAX_PULL);
  const col = pct > 0.66 ? '#ef4444' : pct > 0.33 ? '#eab308' : '#22c55e';
  const sa = aimAngle + Math.PI; // launch direction
  const start = cue.r + 6;
  const end = start + 24 + pct * 66;
  const ax = cue.x + Math.cos(sa) * end;
  const ay = cue.y + Math.sin(sa) * end;

  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cue.x + Math.cos(sa) * start, cue.y + Math.sin(sa) * start);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  const ah = 9;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - Math.cos(sa - 0.42) * ah, ay - Math.sin(sa - 0.42) * ah);
  ctx.lineTo(ax - Math.cos(sa + 0.42) * ah, ay - Math.sin(sa + 0.42) * ah);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Power bar + prompt under the ball
  const bw = 56;
  const bh = 6;
  const bx = cue.x - bw / 2;
  const by = cue.y + cue.r + 12;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw * pct, bh, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '600 10px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('release to shoot', cue.x, by + bh + 12);
  ctx.restore();
}

function updateStick() {
  const hide =
    phase === 'rolling' ||
    phase === 'settling' ||
    phase === 'win' ||
    phase === 'fail' ||
    cue.pocketed;
  stick.style.opacity = hide ? '0' : '1';
  if (!hide) {
    const gap = cue.r + 3 + pullBack;
    const tx = cue.x + Math.cos(aimAngle) * gap;
    const ty = cue.y + Math.sin(aimAngle) * gap;
    stick.style.left = tx + 'px';
    stick.style.top = ty - 4 + 'px';
    stick.style.transform = `rotate(${aimAngle}rad)`;
  }
}

// ── Game loop ──────────────────────────────────────────────────────────
function frame() {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tableCache, 0, 0); // static table + pockets, rendered once on resize
  drawAimGuide();
  balls.forEach(drawBall);
  drawCueHint();
  drawPower();

  if (flashAlpha > 0.01) {
    ctx.fillStyle = `rgba(220,38,38,${flashAlpha.toFixed(3)})`;
    ctx.fillRect(PL(), PT(), PR() - PL(), PB() - PT());
    flashAlpha *= 0.8;
  } else {
    flashAlpha = 0;
  }

  if (phase === 'rolling') {
    rollingFrames++;
    // Sub-step fast balls so they can't tunnel past a pocket, a rail, or each
    // other within one frame (a pocket mouth is only ~12px across).
    const maxV = Math.max(0, ...balls.map((b) => (b.pocketed ? 0 : Math.hypot(b.vx, b.vy))));
    const steps = Math.min(10, Math.max(1, Math.ceil(maxV / (BALL_R() * 0.5))));
    for (let s = 0; s < steps; s++) {
      balls.forEach((b) => moveBall(b, 1 / steps));
      resolveCollision(cue, tgt);
      resolveCollision(cue, blk);
      resolveCollision(tgt, blk);
      checkPockets();
    }
    balls.forEach(applyFriction);

    if (rollingFrames > 10 && allStopped()) {
      phase = 'settling';
      if (tgt.pocketed && tgt.pocketIdx === TARGET_POCKET) {
        setTimeout(() => setPhase('win'), 200);
      } else {
        setTimeout(failRound, 320);
      }
    }
  }

  updateStick();
}

// ── Loop driver ─────────────────────────────────────────────────────────
// Pause the rAF loop when the table is scrolled off-screen or the tab is hidden;
// a continuous canvas loop on the main thread is what makes page scrolling stutter.
let rafId = 0;
function loop() {
  frame();
  rafId = requestAnimationFrame(loop);
}
function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(loop);
}
function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

// ── Init ───────────────────────────────────────────────────────────────
resize();
resetBalls();
startLoop();

if ('IntersectionObserver' in window) {
  new IntersectionObserver(
    (entries) => {
      if (entries[entries.length - 1].isIntersecting) startLoop();
      else stopLoop();
    },
    { threshold: 0.01 },
  ).observe(stage);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else startLoop();
});

window.addEventListener('resize', () => {
  resize();
  if (phase !== 'win' && phase !== 'fail') {
    resetBalls();
    if (phase !== 'settling') setPhase('aim');
  }
});
