import { inject, Injectable } from '@angular/core';
import { filter, lastValueFrom } from 'rxjs';
import {
  type BibEntry,
  buildZip,
  displayTitle,
  type ImportPlanItem,
  mergeInfo,
  type Paper,
  paperFileName,
  paperUploadDate,
  toBibtex,
  toRis,
} from '@domain/sota';
import { formatLocalDate } from '@domain/time';
import { FilesApi, triggerDownload } from '../../core/files/files.api';
import { SotaStorage } from '../../core/sota/sota-storage';

/** Export format. */
export type ExportFormat = 'ris' | 'bibtex';

const EXPORTS: Readonly<
  Record<
    ExportFormat,
    {
      readonly format: (entries: readonly BibEntry[]) => string;
      readonly file: string;
      readonly mime: string;
    }
  >
> = {
  ris: { format: toRis, file: 'references.ris', mime: 'application/x-research-info-systems' },
  bibtex: { format: toBibtex, file: 'references.bib', mime: 'application/x-bibtex' },
};
const UPLOAD_FOLDER = 'uploads';

/** Outcome of an import. */
export interface ImportOutcome {
  readonly imported: number;
  readonly failed: readonly string[];
}

/** Export and import of the library (Zotero-compatible RIS/BibTeX, optional PDFs). */
@Injectable({ providedIn: 'root' })
export class LibraryTransfer {
  private readonly files = inject(FilesApi);
  private readonly storage = inject(SotaStorage);

  /**
   * Build and download an export.
   *
   * @param papers - Papers.
   * @param format - Format.
   * @param withPdfs - Zip the PDFs under `files/` (linked from entries).
   */
  async export(papers: readonly Paper[], format: ExportFormat, withPdfs: boolean): Promise<void> {
    const spec = EXPORTS[format];
    const pdfs = new Map<string, Uint8Array>();
    const entries: BibEntry[] = [];
    for (const paper of papers) {
      const info = { ...paper.info, title: displayTitle(paper) };
      if (!withPdfs) {
        entries.push({ info, attachment: '' });
        continue;
      }
      const name = pdfs.has(paperFileName(paper))
        ? `${paperUploadDate(paper)}_${paperFileName(paper)}`
        : paperFileName(paper);
      pdfs.set(name, await this.bytes(paper.path));
      entries.push({ info, attachment: name });
    }
    const text = spec.format(entries);
    const blob = withPdfs
      ? new Blob([buildZip(spec.file, text, pdfs) as BlobPart], { type: 'application/zip' })
      : new Blob([text], { type: spec.mime });
    this.save(blob, withPdfs ? spec.file.replace(/\.\w+$/, '.zip') : spec.file);
  }

  /**
   * Apply an import plan.
   *
   * @param plan - Plan.
   * @param pdfs - Provided PDFs.
   * @param tag - SOTA tag given to added PDFs.
   * @param markValidated - Flag imported references as validated.
   * @returns Outcome.
   */
  async import(
    plan: readonly ImportPlanItem[],
    pdfs: ReadonlyMap<string, Uint8Array>,
    tag: string,
    markValidated: boolean,
  ): Promise<ImportOutcome> {
    const failed: string[] = [];
    let imported = 0;
    for (const item of plan.filter((candidate) => candidate.action !== 'skip')) {
      try {
        const paper =
          item.existing === null
            ? await this.add(item, pdfs, tag)
            : { path: item.existing.path, info: mergeInfo(item.existing.info, item.entry.info) };
        await this.storage.saveInfo({
          path: paper.path,
          info: { ...paper.info, validated: markValidated || paper.info.validated },
        });
        imported += 1;
      } catch {
        failed.push(item.entry.info.title);
      }
    }
    this.files.uploadsFinished();
    return { imported, failed };
  }

  /**
   * Upload a new PDF tagged with the SOTA tag.
   *
   * @param item - Plan item.
   * @param pdfs - Provided PDFs.
   * @param tag - SOTA tag.
   * @returns New paper.
   * @throws Error when the file already exists or the upload fails.
   */
  private async add(
    item: ImportPlanItem,
    pdfs: ReadonlyMap<string, Uint8Array>,
    tag: string,
  ): Promise<Paper> {
    const date = formatLocalDate(new Date());
    const [planned] = await this.files.uploadPlan([
      { name: item.pdfName, date, folder: UPLOAD_FOLDER },
    ]);
    if (planned === undefined || planned.exists) {
      throw new Error('A file with this name already exists.');
    }
    const blob = new Blob([(pdfs.get(item.pdfName) ?? new Uint8Array()) as BlobPart], {
      type: 'application/pdf',
    });
    const done = await lastValueFrom(
      this.files
        .upload(
          blob,
          { folder: UPLOAD_FOLDER, date, name: planned.storedName },
          { projects: [], tags: [tag], contacts: [] },
        )
        .pipe(filter((event) => event.kind === 'done')),
    );
    return { path: done.result.path, info: item.entry.info };
  }

  /**
   * Bytes of a library file.
   *
   * @param path - File.
   * @returns Content.
   * @throws Error when it cannot be read.
   */
  private async bytes(path: string): Promise<Uint8Array> {
    const response = await fetch(this.files.contentUrl(path));
    if (!response.ok) {
      throw new Error(`Cannot read ${path} (${String(response.status)}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Download a blob.
   *
   * @param blob - Content.
   * @param name - File name.
   */
  private save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, name);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    });
  }
}
