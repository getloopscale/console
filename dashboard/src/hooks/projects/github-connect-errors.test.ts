// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { githubErrorMessage } from './github-connect-errors';

describe('githubErrorMessage', () => {
  it('returns nothing when the page carries no error', () => {
    expect(githubErrorMessage(null)).toBeNull();
    expect(githubErrorMessage('')).toBeNull();
  });

  it.each([
    ['GITHUB_CODE_REJECTED', /authorization expired/i],
    ['INSUFFICIENT_ROLE', /admin or the owner/i],
    ['UNAUTHORIZED', /session ended/i],
    ['RATE_LIMITED', /too many attempts/i],
    ['GITHUB_UNAVAILABLE', /github could not be reached/i],
    ['GITHUB_OAUTH_NOT_CONFIGURED', /not set up on this loopscale installation/i],
    ['NO_INSTALLATION', /no installation of the loopscale app/i],
    ['AUTHORIZATION_DENIED', /authorization was cancelled/i],
    ['SERVICE_UNAVAILABLE', /could not complete the github authorization/i],
    ['INVALID_REQUEST', /something went wrong/i],
    ['INTERNAL_ERROR', /something went wrong/i],
  ])('%s has its own sentence', (code, expected) => {
    expect(githubErrorMessage(code)).toMatch(expected);
  });

  it('gives each specific code a different message', () => {
    const specific = [
      'GITHUB_CODE_REJECTED',
      'INSUFFICIENT_ROLE',
      'UNAUTHORIZED',
      'RATE_LIMITED',
      'GITHUB_UNAVAILABLE',
      'GITHUB_OAUTH_NOT_CONFIGURED',
      'NO_INSTALLATION',
      'AUTHORIZATION_DENIED',
      'SERVICE_UNAVAILABLE',
    ].map((code) => githubErrorMessage(code));
    expect(new Set(specific).size).toBe(specific.length);
  });

  it('never prints a code it does not know', () => {
    expect(githubErrorMessage('<img src=x onerror=alert(1)>')).toBe(
      'Something went wrong while connecting GitHub. Try again.',
    );
    expect(githubErrorMessage('constructor')).toBe(
      'Something went wrong while connecting GitHub. Try again.',
    );
  });
});
