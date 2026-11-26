import { TriangleAlert } from 'lucide-react';

/**
 * SkippedStepNotice — shown under the timeline of a build that was deployed although one of
 * its steps failed. Some steps do not gate a deploy (the SBOM is one): the build goes on, the
 * release goes live and the artefact of that step is missing. Calling that "build failed"
 * contradicts the header, and saying nothing hides that the artefact is missing.
 */
export interface SkippedStepNoticeProps {
  stepName: string;
  errorMessage: string;
}

const SBOM_STEP = /^sbom-(.+)$/;

function title(stepName: string): string {
  const sbomApp = SBOM_STEP.exec(stepName)?.[1];
  if (sbomApp) return `Deployed without an SBOM for ${sbomApp}`;
  return `Deployed although the step ${stepName} failed`;
}

export function SkippedStepNotice({ stepName, errorMessage }: SkippedStepNoticeProps) {
  return (
    <div
      className="rounded-md border border-warning/40 bg-warning/5 p-3 text-body-sm"
      role="status"
    >
      <p className="flex items-center gap-2 font-medium text-foreground">
        <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
        {title(stepName)}
      </p>
      <p className="mt-1 max-w-xl text-muted-foreground">
        The release is live. This step does not block a deploy, so the build went on when it
        failed, and what the step produces is missing for this build.
      </p>
      {errorMessage && (
        <p className="mt-1 max-w-xl font-mono text-label text-muted-foreground/80">{errorMessage}</p>
      )}
    </div>
  );
}
