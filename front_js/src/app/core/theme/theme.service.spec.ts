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
});
