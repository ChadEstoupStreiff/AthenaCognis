import { folderCrumbs, togglePath } from './folder-path';

describe('folderCrumbs', () => {
  it('builds one crumb per part with its cumulative path', () => {
    expect(folderCrumbs('Documents/Work/2026')).toEqual([
      { name: 'Documents', path: 'Documents' },
      { name: 'Work', path: 'Documents/Work' },
      { name: '2026', path: 'Documents/Work/2026' },
    ]);
  });

  it('has no crumb for the root', () => {
    expect(folderCrumbs('')).toEqual([]);
  });
});

describe('togglePath', () => {
  it('adds once, sorted', () => {
    expect(togglePath(['Code'], 'Bills', true)).toEqual(['Bills', 'Code']);
    expect(togglePath(['Code'], 'Code', true)).toEqual(['Code']);
  });

  it('removes', () => {
    expect(togglePath(['Bills', 'Code'], 'Code', false)).toEqual(['Bills']);
  });
});
