import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge, Card, EmptyState } from '@usetheo/ui';
import { useBuildAttestation } from '@/hooks/deploy/use-build-artifacts';
import { formatDate } from '@/lib/formatting/format';

/**
 * AttestationTab — Plan J-17 T5.6.
 *
 * LIVE bug 2026-06-06: backend returns flat attestation metadata
 * (image digest, image_signature reference, signed_at, signed flag)
 * — NOT a cosign DSSE envelope with base64 payload + signatures.
 * The full envelope lives in the registry; the BFF surfaces just the
 * audit trail the dashboard needs.
 *
 * UI shows: signed status badge + image digest + signature reference
 * + signed_at timestamp.
 */
export function AttestationTab() {
  const { id = '' } = useParams<{ name: string; id: string }>();
  // B-244 — the read lives in the domain hook; this used to be a hand-rolled effect with its
  // own `cancelled` flag, `loading` and `error` state.
  const attQuery = useBuildAttestation(id);
  const att = attQuery.data ?? null;
  const loading = attQuery.isLoading;
  const naoConsegiuLer = attQuery.isError;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-label="Loading attestation"
        />
      </div>
    );
  }

  // B-244 — "this build was never signed" and "I could not read whether it was signed" are
  // opposite conclusions about supply-chain provenance, and they used to share a title.
  if (naoConsegiuLer) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Could not read the attestation"
        description="This build may well be signed — the request failed, so the absence on screen is not evidence of anything. Try again in a moment."
      />
    );
  }

  if (!att) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No attestation for this build"
        description="Cosign signs succeeded builds. Failed or cancelled builds don't have an attestation."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Card.Title className="inline-flex items-center gap-2">
              <ShieldCheck className="size-5 text-success" aria-hidden="true" />
              Supply chain signature
            </Card.Title>
            {att.signed ? (
              <Badge
                variant="outline"
                className="border-success/40 bg-success/10 text-success text-label uppercase"
              >
                <CheckCircle2 className="size-3.5 mr-1 inline" aria-hidden="true" />
                Signed
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-destructive/40 bg-destructive/10 text-destructive text-label uppercase"
              >
                <ShieldOff className="size-3.5 mr-1 inline" aria-hidden="true" />
                Unsigned
              </Badge>
            )}
          </div>
          <Card.Description>
            Cosign verifies images at admission. The digest below is the
            authoritative reference for this build's container image.
          </Card.Description>
        </Card.Header>
        <Card.Body className="space-y-4 text-body-sm">
          {att.image_digest && (
            <div>
              <p className="text-label uppercase text-muted-foreground">Image digest</p>
              <p className="mt-1 font-mono text-foreground break-all">
                {att.image_digest}
              </p>
            </div>
          )}

          {att.image_signature && (
            <div>
              <p className="text-label uppercase text-muted-foreground">
                Signature reference
              </p>
              <p className="mt-1 font-mono text-muted-foreground break-all text-label">
                {att.image_signature}
              </p>
            </div>
          )}

          {att.signed_at && (
            <div>
              <p className="text-label uppercase text-muted-foreground">Signed at</p>
              <p
                className="mt-1 font-medium text-foreground tabular-nums"
                title={att.signed_at}
              >
                {formatDate(att.signed_at, 'datetime')} ·{' '}
                <span className="text-muted-foreground">
                  {formatDate(att.signed_at, 'relative')}
                </span>
              </p>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
