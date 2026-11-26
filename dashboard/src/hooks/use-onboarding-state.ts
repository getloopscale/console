import { useCallback, useState } from 'react';
import { useEngineApi } from '@/hooks/use-api';
import { useDeployments } from '@/hooks/projects/use-deployments';
import { useProjects } from '@/hooks/projects/use-projects';
import { useWhoami } from '@/hooks/settings/use-whoami';

/**
 * useOnboardingState (Sprint 3 T3.1) — first-run UX state machine.
 *
 * Per ADR D2 (2026 FAANG synthesis): persistent dismissable checklist combined
 * com empty-state-as-onboarding + first-deploy celebration. State persists in
 * localStorage (versioned key). Auto-derived steps re-evaluate from API on every
 * render; user-confirmed step (cli_installed) requires explicit markStepDone.
 *
 * EC-04 fix: safeGet/safeSet wrap all localStorage ops — Safari Private mode,
 * QuotaExceeded, and corrupted JSON fall back to in-memory state. App MUST NOT
 * crash if localStorage is unavailable.
 *
 * EC-06 fix: replay() resets DEFAULT_STATE so widget reappears even when user
 * had completed all 5 steps. Auto-derived steps re-derive from API rapidly.
 *
 * EC-14 fix: cli_installed is NOT auto-derived from session existence. User
 * could log in via browser flow without ever installing CLI. Requires explicit
 * markStepDone('cli_installed') from user click ("I installed it" CTA).
 */

export const ONBOARDING_KEY = 'loopscale-onboarding-v1';

interface OnboardingSteps {
  cli_installed: boolean;       // EC-14: user-confirmed only
  logged_in: boolean;           // auto
  project_initialized: boolean; // auto
  deploy_succeeded: boolean;    // auto
  domain_added: boolean;        // auto
}

export interface OnboardingState {
  dismissed: boolean;
  steps: OnboardingSteps;
  completedAt?: string;
}

const DEFAULT_STATE: OnboardingState = {
  dismissed: false,
  steps: {
    cli_installed: false,
    logged_in: false,
    project_initialized: false,
    deploy_succeeded: false,
    domain_added: false,
  },
};

// EC-04: localStorage MAY throw or be corrupted — wrap all ops.
function safeGet(): OnboardingState {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_STATE;
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      dismissed: !!parsed.dismissed,
      steps: { ...DEFAULT_STATE.steps, ...(parsed.steps ?? {}) },
      completedAt: parsed.completedAt,
    };
  } catch {
    // Safari Private, QuotaExceeded, malformed JSON — fall back to default.
    return DEFAULT_STATE;
  }
}

function safeSet(state: OnboardingState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage disabled — in-memory only is acceptable
    // fallback; user can still navigate, just won't survive reload.
  }
}

export function useOnboardingState() {
  const [persistedState, setPersistedState] = useState<OnboardingState>(() => safeGet());

  // B-094 — os tres hooks EXPOEM `error`; este consumidor ignorava os tres.
  //
  // O custo era concreto e visivel ao usuario: `logged_in: !!whoami` vira FALSE
  // quando a leitura de whoami falha, entao o painel dizia a um usuario logado
  // que ele precisa entrar. `project_initialized: projects.length > 0` idem —
  // "voce nao tem projetos" quando a busca falhou, empurrando alguem a criar um
  // projeto que ja existe.
  //
  // E a classe do #274 no lugar mais caro: o painel de onboarding e a primeira
  // coisa que um usuario novo le, e ele estava afirmando o negativo a partir de
  // ausencia de dado.
  const { whoami, error: erroWhoami } = useWhoami();
  const { projects, error: erroProjetos } = useProjects();
  const { data: domainsData } = useEngineApi<{ domains: unknown[] }>('/api/v1/domains');
  const { builds } = useDeployments(projects[0]?.name);

  // Derive auto-tracked steps from API state. User-confirmed step
  // (cli_installed) reads from persisted localStorage only (EC-14).
  //
  // Red Team loop-console#56 closure: a successful deploy is rigorous
  // proof the user installed the CLI — the deploy command is the only
  // path to write to the engine. When `deploy_succeeded` is true,
  // cli_installed auto-flips too, regardless of whether the user
  // ticked the "I installed it" CTA. This closes the case where an
  // experienced user goes "Sign in → CLI install → deploy" without
  // ever visiting the onboarding panel and is then told they still
  // need to do steps 1 + 4.
  const deploySucceeded = builds.some((b) => b.status === 'succeeded');
  const steps: OnboardingSteps = {
    cli_installed: persistedState.steps.cli_installed || deploySucceeded,
    logged_in: !!whoami,
    project_initialized: projects.length > 0,
    deploy_succeeded: deploySucceeded,
    domain_added: (domainsData?.domains?.length ?? 0) > 0,
  };

  const state: OnboardingState = {
    dismissed: persistedState.dismissed,
    steps,
    completedAt: persistedState.completedAt,
  };

  const completed = Object.values(steps).filter(Boolean).length;
  const total = 5;
  const percent = Math.round((completed / total) * 100);

  const dismiss = useCallback(() => {
    const next: OnboardingState = { ...state, dismissed: true };
    setPersistedState(next);
    safeSet(next);
  }, [state]);

  // EC-06: replay resets DEFAULT_STATE (not just dismissed flag). Without
  // this, isVisible permanece false quando user havia completado tudo.
  const replay = useCallback(() => {
    setPersistedState(DEFAULT_STATE);
    safeSet(DEFAULT_STATE);
  }, []);

  // EC-14: cli_installed (user-confirmed) marked via this method only
  const markStepDone = useCallback((step: keyof OnboardingSteps) => {
    setPersistedState((prev) => {
      const next = { ...prev, steps: { ...prev.steps, [step]: true } };
      safeSet(next);
      return next;
    });
  }, []);

  // Quando qualquer fonte falhou, os passos derivados dela sao INDETERMINADOS,
  // nao falsos. O painel some em vez de cobrar algo que talvez ja esteja feito —
  // "nao consegui saber" e um estado diferente de "nao foi feito", e so um deles
  // justifica pedir acao ao usuario.
  const sourceUnavailable = Boolean(erroWhoami || erroProjetos);

  const isVisible = !state.dismissed && completed < total && !sourceUnavailable;

  return {
    /** true quando uma das leituras falhou — os passos derivados dela nao valem. */
    sourceUnavailable,
    state,
    completed,
    total,
    percent,
    dismiss,
    replay,
    markStepDone,
    isVisible,
  };
}
