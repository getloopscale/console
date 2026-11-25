import { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import {
  Button,
} from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { Link } from 'react-router-dom';
import { readPlanLimitDetail, type PlanLimitDetail } from '@/lib/http/event-payloads';

/**
 * PlanLimitUpgradeModal — Plan J-10 v1.1 T2.6 (NEW).
 *
 * Listens for the global `loopscale:plan-limit` event emitted by the 402
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
// B-236 — a forma validada vive em `lib/http/event-payloads.ts`, junto do emissor. Duas
// declarações da mesma carga são duas chances de discordarem.


export function PlanLimitUpgradeModal() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);

  useEffect(() => {
    // B-236 — `CustomEvent<PlanLimitDetail>` era uma afirmacao de compilacao sobre o corpo de uma
    // resposta HTTP: um `current_plan` numerico chegava a `String.replace` abaixo e derrubava o
    // modal no exato momento em que ele explica por que a acao foi recusada.
    //
    // O emissor agora valida (`lib/http/event-payloads.ts`), entao este detail nao pode mais vir
    // de `api.ts`. A guarda fica aqui tambem em profundidade: `loopscale:plan-limit` e um evento de
    // window, e um segundo emissor acrescentado amanha nao herda o cuidado do primeiro.
    const handler = (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      setDetail(readPlanLimitDetail(ce.detail));
      setOpen(true);
    };
    window.addEventListener('loopscale:plan-limit', handler);
    return () => window.removeEventListener('loopscale:plan-limit', handler);
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
