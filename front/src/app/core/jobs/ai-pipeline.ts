import type { AiOperation, AiPipelineRequest } from '@domain/contracts';
import {
  encodeFileSegment,
  fileKindOf,
  fileNameOf,
  supportsOcr,
  supportsTranscription,
} from '@domain/files';
import { type ApiClient, backendUrl } from '../api/api-client';

/** Summaries last: the backend runs them once the file's OCR or transcription is done. */
const OPERATION_ORDER: readonly AiOperation[] = ['preview', 'ocr', 'transcription', 'summary'];

/** Backend endpoint queuing each operation. */
const ASK_PATHS: Readonly<Record<AiOperation, string>> = {
  ocr: '/ocr/ask',
  transcription: '/transcription/ask',
  summary: '/summarize/ask',
  preview: '/preview/generate',
};

/** Progress callbacks of a running pipeline. */
export interface PipelineReporter {
  setTotal(total: number): void;
  step(message: string): void;
  message(message: string): void;
}

/**
 * Queue one operation on a file (a duplicate request answers 409 upstream: ignored).
 *
 * @param api - API client.
 * @param operation - Operation.
 * @param path - File.
 */
async function ask(api: ApiClient, operation: AiOperation, path: string): Promise<void> {
  try {
    await api.post(backendUrl(`${ASK_PATHS[operation]}/${encodeFileSegment(path)}`), undefined, {
      silent: true,
    });
  } catch {
    // Already queued, or not supported by the backend for this file.
  }
}

/**
 * Whether the file type supports an operation.
 *
 * @param operation - Operation.
 * @param path - File.
 * @returns `true` when supported.
 */
function supports(operation: AiOperation, path: string): boolean {
  const kind = fileKindOf(path);
  if (operation === 'ocr') {
    return supportsOcr(kind);
  }
  return operation === 'transcription' ? supportsTranscription(kind) : true;
}

/**
 * Queue AI operations: per file, previews, OCR and transcriptions before the summary (the backend
 * holds a summary until the text it needs exists, so nothing waits in the browser).
 *
 * @param api - API client.
 * @param request - Paths and operations.
 * @param reporter - Progress reporter.
 * @returns Final message.
 */
export async function runAiPipeline(
  api: ApiClient,
  request: AiPipelineRequest,
  reporter: PipelineReporter,
): Promise<string> {
  const operations = OPERATION_ORDER.filter((operation) => request.operations.includes(operation));
  reporter.setTotal(request.paths.length * operations.length);
  for (const path of request.paths) {
    for (const operation of operations) {
      if (supports(operation, path)) {
        await ask(api, operation, path);
      }
      reporter.step(`${operation}: ${fileNameOf(path)}`);
    }
  }
  return 'All requests queued.';
}
