/**
 * Body of the 202 that `POST /api/v1/projects/{name}/rollback` answers with.
 * The rollback is accepted, not done: the API finishes it in the background
 * and `GET /projects/{name}/status` shows how it ended.
 *
 * @see getloopscale/loop-runtime api/internal/release/rollbackhttp/rollback.go
 */
export interface RollbackResponse {
  status: 'in_progress';
  /** The id of this rollback in the project's history. Absent from an older API. */
  rollback_id?: string;
  /** The release that was active when the rollback started. */
  rolled_back_release: string;
  /** The release the rollback is activating. */
  reactivated_release: string;
  environment: string;
  url: string;
}

/** How a recorded rollback stands. `interrupted`: the API stopped before it was confirmed. */
export type RollbackRecordStatus = 'in_progress' | 'succeeded' | 'failed' | 'interrupted';

/** A release and the build it was created from. */
export interface RollbackSide {
  release_id: string;
  build_id: string;
}

/**
 * One rollback of a project, as `GET /api/v1/projects/{name}/rollbacks` lists it.
 *
 * @see getloopscale/loop-runtime api/internal/release/rollbackhttp/rollback_history.go
 */
export interface RollbackRecord {
  id: string;
  environment: string;
  status: RollbackRecordStatus;
  /** Why a `failed` or `interrupted` rollback left the environment as it was. */
  failure_reason?: string;
  /** The release the environment ran when the rollback started. */
  from: RollbackSide;
  /** The release the rollback aimed at. */
  to: RollbackSide;
  created_by: string;
  created_at: string;
  /** Null while the rollback is in progress, and for an interrupted one. */
  finished_at: string | null;
}

export interface RollbackListResponse {
  rollbacks: RollbackRecord[];
}
