import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/api';

/**
 * Session-separation (2026-07-23) — the M8 scope switcher.
 *
 * Memory is partitioned into the GLOBAL tier (workspace, user) and per-session
 * WORKING memory (workspace, user, session). These selectors enumerate the
 * user's sessions via the new `/v1/dashboard/memory/sessions` endpoint:
 * `ScopeSelect` flips a surface between Global and one session; `SessionPicker`
 * picks the session INSTANCE on surfaces whose tab already fixed the tier.
 */

export interface SessionRow {
  session_id: string;
  memory_count: number;
  last_activity_at?: string;
}

function useSessionsQuery() {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/sessions'] as const,
    queryFn: () =>
      cloudFetch<{ sessions: SessionRow[] }>(
        '/v1/dashboard/memory/sessions',
        {},
        { throwOnError: true },
      ),
    // Sessions change slowly; keep the picker snappy without hammering the BFF.
    staleTime: 60_000,
  });
}

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
  const sessions = useSessionsQuery();
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
  const sessions = useSessionsQuery();
  const empty = (sessions.data?.sessions ?? []).length === 0;
  return (
    <SessionSelectBase
      {...props}
      id={props.id ?? 'session-picker'}
      ariaLabel="Select session"
      emptyLabel={empty ? 'No sessions recorded yet' : 'Select a session…'}
      optionPrefix=""
      className={`${SELECT_CLASS} w-64`}
    />
  );
}
