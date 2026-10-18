/** Background job services of the backend. */
export const JOB_SERVICES = ['ocr', 'transcription', 'summarize', 'preview'] as const;

/** One background job service. */
export type JobService = (typeof JOB_SERVICES)[number];

/** Human labels of job services. */
export const JOB_SERVICE_LABELS: Readonly<Record<JobService, string>> = {
  ocr: 'OCR & caption',
  transcription: 'Transcription',
  summarize: 'Summary',
  preview: 'Preview',
};

/** State of one job run. */
export type JobState = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

/** One job run (`GET /{service}/tasks`). */
export interface JobTask {
  readonly file: string;
  readonly state: JobState;
  readonly added: string;
  readonly completed: string | null;
  readonly result: string | null;
}

/** Daemon health. */
export type DaemonHealth = 'RUNNING' | 'DEAD' | 'UNKNOWN';

/** Summary of one job service. */
export interface JobServiceStatus {
  readonly service: JobService;
  readonly health: DaemonHealth;
  readonly running: string | null;
  readonly pending: number;
  readonly failed: number;
}

/** Summary of every job service. */
export interface JobsOverview {
  readonly services: readonly JobServiceStatus[];
  readonly activeCount: number;
}

/** AI operations that can be queued on files. */
export type AiOperation = 'summary' | 'ocr' | 'transcription' | 'preview';

/** Request to run AI operations on files (OCR/transcription run before summaries). */
export interface AiPipelineRequest {
  readonly paths: readonly string[];
  readonly operations: readonly AiOperation[];
}

/** Raw OCR record (`GET /ocr/get/{file}`). */
export interface OcrRecord {
  readonly file: string;
  readonly date: string;
  readonly ocr: string | null;
  readonly blip: string | null;
}

/** One OCR text box in image pixel (or normalized) coordinates. */
export interface OcrBox {
  readonly text: string;
  readonly score: number | null;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** `true` when coordinates are in [0, 1] (scale by image size). */
  readonly normalized: boolean;
}

/** OCR result normalized for display. */
export interface ParsedOcr {
  readonly text: string;
  readonly boxes: readonly OcrBox[];
}

/** Summary record (`GET /summarize/get/{file}`). */
export interface SummaryRecord {
  readonly file: string;
  readonly date: string;
  readonly summary: string;
  readonly keywords: readonly string[];
}

/** Transcription record (`GET /transcription/get/{file}`). */
export interface TranscriptionRecord {
  readonly file: string;
  readonly date: string;
  readonly transcription: string;
}
