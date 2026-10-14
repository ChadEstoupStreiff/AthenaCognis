import { describe, expect, it } from 'vitest';
import {
  encodeFileSegment,
  fileNameOf,
  isHiddenArtefactPath,
  isSharedFilePath,
  parseSharedPath,
} from './shared-path';
import { predictStoredName, predictStoredPath, splitExtension } from './upload-naming';

describe('parseSharedPath', () => {
  it('splits a valid path', () => {
    expect(parseSharedPath('/shared/2025-08-29/uploads/a b.pdf')).toEqual({
      date: '2025-08-29',
      folder: 'uploads',
      name: 'a b.pdf',
    });
  });

  it.each([
    '/etc/passwd',
    '/.env',
    '/shared/2025-08-29/uploads/..',
    '/shared/2025-08-29/../x',
    '/shared/2025-08-29/.previews/a.jpg',
    '/shared/2025-08-29/uploads/sub/a.pdf',
    'shared/2025-08-29/uploads/a.pdf',
    '/shared/25-08-29/uploads/a.pdf',
  ])('rejects %s', (path) => {
    expect(isSharedFilePath(path)).toBe(false);
  });
});

describe('path helpers', () => {
  it('extracts the file name', () => {
    expect(fileNameOf('/shared/2025-08-29/notes/12-00-00.md')).toBe('12-00-00.md');
  });

  it('detects hidden artefacts', () => {
    expect(isHiddenArtefactPath('/shared/.previews/2025-08-29/uploads/a.pdf.jpg')).toBe(true);
    expect(isHiddenArtefactPath('/shared/2025-08-29/uploads/a.pdf')).toBe(false);
  });

  it('encodes slashes so the backend sees the leading slash', () => {
    expect(encodeFileSegment('/shared/2025-08-29/uploads/a#b.pdf')).toBe(
      '%2Fshared%2F2025-08-29%2Fuploads%2Fa%23b.pdf',
    );
  });
});

describe('upload naming', () => {
  it('mimics os.path.splitext', () => {
    expect(splitExtension('a.tar.gz')).toEqual({ stem: 'a.tar', extension: '.gz' });
    expect(splitExtension('.bashrc')).toEqual({ stem: '.bashrc', extension: '' });
    expect(splitExtension('..a.b')).toEqual({ stem: '..a', extension: '.b' });
    expect(splitExtension('noext')).toEqual({ stem: 'noext', extension: '' });
  });

  it('sanitizes and converts like the backend', () => {
    expect(predictStoredName('a/b\\c:d?.pdf')).toBe('a_b_c-d.pdf');
    expect(predictStoredName('IMG_1.HEIC')).toBe('IMG_1.png');
    expect(predictStoredName('memo.m4a')).toBe('memo.mp3');
  });

  it('predicts the stored path', () => {
    expect(predictStoredPath('2025-08-29', 'uploads', 'x?.heic')).toBe(
      '/shared/2025-08-29/uploads/x.png',
    );
  });
});
