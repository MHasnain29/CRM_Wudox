/**

 * Derive live filled-position count from job roster (primary assignees).

 * Stored `filledPositions` is unused by placement flows.

 */

import type { Job } from './jobTypes';



export function countFilledPositions(job: Pick<Job, 'assignments'> | null | undefined): number {

  if (!job?.assignments?.length) return 0;

  return job.assignments.filter((a) => !a.isBackup).length;

}


