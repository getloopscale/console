import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button, Card, PageShell } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import { useSetPageTitle } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useScale } from '@/hooks/projects/use-scale';
import { useScaleCost } from '@/hooks/projects/use-scale-cost';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useDeployment } from '@/hooks/deploy/use-deployment';
import { ScaleSlider } from '@/pages/projects/components/scale-slider';
import { HPAToggle, type HPAMode } from '@/pages/projects/components/hpa-toggle';
import { KEDAToggle } from '@/pages/projects/components/keda-toggle';
import { ScaleConfirmDialog } from '@/pages/projects/components/scale-confirm-dialog';
import { describeScaleShape, shapeOfStatus, type ScaleShape } from '@/pages/projects/scale-shape';

// Slider starting point when the API reports no configured replica count.
// It only seeds the control; it is never displayed as the project's count.
const DEFAULT_PROPOSED_REPLICAS = 2;

/**
 * The apps the Scale page can target: the server apps of the build, or every
 * app when the build declares no server type. A project's apps live in its
 * build records (GET /builds/{id} lists them), not in the status response.
 */
function scalableApps(apps: ReadonlyArray<{ name: string; type?: string }> | undefined): string[] {
  const all = apps ?? [];
  const servers = all.filter((a) => a.type === 'server');
  return (servers.length > 0 ? servers : all).map((a) => a.name);
}

/**
 * ProjectScalePage — J-20 Scale plan v1.1 T4.1.
 *
 * Composes the 4 canonical scale components (ScaleSlider, HPAToggle,
 * KEDAToggle, ScaleConfirmDialog) + 2 canonical hooks (useScale,
 * useScaleCost) into the Vercel-style /projects/:name/scale settings
 * page. The page is the security UX layer; the API handler enforces
 * tier + bounds + lock per Phase 1 absorptions.
 *
 * Save flow:
 *
 *   1. User adjusts slider / HPA / KEDA toggle → local state updates.
 *   2. useScaleCost computes preview cost delta inline (UX hint).
 *   3. Click "Apply scale" → ScaleConfirmDialog opens with impact
 *      paragraph + type-to-confirm phrase per EC-8.
 *   4. Confirm → useScale mutation POSTs to /api/v1/projects/{name}/scale.
 *   5. Success → server `monthly_cost_usd` shown as the authoritative
 *      cost; client preview reconciles in the Cost card.
 *   6. Failure → Alert renders the typed error (PLAN_UPGRADE_REQUIRED
 *      surfaces upgrade CTA; HPA_TARGET_OUT_OF_BOUNDS highlights field).
 *
 * Plan tier + cluster KEDA flag — currently sourced from the resolved
 * scale response after the first save. Until the page bootstraps from
 * a status endpoint, the initial render assumes Starter + cluster KEDA
 * installed = false (conservative fail-closed default).
 *
 * The request names the app to scale, read from the build of the active
 * release (or the last build): the only server app, or the one picked when
 * there are several. "Running" shows `replicas_ready` from the status
 * response and "Configured" the stored count; neither shows a number the
 * API did not report.
 */
