import { Label } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

/**
 * Plan tiers eligible for KEDA scale-to-zero. Mirrors
 * pkg/enforcement.kedaEligiblePlans server-side — Pro / Team / Enterprise.
 * Starter is gated with an upgrade CTA per EC-12.
 */
const KEDA_ELIGIBLE_TIERS = new Set(['pro', 'team', 'enterprise']);

export interface KEDAToggleProps {
  /** Whether scale-to-zero is currently opted in (mirrors min=0 in payload). */
  enabled: boolean;
  /** Tenant's resolved plan tier — drives eligibility + upgrade CTA. */
  planTier: string;
  /** Toggle callback (only fires when tier is eligible). */
  onChange: (enabled: boolean) => void;
  /** Disable while a mutation is in flight. */
  disabled?: boolean;
}

/**
 * KEDAToggle — J-20 plan v1.1 T3.3.
 *
 * Opt-in toggle for KEDA scale-to-zero. Two-layer gating:
 *
 *   1. Plan-tier check (Starter → upgrade CTA, never enables)
 *   2. Cluster scale-to-zero availability is enforced server-side at apply
 *      time (402/422) — the dashboard does NOT assert cluster state it can't
 *      observe (M16: removed the fabricated "installed" flag + its term-leaking
 *      "KEDA is not installed on this cluster" alert).
 *
 * Free user bypassing the dashboard via raw API STILL lands in
 * HTTP 402 PLAN_UPGRADE_REQUIRED at the handler — this UI surface is
 * UX-only, not the security boundary (EC-3 absorption).
 *
 * Upgrade CTA: per EC-12, the Starter copy reads "Upgrade to Pro to
 * enable scale-to-zero" with a link to /billing (the canonical
 * pricing surface).
 */
export function KEDAToggle({
  enabled,
  planTier,
  onChange,
  disabled = false,
}: KEDAToggleProps) {
  const tierEligible = KEDA_ELIGIBLE_TIERS.has(planTier.toLowerCase());
  const blocked = !tierEligible;
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled && !blocked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled || blocked}
          className="mt-1"
          aria-describedby="keda-help"
        />
        <span>
          <Label className="font-medium">
            Scale to zero when idle
          </Label>
          <p id="keda-help" className="text-xs text-muted-foreground mt-1">
            Drops replicas to 0 after a cooldown window when traffic stops.
            Cold start when traffic resumes (~2–5s).
          </p>
        </span>
      </label>

      {!tierEligible && (
        <Alert
          intent="warning"
          title="Pro plan required"
          description={
            <>
              Scale-to-zero is part of the Pro plan and above.{' '}
              <a href="/billing" className="underline font-medium">
                Upgrade to Pro
              </a>{' '}
              to enable it.
            </>
          }
        />
      )}

    </div>
  );
}
