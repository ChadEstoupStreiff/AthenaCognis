/** Installed version compared with GitHub (`GET /update/status`). */
export type UpdateState = 'up_to_date' | 'behind' | 'ahead' | 'diverged' | 'unknown';

/** Result of the backend update check. */
export interface UpdateStatus {
  readonly state: UpdateState;
  /** Commits on GitHub the installed version lacks. */
  readonly behind_by: number;
  readonly local_commit: string;
  /** Why the check failed (`unknown` state), empty otherwise. */
  readonly reason: string;
  /** Unix time of the check, seconds. */
  readonly checked_at: number;
}
