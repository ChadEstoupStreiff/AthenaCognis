import { describe, expect, it } from 'vitest';
import { isOwnDropZone, OWN_DROP_ATTRIBUTE } from './drop-overlay.component';

describe('isOwnDropZone', () => {
  it('detects drops inside an element handling files itself (notes editor)', () => {
    const zone = document.createElement('div');
    zone.setAttribute(OWN_DROP_ATTRIBUTE, '');
    const line = document.createElement('span');
    zone.append(line);
    document.body.append(zone);
    expect(isOwnDropZone(line)).toBe(true);
    zone.remove();
  });

  it('lets the global upload overlay handle other drops', () => {
    const element = document.createElement('div');
    document.body.append(element);
    expect(isOwnDropZone(element)).toBe(false);
    expect(isOwnDropZone(null)).toBe(false);
    element.remove();
  });
});
