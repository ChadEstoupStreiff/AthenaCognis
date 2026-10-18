import { describe, expect, it } from 'vitest';
import { fileKindOf, guessMime, mimesForCategories, renderableKindOf } from './index';

describe('mime helpers', () => {
  it('guesses like the backend', () => {
    expect(guessMime('/shared/2025-01-01/notes/a.MD')).toBe('text/markdown');
    expect(guessMime('a.webp')).toBe('image/webp');
    expect(guessMime('a.unknown')).toBe('application/octet-stream');
  });

  it('classifies renderers', () => {
    expect(fileKindOf('a.pdf')).toBe('pdf');
    expect(fileKindOf('a.tif')).toBe('tiff');
    expect(fileKindOf('a.csv', 'text/csv')).toBe('table');
    expect(fileKindOf('a.py')).toBe('code');
    expect(fileKindOf('a.mp3', 'audio/mpeg')).toBe('audio');
    expect(fileKindOf('a.zip')).toBe('archive');
    expect(fileKindOf('a.docx')).toBe('office');
    expect(fileKindOf('a.svg')).toBe('html');
    expect(fileKindOf('a.bin')).toBe('binary');
  });

  it('expands categories', () => {
    expect(mimesForCategories(['audio'])).toContain('audio/mpeg');
    expect(mimesForCategories([])).toEqual([]);
  });
});

describe('renderableKindOf', () => {
  it('offers rendered or source views for Markdown, HTML and SVG only', () => {
    expect(renderableKindOf('/shared/2025-01-01/notes/a.md', 'markdown')).toBe('markdown');
    expect(renderableKindOf('/shared/2025-01-01/uploads/a.HTML', 'html')).toBe('html');
    expect(renderableKindOf('/shared/2025-01-01/uploads/logo.svg', 'html')).toBe('svg');
    expect(renderableKindOf('/shared/2025-01-01/uploads/a.py', 'code')).toBeNull();
  });
});
