import { describe, expect, it } from 'vitest';
import { parseOcr } from './ocr';
import { parseTodo, toBackendTodo, toFileLinks } from './entities';

describe('parseOcr', () => {
  it('parses PaddleOCR polygons', () => {
    const raw = JSON.stringify([
      [
        [
          [10, 20],
          [110, 20],
          [110, 40],
          [10, 40],
        ],
        ['Hello', 0.98],
      ],
      [
        [
          [0.1, 0.5],
          [0.4, 0.5],
          [0.4, 0.6],
          [0.1, 0.6],
        ],
        ['World', '0.5'],
      ],
    ]);
    const parsed = parseOcr(raw);
    expect(parsed.text).toBe('Hello\nWorld');
    expect(parsed.boxes[0]).toMatchObject({
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 40,
      score: 0.98,
      normalized: false,
    });
    expect(parsed.boxes[1]).toMatchObject({ normalized: true, score: 0.5 });
  });

  it('accepts dict items and xyxy boxes', () => {
    const parsed = parseOcr(JSON.stringify([{ bbox: [1, 2, 3, 4], text: 'x', score: 0.1 }]));
    expect(parsed.boxes[0]).toMatchObject({ x1: 1, y2: 4, text: 'x' });
  });

  it('keeps LLM plain text', () => {
    expect(parseOcr('Some text [not json')).toEqual({ text: 'Some text [not json', boxes: [] });
    expect(parseOcr(null)).toEqual({ text: '', boxes: [] });
  });
});

describe('entity mappers', () => {
  it('sorts links by strength', () => {
    expect(
      toFileLinks([
        ['a', 1, null],
        ['b', 2.5, 'c'],
      ]),
    ).toEqual([
      { other: 'b', force: 2.5, comment: 'c' },
      { other: 'a', force: 1, comment: '' },
    ]);
  });

  it('round-trips TODO items', () => {
    const items = parseTodo('[{"Done": true, "Task": "x"}, {"bad": 1}]');
    expect(items).toEqual([{ done: true, task: 'x' }]);
    expect(toBackendTodo(items)).toEqual([{ Done: true, Task: 'x' }]);
    expect(parseTodo('not json')).toEqual([]);
  });
});
