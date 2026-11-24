import { describe, expect, it } from 'vitest';
import {
  extractReferences,
  fileMarkdown,
  mentionMarkdown,
  projectMarkdown,
  tagMarkdown,
} from './note-references';

describe('reference markdown', () => {
  it('builds app links', () => {
    expect(mentionMarkdown('42', 'Ada [L]')).toBe('[@Ada L](/people/42)');
    expect(tagMarkdown('to do')).toBe('[#to do](/library?tags=to%20do&range=all)');
    expect(projectMarkdown('Plan (v2)')).toBe('[+Plan (v2)](/projects/Plan%20%28v2%29)');
    expect(fileMarkdown('/shared/2026-11-24/notes/a b.md', 'a b', true)).toBe(
      '![a b](/f/2026-11-24/notes/a%20b.md)',
    );
  });
});

describe('extractReferences', () => {
  it('collects people, tags, projects and files outside code', () => {
    const doc = [
      mentionMarkdown('42', 'Ada'),
      tagMarkdown('to do'),
      projectMarkdown('Plan (v2)'),
      fileMarkdown('/shared/2026-11-24/notes/a b.md', 'a') ?? '',
      '[ext](https://example.com/people/1)',
      '```',
      '[@Bob](/people/7)',
      '```',
    ].join('\n');
    expect(extractReferences(doc)).toEqual({
      contacts: ['42'],
      tags: ['to do'],
      projects: ['Plan (v2)'],
      files: ['/shared/2026-11-24/notes/a b.md'],
    });
  });
});
