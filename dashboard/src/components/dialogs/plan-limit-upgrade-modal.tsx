import { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import {
  Button,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { Link } from 'react-router-dom';

/**
 * PlanLimitUpgradeModal — Plan J-10 v1.1 T2.6 (NEW).
 *
 * Listens for the global `theo:plan-limit` event emitted by the 402
 * interceptor in lib/api.ts (T1.4). When fired, opens an upgrade modal
 * with CTA → /billing.
 *
 * Design per blueprint § 2.5 Pattern A (Vercel canonical inline modal):
 * direct path to revenue conversion, no friction navigating away. Single
 * top-level mount catches every 402 from any surface — /environments,
 * /secrets, /projects, etc. — without each call site re-implementing.
 *
 * Event payload shape (best-effort; the modal tolerates null/empty):
 *   {
 *     code: 'PLAN_LIMIT_EXCEEDED',
 *     message: '...',
 *     resource: 'environments' | 'secrets' | 'projects' | ...,
 *     current_plan: 'starter' | 'pro' | ...,
 *     limit: number,
 *   }
 */
interface PlanLimitDetail {
  code?: string;
  message?: string;
  resource?: string;
  current_plan?: string;
  limit?: number;
}

export function PlanLimitUpgradeModal() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<PlanLimitDetail | null>;
      setDetail(ce.detail ?? null);
      setOpen(true);
    };
    window.addEventListener('theo:plan-limit', handler);
    return () => window.removeEventListener('theo:plan-limit', handler);
  }, []);

  const resourceLabel = detail?.resource ?? 'this resource';
  const currentPlan = (detail?.current_plan ?? 'Free').replace(/^\w/, (c) =>
    c.toUpperCase(),
  );
  const message =
    detail?.message ??
    `You've reached your ${currentPlan} plan limit for ${resourceLabel}. Upgrade to add more.`;

  return (
    // Sem `size`: o default `md` é `max-w-lg`, a mesma largura herdada antes.
    <AppModal
      open={open}
      onClose={() => setOpen(false)}
      title={
        <span className="inline-flex items-center gap-2">
          <Crown className="size-5 text-warning" aria-hidden="true" />
          Plan limit reached
        </span>
      }
      description={message}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button asChild>
            <Link to="/billing" onClick={() => setOpen(false)}>
              Upgrade plan
            </Link>
          </Button>
        </>
      }
    >
      <Alert
        intent="info"
        description="Upgrade unlocks higher limits, advanced features, and priority support. You can cancel anytime."
      />
    </AppModal>
  );
}
