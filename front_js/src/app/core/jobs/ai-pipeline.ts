import type { AiOperation, AiPipelineRequest, JobService, JobTask } from '@domain/contracts';
import {
  encodeFileSegment,
  fileKindOf,
  fileNameOf,
  supportsOcr,
  supportsTranscription,
} from '@domain/files';
import { type ApiClient, backendUrl } from '../api/api-client';
import { latestRuns } from './jobs-overview';

const POLL_INTERVAL_MS = 5_000;
const PREREQUISITE_TIMEOUT_MS = 1_800_000;

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
 * Wait for a delay.
 *
 * @param ms - Milliseconds.
 * @returns Resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Queue one operation on a file (a duplicate request answers 500 upstream: ignored).
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
 * Wait until the text a summary needs (OCR for images, transcription for media) exists.
 *
 * @param api - API client.
 * @param path - File.
 * @param reporter - Progress reporter.
 * @returns `true` when the summary can be requested.
 */
async function waitForSummaryInput(
  api: ApiClient,
  path: string,
  reporter: PipelineReporter,
): Promise<boolean> {
  const kind = fileKindOf(path);
  const service: JobService | null = supportsOcr(kind)
    ? 'ocr'
    : supportsTranscription(kind)
      ? 'transcription'
      : null;
  const deadline = Date.now() + PREREQUISITE_TIMEOUT_MS;
  while (service !== null && Date.now() < deadline) {
    const tasks = await api.get<JobTask[]>(
      backendUrl(`/${service}/tasks/${encodeFileSegment(path)}`),
      { silent: true },
    );
    const state = latestRuns(tasks)[0]?.state ?? null;
    if (state === 'COMPLETED') {
      return true;
    }
    if (state === 'FAILED' || state === null) {
      return false;
    }
    reporter.message(`Waiting for ${service} of ${fileNameOf(path)}…`);
    await sleep(POLL_INTERVAL_MS);
  }
  return service === null;
}

/**
 * Run AI operations: previews, OCR and transcriptions first, then summaries once their input
 * exists (a summary queued too early stays PENDING forever upstream).
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
  const direct = request.operations.filter((operation) => operation !== 'summary');
  const wantsSummary = request.operations.includes('summary');
  reporter.setTotal(request.paths.length * (direct.length + (wantsSummary ? 1 : 0)));
  for (const path of request.paths) {
    for (const operation of direct.filter((candidate) => supports(candidate, path))) {
      await ask(api, operation, path);
    }
    direct.forEach((operation) => {
      reporter.step(`${operation}: ${fileNameOf(path)}`);
    });
  }
  let skipped = 0;
  for (const path of wantsSummary ? request.paths : []) {
    if (await waitForSummaryInput(api, path, reporter)) {
      await ask(api, 'summary', path);
    } else {
      skipped += 1;
    }
    reporter.step(`summary: ${fileNameOf(path)}`);
  }
  return skipped === 0
    ? 'All requests queued.'
    : `${String(skipped)} summary request(s) skipped (no extracted text).`;
}
