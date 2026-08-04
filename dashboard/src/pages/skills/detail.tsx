import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, PageShell } from '@usetheo/ui';

import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  deleteSkill,
  fetchSkill,
  fetchSkillInstructions,
  promotionRefusal,
  setSkillLifecycle,
} from '@/components/skills/skills-api';

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

  // ---- M32 — o ciclo de vida --------------------------------------------------------------
  const queryClient = useQueryClient();
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
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills'] });
    },
    onError: (err) => {
      setConfirmar(false);
      setErroCiclo(promotionRefusal(err, 'Não foi possível mudar o ciclo de vida desta skill.'));
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
      void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills'] });
      // Volta ao acervo: permanecer num detalhe que não existe mais mostraria uma tela de erro
      // como resultado de uma operação bem-sucedida.
      void navigate('/skills');
    },
    onError: (err) => {
      setConfirmarExclusao(false);
      setErroExclusao(promotionRefusal(err, 'Não foi possível apagar esta skill.'));
    },
  });

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
      {/* ---- M32 — ciclo de vida (AC5) ------------------------------------------------ */}
      {erroCiclo !== null ? (
        <Alert intent="destructive" title="A mudança não foi aplicada" description={erroCiclo} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Ciclo de vida</h2>
          </Card.Title>
          <Card.Description>
            Descontinuar <strong>não remove</strong> a skill nem quebra quem já a referencia — ela
            continua sendo carregada por quem a pede pelo identificador. O que muda é a{' '}
            <strong>descoberta</strong>: ela deixa de aparecer para quem procura sem saber o nome.
          </Card.Description>
        </Card.Header>

        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Situação atual:</span>
            {/* Texto, nunca só cor. E ausente não vira "em uso": um registro mais antigo
                simplesmente não devolve o campo, e ausência não é o mesmo que estar ativa. */}
            {cicloAtual === undefined ? (
              <span className="text-muted-foreground">não informada por este registro</span>
            ) : (
              <Badge
                variant={
                  cicloAtual === 'active' ? 'success' : cicloAtual === 'deprecated' ? 'warning' : 'outline'
                }
              >
                {cicloAtual === 'active' ? 'em uso' : cicloAtual === 'deprecated' ? 'descontinuada' : 'rascunho'}
              </Badge>
            )}
          </div>

          {cicloAtual === 'deprecated' ? (
            <div className="flex flex-col gap-1 text-sm">
              {data?.deprecation_reason ? (
                <span className="text-muted-foreground">Motivo: {data.deprecation_reason}</span>
              ) : null}
              {data?.superseded_by ? (
                <Link
                  to={`/skills/${encodeURIComponent(data.superseded_by)}`}
                  className="underline-offset-4 hover:underline"
                >
                  Substituída por {data.superseded_by}
                </Link>
              ) : null}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mudarCiclo.isPending}
                  onClick={() => mudarCiclo.mutate({ lifecycle: 'active', reason: '', supersededBy: '' })}
                >
                  Voltar a circular
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
                <span>Por que está sendo descontinuada?</span>
                <Input
                  aria-label="Motivo da descontinuação"
                  placeholder="ex.: substituída por uma versão que também lê PDF"
                  value={motivo}
                  onChange={(ev) => setMotivo(ev.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Sucessora (opcional)</span>
                <Input
                  aria-label="Skill sucessora"
                  placeholder="identificador da skill"
                  value={sucessora}
                  onChange={(ev) => setSucessora(ev.target.value)}
                />
              </label>
              <Button type="submit" variant="destructive" disabled={motivo.trim() === '' || mudarCiclo.isPending}>
                Descontinuar
              </Button>
            </form>
          )}
        </div>
      </Card>

      {/* ---- M31 — DangerZone (DESIGN.md §16) ----------------------------------------- */}
      {erroExclusao !== null ? (
        <Alert intent="destructive" title="A skill não foi apagada" description={erroExclusao} />
      ) : null}

      <Card className="border-destructive/40">
        <Card.Header>
          <Card.Title asChild>
            <h2>Zona de perigo</h2>
          </Card.Title>
          <Card.Description>
            Apagar <strong>reserva o identificador</strong>: nenhuma skill futura poderá usar{' '}
            <code className="font-mono text-xs">{skillId}</code>, e quem a referencia por ele passa
            a receber erro. <strong>Não há como desfazer.</strong>
          </Card.Description>
        </Card.Header>
        <div className="flex flex-col gap-2 px-6 pb-6">
          {/* A alternativa REVERSÍVEL vem antes do botão destrutivo, não depois: quem chegou aqui
              querendo "tirar de circulação" precisa saber que existe um caminho que não quebra
              quem já usa. Oferecer só depois de apagar seria tarde. */}
          {cicloAtual !== 'deprecated' ? (
            <p className="text-sm text-muted-foreground">
              Se a intenção é só parar de recomendá-la, <strong>descontinuar</strong> (acima) faz
              isso sem quebrar quem já a referencia — e pode ser desfeito.
            </p>
          ) : null}
          <div>
            <Button variant="destructive" onClick={() => setConfirmarExclusao(true)} disabled={apagar.isPending}>
              Apagar esta skill
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmarExclusao}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmarExclusao(false);
        }}
        title={`Apagar "${data?.name ?? skillId}"?`}
        description={
          <>
            Todo agente que a carrega pelo identificador passa a receber erro na próxima resolução.
            O identificador <code className="font-mono text-xs">{skillId}</code> fica{' '}
            <strong>reservado</strong> — nenhuma skill futura poderá usá-lo.{' '}
            <strong>Esta ação não pode ser desfeita.</strong>
          </>
        }
        confirmLabel="Apagar skill"
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
        title={`Descontinuar "${data?.name ?? skillId}"?`}
        description={
          <>
            Ela <strong>deixa de aparecer</strong> para quem procura sem saber o nome. Quem já a
            referencia pelo identificador continua carregando normalmente — nada quebra hoje. O
            motivo que você escreveu fica visível para quem a encontrar depois.
          </>
        }
        confirmLabel="Descontinuar skill"
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
