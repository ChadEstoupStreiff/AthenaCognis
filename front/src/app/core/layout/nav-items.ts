/** One entry of the main navigation rail. */
export interface NavItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  /** Second key of the `g <key>` jump shortcut. */
  readonly shortcut: string;
}

/** Main sections, in rail order. */
export const MAIN_NAV: readonly NavItem[] = [
  { label: 'Home', icon: 'pi pi-home', route: '/home', shortcut: 'h' },
  { label: 'Activity', icon: 'pi pi-bolt', route: '/activity', shortcut: 'y' },
  { label: 'Mail', icon: 'pi pi-envelope', route: '/mail', shortcut: 'm' },
  { label: 'Library', icon: 'pi pi-folder-open', route: '/library', shortcut: 'l' },
  { label: 'Notes', icon: 'pi pi-pen-to-square', route: '/notes', shortcut: 'n' },
  { label: 'Time', icon: 'pi pi-calendar', route: '/time', shortcut: 't' },
  { label: 'Work', icon: 'pi pi-th-large', route: '/work', shortcut: 'w' },
  { label: 'Projects', icon: 'pi pi-briefcase', route: '/projects', shortcut: 'p' },
  { label: 'People', icon: 'pi pi-users', route: '/people', shortcut: 'c' },
  { label: 'Research', icon: 'pi pi-book', route: '/research', shortcut: 'r' },
  { label: 'Assistant', icon: 'pi pi-comments', route: '/assistant', shortcut: 'a' },
];

/** Settings entry (pinned at the bottom of the rail). */
export const SETTINGS_NAV: NavItem = {
  label: 'Settings',
  icon: 'pi pi-cog',
  route: '/settings',
  shortcut: 's',
};

/** Setting holding the routes of {@link MAIN_NAV} in rail order. */
export const NAV_ORDER_KEY = 'nav_order';
/** Setting holding the routes hidden from the rail (pages stay reachable by search and shortcut). */
export const NAV_HIDDEN_KEY = 'nav_hidden';

/**
 * Sort navigation items by a saved route order.
 *
 * Routes missing from the order (new sections) keep their default position after the saved ones.
 *
 * @param items - Items in default order.
 * @param order - Saved routes, first shown first.
 * @returns Items in rail order.
 */
export function orderNav(items: readonly NavItem[], order: readonly string[]): readonly NavItem[] {
  const rank = (item: NavItem): number => {
    const index = order.indexOf(item.route);
    return index === -1 ? order.length + items.indexOf(item) : index;
  };
  return [...items].sort((left, right) => rank(left) - rank(right));
}

/**
 * Items shown in the rail: ordered, hidden ones removed.
 *
 * @param items - Items in default order.
 * @param order - Saved route order.
 * @param hidden - Hidden routes.
 * @returns Visible items in rail order.
 */
export function arrangeNav(
  items: readonly NavItem[],
  order: readonly string[],
  hidden: readonly string[],
): readonly NavItem[] {
  return orderNav(items, order).filter((item) => !hidden.includes(item.route));
}
