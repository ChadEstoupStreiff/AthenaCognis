import { describe, expect, it } from 'vitest';
import { isEmbeddableImage, noteAssetName } from './note-assets';

describe('noteAssetName', () => {
  const now = new Date(2026, 10, 24, 9, 5, 7, 42);

  it('keeps the original stem and extension', () => {
    expect(noteAssetName('Shot.PNG', 'image/png', now)).toBe('Shot-09-05-07-042.png');
  });

  it('derives the extension from the MIME type', () => {
    expect(noteAssetName('', 'image/jpeg', now)).toBe('image-09-05-07-042.jpg');
  });

  it('keeps other files without an extension as is', () => {
    expect(noteAssetName('', 'application/octet-stream', now)).toBe('file-09-05-07-042');
  });
});

describe('isEmbeddableImage', () => {
  it('accepts images only', () => {
    expect(isEmbeddableImage(new Blob([], { type: 'image/png' }))).toBe(true);
    expect(isEmbeddableImage(new Blob([], { type: 'application/pdf' }))).toBe(false);
  });
});
