import { clampPanelWidth } from './resize-handle.component';

describe('clampPanelWidth', () => {
  it('keeps widths inside the range', () => {
    expect(clampPanelWidth(500.4, 280, 900)).toBe(500);
    expect(clampPanelWidth(100, 280, 900)).toBe(280);
    expect(clampPanelWidth(1200, 280, 900)).toBe(900);
  });

  it('prefers the minimum when the container is too narrow', () => {
    expect(clampPanelWidth(400, 280, 150)).toBe(280);
  });
});
