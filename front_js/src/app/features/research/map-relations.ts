import { inject, Injectable, signal } from '@angular/core';
import type { Paper } from '@domain/sota';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SotaStorage } from '../../core/sota/sota-storage';

/** AI relation search between library papers (background job). */
@Injectable({ providedIn: 'root' })
export class MapRelations {
  private readonly details = inject(FileDetailsApi);
  private readonly storage = inject(SotaStorage);
  private readonly jobs = inject(JobsStore);

  /** Bumped when relations change (reloads the map). */
  readonly version = signal(0);

  /**
   * Ask the AI for relations between sources and the other papers, keep strong ones.
   *
   * @param sources - Papers to analyze.
   * @param papers - Candidate related papers.
   * @param minForce - Minimum strength kept (0–3).
   */
  find(sources: readonly Paper[], papers: readonly Paper[], minForce: number): void {
    this.jobs.track(
      'sota-ai-links',
      `AI relations of ${String(sources.length)} paper(s)`,
      async (progress) => {
        const linked = new Set(
          (await this.storage.aiLinks(papers.map((paper) => paper.path))).map((link) =>
            pairKey(link.fileA, link.fileB),
          ),
        );
        progress.setTotal(sources.length);
        let added = 0;
        for (const source of sources) {
          const targets = papers
            .filter(
              (paper) =>
                paper.path !== source.path && !linked.has(pairKey(source.path, paper.path)),
            )
            .map((paper) => paper.path);
          if (targets.length > 0) {
            for (const link of (await this.details.suggestLinks(source.path, targets)).filter(
              (suggestion) => suggestion.force >= minForce,
            )) {
              await this.details.addLink(link.fileA, link.fileB, link.force, link.comment);
              linked.add(pairKey(link.fileA, link.fileB));
              added += 1;
            }
          }
          progress.step(`${String(added)} added`);
          this.version.update((value) => value + 1);
        }
        return `${String(added)} AI relation(s) added.`;
      },
    );
  }
}

/**
 * Order-independent key of a pair.
 *
 * @param first - File.
 * @param second - File.
 * @returns Key.
 */
function pairKey(first: string, second: string): string {
  return [first, second].sort().join('\n');
}
