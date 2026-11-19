import { maskLines, maskLink } from './mask-link';

describe('maskLink', () => {
  it('keeps scheme and host, hides credentials, path and query', () => {
    expect(maskLink('https://user:pass@cloud.x.org:8443/cal.ics?export')).toBe(
      'https://cloud.x.org:8443/••••',
    );
    expect(maskLink('webcal://p01-caldav.icloud.com/published/2/abc')).toBe(
      'webcal://p01-caldav.icloud.com/••••',
    );
  });

  it('hides everything when the link does not parse', () => {
    expect(maskLink('not a link secret')).toBe('••••');
  });
});

describe('maskLines', () => {
  it('masks each non-blank line', () => {
    expect(maskLines('https://a.org/x\n\n  https://b.org/y  \n')).toEqual([
      'https://a.org/••••',
      'https://b.org/••••',
    ]);
  });
});
