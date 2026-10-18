import {
  type DaemonHealth,
  JOB_SERVICES,
  type JobService,
  type JobServiceStatus,
  type JobsOverview,
  type JobTask,
} from '@domain/contracts';
import type { ApiClient } from '../api/api-client';
import { backendUrl } from '../api/api-client';

const DAEMON_HEALTH: ReadonlySet<string> = new Set(['RUNNING', 'DEAD']);

/**
 * Keep the most recent run of each file.
 *
 * @param tasks - Task history.
 * @returns Latest run per file.
 */
export function latestRuns(tasks: readonly JobTask[]): JobTask[] {
  const latest = new Map<string, JobTask>();
  for (const task of tasks) {
    const current = latest.get(task.file);
    if (current === undefined || task.added > current.added) {
      latest.set(task.file, task);
    }
  }
  return [...latest.values()];
}

/**
 * Daemon health (the preview health endpoint is hard-coded upstream).
 *
 * @param api - API client.
 * @param service - Job service.
 * @returns Health.
 */
async function healthOf(api: ApiClient, service: JobService): Promise<DaemonHealth> {
  try {
    const value = await api.get<string>(backendUrl(`/${service}/health`), { silent: true });
    return DAEMON_HEALTH.has(value) ? (value as DaemonHealth) : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Status of one job service.
 *
 * @param api - API client.
 * @param service - Job service.
 * @returns Health, running file and queue counts.
 */
async function statusOf(api: ApiClient, service: JobService): Promise<JobServiceStatus> {
  const [health, running, tasks] = await Promise.all([
    healthOf(api, service),
    api.get<string | null>(backendUrl(`/${service}/running`), { silent: true }),
    api.get<JobTask[]>(backendUrl(`/${service}/tasks`), { silent: true }),
  ]);
  const latest = latestRuns(tasks);
  return {
    service,
    health,
    running,
    pending: latest.filter((task) => task.state === 'PENDING' || task.state === 'IN_PROGRESS')
      .length,
    failed: latest.filter((task) => task.state === 'FAILED').length,
  };
}

/**
 * Health and queue sizes of every job service.
 *
 * @param api - API client.
 * @returns The overview.
 */
export async function loadJobsOverview(api: ApiClient): Promise<JobsOverview> {
  const services = await Promise.all(JOB_SERVICES.map((service) => statusOf(api, service)));
  return { services, activeCount: services.reduce((sum, status) => sum + status.pending, 0) };
}