export function ProjectScalePage() {
  useRequireAuth();
  const { name = '' } = useParams<{ name: string }>();
  useSetPageTitle(`${name} · Scale`);

  // Local edit state
  const [mode, setMode] = useState<HPAMode>('manual');
  const [replicas, setReplicas] = useState(DEFAULT_PROPOSED_REPLICAS);
  const [hpaMin, setHpaMin] = useState(1);
  const [hpaMax, setHpaMax] = useState(3);
  const [hpaTargets, setHpaTargets] = useState({ cpu: 80, memory: 80 });
  const [kedaEnabled, setKedaEnabled] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Initial tier from engine GET /api/v1/projects/{name}/status (#142
  // canonical, closes #123 of qa-dogfood-cleanup-2026-06-21). Engine
  // surfaces the resolved tier from PlanTierStore (same store
  // ScaleHandler.resolveTier uses for enforcement), so this is now a
  // single canonical SoT — no /v1/billing dependency on Known Gap #116.
  // Mutation response still wins post-save (server-authoritative per
  // ADR D1 EC-2). Falls back to 'starter' when status hasn't loaded yet
  // OR engine omits plan_tier (older deployments).
  const { status, loading: statusLoading } = useProjectStatus(name);
  const [resolvedPlanTier, setResolvedPlanTier] = useState('starter');
  useEffect(() => {
    if (status?.plan_tier && status.plan_tier !== resolvedPlanTier) {
      setResolvedPlanTier(status.plan_tier);
    }
    // resolvedPlanTier intentionally excluded from deps so a post-save
    // mutation response (which sets a fresh tier echo via /scale response)
    // does not get clobbered by a stale status poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.plan_tier]);
  // The stored scale, from status until a save, then from what the API
  // accepted. `null` while the API has reported none.
  const [configured, setConfigured] = useState<ScaleShape | null>(null);
  const runningReplicas =
    typeof status?.replicas_ready === 'number' ? status.replicas_ready : null;

  const appsBuildId = status?.active_release?.build_id ?? status?.last_build?.id;
  const { build: appsBuild, loading: appsLoading } = useDeployment(appsBuildId);
  const apps = useMemo(() => scalableApps(appsBuild?.apps), [appsBuild?.apps]);
  const [pickedApp, setPickedApp] = useState<string | null>(null);
  const app = pickedApp !== null && apps.includes(pickedApp) ? pickedApp : (apps[0] ?? null);
  const [serverMonthlyCostUSD, setServerMonthlyCostUSD] = useState<number | null>(
    null,
  );

  // Seed the configured scale and the controls from the status once it loads:
  // a fixed count, or the mode and bounds of a saved autoscaling range (#567).
  // Seeded exactly once so a status poll never clobbers the user's edits; the
  // post-save echo (setConfigured below) still wins afterwards.
  // Until the status arrives, the controls hold the form's defaults, not the project's scale.
  const settingsLoading = statusLoading && !status;
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const saved = shapeOfStatus(status);
    if (saved === null) return;
    seededRef.current = true;
    setConfigured(saved);
    if (saved.kind === 'fixed') {
      setReplicas(saved.replicas);
      return;
    }
    setMode('auto');
    // The saved targets, when the API reports them; the defaults otherwise.
    setHpaTargets((defaults) => ({
      cpu: status?.scaling?.target_cpu ?? defaults.cpu,
      memory: status?.scaling?.target_memory ?? defaults.memory,
    }));
    setKedaEnabled(saved.min === 0);
    setHpaMin(Math.max(saved.min, 1));
    setHpaMax(saved.max);
  }, [status]);

  const scale = useScale(name);

  const proposed: ScaleShape =
    mode === 'manual'
      ? { kind: 'fixed', replicas }
      : { kind: 'auto', min: kedaEnabled ? 0 : hpaMin, max: hpaMax };
  // An autoscaled app is billed for up to its maximum.
  const billedReplicas = (shape: ScaleShape) => (shape.kind === 'fixed' ? shape.replicas : shape.max);
  const proposedReplicas = billedReplicas(proposed);
  // With no configured scale reported, the cost delta has no baseline.
  const baselineReplicas = configured === null ? proposedReplicas : billedReplicas(configured);
  // The minimum never passes the maximum: moving one drags the other (#568).
  const onMinChange = (min: number) => {
    setHpaMin(min);
    if (min > hpaMax) setHpaMax(min);
  };
  const onMaxChange = (max: number) => {
    setHpaMax(max);
    if (max < hpaMin) setHpaMin(max);
  };
  const cost = useScaleCost({
    replicas: proposedReplicas,
    currentReplicas: baselineReplicas,
  });

  const onConfirm = async () => {
    if (app === null) return;
    const payload =
      mode === 'manual'
        ? {
            app,
            environment: 'production',
            replicas,
          }
        : {
            app,
            environment: 'production',
            min: kedaEnabled ? 0 : hpaMin,
            max: hpaMax,
            cpu: hpaTargets.cpu,
            memory: hpaTargets.memory,
          };
    const res = await scale.mutateAsync(payload);
    setConfirmOpen(false);
    // Rehydrate from server-authoritative response per ADR D1 EC-2.
    setResolvedPlanTier(res.plan_tier);
    setServerMonthlyCostUSD(res.monthly_cost_usd);
    // The API stored this scale. Whether it runs is for `replicas_ready` to say.
    setConfigured(proposed);
  };

  const errorMessage =
    scale.error instanceof Error ? scale.error.message : null;

  return (
    <PageShell
      title="Scale"
      description={`Replica count and autoscaling for ${name}.`}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/projects/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to project</span>
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <Card.Header>
            <Card.Title>Replica configuration</Card.Title>
            <Card.Description>
              Set the replica count and autoscaling bounds. Changes apply on
              save and persist across deploys.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            {settingsLoading ? (
              // Before the status arrives the plan, the saved scale and the apps
              // are unknown; controls drawn from defaults would state them (#569).
              <p className="text-body-sm text-muted-foreground" role="status">
                Loading the scale settings…
              </p>
            ) : (
            <div className="space-y-6">
              {apps.length > 1 && (
                <div className="space-y-1">
                  <label htmlFor="scale-app" className="text-body-sm font-medium">
                    App
                  </label>
                  <select
                    id="scale-app"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm"
                    value={app ?? ''}
                    onChange={(e) => setPickedApp(e.target.value)}
                    disabled={scale.isPending}
                  >
                    {apps.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <HPAToggle
                mode={mode}
                targets={hpaTargets}
                onModeChange={setMode}
                onTargetsChange={setHpaTargets}
                disabled={scale.isPending}
              />

              {mode === 'manual' && (
                <ScaleSlider
                  value={replicas}
                  planTier={resolvedPlanTier}
                  onChange={setReplicas}
                  disabled={scale.isPending}
                />
              )}

              {mode === 'auto' && (
                <div className="grid grid-cols-2 gap-4">
                  <ScaleSlider
                    value={hpaMin}
                    planTier={resolvedPlanTier}
                    onChange={onMinChange}
                    disabled={scale.isPending || kedaEnabled}
                    label="Minimum replicas"
                    id="scale-slider-min"
                  />
                  <ScaleSlider
                    value={hpaMax}
                    planTier={resolvedPlanTier}
                    onChange={onMaxChange}
                    disabled={scale.isPending}
                    label="Maximum replicas"
                    id="scale-slider-max"
                  />
                </div>
              )}

              {mode === 'auto' && (
                <KEDAToggle
                  enabled={kedaEnabled}
                  planTier={resolvedPlanTier}
                  onChange={setKedaEnabled}
                  disabled={scale.isPending}
                />
              )}

              {errorMessage && (
                <Alert intent="destructive" description={errorMessage} />
              )}

              {app === null && !appsLoading && (
                <p className="text-body-sm text-muted-foreground">
                  Deploy the project once so the console knows which app to scale.
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={scale.isPending || app === null}
                >
                  {scale.isPending && (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {scale.isPending ? 'Scaling…' : 'Apply scale'}
                </Button>
              </div>
            </div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title className="text-body-sm">Cost preview</Card.Title>
            <Card.Description>
              Estimated monthly cost. Final bill reconciles to actual usage
              at the end of the billing cycle.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <dl className="space-y-3 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Running</dt>
                <dd className="font-mono text-foreground" data-testid="running-replicas">
                  {runningReplicas === null ? 'Not reported' : `${runningReplicas} replicas`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Configured</dt>
                <dd className="font-mono text-foreground" data-testid="configured-replicas">
                  {configured === null
                    ? 'Not reported'
                    : configured.kind === 'fixed'
                      ? `${configured.replicas} replicas`
                      : describeScaleShape(configured)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">After change</dt>
                <dd className="font-mono text-foreground" data-testid="after-change">
                  {settingsLoading ? 'Not reported' : proposed.kind === 'fixed' ? `${proposed.replicas} replicas` : describeScaleShape(proposed)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-3">
                <dt className="text-muted-foreground">Estimated</dt>
                <dd className="font-mono text-foreground" data-testid="estimated-cost">
                  {settingsLoading ? 'Not reported' : `$${cost.estimatedMonthlyUSD.toFixed(2)}/mo`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delta</dt>
                <dd
                  className={`font-mono ${
                    cost.direction === 'up'
                      ? 'text-warning'
                      : cost.direction === 'down'
                        ? 'text-success'
                        : 'text-foreground'
                  }`}
                >
                  {cost.direction === 'flat'
                    ? '—'
                    : `${cost.deltaUSD > 0 ? '+' : '–'}$${Math.abs(cost.deltaUSD).toFixed(2)}/mo`}
                </dd>
              </div>
              {serverMonthlyCostUSD !== null && (
                <div className="flex justify-between border-t border-border/60 pt-3">
                  <dt className="text-muted-foreground">
                    Applied (server authoritative)
                  </dt>
                  <dd className="font-mono text-foreground">
                    ${serverMonthlyCostUSD.toFixed(2)}/mo
                  </dd>
                </div>
              )}
            </dl>
          </Card.Body>
        </Card>
      </div>

      <ScaleConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        projectName={name}
        environment="production"
        current={configured}
        proposed={proposed}
        estimatedMonthlyUSD={cost.estimatedMonthlyUSD}
        deltaUSD={cost.deltaUSD}
        onConfirm={onConfirm}
        busy={scale.isPending}
      />
    </PageShell>
  );
}
