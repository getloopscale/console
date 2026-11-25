/**
 * Body of the 202 that `POST /api/v1/projects/{name}/rollback` answers with.
 * The rollback is accepted, not done: the API finishes it in the background
 * and `GET /projects/{name}/status` shows how it ended.
 *
 * @see getloopscale/loopzero api/internal/release/rollbackhttp/rollback.go
 */
export interface RollbackResponse {
  status: 'in_progress';
  /** The release that was active when the rollback started. */
  rolled_back_release: string;
  /** The release the rollback is activating. */
  reactivated_release: string;
  environment: string;
  url: string;
}
