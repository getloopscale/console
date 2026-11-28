import { Crown } from 'lucide-react';
import { Button } from '@getloopscale/ui';
import { Link } from 'react-router-dom';

import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import type { PlanLimitDetail } from '@/lib/http/event-payloads';

interface PlanLimitUpgradePanelProps {
  readonly open: boolean;
  readonly detail: PlanLimitDetail | null;
  readonly onClose: () => void;
}

/** The upgrade modal itself. `PlanLimitUpgradeModal` owns the listener and loads this on demand. */
export function PlanLimitUpgradePanel({ open, detail, onClose }: PlanLimitUpgradePanelProps) {
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
      onClose={onClose}
      title="Plan limit reached"
      icon={<Crown className="size-4" aria-hidden="true" />}
      description={message}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button asChild>
            <Link to="/billing" onClick={onClose}>
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
