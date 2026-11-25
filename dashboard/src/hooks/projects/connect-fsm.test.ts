// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveConnectStep } from './connect-fsm';

const ACME = { id: 7, account_login: 'acme', account_type: 'Organization' };
const DEV = { id: 9, account_login: 'dev', account_type: 'User' };

describe('deriveConnectStep', () => {
  it('shows the linked repository when the project is connected', () => {
    expect(deriveConnectStep({ connected: true, repo: 'acme/api' }, [ACME], undefined)).toEqual({
      step: 'connected',
    });
  });

  it('asks for the authorization when no installation is confirmed', () => {
    expect(deriveConnectStep({ connected: false }, [], undefined)).toEqual({ step: 'authorize' });
    expect(deriveConnectStep(null, [], undefined)).toEqual({ step: 'authorize' });
  });

  it('does not take an installation from the connection or from a selection outside the list', () => {
    expect(deriveConnectStep({ connected: false, installation_id: 42 }, [], 42)).toEqual({
      step: 'authorize',
    });
    expect(deriveConnectStep({ connected: false }, [ACME, DEV], 42)).toEqual({
      step: 'pick_account',
    });
  });

  it('goes straight to the repositories of the only installation', () => {
    expect(deriveConnectStep({ connected: false }, [ACME], undefined)).toEqual({
      step: 'pick_repository',
      installationId: 7,
    });
  });

  it('asks which account when there are several, then uses the chosen one', () => {
    expect(deriveConnectStep({ connected: false }, [ACME, DEV], undefined)).toEqual({
      step: 'pick_account',
    });
    expect(deriveConnectStep({ connected: false }, [ACME, DEV], 9)).toEqual({
      step: 'pick_repository',
      installationId: 9,
    });
  });
});
