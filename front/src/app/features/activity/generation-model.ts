import type { GenerationRun } from '@domain/contracts';

/**
 * Tell whether a generation is queued or running.
 *
 * @param run - Latest run, null when never run.
 * @returns True while pending or in progress.
 */
export function isGenerating(run: GenerationRun | null): boolean {
  return run?.state === 'PENDING' || run?.state === 'IN_PROGRESS';
}

/**
 * Note body without its generated title line.
 *
 * @param content - Note markdown.
 * @returns Markdown after the first "# " line.
 */
export function noteBody(content: string): string {
  return content.replace(/^# .*\n+/, '');
}
