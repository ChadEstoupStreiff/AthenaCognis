import { describe, expect, it } from 'vitest';
import {
  buildTable,
  imageMarkdown,
  insertBlock,
  parseImage,
  renderImage,
  setHeading,
  styledSpan,
  type TextEdit,
  toggleLineMarker,
  wrapSelection,
} from './markdown-format';

/**
 * Apply an edit to a document.
 *
 * @param doc - Document.
 * @param edit - Edit.
 * @returns New document.
 */
function applyEdit(doc: string, edit: TextEdit): string {
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}

describe('wrapSelection', () => {
  it('wraps the selection and keeps it selected', () => {
    const edit = wrapSelection('say hi now', 4, 6, '**', '**', 'text');
    expect(applyEdit('say hi now', edit)).toBe('say **hi** now');
    expect([edit.selectFrom, edit.selectTo]).toEqual([6, 8]);
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    const edit = wrapSelection('ab', 1, 1, '*', '*', 'text');
    expect(applyEdit('ab', edit)).toBe('a*text*b');
    expect([edit.selectFrom, edit.selectTo]).toEqual([2, 6]);
  });

  it('unwraps an already wrapped selection', () => {
    const doc = 'say **hi** now';
    expect(applyEdit(doc, wrapSelection(doc, 6, 8, '**', '**', 'text'))).toBe('say hi now');
  });
});

describe('setHeading', () => {
  it('replaces an existing heading level', () => {
    const doc = 'intro\n## Title\nend';
    expect(applyEdit(doc, setHeading(doc, 9, 9, 3))).toBe('intro\n### Title\nend');
  });

  it('turns a heading back into a paragraph', () => {
    expect(applyEdit('# Title', setHeading('# Title', 0, 0, 0))).toBe('Title');
  });

  it('rejects invalid levels', () => {
    expect(() => setHeading('x', 0, 0, 7)).toThrow(RangeError);
  });
});

describe('toggleLineMarker', () => {
  it('numbers every selected line', () => {
    const doc = 'a\nb\nc';
    expect(applyEdit(doc, toggleLineMarker(doc, 0, doc.length, 'ordered'))).toBe(
      '1. a\n2. b\n3. c',
    );
  });

  it('removes the marker when every line has it', () => {
    const doc = '- a\n- b';
    expect(applyEdit(doc, toggleLineMarker(doc, 0, doc.length, 'bullet'))).toBe('a\nb');
  });

  it('switches a bullet list to a task list', () => {
    expect(applyEdit('- a', toggleLineMarker('- a', 0, 0, 'task'))).toBe('- [ ] a');
  });

  it('quotes lines without touching their list marker', () => {
    expect(applyEdit('- a', toggleLineMarker('- a', 0, 0, 'quote'))).toBe('> - a');
  });
});

describe('insertBlock', () => {
  it('surrounds the block with blank lines', () => {
    const edit = insertBlock('text', 4, 4, '---');
    expect(applyEdit('text', edit)).toBe('text\n\n---\n\n');
    expect(edit.selectFrom).toBe(9);
  });

  it('adds no blank line at the start of the document', () => {
    expect(applyEdit('\n\nrest', insertBlock('\n\nrest', 0, 0, '---'))).toBe('---\n\nrest');
  });
});

describe('buildTable', () => {
  it('builds header, separator and body rows', () => {
    expect(buildTable(1, 2)).toBe('| Column 1 | Column 2 |\n| --- | --- |\n|   |   |');
  });

  it('rejects empty tables', () => {
    expect(() => buildTable(0, 2)).toThrow(RangeError);
  });
});

describe('styledSpan / imageMarkdown', () => {
  it('builds a styled span', () => {
    expect(styledSpan('color', '#dc2626')).toEqual({
      before: '<span style="color: #dc2626">',
      after: '</span>',
    });
  });

  it('escapes parentheses and brackets', () => {
    expect(imageMarkdown('a [b].png', '/raw/n (1)/x.png')).toBe('![a b.png](/raw/n %281%29/x.png)');
  });
});

describe('parseImage / renderImage', () => {
  it('turns a Markdown image into a sized HTML image and back', () => {
    const image = parseImage('![A "b"](/raw/a.png)');
    expect(image).toEqual({ alt: 'A "b"', url: '/raw/a.png', width: null, caption: false });
    const sized = renderImage({ alt: 'A "b"', url: '/raw/a.png', width: '50%', caption: true });
    expect(sized).toBe(
      '<figure><img src="/raw/a.png" alt="A &quot;b&quot;" width="50%"><figcaption>A &quot;b&quot;</figcaption></figure>',
    );
    expect(parseImage(sized)).toEqual({
      alt: 'A "b"',
      url: '/raw/a.png',
      width: '50%',
      caption: true,
    });
    expect(renderImage({ alt: 'A', url: '/raw/a.png', width: null, caption: false })).toBe(
      '![A](/raw/a.png)',
    );
  });

  it('rejects text that is not a single image', () => {
    expect(parseImage('see ![a](b) here')).toBeNull();
  });
});
