export type RgbTuple = readonly [number, number, number];

export const palette = {
  accent: [139, 209, 181],
  muted: [167, 215, 197],
  dim: [107, 122, 120],
  warn: [230, 201, 122],
  err: [232, 144, 140],
} as const satisfies Record<string, RgbTuple>;

export const paletteHex = {
  accent: '#8BD1B5',
  muted: '#A7D7C5',
  dim: '#6B7A78',
  warn: '#E6C97A',
  err: '#E8908C',
} as const;

export type Tone = keyof typeof palette;
