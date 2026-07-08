import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, CopyButton, EmptyState } from '@usetheo/ui';

import {
  detectPii,
  groupByNamespace,
  promotedBadges,
  type NamespaceGroup,
} from '@/lib/otel-attributes';

/**
 * M58 P2.2 — the namespace-grouped, PII-masked attribute panel (the trace-detail superiority feature;
 * ADR D4, blueprint §4). Replaces the old flat `<dl>` attribute render in `SpanDetail`.
 *
 * Layout: a promoted-badge header (`promotedBadges`) over one collapsible `Card` per OTel namespace
 * (`groupByNamespace`). `@usetheo/ui` `Card` is a shadcn-style compound with NO built-in collapse, so
 * collapse is composed from a header Button + local state (default OPEN — rows visible unless toggled).
 *
 * PII invariant (D4 / R3 — the load-bearing rule): a `detectPii`-flagged value is rendered as `•••`
 * plus a Reveal control. The RAW value string is NEVER placed in the DOM until Reveal is clicked AND
 * the caller's `canReveal` gate is true. It is not put in a `title` / `aria-*` / `data-*` attribute
 * either (React only renders it inside the conditional branch). The per-value CopyButton is likewise
 * withheld until reveal, so the raw string cannot leak through the CopyButton `value` prop pre-reveal.
 * When `!canReveal` the Reveal control is disabled (fail-closed) — force-clicking it changes nothing.
 */
export function Attributes({
  attrs,
  canReveal,
}: {
  attrs?: Record<string, unknown>;
  canReveal: boolean;
}) {
  const safe = attrs ?? {};
  const groups = groupByNamespace(safe);
  const badges = promotedBadges(safe);

  if (groups.length === 0) {
    return <EmptyState title="No attributes" description="This span records none." dashed />;
  }

  return (
    <div className="space-y-2" data-testid="attributes-panel">
      {badges.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="attributes-badges">
          {badges.map((b) => (
            <Badge key={b.label} variant="outline" title={b.label}>
              {b.value}
            </Badge>
          ))}
        </div>
      ) : null}
      {groups.map((group) => (
        <NamespaceCard key={group.namespace} group={group} canReveal={canReveal} />
      ))}
    </div>
  );
}

/** One collapsible Card for a single OTel namespace. Open by default; the header Button toggles. */
function NamespaceCard({ group, canReveal }: { group: NamespaceGroup; canReveal: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Card size="sm">
      <Card.Header className="p-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.namespace}`}
          onClick={() => setOpen((o) => !o)}
          className="w-full justify-start gap-1.5"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {/* Namespace + count in a SINGLE text node so a namespace like `user` never collides with an
              unrelated `user` text node elsewhere in the detail pane (e.g. a chat-role badge). */}
          <span className="font-mono text-xs font-semibold" data-testid={`attributes-ns-${group.namespace}`}>
            {`${group.namespace} (${group.entries.length})`}
          </span>
        </Button>
      </Card.Header>
      {open ? (
        <Card.Body className="pt-1">
          <dl className="grid grid-cols-1 gap-1 text-xs">
            {group.entries.map(([key, value]) => (
              <AttributeRow key={key} attrKey={key} value={value} canReveal={canReveal} />
            ))}
          </dl>
        </Card.Body>
      ) : null}
    </Card>
  );
}

/** A single key/value row — masked when the value is PII, otherwise the plain value + a CopyButton. */
function AttributeRow({
  attrKey,
  value,
  canReveal,
}: {
  attrKey: string;
  value: unknown;
  canReveal: boolean;
}) {
  const isPii = detectPii(value);
  return (
    <div className="flex items-start gap-2">
      <dt className="w-40 shrink-0 truncate font-mono text-muted-foreground" title={attrKey}>
        {attrKey}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1.5">
        {isPii ? (
          <MaskedValue value={String(value)} canReveal={canReveal} />
        ) : (
          <PlainValue value={value} />
        )}
      </dd>
    </div>
  );
}

function PlainValue({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (
    <>
      <span className="min-w-0 truncate font-mono">{text}</span>
      <CopyButton value={text} variant="ghost" size="sm" />
    </>
  );
}

/**
 * A PII value rendered fail-closed. Pre-reveal, the DOM contains ONLY the `•••` placeholder and the
 * Reveal button — the raw `value` string is never mounted (no text node, no title/aria/data). Reveal
 * is disabled unless `canReveal`; only after a click on an enabled control does the raw value (and its
 * CopyButton) render.
 */
function MaskedValue({ value, canReveal }: { value: string; canReveal: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const showRaw = revealed && canReveal;

  if (showRaw) {
    return (
      <>
        <span className="min-w-0 truncate font-mono">{value}</span>
        <CopyButton value={value} variant="ghost" size="sm" />
      </>
    );
  }

  return (
    <>
      <span className="font-mono text-muted-foreground" aria-label="Masked value">
        •••
      </span>
      {/* M72 — the Reveal control is shown ONLY to an authorized viewer. When `!canReveal` we render a
          quiet "masked" hint instead of a permanently-disabled button (no inert affordance / theatre). */}
      {canReveal ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Reveal masked value"
          title="Reveal"
          onClick={() => setRevealed(true)}
        >
          Reveal
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground" title="You do not have permission to reveal this value">
          masked
        </span>
      )}
    </>
  );
}
