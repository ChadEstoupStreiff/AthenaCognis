import { describe, expect, it } from 'vitest';
import { buildAnchors, easeStep, invertAnchors, mapScroll } from './scroll-sync';

describe('scroll sync', () => {
  const anchors = buildAnchors([100, 300], [200, 900], 1000, 2000);

  it('frames heading anchors with both ends', () => {
    expect(anchors).toEqual([
      { source: 0, target: 0 },
      { source: 100, target: 200 },
      { source: 300, target: 900 },
      { source: 1000, target: 2000 },
    ]);
  });

  it('interpolates between anchors', () => {
    expect(mapScroll(anchors, 200)).toBe(550);
    expect(mapScroll(anchors, 5000)).toBe(2000);
  });

  it('falls back to a proportional mapping when heading counts differ', () => {
    expect(buildAnchors([100], [], 1000, 500)).toEqual([
      { source: 0, target: 0 },
      { source: 1000, target: 500 },
    ]);
  });

  it('maps back with inverted anchors', () => {
    expect(mapScroll(invertAnchors(anchors), 550)).toBe(200);
  });
});

describe('easeStep', () => {
  it('covers a share of the remaining distance', () => {
    expect(easeStep(0, 100, 0.3)).toBe(30);
    expect(easeStep(100, 0, 0.5)).toBe(50);
  });

  it('snaps when close to the target', () => {
    expect(easeStep(99.6, 100, 0.3)).toBe(100);
  });
});
