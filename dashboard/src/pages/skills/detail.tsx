import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card, Input, PageShell } from '@usetheo/ui';

import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useSkill, useSkillInstructions, useInvalidateSkills } from '@/hooks/skills/use-skills';
import {
  deleteSkill,
  promotionRefusal,
  setSkillLifecycle,
} from '@/hooks/skills/skills-api';

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
  /** M32 — o eixo editorial. Ausente num registro mais antigo; ausência ≠ `active`. */
  readonly lifecycle?: 'active' | 'draft' | 'deprecated';
  readonly deprecation_reason?: string | null;
  readonly superseded_by?: string | null;
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

  // B-052 — esta chave colidia com a de `overview.tsx`, que punha um TOKEN DE
  // PAGINA no mesmo slot onde esta punha um id de skill.
  const skill = useSkill<SkillDetail>(skillId);

    const instructions = useSkillInstructions<Instructions>(skillId);

  const data = skill.data;

  // ---- M32 — o ciclo de vida --------------------------------------------------------------
  const invalidarSkills = useInvalidateSkills();
  const [motivo, setMotivo] = useState('');
  const [sucessora, setSucessora] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [erroCiclo, setErroCiclo] = useState<string | null>(null);

  const mudarCiclo = useMutation({
    mutationFn: (v: { lifecycle: 'active' | 'draft' | 'deprecated'; reason: string; supersededBy: string }) =>
      setSkillLifecycle(skillId, v.lifecycle, v.reason, v.supersededBy),
    onSuccess: () => {
      setErroCiclo(null);
      setConfirmar(false);
      setMotivo('');
      setSucessora('');
      // B-052 — invalida a RAIZ do dominio. As chaves literais que estavam aqui
      // deixaram de ser lidas no instante em que as paginas migraram: manter uma
      // delas seria invalidar o que ninguem le, e a lista mostraria dado velho.
      invalidarSkills();
    },
    onError: (err) => {
      setConfirmar(false);
      setErroCiclo(promotionRefusal(err, "Could not change this skill's lifecycle."));
    },
  });

  const cicloAtual = data?.lifecycle;

  // ---- M31 — a exclusão -------------------------------------------------------------------
  const navigate = useNavigate();
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const apagar = useMutation({
    mutationFn: () => deleteSkill(skillId),
    onSuccess: () => {
      // B-052 — invalida a RAIZ do dominio. As chaves literais que estavam aqui
      // deixaram de ser lidas no instante em que as paginas migraram: manter uma
      // delas seria invalidar o que ninguem le, e a lista mostraria dado velho.
      invalidarSkills();
      // Volta ao acervo: permanecer num detalhe que não existe mais mostraria uma tela de erro
      // como resultado de uma operação bem-sucedida.
      void navigate('/skills');
    },
    onError: (err) => {
      setConfirmarExclusao(false);
      setErroExclusao(promotionRefusal(err, 'Could not delete this skill.'));
    },
  });

  return (
    <PageShell
      title={data?.name ?? skillId}
      description={data?.description ?? "The skill's detail in this workspace's registry."}
      primaryAction={undefined}
    >
      {/* Volta ao acervo. Sem ela, chegar aqui pelo catálogo ou pela descoberta deixava o
          operador dependente do botão do navegador — e o item de menu leva ao overview, que
          não é a origem de quem veio de uma busca.

          Medido no app-dev em 2026-08-04: nenhuma das duas rotas aninhadas da capacidade tinha
          saída, contra o critério do M31 que pede volta à origem em toda rota aninhada. */}
      <Link to="/skills" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to the registry
      </Link>

      {skill.error ? (
        <Alert
          intent="destructive"
          title="Could not load this skill"
          description="The read failed. This does NOT mean the skill stopped existing."
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Identification</h2>
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Identifier</dt>
              <dd className="font-mono text-sm">{data?.skill_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Latest revision</dt>
              <dd className="font-mono text-sm">{data?.latest_revision_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Category</dt>
              <dd className="text-sm">{data?.category ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Execution</dt>
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
            <Link to={`/skills/${encodeURIComponent(skillId)}/versions`}>View versions and channels</Link>
          </Button>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Resolved instruction</h2>
          </Card.Title>
          <Card.Description>
            The text an agent would load when resolving this skill — not an editorial preview.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          {instructions.error ? (
            <Alert
              intent="warning"
              title="This skill does not deliver instructions by loading"
              description="It runs on the client machine and ships a script; the instructions reference files a remote agent does not have. Install it through the CLI instead of loading it."
            />
          ) : instructions.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
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
            <p className="text-sm text-muted-foreground">No instruction available.</p>
          )}
        </Card.Body>
      </Card>
      {/* ---- M32 — ciclo de vida (AC5) ------------------------------------------------ */}
      {erroCiclo !== null ? (
        <Alert intent="destructive" title="The change was not applied" description={erroCiclo} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Lifecycle</h2>
          </Card.Title>
          <Card.Description>
            Deprecating <strong>does not remove</strong> the skill, nor break whoever already references it — it
            keeps being loaded by anyone asking for it by identifier. What changes is{' '}
            <strong>discovery</strong>: it stops appearing for people searching without knowing the name.
          </Card.Description>
        </Card.Header>

        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current state:</span>
            {/* Texto, nunca só cor. E ausente não vira "em uso": um registro mais antigo
                simplesmente não devolve o campo, e ausência não é o mesmo que estar ativa. */}
            {cicloAtual === undefined ? (
              <span className="text-muted-foreground">not reported by this registry</span>
            ) : (
              <Badge
                variant={
                  cicloAtual === 'active' ? 'success' : cicloAtual === 'deprecated' ? 'warning' : 'outline'
                }
              >
                {cicloAtual === 'active' ? 'in use' : cicloAtual === 'deprecated' ? 'deprecated' : 'draft'}
              </Badge>
            )}
          </div>

          {cicloAtual === 'deprecated' ? (
            <div className="flex flex-col gap-1 text-sm">
              {data?.deprecation_reason ? (
                <span className="text-muted-foreground">Reason: {data.deprecation_reason}</span>
              ) : null}
              {data?.superseded_by ? (
                <Link
                  to={`/skills/${encodeURIComponent(data.superseded_by)}`}
                  className="underline-offset-4 hover:underline"
                >
                  Superseded by {data.superseded_by}
                </Link>
              ) : null}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mudarCiclo.isPending}
                  onClick={() => mudarCiclo.mutate({ lifecycle: 'active', reason: '', supersededBy: '' })}
                >
                  Put back in circulation
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                // Motivo é exigido AQUI e no BFF. Aqui para o operador não descobrir a regra
                // pelo erro; lá porque a fronteira não pode confiar na tela.
                if (motivo.trim() === '') return;
                setConfirmar(true);
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span>Why is it being deprecated?</span>
                <Input
                  aria-label="Deprecation reason"
                  placeholder="e.g. superseded by a version that also reads PDF"
                  value={motivo}
                  onChange={(ev) => setMotivo(ev.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Successor (optional)</span>
                <Input
                  aria-label="Successor skill"
                  placeholder="skill identifier"
                  value={sucessora}
                  onChange={(ev) => setSucessora(ev.target.value)}
                />
              </label>
              <Button type="submit" variant="destructive" disabled={motivo.trim() === '' || mudarCiclo.isPending}>
                Deprecate
              </Button>
            </form>
          )}
        </div>
      </Card>

      {/* ---- M31 — DangerZone (DESIGN.md §16) ----------------------------------------- */}
      {erroExclusao !== null ? (
        <Alert intent="destructive" title="The skill was not deleted" description={erroExclusao} />
      ) : null}

      <Card className="border-destructive/40">
        <Card.Header>
          <Card.Title asChild>
            <h2>Danger zone</h2>
          </Card.Title>
          <Card.Description>
            Deleting <strong>reserves the identifier</strong>: no future skill will be able to use{' '}
            <code className="font-mono text-xs">{skillId}</code>, and whoever references it by that name
            starts getting errors. <strong>There is no way to undo this.</strong>
          </Card.Description>
        </Card.Header>
        <div className="flex flex-col gap-2 px-6 pb-6">
          {/* A alternativa REVERSÍVEL vem antes do botão destrutivo, não depois: quem chegou aqui
              querendo "tirar de circulação" precisa saber que existe um caminho que não quebra
              quem já usa. Oferecer só depois de apagar seria tarde. */}
          {cicloAtual !== 'deprecated' ? (
            <p className="text-sm text-muted-foreground">
              If you only want to stop recommending it, <strong>deprecating</strong> (above) does
              that without breaking whoever already references it — and it can be undone.
            </p>
          ) : null}
          <div>
            <Button variant="destructive" onClick={() => setConfirmarExclusao(true)} disabled={apagar.isPending}>
              Delete this skill
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmarExclusao}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmarExclusao(false);
        }}
        title={`Delete "${data?.name ?? skillId}"?`}
        description={
          <>
            Every agent that loads it by identifier starts getting an error on the next resolution.
            The identifier <code className="font-mono text-xs">{skillId}</code> becomes{' '}
            <strong>reserved</strong> — no future skill will be able to use it.{' '}
            <strong>This action cannot be undone.</strong>
          </>
        }
        confirmLabel="Delete skill"
        intent="destructive"
        confirmationPhrase={skillId}
        loading={apagar.isPending}
        onConfirm={() => apagar.mutate()}
      />

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmar(false);
        }}
        title={`Deprecate "${data?.name ?? skillId}"?`}
        description={
          <>
            It <strong>stops appearing</strong> for people searching without knowing the name. Whoever
            already references it by identifier keeps loading it normally — nothing breaks today. The
            reason you wrote stays visible to whoever finds it later.
          </>
        }
        confirmLabel="Deprecate skill"
        intent="destructive"
        // A frase é o identificador: é o que distingue esta skill de outra com nome parecido.
        confirmationPhrase={skillId}
        loading={mudarCiclo.isPending}
        onConfirm={() =>
          mudarCiclo.mutate({ lifecycle: 'deprecated', reason: motivo.trim(), supersededBy: sucessora.trim() })
        }
      />
    </PageShell>
  );
}
