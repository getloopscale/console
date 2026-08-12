import { useState } from 'react';
import { Mail, User } from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  CodeBlock,
  DangerZone,
  PageShell,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { logout } from '@/lib/auth/session';
import { useDeleteTenant } from '@/hooks/settings/use-delete-tenant';
import { maskEmail } from '@/lib/formatting/format';

export function ProfilePage() {
  const session = useRequireAuth();
  const { setPageTitle } = usePageMeta();

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!session) return null;

  const email = session.identity.traits.email ?? '';
  const name = session.identity.traits.name ?? '';
  const initials = (name || email).charAt(0).toUpperCase();

  // SG-05 CLOSED (plan v1.0 T4.8, 2026-05-26): replaced setTimeout fake with
  // real DELETE /api/v1/tenants/{id}. Backend soft-deletes with grace period;
  // logout invalidates the local session so the user is redirected to /login.
  //
  // B-264 — the delete had NO error branch. Without `throwOnError` a failure resolved `null`,
  // nothing looked at it, and this walked the whole success path: dialog closed, session
  // ended. The user reads that as "my account is gone", over a request that failed.
  const deleteTenant = useDeleteTenant();
  const deleting = deleteTenant.isPending;

  const handleDeleteAccount = async () => {
    await deleteTenant.mutateAsync(session.identity.id);
    setConfirmOpen(false);
    await logout();
  };
  // NO try/catch here, deliberately. `ConfirmDialog` already catches a rejecting `onConfirm`,
  // keeps itself open and renders the reason (B-105) — catching it here would swallow the
  // error before the component that knows how to show it ever sees it. What was missing was
  // never the handling; it was that the request could not FAIL: without `throwOnError` it
  // resolved `null` and this function ran to the end (B-264).

  return (
    <PageShell title="Profile" onTitleChange={setPageTitle}>
      <Card>
        <Card.Header className="flex flex-row items-start justify-between gap-4">
          <div>
            <Card.Title asChild>
              {/* Red Team theo-cloud#79: promote h3 → h2 so /profile
                  heading hierarchy goes h1 → h2 → h3 without skipping. */}
              <h2>Account</h2>
            </Card.Title>
            <Card.Description>Your identity and session info.</Card.Description>
          </div>
          {/* T-DR-1.5 v1.2: Sign out moved to Account card header (right-aligned),
              eliminates 45px 1-button Card anti-pattern (closes P2-3). */}
          <Button variant="secondary" size="sm" onClick={logout}>
            Sign out
          </Button>
        </Card.Header>
        <Card.Body className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-12">
              <Avatar.Fallback>{initials}</Avatar.Fallback>
            </Avatar>
            <div className="space-y-0.5">
              {name && (
                <p
                  className="text-body-sm font-medium text-foreground max-w-[28ch] break-words"
                  style={{ overflowWrap: 'anywhere' }}
                  title={name}
                  data-testid="profile-name"
                >
                  {name}
                </p>
              )}
              <p className="font-mono text-label text-muted-foreground flex items-center gap-1.5">
                <Mail className="size-3" aria-hidden="true" />
                {maskEmail(email)}
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-label text-success flex items-center gap-2">
            <User className="size-3.5" aria-hidden="true" />
            Authenticated via secure session.
          </div>
        </Card.Body>
      </Card>

      {/* T-DR-1.5 v1.2 + ADR D4: CLI signature card mitigates P2-4 sparseness
          (~38% whitespace below). CLI-first per DSS § 9.1. */}
      <Card>
        <Card.Header>
          <Card.Title asChild>
            {/* Red Team theo-cloud#79: cards on /profile MUST stay at
                h2 so the page outline is contiguous. */}
            <h2>Or use the CLI</h2>
          </Card.Title>
          <Card.Description>Profile actions are also available via terminal.</Card.Description>
        </Card.Header>
        <Card.Body>
          <CodeBlock
            caption="Common profile commands"
            /* B-132/B-133 — `theo account delete` NAO e um comando registrado pela CLI (medido
               2026-08-11). Um bloco copiavel torna a mentira acionavel: a pessoa cola e o
               terminal responde que o comando nao existe. */
            code={`theo whoami
theo logout`}
            terminal
            copyable
          />
        </Card.Body>
      </Card>

      <DangerZone>
        <DangerZone.Action
          title="Delete Account"
          description="Permanently delete your account, all your projects, and all your data. This action cannot be undone."
          action={
            <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              Delete Account
            </Button>
          }
        />
      </DangerZone>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete your account?"
        description={
          <>
            This will permanently delete your account and all associated data
            (projects, environments, domains). You will be signed out
            immediately. This cannot be undone.
          </>
        }
        confirmLabel="Delete My Account"
        cancelLabel="Cancel"
        intent="destructive"
        confirmationPhrase={email}
        loading={deleting}
        onConfirm={handleDeleteAccount}
      />
    </PageShell>
  );
}
