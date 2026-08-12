import { useParams } from 'react-router-dom';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@usetheo/ui';
import { useBuildSBOM } from '@/hooks/deploy/use-build-artifacts';
import { formatDate } from '@/lib/formatting/format';

/**
 * SBOMTab — Plan J-17 T5.5.
 *
 * LIVE bug 2026-06-06: backend returns SBOM METADATA per app (format,
 * component count, generated_at, presigned MinIO download_url) — NOT
 * the inline CycloneDX JSON. The full SBOM lives at download_url for
 * users to grab via curl/sbom tools (grype, syft, dependency-track).
 *
 * UI shows: one card per app with format + component count + generated
 * time + a "Download" button that opens the presigned URL.
 */
export function SBOMTab() {
  const { id = '' } = useParams<{ name: string; id: string }>();
  // B-244 — the read lives in the domain hook. It used to be a hand-rolled effect with its own
  // `cancelled` flag, `loading` and `error` state: a second fetching mechanism beside
  // react-query that cached nothing and deduplicated nothing.
  const sbomQuery = useBuildSBOM(id);
  const sbom = sbomQuery.data ?? null;
  const loading = sbomQuery.isLoading;
  const naoConsegiuLer = sbomQuery.isError;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading SBOM" />
      </div>
    );
  }

  // B-244 — a FAILED read is not an absent SBOM, and for a supply-chain artifact the two are
  // opposite conclusions: "this build shipped without provenance" is a compliance finding,
  // "I could not read the provenance" is a retry. They used to share a title.
  if (naoConsegiuLer) {
    return (
      <EmptyState
        icon={FileText}
        title="Could not read the SBOM"
        description="This build may well have one — the request failed, so what is on screen is not what exists. Try again in a moment."
      />
    );
  }

  if (!sbom || !sbom.apps || sbom.apps.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No SBOM for this build"
        description="SBOMs are generated for succeeded builds. This build may have failed before the SBOM step."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Body>
          <p className="text-body-sm text-muted-foreground">
            Software Bill of Materials for each app in this build. Download the
            CycloneDX JSON for use with grype, dependency-track, or other supply
            chain tools.
          </p>
        </Card.Body>
      </Card>

      {sbom.apps.map((app) => (
        <Card key={app.app_name}>
          <Card.Header>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <Card.Title>{app.app_name}</Card.Title>
                <Card.Description>
                  {app.sbom_format ? (
                    <Badge variant="outline" className="text-label uppercase">
                      {app.sbom_format}
                    </Badge>
                  ) : (
                    'Format unknown'
                  )}
                </Card.Description>
              </div>
              {app.download_url && (
                <Button asChild size="sm">
                  <a href={app.download_url} target="_blank" rel="noopener noreferrer">
                    <Download className="size-4" aria-hidden="true" />
                    Download
                  </a>
                </Button>
              )}
            </div>
          </Card.Header>
          <Card.Body className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-body-sm">
            <div>
              <p className="text-label uppercase text-muted-foreground">Components</p>
              <p className="mt-1 font-medium text-foreground tabular-nums">
                {app.component_count ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-label uppercase text-muted-foreground">Generated</p>
              <p
                className="mt-1 font-medium text-foreground tabular-nums"
                title={app.generated_at}
              >
                {app.generated_at ? formatDate(app.generated_at, 'relative') : '—'}
              </p>
            </div>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}
