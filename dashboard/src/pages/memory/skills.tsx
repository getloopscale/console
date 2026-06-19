import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import {
  Alert,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageShell,
  Timestamp,
} from '@usetheo/ui';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * dashboard-phase2b-skills-browse T4.1 (blueprint ADR D2).
 *
 * /memory/skills — READ-ONLY browse of a repo's skill library.
 *
 *  - A repoId input gates the fetch (no skills without a repo).
 *  - DataTable of {description, language, code (preview), createdAt}.
 *  - EmptyState when the repo has no skills; hint when no repoId entered.
 *  - EC-3: skills with null code (derived/consolidated) render gracefully.
 *  - EC-4: truncation at the topK cap is disclosed ("showing the first N").
 *  - D4 scope guardrail: READ-ONLY — no run/edit/delete controls, no sandbox.
 */

interface Skill {
  id: string;
  hash: string;
  description: string;
  code: string | null;
  codeLanguage: string | null;
  createdAt: string;
  derivedFrom: string[];
  supersededBy: string | null;
}

interface SkillsResult {
  skills: Skill[];
  truncated: boolean;
}

export function SkillsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Skills'), [setPageTitle]);
  useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const repoId = searchParams.get('repoId') ?? '';

  const setRepoId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === '') {
      params.delete('repoId');
    } else {
      params.set('repoId', next);
    }
    setSearchParams(params, { replace: true });
  };

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/skills', repoId] as const,
    queryFn: () =>
      cloudFetch<SkillsResult>(
        `/v1/dashboard/memory/skills?repoId=${encodeURIComponent(repoId)}`,
      ),
    enabled: repoId !== '',
  });

  const skills = query.data?.skills ?? [];
  const truncated = query.data?.truncated ?? false;

  const columns: DataTableColumn<Skill>[] = [
    {
      key: 'description',
      label: 'Skill',
      render: (row) => (
        <div className="flex flex-col">
          <span>{row.description}</span>
          {row.derivedFrom.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              derived from {row.derivedFrom.length} source
              {row.derivedFrom.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'codeLanguage',
      label: 'Language',
      render: (row) =>
        row.codeLanguage ? (
          <span className="font-mono text-xs">{row.codeLanguage}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: 'code',
      label: 'Code',
      render: (row) =>
        row.code ? (
          <code className="font-mono text-xs line-clamp-2 max-w-md block">{row.code}</code>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (row) => <Timestamp value={row.createdAt} />,
    },
  ];

  return (
    <PageShell
      title="Skills"
      description="Browse the executable skills your agent has learned, grouped by repo. Read-only."
    >
      <div className="space-y-6">
        <div className="max-w-sm">
          <label htmlFor="skills-repo" className="text-sm font-medium">
            Repo
          </label>
          <Input
            id="skills-repo"
            placeholder="e.g. my-repo"
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
          />
        </div>

        {repoId === '' ? (
          <EmptyState
            icon={Boxes}
            title="Enter a repo to browse its skills"
            description="Skills are scoped per repo. Type a repo above to list the skills your agent has learned there."
          />
        ) : query.isError ? (
          <Alert intent="warning" title="Could not load skills">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No skills found for this repo"
            description={`Your agent has not learned any skills under "${repoId}" yet.`}
          />
        ) : (
          <div className="space-y-2">
            <Card>
              <DataTable columns={columns} data={skills} rowKey={(row) => row.id} />
            </Card>
            {truncated ? (
              <p className="text-muted-foreground text-xs">
                Showing the first {skills.length} skills. Narrow the repo to see more.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </PageShell>
  );
}
