import { tokenize } from './tokenize';

/**
 * Emit a string token-by-token at a target rate, so a prebaked answer plays back
 * like a live model streaming. Honors an AbortSignal so a new question can
 * interrupt the current playback.
 */
export async function* pacedTokens(
  text: string,
  tokensPerSec: number,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const delay = Math.max(0, 1000 / Math.max(1, tokensPerSec));
  for (const tok of tokenize(text)) {
    if (signal?.aborted) return;
    yield tok;
    if (delay > 0) await sleep(delay, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    });
  });
}
