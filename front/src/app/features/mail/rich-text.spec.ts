import {
  fitWithin,
  isBlankContent,
  mailReadyHtml,
  sanitizeMailHtml,
  textToHtml,
} from './rich-text';

describe('rich text', () => {
  it('converts plain text to HTML keeping line breaks', () => {
    expect(textToHtml('a & b\r\nc\nd')).toBe('a &amp; b<br>c<br>d');
  });

  it('drops scripts but keeps formatting and data URI images', () => {
    const clean = sanitizeMailHtml(
      '<b>hi</b><script>alert(1)</script><img src="data:image/png;base64,AA">',
    );
    expect(clean).toContain('<b>hi</b>');
    expect(clean).not.toContain('script');
    expect(clean).toContain('data:image/png;base64,AA');
  });

  it('treats an image without text as content', () => {
    expect(isBlankContent('  \n', '<br>')).toBe(true);
    expect(isBlankContent('', '<img src="x">')).toBe(false);
    expect(isBlankContent('hi', 'hi')).toBe(false);
  });

  it('scales wide images down keeping the ratio', () => {
    expect(fitWithin({ width: 2400, height: 1200 }, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin({ width: 800, height: 600 }, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('sends font sizes and colors as inline CSS spans', () => {
    const editor = document.createElement('div');
    editor.innerHTML =
      '<font size="5" color="#ff0000">big <b>red</b></font> <img class="selected" src="x">';
    const html = mailReadyHtml(editor);
    expect(html).not.toContain('<font');
    expect(html).toContain('font-size: 20px');
    expect(html).toMatch(/color: (rgb\(255, 0, 0\)|#ff0000)/);
    expect(html).toContain('<b>red</b>');
    expect(html).toContain('<img src="x">');
    expect(editor.innerHTML).toContain('<font');
  });
});
