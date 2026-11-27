import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Input, Label, Select } from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';
import { useProjects } from '@/hooks/projects/use-projects';
import { useAddDomain } from '@/hooks/mutations/use-domains';
import { useEnvironments } from '@/hooks/use-environments';
import { useProjectStatus } from '@/hooks/use-project-status';
import { useDeployment } from '@/hooks/deploy/use-deployment';
import type { Domain } from '@/lib/api/types';

interface AddDomainSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProject?: string;
  onAdded?: (domain: Domain) => void;
}

const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * AddDomainSheet — right-side Sheet (2026 FAANG pattern).
 * Preserves domain table behind so user sees what's already there.
 */
export function AddDomainSheet({
  open,
  onOpenChange,
  defaultProject = '',
  onAdded,
}: AddDomainSheetProps) {
  const [domain, setDomain] = useState('');
  const [project, setProject] = useState(defaultProject);
  const [pickedApp, setApp] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDomain = useAddDomain();

  // M18: bind project / app / environment from real sources instead of free text,
  // so a typo can't register a domain against a non-existent workload.
  // B-113 — a lista vem do hook canônico, e não de uma segunda leitura própria.
  // Esta folha lia por `useEngineApi('/api/v1/projects')`, chave `['engine','/api/v1/projects']`.
  // Era a MESMA requisição que `useProjects` faz (`engineFetch(p)` é `cloudFetch('/engine'+p)`) —
  // só a chave divergia. E `use-bulk-delete-projects` invalida `['projects']`, que não alcança
  // `['engine', …]`: com `staleTime` de 60s, um projeto apagado continuava sendo oferecido aqui.
  const { projects } = useProjects();
  const { envs } = useEnvironments(project);
  // The names of a project's apps live in its build records. The list of projects carries only
  // a count, so reading them from there left this selector empty and the form unsendable.
  const { status } = useProjectStatus(project || undefined, { env: environment, intervalMs: 0, enabled: open });
  const { build: appsBuild } = useDeployment(status?.active_release?.build_id ?? status?.last_build?.id);
  const apps = (appsBuild?.apps ?? []).map((a) => a.name);
  const app = apps.includes(pickedApp) ? pickedApp : (apps[0] ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!DOMAIN_PATTERN.test(domain)) {
      setError('Enter a valid domain (e.g., app.example.com).');
      return;
    }
    if (!project) {
      setError('Pick the project the domain points to.');
      return;
    }
    if (!app) {
      setError(`${project} has no deployed app in ${environment}. Deploy it there, then add the domain.`);
      return;
    }
    setSubmitting(true);
    try {
      // B-017 — passa pelo hook de mutation em vez do engineFetch cru. O POST era
      // identico; o que faltava era o onSuccess que invalida a lista. Sem ele,
      // adicionar um dominio nao atualizava a tabela por tras do sheet, e o
      // consumidor (domains.tsx) nem sequer passa onAdded — entao NADA acontecia.
      const res = await addDomain.mutateAsync({ domain, project, app, environment });
      if (res === null) {
        setError("Couldn't add domain. Try again in a moment.");
        return;
      }
      onAdded?.(res);
      setDomain('');
      onOpenChange(false);
    } catch (e) {
      // T0.1 TCIA — sponsor critério #6
      setError(
        e instanceof Error
          ? `Add domain failed: ${e.message}. No domain was registered. Retry, or contact support if it persists.`
          : 'Add domain failed. No domain was registered. Retry, or contact support if it persists.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Add custom domain"
      description="We'll generate the DNS records you need to add at your registrar."
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-domain-form" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Adding…' : 'Add domain'}
          </Button>
        </>
      }
    >
      <form id="add-domain-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
              <Label htmlFor="add-domain">Domain</Label>
              <Input
                id="add-domain"
                type="text"
                placeholder="app.acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value.toLowerCase())}
                autoFocus
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="add-domain-project">Project</Label>
                <Select value={project} onValueChange={(v) => { setProject(v); setApp(''); }}>
                  <Select.Trigger id="add-domain-project" className="w-full">
                    <Select.Value placeholder="Select a project" />
                  </Select.Trigger>
                  <Select.Content>
                    {projects.map((p) => (
                      <Select.Item key={p.name} value={p.name}>{p.name}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Label htmlFor="add-domain-app">App</Label>
                <Select value={app} onValueChange={setApp} disabled={!project || apps.length === 0}>
                  <Select.Trigger id="add-domain-app" className="w-full">
                    <Select.Value placeholder={project ? 'Select an app' : 'Pick a project first'} />
                  </Select.Trigger>
                  <Select.Content>
                    {apps.map((a) => (
                      <Select.Item key={a} value={a}>{a}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="add-domain-env">Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <Select.Trigger id="add-domain-env" className="w-full">
                  <Select.Value placeholder="Select an environment" />
                </Select.Trigger>
                <Select.Content>
                  {(envs.length > 0 ? envs : ['production']).map((e) => (
                    <Select.Item key={e} value={e}>{e}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

        {error && <Alert intent="destructive" description={error} />}
      </form>
    </AppModal>
  );
}
