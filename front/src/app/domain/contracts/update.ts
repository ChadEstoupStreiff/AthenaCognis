/** Installed version compared with GitHub (`GET /update/status`). */
export type UpdateState = 'up_to_date' | 'behind' | 'ahead' | 'diverged' | 'unknown';

/** Result of the backend update check. */
export interface UpdateStatus {
  readonly state: UpdateState;
  /** Commits on GitHub the installed version lacks. */
  readonly behind_by: number;
  /** Installed commit SHA, empty when the repository is unreadable. */
  readonly local_commit: string;
  /** Installed branch, empty when the repository is unreadable. */
  readonly local_branch: string;
  /** Why the check failed (`unknown` state), empty otherwise. */
  readonly reason: string;
  /** Unix time of the check, seconds. */
  readonly checked_at: number;
}
