import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { JobTask } from '@domain/contracts';
import { ApiClient } from '../api/api-client';
import { Previews } from '../files/previews';
import { type PipelineReporter, runAiPipeline } from './ai-pipeline';

const IMAGE = '/shared/2025-01-01/uploads/scan.png';
const ENCODED = encodeURIComponent(IMAGE);

/**
 * Wait for pending promise callbacks (each awaited request is issued after the previous resolves).
 *
 * @returns Resolves on the next macrotask.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * Preview run of the test image.
 *
 * @param state - Run state.
 * @param result - Run result.
 * @returns The run.
 */
function run(state: JobTask['state'], result: string | null = null): JobTask {
  return { file: IMAGE, state, added: '2025-01-01 10:00:00', completed: null, result };
}

describe('background jobs', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  /**
   * Answer the next request.
   *
   * @param method - Expected method.
   * @param match - URL fragment.
   * @param body - Response body.
   */
  async function answer(method: string, match: string, body: object | null): Promise<void> {
    await settle();
    const request = http.expectOne(
      (candidate) => candidate.method === method && candidate.urlWithParams.includes(match),
    );
    request.flush(body);
  }

  it('queues OCR before the summary and never waits in the browser', async () => {
    const steps: string[] = [];
    const reporter: PipelineReporter = {
      setTotal: (total) => steps.push(`total ${String(total)}`),
      step: (message) => steps.push(message),
      message: (message) => steps.push(message),
    };
    const done = runAiPipeline(
      TestBed.inject(ApiClient),
      { paths: [IMAGE], operations: ['summary', 'transcription', 'ocr'] },
      reporter,
    );
    await answer('POST', `/api/ocr/ask/${ENCODED}`, {});
    await answer('POST', `/api/summarize/ask/${ENCODED}`, {});
    expect(await done).toBe('All requests queued.');
    expect(steps).toEqual([
      'total 3',
      'ocr: scan.png',
      'transcription: scan.png',
      'summary: scan.png',
    ]);
  });

  it('asks for a preview never generated', async () => {
    const queued = TestBed.inject(Previews).queue(IMAGE);
    await answer('GET', `/api/preview/tasks/${ENCODED}`, []);
    await answer('POST', `/api/preview/generate/${ENCODED}`, {});
    expect(await queued).toBe(true);
  });

  it('waits for a preview already queued without asking again', async () => {
    const queued = TestBed.inject(Previews).queue(IMAGE);
    await answer('GET', `/api/preview/tasks/${ENCODED}`, [run('IN_PROGRESS')]);
    expect(await queued).toBe(true);
  });

  it('does not re-queue a file the backend cannot preview', async () => {
    const queued = TestBed.inject(Previews).queue(IMAGE);
    await answer('GET', `/api/preview/tasks/${ENCODED}`, [run('COMPLETED', 'unsupported')]);
    expect(await queued).toBe(false);
  });

  it('does not retry a failed preview automatically', async () => {
    const queued = TestBed.inject(Previews).queue(IMAGE);
    await answer('GET', `/api/preview/tasks/${ENCODED}`, [run('FAILED', 'no such file')]);
    expect(await queued).toBe(false);
  });
});
