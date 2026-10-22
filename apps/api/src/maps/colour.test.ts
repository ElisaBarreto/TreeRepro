import { describe, expect, it } from 'vitest';
import { colourScale, fillColour, RAMPS, rampColour } from './colour.ts';

// scales::gradient_n_pal(viridisLite::viridis(6, option, direction = -1))(x) in R.
const R_SAMPLES: Record<keyof typeof RAMPS, [number, string][]> = {
  magma: [[0, '#FCFDBF'], [0.1, '#FFCE95'], [0.25, '#F78B6C'], [0.5, '#B63875'], [0.73, '#591776'], [0.999, '#010005'], [1, '#000004']],
  mako: [[0, '#DEF5E5'], [0.1, '#A3E2C8'], [0.25, '#57C0AC'], [0.5, '#3A7AA3'], [0.73, '#3B3B6C'], [0.999, '#0B0406'], [1, '#0B0405']],
  viridis: [[0, '#FDE725'], [0.1, '#C0DD40'], [0.25, '#6BC760'], [0.5, '#2B9089'], [0.73, '#3D578A'], [0.999, '#440154'], [1, '#440154']],
  cividis: [[0, '#FFEA46'], [0.1, '#E5D25A'], [0.25, '#BEAF6D'], [0.5, '#7E7C74'], [0.73, '#45516D'], [0.999, '#00204D'], [1, '#00204D']],
};

describe('RFC-76 R4 colours', () => {
  it.each(Object.keys(R_SAMPLES) as (keyof typeof RAMPS)[])('%s interpolates in CIELAB exactly as R', (ramp) => {
    for (const [x, expected] of R_SAMPLES[ramp]) expect(rampColour(ramp, x), `${ramp} ${x}`).toBe(expected);
  });

  it('percent kinds run 0-100; others the data range, log10 at a 100-fold span of positive values', () => {
    expect(colourScale('completeness', [3, 40])).toEqual({ limits: [0, 100], log: false, percent: true });
    expect(colourScale('mean', [2, 50])).toEqual({ limits: [2, 50], log: false, percent: false });
    expect(colourScale('mean', [2, 200])).toEqual({ limits: [2, 200], log: true, percent: false });
    expect(colourScale('mean', [0, 200]).log).toBe(false);
    expect(colourScale('mean', [5]).log).toBe(false);
  });

  it('a value is clamped, placed on the scale, the middle when both ends are equal; none is grey92', () => {
    const linear = colourScale('mean', [0, 10]);
    expect(fillColour('mean', 0, linear)).toBe('#DEF5E5');
    expect(fillColour('mean', 10, linear)).toBe('#0B0405');
    expect(fillColour('mean', 5, linear)).toBe(rampColour('mako', 0.5));
    const log = colourScale('mean', [1, 100]);
    expect(fillColour('mean', 10, log)).toBe(rampColour('mako', 0.5));
    expect(fillColour('completeness', 150, colourScale('completeness', [150]))).toBe('#000004');
    expect(fillColour('mean', 7, colourScale('mean', [7]))).toBe(rampColour('mako', 0.5));
    expect(fillColour('mean', null, linear)).toBe('#EBEBEB');
  });
});
