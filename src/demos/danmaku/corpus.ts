/**
 * A prebaked, backend-free pool of sample comments. Deliberately multilingual +
 * emoji so the demo doubles as a showcase of VectoUI's text rendering. Picked at
 * random to keep the stream lively without a server.
 */
export const COMMENTS: readonly string[] = [
  'VectoUI is buttery smooth 🧈',
  '前方高能!!!',
  '这弹幕一点都不卡 😮',
  '草草草草草',
  'zero DOM nodes, respect 🫡',
  'Playwright can click these?!',
  'いいね〜 (´• ω •`)',
  '弾幕すごい',
  '60fps gang where you at 🏎️',
  '한국어도 잘 나오네 👍',
  'مرحبا بالعالم',
  'Это очень быстро!',
  'render everything on canvas 🎨',
  '666666666',
  'accessibility + canvas = 🤯',
  'this would kill bilibili lol',
  'ありがとう ✨',
  'à la perfection 🇫🇷',
  'wgöttlich schnell',
  'no jank detected ✅',
  '滚屏弹幕天花板',
  'agent-native ftw 🤖',
  'how is this not lagging',
  'GPU goes brrr',
  '太丝滑了吧 🥹',
  'screen reader friendly 🦮',
  '¡increíble rendimiento!',
  'so many comments 😵‍💫',
  'first! (not really)',
  'math-driven UI 📐',
];

const COLORS: readonly string[] = [
  '#ffffff',
  '#ffffff',
  '#ffffff', // white is most common, weight it
  '#7cb3ff',
  '#ffd166',
  '#06d6a0',
  '#ff6b9d',
  '#c77dff',
  '#ff9f1c',
];

export type DanmakuType = 'scroll' | 'top' | 'bottom';

export interface CommentDraw {
  text: string;
  color: string;
  fontSize: number;
  type: DanmakuType;
}

const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

/** Roll a random comment with a weighted bias toward plain white scrolling text. */
export function rollComment(): CommentDraw {
  const r = Math.random();
  const type: DanmakuType = r < 0.86 ? 'scroll' : r < 0.93 ? 'top' : 'bottom';
  const big = Math.random() < 0.12;
  return {
    text: pick(COMMENTS),
    color: pick(COLORS),
    fontSize: big ? 30 : 22,
    type,
  };
}
