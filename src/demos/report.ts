/**
 * In-browser performance report. Headless Chrome falls back to software
 * rasterization (SwiftShader), so GPU-bound FPS measured there is a pessimistic
 * floor. This runs in the visitor's real browser instead: the user clicks a
 * button, it samples a window of real frames, and prints a copyable report — the
 * honest, real-hardware numbers we can actually quote. Reusable across demos.
 */
export interface ReportExtra {
  [key: string]: string | number;
}

export interface PerfReport {
  page: string;
  timestamp: string;
  browser: string;
  userAgent: string;
  viewport: string;
  dpr: number;
  windowSeconds: number;
  sceneFpsMean: number;
  sceneFpsMin: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  frameMsMax: number;
  jankPct: number;
  domNodes: number;
  shadowNodes: number;
  heapUsedMB: number | null;
  heapTotalMB: number | null;
  extra: ReportExtra;
}

interface MeasureOptions {
  seconds?: number;
  /**
   * Captures the *scene's* real per-frame dt over the window. Strongly preferred:
   * the report's own requestAnimationFrame runs at the monitor refresh rate, so
   * when the scene is capped below it (e.g. 60 on a 240Hz panel) rAF-based frame
   * times measure the compositor, not the scene — inflating "jank". Sampling the
   * scene's dt directly gives honest frame-time and jank numbers.
   */
  frameSampler?: { start(): void; stop(): number[] };
  /** Demo-specific fields (e.g. on-screen count, frame cap). */
  extra?: () => ReportExtra;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function collectRafDeltas(seconds: number): Promise<number[]> {
  return new Promise((resolve) => {
    const out: number[] = [];
    let last = performance.now();
    const t0 = last;
    const tick = (now: number) => {
      out.push(now - last);
      last = now;
      if (now - t0 >= seconds * 1000) resolve(out);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const browserName = (ua: string): string => {
  const m =
    /Firefox\/([\d.]+)/.exec(ua) ||
    /Edg\/([\d.]+)/.exec(ua) ||
    /Chrome\/([\d.]+)/.exec(ua) ||
    /Version\/([\d.]+).*Safari/.exec(ua);
  if (!m) return 'Unknown';
  const name = /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : 'Safari';
  return `${name} ${m[1].split('.')[0]}`;
};

export async function measurePerformance(opts: MeasureOptions = {}): Promise<PerfReport> {
  const seconds = opts.seconds ?? 4;

  let raw: number[];
  if (opts.frameSampler) {
    opts.frameSampler.start();
    await delay(seconds * 1000);
    raw = opts.frameSampler.stop();
  } else {
    raw = await collectRafDeltas(seconds);
  }

  const samples = raw.slice(1).filter((d) => d > 0); // drop warm-up frame
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const worst = sorted[sorted.length - 1] || 0;
  const median = pct(0.5) || 1;
  const jank = samples.filter((d) => d > median * 1.5).length;

  const mem = (
    performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  ).memory;
  const mb = (b: number) => +(b / 1048576).toFixed(1);
  const round = (n: number) => +n.toFixed(1);

  return {
    page: location.pathname,
    timestamp: new Date().toISOString(),
    browser: browserName(navigator.userAgent),
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    windowSeconds: seconds,
    sceneFpsMean: mean ? round(1000 / mean) : 0,
    sceneFpsMin: worst ? round(1000 / worst) : 0, // fps of the single worst frame
    frameMsP50: round(pct(0.5)),
    frameMsP95: round(pct(0.95)),
    frameMsP99: round(pct(0.99)),
    frameMsMax: round(worst),
    jankPct: samples.length ? round((jank / samples.length) * 100) : 0,
    domNodes: document.querySelectorAll('*').length,
    shadowNodes: document.querySelectorAll('[data-vecto-id]').length,
    heapUsedMB: mem ? mb(mem.usedJSHeapSize) : null,
    heapTotalMB: mem ? mb(mem.totalJSHeapSize) : null,
    extra: opts.extra ? opts.extra() : {},
  };
}

export function formatReport(r: PerfReport): string {
  const lines = [
    `VectoUI demo — performance report`,
    `page         ${r.page}`,
    `when         ${r.timestamp}`,
    `browser      ${r.browser}`,
    `viewport     ${r.viewport} @ ${r.dpr}x dpr`,
    `window       ${r.windowSeconds}s`,
    ``,
    `scene FPS    ${r.sceneFpsMean} mean · ${r.sceneFpsMin} min`,
    `frame time   p50 ${r.frameMsP50}ms · p95 ${r.frameMsP95}ms · p99 ${r.frameMsP99}ms · max ${r.frameMsMax}ms`,
    `jank         ${r.jankPct}% of frames > 1.5x median`,
    `DOM nodes    ${r.domNodes} total · ${r.shadowNodes} interactive shadow nodes`,
    `JS heap      ${r.heapUsedMB ?? '—'} MB used / ${r.heapTotalMB ?? '—'} MB total`,
  ];
  for (const [k, v] of Object.entries(r.extra)) lines.push(`${k.padEnd(12)} ${v}`);
  return lines.join('\n');
}

interface ReporterUI extends MeasureOptions {
  button: HTMLElement;
  panel: HTMLElement;
  pre: HTMLElement;
}

/** Wire a "run" button to measure and render a report into a panel with copy/download. */
export function setupReporter(ui: ReporterUI): void {
  const { button, panel, pre } = ui;
  let last: PerfReport | null = null;

  button.addEventListener('click', async () => {
    button.setAttribute('disabled', 'true');
    const original = button.textContent;
    button.textContent = `Measuring ${ui.seconds ?? 4}s…`;
    last = await measurePerformance(ui);
    pre.textContent = formatReport(last);
    panel.hidden = false;
    button.removeAttribute('disabled');
    button.textContent = original;
  });

  panel.querySelector('[data-report-copy]')?.addEventListener('click', () => {
    if (last) navigator.clipboard?.writeText(JSON.stringify(last, null, 2));
  });
  panel.querySelector('[data-report-download]')?.addEventListener('click', () => {
    if (!last) return;
    const blob = new Blob([JSON.stringify(last, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vecto-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  panel.querySelector('[data-report-close]')?.addEventListener('click', () => {
    panel.hidden = true;
  });
}
