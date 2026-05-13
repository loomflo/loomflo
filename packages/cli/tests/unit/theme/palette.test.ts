import { describe, expect, it } from 'vitest';
import { palette, paletteHex } from '../../../src/theme/palette.js';

describe('palette', () => {
  it('exposes the 5 Mint tokens as RGB tuples', () => {
    expect(palette.accent).toEqual([139, 209, 181]);
    expect(palette.muted).toEqual([167, 215, 197]);
    expect(palette.dim).toEqual([107, 122, 120]);
    expect(palette.warn).toEqual([230, 201, 122]);
    expect(palette.err).toEqual([232, 144, 140]);
  });

  it('exposes matching hex strings', () => {
    expect(paletteHex.accent).toBe('#8BD1B5');
    expect(paletteHex.muted).toBe('#A7D7C5');
    expect(paletteHex.dim).toBe('#6B7A78');
    expect(paletteHex.warn).toBe('#E6C97A');
    expect(paletteHex.err).toBe('#E8908C');
  });

  it('palette keys match paletteHex keys', () => {
    expect(Object.keys(palette).sort()).toEqual(Object.keys(paletteHex).sort());
  });
});
