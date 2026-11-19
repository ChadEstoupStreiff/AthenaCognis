/**
 * State of a data source: active (added, on), disabled (added, off), available (set up, not
 * added), inactive (not set up), incoming (planned).
 */
export type DataSourceState = 'active' | 'disabled' | 'available' | 'inactive' | 'incoming';

/** Where a data source lives: an outside service or an AthenaCognis feature. */
export type DataSourceOrigin = 'external' | 'athenacognis';

/** One choice of a multiselect config field. */
export interface DataSourceOption {
  readonly value: string;
  readonly label: string;
}

/** One setting of a data source, declared by the backend and rendered generically. */
export interface DataSourceField {
  /** Setting key (`activity_<source>_<name>`). */
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly kind: 'multiselect' | 'toggle' | 'text' | 'lines' | 'folders';
  /** Value when the setting is unset. */
  readonly default: boolean | string | readonly string[];
  // Mutable type: PrimeNG multiselect takes `any[]`.
  readonly options: DataSourceOption[];
  /** Multiselect text when nothing is picked. */
  readonly placeholder: string;
  /** Value shown masked once set (secret links). */
  readonly secret: boolean;
}

/** Subfolder listed by a folder picker (`GET /activity/sources/{key}/folders`). */
export interface FolderEntry {
  readonly name: string;
  /** Path relative to the source root. */
  readonly path: string;
  readonly has_children: boolean;
}

/** Progress of a long feed scan (`GET /activity/sources/{key}/progress`). */
export interface ScanProgress {
  readonly running: boolean;
  /** Steps (folders) done. */
  readonly done: number;
  readonly total: number;
  /** Files read so far. */
  readonly files: number;
}

/** One data source (`GET /activity/sources`). */
export interface DataSourceInfo {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly origin: DataSourceOrigin;
  readonly state: DataSourceState;
  /** Short status ("2 accounts", "Incoming"). */
  readonly detail: string;
  /** In-app route to set the source up, null when none. */
  readonly setup_link: string | null;
  /** User instruction for the AI summarizing this source. */
  readonly instruction: string;
  /** Settings of the source. */
  readonly config: readonly DataSourceField[];
}

/** One normalized activity (`GET /activity/sources/{key}/feed`). */
export interface ActivityItem {
  readonly id: string;
  readonly source: string;
  /** Source-specific kind ("received", "sent", …). */
  readonly kind: string;
  /** ISO datetime, naive UTC. */
  readonly occurred_at: string;
  readonly title: string;
  readonly summary: string;
  readonly actors: readonly string[];
  /** In-app URL of the item, null when none. */
  readonly link: string | null;
  readonly details: Readonly<Record<string, string>>;
  /** One-line text form for AI day summaries. */
  readonly ai_context: string;
}
