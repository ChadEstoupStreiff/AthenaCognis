import { clampPanelWidth, snapPanelWidth } from './resize-handle.component';

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

describe('snapPanelWidth', () => {
  const bounds = { min: 200, max: 400, snap: 40 };

  it('clamps an expanded panel between min and max', () => {
    expect(snapPanelWidth(300, 232, false, bounds)).toEqual({ collapsed: false, width: 300 });
    expect(snapPanelWidth(180, 232, false, bounds)).toEqual({ collapsed: false, width: 200 });
    expect(snapPanelWidth(500, 232, false, bounds)).toEqual({ collapsed: false, width: 400 });
  });

  it('collapses when dragged past the minimum by the snap distance', () => {
    expect(snapPanelWidth(159, 232, false, bounds)).toEqual({ collapsed: true, width: 200 });
  });

  it('stays collapsed until dragged open by the snap distance', () => {
    expect(snapPanelWidth(100, 68, true, bounds)).toEqual({ collapsed: true, width: 200 });
    expect(snapPanelWidth(30, 68, true, bounds)).toEqual({ collapsed: true, width: 200 });
  });

  it('expands at the minimum width when a collapsed panel is dragged open', () => {
    expect(snapPanelWidth(109, 68, true, bounds)).toEqual({ collapsed: false, width: 200 });
  });
});
