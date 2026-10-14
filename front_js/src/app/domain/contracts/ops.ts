/** Lifecycle of a long-running BFF operation. */
export type OperationStatus = 'running' | 'succeeded' | 'failed';

/** Long-running BFF operation (AI pipelines, model pulls, imports). */
export interface OperationInfo {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly status: OperationStatus;
  readonly done: number;
  readonly total: number;
  readonly message: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}
