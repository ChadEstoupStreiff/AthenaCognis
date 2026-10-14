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
