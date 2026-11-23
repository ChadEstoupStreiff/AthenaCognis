import { badgeText, MAIL_BADGE_MAX } from './mail-badge';

describe('badgeText', () => {
  it('hides the badge when nothing is unread', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
  });

  it('shows the count up to the maximum', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(MAIL_BADGE_MAX)).toBe('99');
  });

  it('caps larger counts', () => {
    expect(badgeText(MAIL_BADGE_MAX + 1)).toBe('99+');
  });
});
