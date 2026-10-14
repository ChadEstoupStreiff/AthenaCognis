import type { ContactSummary, Project, Tag } from '@domain/contracts';
import { MAIN_NAV, SETTINGS_NAV } from './nav-items';

/** Palette sections, in display order. */
export const PALETTE_SECTIONS = [
  'Actions',
  'Pages',
  'Files',
  'Projects',
  'Tags',
  'People',
] as const;

/** One palette section. */
export type PaletteSection = (typeof PALETTE_SECTIONS)[number];

/** What a palette entry does. */
export type PaletteTarget =
  | {
      readonly kind: 'route';
      readonly commands: readonly string[];
      readonly query?: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'action'; readonly action: PaletteAction };

/** Built-in actions. */
export type PaletteAction = 'new-note' | 'upload' | 'voice' | 'theme';

/** One palette entry. */
export interface PaletteItem {
  readonly id: string;
  readonly section: PaletteSection;
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
  readonly target: PaletteTarget;
}

/** Prefixes restricting the search to one section. */
export const PALETTE_PREFIXES: Readonly<Record<string, PaletteSection>> = {
  '>': 'Actions',
  '/': 'Pages',
  '#': 'Tags',
  '@': 'People',
};

/** Route-based creation entries. */
const CREATE_ITEMS: readonly PaletteItem[] = [
  {
    id: 'a:time',
    section: 'Actions',
    label: 'Log time',
    hint: '',
    icon: 'pi pi-clock',
    target: { kind: 'route', commands: ['/time'], query: { log: '1' } },
  },
  {
    id: 'a:task',
    section: 'Actions',
    label: 'New task',
    hint: '',
    icon: 'pi pi-check-square',
    target: { kind: 'route', commands: ['/work'], query: { newTask: '1' } },
  },
  {
    id: 'a:contact',
    section: 'Actions',
    label: 'New contact',
    hint: '',
    icon: 'pi pi-user-plus',
    target: { kind: 'route', commands: ['/people'], query: { new: '1' } },
  },
];

/** Fixed actions. */
export const ACTION_ITEMS: readonly PaletteItem[] = [
  {
    id: 'a:note',
    section: 'Actions',
    label: 'New note',
    hint: 'n',
    icon: 'pi pi-pen-to-square',
    target: { kind: 'action', action: 'new-note' },
  },
  {
    id: 'a:upload',
    section: 'Actions',
    label: 'Upload files',
    hint: 'u',
    icon: 'pi pi-cloud-upload',
    target: { kind: 'action', action: 'upload' },
  },
  {
    id: 'a:voice',
    section: 'Actions',
    label: 'Record a voice memo',
    hint: 'v',
    icon: 'pi pi-microphone',
    target: { kind: 'action', action: 'voice' },
  },
  {
    id: 'a:theme',
    section: 'Actions',
    label: 'Switch theme',
    hint: '',
    icon: 'pi pi-moon',
    target: { kind: 'action', action: 'theme' },
  },
  ...CREATE_ITEMS,
];

/** Navigation entries. */
export const PAGE_ITEMS: readonly PaletteItem[] = [...MAIN_NAV, SETTINGS_NAV].map((item) => ({
  id: `p:${item.route}`,
  section: 'Pages' as const,
  label: item.label,
  hint: `g ${item.shortcut}`,
  icon: item.icon,
  target: { kind: 'route' as const, commands: [item.route] },
}));

/**
 * Palette entries of the catalog (projects, tags, people).
 *
 * @param projects - Projects.
 * @param tags - Tags.
 * @param contacts - Contacts.
 * @returns Entries.
 */
export function catalogItems(
  projects: readonly Project[],
  tags: readonly Tag[],
  contacts: readonly ContactSummary[],
): PaletteItem[] {
  return [
    ...projects.map((project) => ({
      id: `pr:${project.name}`,
      section: 'Projects' as const,
      label: project.name,
      hint: project.description,
      icon: 'pi pi-briefcase',
      target: { kind: 'route' as const, commands: ['/projects', project.name] },
    })),
    ...tags.map((tag) => ({
      id: `t:${tag.name}`,
      section: 'Tags' as const,
      label: tag.name,
      hint: 'Files with this tag',
      icon: 'pi pi-tag',
      target: {
        kind: 'route' as const,
        commands: ['/library'],
        query: { tags: tag.name, range: 'all' },
      },
    })),
    ...contacts.map((contact) => ({
      id: `c:${contact.id}`,
      section: 'People' as const,
      label: contact.name,
      hint: [contact.role, contact.company]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
      icon: 'pi pi-user',
      target: { kind: 'route' as const, commands: ['/people', contact.id] },
    })),
  ];
}
