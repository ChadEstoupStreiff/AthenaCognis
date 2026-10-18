import { describe, expect, it } from 'vitest';
import { cleanSummaryText, toSummaryRecord } from './summary';

describe('cleanSummaryText', () => {
  it('unwraps a fenced markdown answer', () => {
    expect(cleanSummaryText('```markdown\n### Title\n- point\n```')).toBe('### Title\n- point');
  });

  it('drops an unclosed leading fence', () => {
    expect(cleanSummaryText('```\nThis diagram describes **a pipeline**.')).toBe(
      'This diagram describes **a pipeline**.',
    );
  });

  it('drops a stray language line', () => {
    expect(cleanSummaryText('markdown\nThe file **a.md** is about X.')).toBe(
      'The file **a.md** is about X.',
    );
  });

  it('keeps code blocks inside the summary', () => {
    const text = 'Intro\n\n```python\nprint(1)\n```';
    expect(cleanSummaryText(text)).toBe(text);
  });

  it('leaves plain text alone', () => {
    expect(cleanSummaryText('  Plain summary.  ')).toBe('Plain summary.');
  });
});

describe('toSummaryRecord', () => {
  it('cleans the text and keeps null', () => {
    expect(toSummaryRecord(null)).toBeNull();
    expect(
      toSummaryRecord({ file: 'f', date: 'd', summary: '```md\nHi\n```', keywords: ['k'] }),
    ).toEqual({ file: 'f', date: 'd', summary: 'Hi', keywords: ['k'] });
  });
});
