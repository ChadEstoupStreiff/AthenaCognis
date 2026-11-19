import { fileExtension, previewType } from './attachment-preview';

describe('attachment preview', () => {
  it('reads the extension case-insensitively', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.hidden')).toBe('');
  });

  it('previews media, PDF and text with a forced MIME type', () => {
    expect(previewType('photo.JPG')).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(previewType('clip.mov')).toEqual({ kind: 'video', mime: 'video/quicktime' });
    expect(previewType('memo.m4a')?.kind).toBe('audio');
    expect(previewType('invoice.pdf')?.kind).toBe('pdf');
    expect(previewType('notes.txt')?.kind).toBe('text');
  });

  it('downloads script-capable and unknown types instead of previewing', () => {
    for (const name of ['logo.svg', 'page.html', 'feed.xml', 'sheet.xlsx', 'attachment']) {
      expect(previewType(name)).toBeNull();
    }
  });
});
