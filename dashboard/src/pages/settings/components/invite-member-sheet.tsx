import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button, Input, Label, Select } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import { AppModal } from '@/components/ui/app-modal';
import { useInviteMember } from '@/hooks/mutations/use-team';
import type { TeamMember, TeamRole } from '@/lib/api/types';

interface InviteMemberSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: (member: TeamMember) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * InviteMemberSheet — right-side Sheet (2026 FAANG pattern).
 * Sheet preserves team list context while operator fills the invite form.
 */
export function InviteMemberSheet({ open, onOpenChange, onInvited }: InviteMemberSheetProps) {
  const inviteMember = useInviteMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      // B-060 — passa pelo hook de mutation em vez do engineFetch cru. O POST era
      // identico; faltava o onSuccess que invalida a lista.
      const res = await inviteMember.mutateAsync({ email, role });
      if (res === null) {
        setError("Couldn't send invite. Try again in a moment.");
        return;
      }
      onInvited?.(res);
      setEmail('');
      onOpenChange(false);
    } catch (e) {
      // T0.1 TCIA — sponsor critério #6
      setError(
        e instanceof Error
          ? `Invite failed: ${e.message}. No invitation was sent. Retry, or contact support if it persists.`
          : 'Invite failed. No invitation was sent. Retry, or contact support if it persists.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Invite teammate"
      description="They'll receive an email with a join link."
      icon={<UserPlus className="size-4" aria-hidden="true" />}
      busy={submitting}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="invite-member-form" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Sending…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <form id="invite-member-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="teammate@acme.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div>
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
            <Select.Trigger id="invite-role">
              <Select.Value placeholder="Member" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="member">Member · view + deploy</Select.Item>
              <Select.Item value="admin">Admin · manage team + billing</Select.Item>
            </Select.Content>
          </Select>
        </div>

        {error && <Alert intent="destructive" description={error} />}
      </form>
    </AppModal>
  );
}
