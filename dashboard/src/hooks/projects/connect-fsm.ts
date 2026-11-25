import type { ProjectConnection } from '@/lib/api/types';
import type { GitHubInstallation } from './github-connect';

/**
 * Which step of the connect page to show.
 *
 *   connected        A repository is linked: show it and offer to disconnect.
 *   authorize        GitHub has confirmed no installation for this team yet: offer the one button
 *                    that starts the authorization (and the App install, when it is missing).
 *   pick_account     Several installations are confirmed and none is chosen: ask which account.
 *   pick_repository  One installation is in use: list its repositories.
 *
 * The installation always comes from the engine's list of installations GitHub confirmed for the
 * signed-in user's team. Nothing in the page URL can name one.
 */
export type ConnectStep =
  | { step: 'connected' }
  | { step: 'authorize' }
  | { step: 'pick_account' }
  | { step: 'pick_repository'; installationId: number };

export function deriveConnectStep(
  connection: ProjectConnection | null,
  installations: readonly GitHubInstallation[],
  selectedInstallationId: number | undefined,
): ConnectStep {
  if (connection?.connected) return { step: 'connected' };
  if (installations.length === 0) return { step: 'authorize' };
  if (installations.length === 1) {
    return { step: 'pick_repository', installationId: installations[0]!.id };
  }
  // A selection that is not in the list is ignored: the list is the only source of ids.
  const chosen = installations.find((i) => i.id === selectedInstallationId);
  return chosen ? { step: 'pick_repository', installationId: chosen.id } : { step: 'pick_account' };
}
