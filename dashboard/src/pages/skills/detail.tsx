import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, PageShell } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { fetchSkill, fetchSkillInstructions } from '@/components/skills/skills-api';

/**
 * M26 — `/skills/:skillId`: uma skill, e a instrução que um agente de fato carregaria.
 *
 * A instrução resolvida é o FIM da jornada de leitura, e ela está aqui de propósito: sem ver o
 * texto, o operador não tem como julgar se a revisão vigente é a que ele quer promover — e a
 * promoção passaria a ser um ato às cegas sobre um identificador opaco.
 *
 * O serviço recusa a instrução de uma skill `local` com um código tipado
 * (`execution_is_local`, 422), porque ela traz script e referencia arquivos que o agente remoto
 * não tem. Essa recusa é EXIBIDA como diagnóstico, não escondida atrás de "erro ao carregar":
 * é a diferença entre o operador entender a natureza da skill e achar que o sistema falhou.
 */

interface SkillDetail {
  readonly skill_id: string;
  readonly name: string;
  readonly description: string;
  readonly state: string;
  readonly latest_revision_id: string | null;
  readonly category?: string;
  readonly execution?: string;
  readonly create_time: string;
  readonly update_time: string;
}

interface Instructions {
  readonly skill_id: string;
  readonly instructions: string;
  readonly execution: string;
  readonly origin: 'own' | 'public';
}

export function SkillDetailPage() {
  const { skillId = '' } = useParams();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle(`Skill — ${skillId}`), [setPageTitle, skillId]);
  useRequireAuth();

  const skill = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', skillId],
    queryFn: () => fetchSkill<SkillDetail>(skillId),
    enabled: skillId !== '',
  });

  const instructions = useQuery({
    queryKey: ['cloud', '/v1/dashboard/skills', skillId, 'instructions'],
    queryFn: () => fetchSkillInstructions<Instructions>(skillId),
    enabled: skillId !== '',
    // Uma skill `local` responde 422 por CONTRATO, não por falha: repetir a chamada não muda
    // a resposta e só gasta a paciência de quem espera a tela.
    retry: false,
  });

  const data = skill.data;

  return (
    <PageShell
      title={data?.name ?? skillId}
      description={data?.description ?? 'Detalhe da skill no registro deste workspace.'}
      primaryAction={undefined}
    >
      {skill.error ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar esta skill"
          description="A leitura falhou. Isto NÃO significa que a skill deixou de existir."
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Identificação</h2>
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Identificador</dt>
              <dd className="font-mono text-sm">{data?.skill_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Revisão mais recente</dt>
              <dd className="font-mono text-sm">{data?.latest_revision_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Categoria</dt>
              <dd className="text-sm">{data?.category ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Execução</dt>
              <dd className="text-sm">
                {data?.execution ? <Badge variant="outline">{data.execution}</Badge> : '—'}
              </dd>
            </div>
          </dl>
        </Card.Body>
        <Card.Footer>
          {/* O caminho para a próxima etapa da jornada — versões e canais. Sem ele o detalhe
              seria terminal, e o operador teria de descobrir a URL sozinho. */}
          <Button asChild>
            <Link to={`/skills/${encodeURIComponent(skillId)}/versions`}>Ver versões e canais</Link>
          </Button>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Instrução resolvida</h2>
          </Card.Title>
          <Card.Description>
            O texto que um agente carregaria ao resolver esta skill — não uma prévia editorial.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          {instructions.error ? (
            <Alert
              intent="warning"
              title="Esta skill não entrega instrução por carregamento"
              description="Ela roda na máquina do cliente e traz script; as instruções referenciam arquivos que um agente remoto não tem. Instale-a pela CLI em vez de carregá-la."
            />
          ) : instructions.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : instructions.data ? (
            <>
              <p className="mb-2 text-sm text-muted-foreground">
                Origem:{' '}
                {/* `origin` não é enfeite: uma skill pública é instrução de TERCEIRO que o agente
                    vai seguir, e essa é justamente a decisão de quem a carrega. */}
                <Badge variant={instructions.data.origin === 'public' ? 'warning' : 'outline'}>
                  {instructions.data.origin === 'public' ? 'publicada por terceiro' : 'deste workspace'}
                </Badge>
              </p>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">
                {instructions.data.instructions}
              </pre>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sem instrução disponível.</p>
          )}
        </Card.Body>
      </Card>
    </PageShell>
  );
}
