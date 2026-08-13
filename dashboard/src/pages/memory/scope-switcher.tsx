import { useMemorySessions, type SessionRow } from '@/hooks/memory/use-sessions';

/**
 * B-024 (classe) — sessoes acumulam com o uso e o seletor baixava todas para
 * montar um <select>. Um workspace ativo por meses derruba a propria tela de
 * memoria pelo peso do dropdown.
 *
 * 100 e escolha: um <select> nativo com mais que isso ja e inutilizavel como
 * navegacao — quem tem mais sessoes chega nelas por deep link, e o caminho do
 * deep link continua funcionando porque SessionSelectBase sintetiza a opcao
 * desconhecida em vez de descartar o id da URL.
 */

/**
 * Session-separation (2026-07-23) — the M8 scope switcher.
 *
 * Memory is partitioned into the GLOBAL tier (workspace, user) and per-session
 * WORKING memory (workspace, user, session). These selectors enumerate the
 * user's sessions via the new `/v1/dashboard/memory/sessions` endpoint:
 * `ScopeSelect` flips a surface between Global and one session; `SessionPicker`
 * picks the session INSTANCE on surfaces whose tab already fixed the tier.
 */


/** Short human handle for a session id (full id stays in the option title). */
function sessionLabel(s: SessionRow): string {
  const shortId = s.session_id.length > 10 ? `${s.session_id.slice(0, 10)}…` : s.session_id;
  return `${shortId} · ${s.memory_count} ${s.memory_count === 1 ? 'memory' : 'memories'}`;
}

interface SessionSelectProps {
  /** '' = none selected (ScopeSelect: the Global tier). */
  value: string;
  onChange: (sessionId: string) => void;
  id?: string;
}

/**
 * Shared select body: an empty-value option (caller-labeled), one option per
 * enumerated session, and — when a deep-linked id is unknown — a synthetic
 * option so the URL state stays honest instead of snapping back silently.
 */
function SessionSelectBase({
  value,
  onChange,
  id,
  emptyLabel,
  optionPrefix,
  className,
  ariaLabel,
}: SessionSelectProps & {
  emptyLabel: string;
  optionPrefix: string;
  className: string;
  ariaLabel?: string;
}) {
  const sessions = useMemorySessions();
  const rows = sessions.data?.sessions ?? [];
  const known = rows.some((s) => s.session_id === value);
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <option value="">{emptyLabel}</option>
      {rows.map((s) => (
        <option key={s.session_id} value={s.session_id} title={s.session_id}>
          {optionPrefix}
          {sessionLabel(s)}
        </option>
      ))}
      {value && !known ? (
        <option value={value} title={value}>
          {optionPrefix}
          {value.slice(0, 10)}… (from link)
        </option>
      ) : null}
    </select>
  );
}

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/** Global-vs-session switcher for the Memories listing. */
export function ScopeSelect(props: SessionSelectProps) {
  const id = props.id ?? 'scope-session';
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground block mb-1">
        Scope
      </label>
      <SessionSelectBase
        {...props}
        id={id}
        emptyLabel="Global — durable memory"
        optionPrefix="Session "
        className={`${SELECT_CLASS} w-56`}
      />
    </div>
  );
}

/**
 * Instance picker for surfaces whose SESSION tab already fixes the tier
 * (Entities / Graph / Episodes) — picks WHICH session to inspect.
 */
export function SessionPicker(props: SessionSelectProps) {
  const sessions = useMemorySessions();
  // B-243 — FOUR states, where the code had two. `data === undefined` collapsed into the
  // empty list via `?? []`, so the picker announced "no sessions recorded yet" both while
  // the request was still in flight and after it failed — a claim about the user's data,
  // made twice over on the strength of a read that had not answered.
  //
  // The four ask different things of whoever is looking: wait, retry or check the service,
  // create your first session, or pick one. Only the third is a statement about their data.
  //
  // The loading case was found by the test for the error case: `findByRole` resolved on the
  // first render, which is the pending one, and it still said "no sessions recorded yet".
  const label = sessions.isPending
    ? 'Loading sessions…'
    : sessions.isError
      ? 'Could not read sessions'
      : (sessions.data?.sessions ?? []).length === 0
        ? 'No sessions recorded yet'
        : 'Select a session…';
  return (
    <SessionSelectBase
      {...props}
      id={props.id ?? 'session-picker'}
      ariaLabel="Select session"
      emptyLabel={label}
      optionPrefix=""
      className={`${SELECT_CLASS} w-64`}
    />
  );
}
