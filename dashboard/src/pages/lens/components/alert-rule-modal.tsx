import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BellPlus } from 'lucide-react';
import { Button } from '@getloopscale/ui';

import { Alert } from '@/components/ui/alert-guard';
import { AppModal } from '@/components/ui/app-modal';
import { AlertCreateForm, type AlertCreateFormProps } from '@/pages/lens/components/alert-create-form';

interface AlertRuleModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The create request is in flight. */
  readonly pending: boolean;
  readonly canCreate: boolean;
  readonly onSubmit: () => void;
  /** A refused creation, shown inside the modal: behind the overlay nobody would read it. */
  readonly failure: ReactNode;
  readonly fields: AlertCreateFormProps;
}

/**
 * The "New alert rule" modal. It owns the `<form>` and the footer's submit button, so the two
 * stay in one file and the `form="<id>"` link between them is checked by `modal-primitive.test.ts`.
 * The state and the validation stay in the page.
 */
export function AlertRuleModal({ open, onClose, pending, canCreate, onSubmit, failure, fields }: AlertRuleModalProps) {
  const hasWebhooks = fields.webhooks.length > 0;
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="New alert rule"
      description="The rule is checked on a schedule and notifies the webhook when the metric crosses the threshold."
      icon={<BellPlus className="size-4" aria-hidden="true" />}
      size="lg"
      busy={pending}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {hasWebhooks ? (
            <Button type="submit" form="alert-rule-form" disabled={!canCreate || pending}>
              {pending ? 'Creating…' : 'Create rule'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {failure}
        {hasWebhooks ? (
          <form
            id="alert-rule-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate) onSubmit();
            }}
          >
            <AlertCreateForm {...fields} />
          </form>
        ) : (
          <Alert intent="warning" title="Register a webhook first">
            Alerts are delivered to a registered webhook. Add one under{' '}
            <Link to="/observability/webhooks" className="font-medium text-primary underline underline-offset-2">
              Observability › Webhooks →
            </Link>
            , then create a rule here.
          </Alert>
        )}
      </div>
    </AppModal>
  );
}
