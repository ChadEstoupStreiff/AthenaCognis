import { describe, expect, it } from 'vitest';
import { isInternalLink, renderMarkdown } from './markdown';

describe('renderMarkdown styles', () => {
  it('keeps allowed color and size declarations', () => {
    const html = renderMarkdown('<span style="color: red; font-size: 1.25em">hi</span>');
    expect(html).toContain('color: red');
    expect(html).toContain('font-size: 1.25em');
  });

  it('drops positioning and url based styles', () => {
    const html = renderMarkdown(
      '<span style="position: fixed; background-image: url(x.png); color: blue">hi</span>',
    );
    expect(html).not.toContain('position');
    expect(html).not.toContain('url');
    expect(html).toContain('color: blue');
  });

  it('renders note images', () => {
    expect(renderMarkdown('![a](/raw/2026-11-24/notes/n/assets/a.png)')).toContain(
      '<img src="/raw/2026-11-24/notes/n/assets/a.png" alt="a">',
    );
  });
});

describe('renderMarkdown extensions', () => {
  it('turns tagged blockquotes into callouts', () => {
    expect(renderMarkdown('> [!WARNING]\n> Careful')).toContain(
      '<blockquote class="callout callout-warning"><p class="callout-title">Warning</p>',
    );
  });

  it('leaves math placeholders for KaTeX', () => {
    const html = renderMarkdown('Inline $x^2$ costs $5 and $6.\n\n$$\na+b\n$$');
    expect(html).toContain('<span class="math" data-tex="x^2">');
    expect(html).toContain('<div class="math math-block" data-tex="a+b">');
    expect(html).toContain('$5 and $6');
  });

  it('keeps mermaid code unhighlighted for the diagram renderer', () => {
    expect(renderMarkdown('```mermaid\nflowchart LR\n```')).toContain('language-mermaid');
  });

  it('renders file embeds as preview cards', () => {
    const html = renderMarkdown('![Report](/f/2026-11-24/uploads/r.pdf)');
    expect(html).toContain('class="file-embed" href="/f/2026-11-24/uploads/r.pdf"');
    expect(html).toContain('/api/preview/');
  });

  it('opens only external links in a new tab', () => {
    const html = renderMarkdown('[in](/people/1) [out](https://example.com)');
    expect(html).toContain('<a href="/people/1">in</a>');
    expect(html).toContain('target="_blank"');
    expect(isInternalLink('/raw/x.png')).toBe(false);
  });

  it('keeps sized images and captions', () => {
    const html = renderMarkdown(
      '<figure><img src="/raw/a.png" alt="A" width="50%"><figcaption>A</figcaption></figure>',
    );
    expect(html).toContain('width="50%"');
    expect(html).toContain('<figcaption>A</figcaption>');
  });
});
