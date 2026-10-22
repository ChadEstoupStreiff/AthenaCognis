import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { clampPanelWidth, ResizeHandleComponent, snapPanelWidth } from './resize-handle.component';

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

@Component({
  imports: [ResizeHandleComponent],
  template: `
    <div class="panel"></div>
    <ac-resize-handle
      orientation="horizontal"
      panel="before"
      [fitContainer]="false"
      [min]="200"
      [(width)]="height"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HorizontalHost {
  readonly height = signal(300);
}

describe('ResizeHandleComponent (horizontal)', () => {
  /**
   * Render the host with a 300px-tall panel above the handle.
   *
   * @returns Host instance and handle element.
   */
  function setup(): { host: HorizontalHost; handle: HTMLElement } {
    const fixture = TestBed.createComponent(HorizontalHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector<HTMLElement>('.panel');
    const handle = root.querySelector<HTMLElement>('ac-resize-handle');
    if (panel === null || handle === null) {
      throw new Error('Host template not rendered.');
    }
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 300));
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    return { host: fixture.componentInstance, handle };
  }

  it('grows the panel height when dragged down, past the container', () => {
    const { host, handle } = setup();
    handle.dispatchEvent(new MouseEvent('pointerdown', { clientY: 100 }));
    handle.dispatchEvent(new MouseEvent('pointermove', { clientY: 1100 }));
    handle.dispatchEvent(new MouseEvent('pointerup', { clientY: 1100 }));
    expect(host.height()).toBe(1300);
  });

  it('keeps the minimum height when dragged up', () => {
    const { host, handle } = setup();
    handle.dispatchEvent(new MouseEvent('pointerdown', { clientY: 400 }));
    handle.dispatchEvent(new MouseEvent('pointermove', { clientY: 100 }));
    expect(host.height()).toBe(200);
  });

  it('resizes with up/down arrows and ignores left/right', () => {
    const { host, handle } = setup();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(host.height()).toBe(300);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(host.height()).toBe(324);
  });
});
