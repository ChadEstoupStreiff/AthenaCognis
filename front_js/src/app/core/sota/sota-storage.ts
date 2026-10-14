import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { BackendLinkTuple } from '@domain/contracts';
import { encodeFileSegment } from '@domain/files';
import {
  type AiLink,
  type CitationRecord,
  citationRecordFromDict,
  infoKey,
  type Paper,
  type PaperInfo,
  paperInfoFromDict,
  paperInfoToDict,
  refsKey,
} from '@domain/sota';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { DataSync } from '../state/data-sync.service';
import { mapWithConcurrency } from '../util/concurrency';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const TAG_KEY = 'sota_tag';
const LOAD_CONCURRENCY = 6;

/** Library storage (stockpile keys and encodings shared with the Streamlit front). */
@Injectable({ providedIn: 'root' })
export class SotaStorage {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Tag marking state-of-the-art papers.
   *
   * @returns Tag, or null when unset.
   */
  async tag(): Promise<string | null> {
    const value = await this.read(TAG_KEY);
    return value === null || value === '' ? null : value;
  }

  /**
   * Change the SOTA tag.
   *
   * @param tag - Tag, or null to unset.
   */
  async setTag(tag: string | null): Promise<void> {
    if (tag === null) {
      await this.api
        .delete(backendUrl(`/stockpile/delete/${TAG_KEY}`), { silent: true })
        .catch(() => undefined);
    } else {
      await this.write(TAG_KEY, tag);
    }
    this.sync.invalidate('sota');
  }

  /**
   * Every paper carrying the tag, with its metadata.
   *
   * @param tag - SOTA tag.
   * @returns Papers.
   */
  async library(tag: string): Promise<Paper[]> {
    const paths = await this.taggedFiles(tag);
    return mapWithConcurrency(paths, LOAD_CONCURRENCY, async (path) => ({
      path,
      info: await this.info(path),
    }));
  }

  /**
   * Stored metadata of a file.
   *
   * @param path - File.
   * @returns Metadata (empty when none or unreadable).
   */
  async info(path: string): Promise<PaperInfo> {
    return paperInfoFromDict(parseJson(await this.read(infoKey({ path }))));
  }

  /**
   * Save metadata (JSON in a stockpile string, like the Streamlit front).
   *
   * @param paper - Paper.
   */
  async saveInfo(paper: Paper): Promise<void> {
    await this.write(infoKey(paper), JSON.stringify(paperInfoToDict(paper.info)));
  }

  /**
   * Citation record of a paper.
   *
   * @param paper - Paper.
   * @returns Record, or null when never analyzed.
   */
  async record(paper: Paper): Promise<CitationRecord | null> {
    const value = parseJson(await this.read(refsKey(paper)));
    return value === null ? null : citationRecordFromDict(value);
  }

  /**
   * Records of several papers.
   *
   * @param papers - Papers.
   * @returns Path → record (analyzed papers only).
   */
  async records(papers: readonly Paper[]): Promise<Map<string, CitationRecord>> {
    const records = await mapWithConcurrency(
      papers,
      LOAD_CONCURRENCY,
      async (paper) => [paper.path, await this.record(paper)] as const,
    );
    return new Map(
      records.filter((entry): entry is readonly [string, CitationRecord] => entry[1] !== null),
    );
  }

  /**
   * Save a citation record.
   *
   * @param paper - Paper.
   * @param record - Record.
   */
  async saveRecord(paper: Paper, record: CitationRecord): Promise<void> {
    await this.write(refsKey(paper), JSON.stringify(record));
  }

  /**
   * AI relations of several files.
   *
   * @param paths - Files.
   * @returns Links (both directions may appear).
   */
  async aiLinks(paths: readonly string[]): Promise<AiLink[]> {
    const lists = await mapWithConcurrency(paths, LOAD_CONCURRENCY, async (path) => {
      const tuples = await this.api
        .get<BackendLinkTuple[]>(backendUrl(`/links/list/${encodeFileSegment(path)}`), {
          silent: true,
        })
        .catch(() => []);
      return tuples.map(([other, force, comment]): AiLink => ({
        fileA: path,
        fileB: other,
        force,
        comment: comment ?? '',
      }));
    });
    return lists.flat();
  }

  /**
   * Files carrying a tag (404 = none).
   *
   * @param tag - Tag.
   * @returns Paths.
   */
  private async taggedFiles(tag: string): Promise<string[]> {
    try {
      return await this.api.get<string[]>(backendUrl(`/tag/${encodeURIComponent(tag)}/files`), {
        silent: true,
      });
    } catch (error) {
      if (hasStatus(error, NOT_FOUND)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Read a stockpile value.
   *
   * @param key - Key.
   * @returns Value, or null when missing (the backend reports a missing key as an empty 500, so any HTTP error counts, like the Streamlit front).
   * @throws Error when the backend is unreachable.
   */
  private async read(key: string): Promise<string | null> {
    try {
      return await this.api.get<string>(backendUrl(`/stockpile/get/${encodeURIComponent(key)}`), {
        silent: true,
      });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status >= BAD_REQUEST) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write a stockpile value.
   *
   * @param key - Key.
   * @param value - Value.
   */
  private async write(key: string, value: string): Promise<void> {
    await this.api.post(backendUrl(`/stockpile/set/${encodeURIComponent(key)}`), undefined, {
      params: { value },
    });
  }
}

/**
 * Parse JSON text.
 *
 * @param text - Text or null.
 * @returns Value, or null when missing/invalid.
 */
function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
