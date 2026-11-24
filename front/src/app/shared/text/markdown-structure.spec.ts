import { describe, expect, it } from 'vitest';
import { extractHeadings, scanLines, textStats, toggleTask } from './markdown-structure';

describe('scanLines', () => {
  it('flags fenced code, fences included', () => {
    const flags = scanLines('a\n```\n# not\n```\nb').map((line) => line.inFence);
    expect(flags).toEqual([false, true, true, true, false]);
  });

  it('keeps a fence open until the same marker closes it', () => {
    const flags = scanLines('~~~\n```\n~~~\nx').map((line) => line.inFence);
    expect(flags).toEqual([true, true, true, false]);
  });
});

describe('extractHeadings', () => {
  it('lists ATX headings outside code with plain text', () => {
    expect(extractHeadings('# **Title**\ntext\n```\n# code\n```\n### [Link](/x) ##')).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 3, text: 'Link', line: 6 },
    ]);
  });
});

describe('toggleTask', () => {
  const doc = '- [ ] one\n```\n- [ ] code\n```\n1. [x] two';

  it('checks the nth task, skipping code blocks', () => {
    expect(toggleTask(doc, 0)).toBe('- [x] one\n```\n- [ ] code\n```\n1. [x] two');
    expect(toggleTask(doc, 1)).toBe('- [ ] one\n```\n- [ ] code\n```\n1. [ ] two');
  });

  it('leaves the document unchanged for unknown tasks', () => {
    expect(toggleTask(doc, 5)).toBe(doc);
  });
});

describe('textStats', () => {
  it('counts words of the rendered text', () => {
    expect(textStats('# Hello **big** [world](http://x.y)')).toEqual({
      words: 3,
      characters: 35,
      readingMinutes: 1,
    });
  });

  it('reports zero for an empty note', () => {
    expect(textStats('').readingMinutes).toBe(0);
  });
});
