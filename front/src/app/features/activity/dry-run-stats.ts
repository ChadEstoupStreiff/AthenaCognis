import type { PromptPartKind, PromptPartStat, PromptStats } from '@domain/contracts';

/** One figure shown on a prompt. */
export interface StatItem {
  readonly label: string;
  readonly value: string;
  /** Prompt fills most of (or overflows) the model context. */
  readonly isWarning: boolean;
}

const PERCENT = 100;
/** Share of the context window above which the prompt is flagged. */
const CONTEXT_WARNING_RATIO = 0.8;
const NUMBER_FORMAT = new Intl.NumberFormat();

/**
 * Figures of a prompt, with its share of the model context when known.
 *
 * @param stats - Prompt size.
 * @param contextTokens - Context window of the model; 0 when unknown.
 * @returns Characters, words, lines, estimated tokens and context share.
 */
export function promptStatItems(stats: PromptStats, contextTokens: number): StatItem[] {
  const items: StatItem[] = [
    { label: 'Characters', value: NUMBER_FORMAT.format(stats.characters), isWarning: false },
    { label: 'Words', value: NUMBER_FORMAT.format(stats.words), isWarning: false },
    { label: 'Lines', value: NUMBER_FORMAT.format(stats.lines), isWarning: false },
    {
      label: 'Tokens',
      value: `~${NUMBER_FORMAT.format(stats.estimated_tokens)}`,
      isWarning: false,
    },
  ];
  if (contextTokens <= 0) {
    return items;
  }
  const ratio = stats.estimated_tokens / contextTokens;
  items.push({
    label: 'Context',
    value: `${(ratio * PERCENT).toFixed(1)}% of ${NUMBER_FORMAT.format(contextTokens)}`,
    isWarning: ratio >= CONTEXT_WARNING_RATIO,
  });
  return items;
}

/** One block of the prompt as a table row. */
export interface PartRow {
  readonly label: string;
  readonly kind: PromptPartKind;
  /** Activities read; null for blocks that are not data sources. */
  readonly activities: number | null;
  readonly error: string;
  readonly characters: string;
  readonly words: string;
  readonly lines: string;
  readonly tokens: string;
  /** Share of the prompt tokens, 0–100. */
  readonly share: number;
}

/**
 * Rows of the per-block table, with each block's share of the prompt.
 *
 * @param parts - Block sizes.
 * @param totalTokens - Estimated tokens of the whole prompt.
 * @returns Rows in prompt order.
 */
export function partRows(parts: readonly PromptPartStat[], totalTokens: number): PartRow[] {
  return parts.map((part) => ({
    label: part.label,
    kind: part.kind,
    activities: part.kind === 'source' ? part.activities : null,
    error: part.error,
    characters: NUMBER_FORMAT.format(part.stats.characters),
    words: NUMBER_FORMAT.format(part.stats.words),
    lines: NUMBER_FORMAT.format(part.stats.lines),
    tokens: `~${NUMBER_FORMAT.format(part.stats.estimated_tokens)}`,
    share: totalTokens > 0 ? (part.stats.estimated_tokens / totalTokens) * PERCENT : 0,
  }));
}
