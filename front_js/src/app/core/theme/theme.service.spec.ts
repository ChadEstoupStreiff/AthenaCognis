import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('app-dark');
  });

  it('cycles modes and toggles the dark class', () => {
    const theme = TestBed.inject(ThemeService);
    theme.mode.set('dark');
    TestBed.tick();
    expect(document.documentElement.classList.contains('app-dark')).toBe(true);
    theme.cycle();
    TestBed.tick();
    expect(theme.mode()).toBe('system');
    expect(localStorage.getItem('athena.theme')).toBe('system');
  });

  it('switches through a view transition after the first render', () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {} as ViewTransition;
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    try {
      const theme = TestBed.inject(ThemeService);
      theme.mode.set('light');
      TestBed.tick();
      expect(startViewTransition).not.toHaveBeenCalled();
      theme.mode.set('dark');
      TestBed.tick();
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.classList.contains('app-dark')).toBe(true);
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });
});
