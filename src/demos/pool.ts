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
const POWER_STEP = 0.15; // power added per click on the cue ball (~7 clicks = full)
const FIRE_DELAY = 800; // ms with no clicks after charging before the shot fires
const SPEED_FRAC = 0.08; // full-power launch speed = 8% of table width per frame
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

type Phase = 'aim' | 'rolling' | 'settling' | 'win' | 'fail';

// ── State ──────────────────────────────────────────────────────────────
let phase: Phase = 'aim';
let balls: Ball[];
let cue: Ball, tgt: Ball, blk: Ball;
let aimAngle = 0; // LAUNCH direction — set by clicking around the cue ball
let power = 0; // accumulated shot power 0..1 (one notch per cue-ball click)
let lastInteract = 0; // performance.now() of the last aim / charge click
let attempts = 0;
let rollingFrames = 0;
let flashAlpha = 0;
let tutorial = true; // animated "how to play" demo, until the first shot

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
  // Run the callback on transitionend, but guard against the transition never
  // firing (forced reduced-motion, interrupted opacity change) — otherwise the
  // win/fail overlay would stay up and soft-lock the demo.
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    overlay.removeEventListener('transitionend', finish);
    overlay.hidden = true;
    cb();
  };
  overlay.addEventListener('transitionend', finish);
  setTimeout(finish, 400); // > the 0.28s CSS transition
}

function setPhase(p: Phase) {
  phase = p;
  if (p === 'aim') {
    power = 0;
    lastInteract = 0;
    stick.style.opacity = '1';
    canvas.style.cursor = 'crosshair';
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
  const speed = power * (W * SPEED_FRAC);
  cue.vx = Math.cos(aimAngle) * speed; // launch toward the aimed direction
  cue.vy = Math.sin(aimAngle) * speed;
  tutorial = false; // they've got it
  setPhase('rolling'); // note: setPhase('rolling') does not reset power
  power = 0;
}

// Canvas-drawn SHOOT button rect (only live once charged) — one geometry used by
// both the renderer and the hit-test, so they can never drift apart.
function shootRect(): { x: number; y: number; w: number; h: number } {
  const w = Math.max(84, Math.round(W * 0.12));
  const h = Math.max(26, Math.round(W * 0.034));
  return { x: MX() - w / 2, y: PB() - 14 - h / 2, w, h };
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

function addPower() {
  power = Math.min(1, power + POWER_STEP);
  lastInteract = performance.now();
  tutorial = false;
}

// Clock + click-charge model: click the cue BALL to add a notch of power; click
// anywhere AROUND it (the clock ring) to set the launch direction; click the
// SHOOT button to fire now. Otherwise the shot auto-fires FIRE_DELAY ms after the
// last click. A single click handler drives it all — no hover, drag, or hold.
function onDown(x: number, y: number) {
  if (phase !== 'aim') return;
  // SHOOT button first (only present once there is power to fire)
  if (power > 0) {
    const b = shootRect();
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      shoot();
      return;
    }
  }
  if (Math.hypot(x - cue.x, y - cue.y) <= cue.r + 10) {
    addPower(); // clicked the ball → charge
  } else {
    aimAngle = Math.atan2(y - cue.y, x - cue.x); // clicked around it → aim
    lastInteract = performance.now();
    tutorial = false;
  }
}

// A click is a single down; everything happens on mousedown / touchstart. No
// document-level move/up listeners are needed (aim + power are click-driven).
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  onDown(...canvasXY(e.clientX, e.clientY));
});
canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onDown(...canvasXY(t.clientX, t.clientY));
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

// Dashed line from the cue ball in the LAUNCH direction (toward the cursor — where
// the ball will go).
function drawAimGuide() {
  if (phase !== 'aim' || cue.pocketed || tutorial) return;
  const len = Math.hypot(PR() - PL(), PB() - PT());
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cue.x + Math.cos(aimAngle) * (cue.r + 2), cue.y + Math.sin(aimAngle) * (cue.r + 2));
  ctx.lineTo(cue.x + Math.cos(aimAngle) * len, cue.y + Math.sin(aimAngle) * len);
  ctx.stroke();
  ctx.restore();
}

