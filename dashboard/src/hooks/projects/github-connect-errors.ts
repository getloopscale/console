/**
 * The message for each `github_error` code the connect flow can return to the page.
 *
 * The codes come from the control plane's GitHub callback: the engine's claim errors, plus the
 * ones the callback adds itself (NO_INSTALLATION, AUTHORIZATION_DENIED, SERVICE_UNAVAILABLE).
 * A code this table does not know gets the generic message, so the page never prints a raw value
 * from its own URL.
 */
const GENERIC_MESSAGE = 'Something went wrong while connecting GitHub. Try again.';

const MESSAGES: Readonly<Record<string, string>> = {
  GITHUB_CODE_REJECTED:
    'The GitHub authorization expired before it could be used. Start again.',
  INSUFFICIENT_ROLE:
    'Only an admin or the owner of this team can connect GitHub. Ask one of them to do it.',
  UNAUTHORIZED: 'Your session ended during the GitHub authorization. Sign in and try again.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  GITHUB_UNAVAILABLE:
    'GitHub could not be reached, so nothing was connected. Try again in a moment.',
  GITHUB_OAUTH_NOT_CONFIGURED:
    "GitHub authorization is not set up on this LoopScale installation. Ask its administrator to configure the GitHub App's client id and secret.",
  NO_INSTALLATION:
    'GitHub reports no installation of the LoopScale App that your account can access. If you asked an organization owner to approve it, try again once it is approved.',
  AUTHORIZATION_DENIED:
    'The GitHub authorization was cancelled. LoopScale needs it to confirm which installations you can access.',
  SERVICE_UNAVAILABLE:
    'LoopScale could not complete the GitHub authorization. Try again in a moment.',
  INVALID_REQUEST: GENERIC_MESSAGE,
  INTERNAL_ERROR: GENERIC_MESSAGE,
};

/** Returns null when there is no error to show. */
export function githubErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : GENERIC_MESSAGE;
}

/** Shown when the engine answers 403 for an installation: GitHub has not confirmed it for this team. */
export const INSTALLATION_NEEDS_AUTHORIZATION =
  'This GitHub installation needs authorization. Authorize LoopScale on GitHub to confirm your access to it.';
