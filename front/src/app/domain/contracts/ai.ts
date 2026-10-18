/** Rewrite request (`refractor` in the backend). */
export interface RewriteRequest {
  readonly text: string;
  readonly instruction: string;
}

/** Rewrite result. */
export interface RewriteResult {
  readonly text: string;
}

/** Preset rewrite instructions of the AI-assist text areas. */
export const REWRITE_PRESETS: readonly {
  readonly key: string;
  readonly label: string;
  readonly instruction: string;
}[] = [
  { key: 'brief', label: 'Brief', instruction: 'Make this text brief and summarize it:' },
  { key: 'rewrite', label: 'Rewrite', instruction: 'Rewrite and improve this text:' },
  { key: 'expand', label: 'Expand', instruction: 'Give more details in this text:' },
];