// Animated "how to play" demo, looping until the first click: aim toward the
// pocket, fill a power bar one notch at a time (the click-charge), then fire.
function drawTutorial() {
  if (!tutorial || phase !== 'aim' || cue.pocketed) return;
  const [tpx, tpy] = pockets()[TARGET_POCKET];
  const aim = Math.atan2(tpy - cue.y, tpx - cue.x); // toward the target pocket
  const cyc = (performance.now() % 3600) / 3600;
  const rr = cue.r + 14;

  ctx.save();
  // clock ring + aim marker toward the pocket
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(cue.x + Math.cos(aim) * rr, cue.y + Math.sin(aim) * rr, 4, 0, Math.PI * 2);
  ctx.fill();

  // charge phase (0.25..0.8): a segmented power bar fills a notch at a time, and
  // the ball pulses as if being clicked
  const demoPower = cyc < 0.25 ? 0 : cyc < 0.8 ? (cyc - 0.25) / 0.55 : 1;
  if (cyc >= 0.25 && cyc < 0.8) {
    const beat = 0.5 + 0.5 * Math.sin((cyc - 0.25) * 34);
    ctx.strokeStyle = `rgba(56,189,248,${0.25 + beat * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, cue.r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const segs = 7;
  const bw = 118;
  const bh = 10;
  const g = 3;
  const dx = cue.x - bw / 2;
  const dy = cue.y + rr + 16;
  const cw = (bw - g * (segs - 1)) / segs;
  for (let i = 0; i < segs; i++) {
    const sx = dx + i * (cw + g);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(sx, dy, cw, bh, 2);
    ctx.fill();
    if (demoPower * segs > i) {
      ctx.fillStyle = powerColor(demoPower);
      ctx.beginPath();
      ctx.roundRect(sx, dy, cw, bh, 2);
      ctx.fill();
    }
  }

  // fire burst (0.8..1)
  if (cyc >= 0.8) {
    ctx.globalAlpha = ((1 - cyc) / 0.2) * 0.7;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, cue.r + 6 + ((cyc - 0.8) / 0.2) * 30, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#fde68a';
  ctx.font = '600 13px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(
    'Click around the ball to aim · click the ball to charge · stop to shoot',
    W / 2,
    PT() + (PB() - PT()) * 0.9,
  );
  ctx.restore();
}

// Clock-style aim ring around the cue ball: tick marks + a bright marker in the
// launch direction, so the control reads at a glance.
function drawClockRing() {
  if (phase !== 'aim' || cue.pocketed || tutorial) return;
  const rr = cue.r + 14;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cue.x + Math.cos(a) * (rr - 4), cue.y + Math.sin(a) * (rr - 4));
    ctx.lineTo(cue.x + Math.cos(a) * (rr + 3), cue.y + Math.sin(a) * (rr + 3));
    ctx.stroke();
  }
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(cue.x + Math.cos(aimAngle) * rr, cue.y + Math.sin(aimAngle) * rr, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function powerColor(p: number): string {
  return p > 0.66 ? '#ef4444' : p > 0.33 ? '#eab308' : '#22c55e';
}

// Bottom-of-table HUD: a segmented power bar that fills one notch per click, and a
// SHOOT button whose fill doubles as the "auto-fire in FIRE_DELAY" countdown.
function drawPowerHUD() {
  if (phase !== 'aim' || cue.pocketed || tutorial) return;

  // Segmented power bar
  const segs = 7;
  const bw = Math.max(150, Math.round(W * 0.24));
  const bh = 14;
  const bx = MX() - bw / 2;
  const by = PB() - 40 - bh / 2;
  const gap = 3;
  const cellW = (bw - gap * (segs - 1)) / segs;
  const filled = power * segs;
  for (let i = 0; i < segs; i++) {
    const cx = bx + i * (cellW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.roundRect(cx, by, cellW, bh, 3);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, filled - i));
    if (frac > 0) {
      ctx.fillStyle = powerColor(power);
      ctx.beginPath();
      ctx.roundRect(cx, by, cellW * frac, bh, 3);
      ctx.fill();
    }
  }

  // Prompt
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '600 12px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(
    power > 0 ? 'Click the ball to add power' : 'Click the ball to charge · click around it to aim',
    MX(),
    by - 9,
  );
  ctx.restore();

  // SHOOT button — only once charged; its fill counts down to auto-fire
  if (power > 0) {
    const b = shootRect();
    const idle = Math.min(1, (performance.now() - lastInteract) / FIRE_DELAY);
    const r = b.h / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(34,197,94,0.16)';
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, r);
    ctx.fill();
    ctx.stroke();
    // countdown fill (clipped to the pill)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, r);
    ctx.clip();
    ctx.fillStyle = 'rgba(34,197,94,0.5)';
    ctx.fillRect(b.x, b.y, b.w * idle, b.h);
    ctx.restore();
    ctx.fillStyle = '#eafff0';
    ctx.font = '700 13px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SHOOT ▸', b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.restore();
  }
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
    // Behind the ball (opposite the launch), pulling back as it charges.
    const back = aimAngle + Math.PI;
    const gap = cue.r + 6 + power * 44;
    const tx = cue.x + Math.cos(back) * gap;
    const ty = cue.y + Math.sin(back) * gap;
    stick.style.left = tx + 'px';
    stick.style.top = ty - 4 + 'px';
    stick.style.transform = `rotate(${aimAngle}rad)`;
  }
}

// ── Game loop ──────────────────────────────────────────────────────────
function frame() {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tableCache, 0, 0); // static table + pockets, rendered once on resize
  // Auto-fire once charged and the player has stopped clicking.
  if (phase === 'aim' && power > 0 && performance.now() - lastInteract > FIRE_DELAY) shoot();

  drawAimGuide();
  balls.forEach(drawBall);
  drawClockRing();
  drawTutorial();
  drawPowerHUD();

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
