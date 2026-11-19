import { addLine, isExternalLink, linesOf, pendingSuggestions } from './lines';

describe('lines', () => {
  it('reads trimmed non-blank lines', () => {
    expect(linesOf(' a \n\n b\n')).toEqual(['a', 'b']);
  });

  it('appends once', () => {
    expect(addLine('a\n', 'b')).toBe('a\nb');
    expect(addLine('', 'b')).toBe('b');
    expect(addLine('a\nb', 'b')).toBe('a\nb');
  });

  it('keeps suggestions not entered yet', () => {
    const options = [
      { value: 'me/app', label: 'me/app' },
      { value: 'me/new', label: 'me/new' },
    ];
    expect(pendingSuggestions(options, 'me/app')).toEqual([options[1]]);
  });

  it('detects external links', () => {
    expect(isExternalLink('https://github.com/me/app')).toBe(true);
    expect(isExternalLink('/mail?open=1')).toBe(false);
  });
});
