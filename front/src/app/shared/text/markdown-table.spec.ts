import { describe, expect, it } from 'vitest';
import {
  applyTableOperation,
  findTable,
  formatTable,
  parseTable,
  splitRow,
} from './markdown-table';

const DOC = 'intro\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\nend';

describe('splitRow', () => {
  it('splits cells and keeps escaped pipes', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });
});

describe('findTable', () => {
  it('finds the table and the cursor cell', () => {
    const position = DOC.indexOf('2 |');
    const found = findTable(DOC, position);
    expect(found?.row).toBe(1);
    expect(found?.column).toBe(1);
    expect(DOC.slice(found?.from, found?.to)).toBe('| a | b |\n|:--|--:|\n| 1 | 2 |');
  });

  it('returns null outside a table', () => {
    expect(findTable(DOC, 1)).toBeNull();
  });
});

describe('formatTable / applyTableOperation', () => {
  const table = parseTable(['| a | b |', '|:--|--:|', '| 1 | 2 |']);

  it('aligns pipes and keeps alignments', () => {
    expect(table && formatTable(table)).toBe('| a   |   b |\n| :-- | --: |\n| 1   |   2 |');
  });

  it('inserts and deletes rows and columns', () => {
    if (table === null) {
      throw new Error('table expected');
    }
    const withRow = applyTableOperation(table, 1, 0, { kind: 'insertRow' });
    expect(withRow.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['', ''],
    ]);
    const withColumn = applyTableOperation(table, 0, 0, { kind: 'insertColumn' });
    expect(withColumn.rows[0]).toEqual(['a', '', 'b']);
    expect(withColumn.aligns).toEqual(['left', 'none', 'right']);
    expect(applyTableOperation(table, 0, 1, { kind: 'deleteColumn' }).rows).toEqual([['a'], ['1']]);
  });

  it('keeps the header and the last body row', () => {
    if (table === null) {
      throw new Error('table expected');
    }
    expect(applyTableOperation(table, 0, 0, { kind: 'deleteRow' })).toBe(table);
    expect(applyTableOperation(table, 1, 0, { kind: 'deleteRow' })).toBe(table);
  });

  it('changes a column alignment', () => {
    if (table === null) {
      throw new Error('table expected');
    }
    expect(applyTableOperation(table, 0, 1, { kind: 'align', align: 'center' }).aligns).toEqual([
      'left',
      'center',
    ]);
  });
});
