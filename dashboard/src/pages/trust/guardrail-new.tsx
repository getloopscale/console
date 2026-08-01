import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import { Button, Card, FormField, Input, PageShell, Select, Textarea } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  createGuardrail,
  serviceCode,
  serviceMessage,
  testGuardrail,
} from '@/components/trust/trust-api';
import {
  EMPTY_DRAFT,
  cleanTerms,
  draftProblems,
  draftProblemsByField,
  toCreateBody,
  toTestBody,
  verdictSummary,
  type DryRunVerdict,
  type GuardrailDraft,
} from '@/components/trust/guardrail-draft';

/**
 * M24 T5.1 — criar uma guardrail, com o teste como PASSAGEM OBRIGATÓRIA.
 *
 * A decisão que define esta tela (ADR D1): **não existe caminho para gravar sem antes testar**.
 * Não é um botão desabilitado nem um aviso — a ação de gravar simplesmente não é renderizada
 * enquanto não houver veredito de dry-run da spec vigente.
 *
 * O prior art mostra o custo de fazer diferente. O Langfuse tem um belo diálogo de revisão com
 * diff… e um botão "Save" ao lado dele, que pula tudo. O PostHog testa a flag numa aba, depois
 * de ela já existir. Nenhum dos dois é modelo aqui, porque o objeto é diferente: uma guardrail
 * errada bloqueia conversa de produção inline, no instante em que é gravada.
 *
 * O veredito é amarrado à SERIALIZAÇÃO da spec testada. Editar qualquer campo o invalida — mas
 * reescrever um campo com o mesmo valor, não. É a diferença entre "testou esta spec" e "clicou
 * em testar em algum momento".
 */
export function TrustGuardrailNewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust — nova guardrail'), [setPageTitle]);
  useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<GuardrailDraft>(EMPTY_DRAFT);
  const [termsText, setTermsText] = useState('');
  const [sample, setSample] = useState('');
  const [verdict, setVerdict] = useState<DryRunVerdict | null>(null);
  /** A spec exata que foi testada. Enquanto bater com a atual, o veredito vale. */
  const [testedSpec, setTestedSpec] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'testing' | 'saving'>('idle');
  const [error, setError] = useState<{ title: string; description: string } | null>(null);

  const current: GuardrailDraft = useMemo(
    () => ({ ...draft, terms: termsText.split('\n') }),
    [draft, termsText],
  );

  const problems = draftProblems(current);
  const fieldProblems = draftProblemsByField(current);
  const currentSpec = useMemo(() => JSON.stringify(toCreateBody(current)), [current]);

  // O coração da tela: o veredito só vale para a spec que o produziu.
  const verdictIsCurrent = testedSpec !== null && testedSpec === currentSpec;
  const summary = verdictIsCurrent ? verdictSummary(verdict) : null;

  // `busy` NÃO entra aqui de propósito: durante o save o botão precisa continuar renderizado
  // para mostrar progresso (`DESIGN.md § 2.2`). O que ele não pode é ser clicado de novo —
  // e disso cuida o `disabled` abaixo.
  //
  // `summary` entra porque o DoD pede "mostra o RESULTADO antes de permitir a criação". Se o
  // serviço devolver uma ação que não sabemos traduzir (um `kind` novo, por exemplo),
  // `verdictSummary` responde null — e liberar o salvar ali daria ao operador a impressão de
  // que ele viu um veredito que a tela nunca mostrou. Achado do review do M24.
  const canSave = verdictIsCurrent && summary !== null && problems.length === 0;

  async function onTest() {
    setBusy('testing');
    setError(null);
    try {
      // O `/v1/validators:test` responde `{valid, result:{action, modified}}` — o veredito vem
      // ANINHADO. Ler `action` do topo devolveria sempre `undefined`, e a tela ficaria muda
      // depois de um teste bem-sucedido. Foi o e2e que pegou isto: o teste de unidade passava
      // porque o dobre dele devolvia o formato achatado, e não o do serviço.
      const response = await testGuardrail<{ result?: DryRunVerdict } & DryRunVerdict>(
        toTestBody(current, sample),
      );
      setVerdict(response?.result ?? response ?? null);
      setTestedSpec(currentSpec);
    } catch (err) {
      setVerdict(null);
      setTestedSpec(null);
      setError({
        title: 'O teste não pôde ser executado',
        description: serviceMessage(err, 'A guardrail não foi criada e nada mudou em produção.'),
      });
    } finally {
      setBusy('idle');
    }
  }

  async function onSave() {
    setBusy('saving');
    setError(null);
    try {
      await createGuardrail(toCreateBody(current));
      await queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/trust/validators'] });
      void navigate('/trust/guardrails');
    } catch (err) {
      const code = serviceCode(err);
      setError({
        title:
          code === 'VALIDATOR_NAME_RESERVED'
            ? 'Esse nome pertence à plataforma'
            : code === 'CONFLICT'
              ? 'Já existe uma guardrail com esse nome'
              : 'A guardrail não foi criada',
        // A mensagem do serviço nomeia o campo e o motivo; substituí-la por texto nosso
        // faria o operador tentar de novo exatamente igual.
        description: serviceMessage(err, 'O serviço recusou a criação e nada mudou em produção.'),
      });
      setBusy('idle');
    }
  }

  return (
    <PageShell
      title="Nova guardrail"
      description="Os termos abaixo passam a ser bloqueados nas conversas deste workspace assim que a regra for salva."
    >
      <Card>
        <div className="space-y-5">
          <FormField id="guardrail-name" invalid={Boolean(fieldProblems.name)}>
            <FormField.Label>Nome</FormField.Label>
            <FormField.Control>
              <Input
                aria-label="Nome"
                size="md"
                value={draft.name}
                placeholder="termos-internos"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </FormField.Control>
            {fieldProblems.name ? <FormField.Error>{fieldProblems.name}</FormField.Error> : null}
          </FormField>

          <FormField id="guardrail-terms" invalid={Boolean(fieldProblems.terms)}>
            <FormField.Label>Termos a bloquear</FormField.Label>
            <FormField.Control>
              <Textarea
                aria-label="Termos a bloquear"
                rows={4}
                className="font-mono"
                value={termsText}
                placeholder={'projeto-fenix\ncodinome-interno'}
                onChange={(e) => setTermsText(e.target.value)}
              />
            </FormField.Control>
            {fieldProblems.terms ? (
              <FormField.Error>{fieldProblems.terms}</FormField.Error>
            ) : (
              <FormField.Hint>Um termo por linha.</FormField.Hint>
            )}
          </FormField>

          <FormField id="guardrail-action">
            <FormField.Label>O que fazer ao encontrar</FormField.Label>
            <FormField.Control>
              <Select
                value={draft.action}
                onValueChange={(v) => setDraft((d) => ({ ...d, action: v as GuardrailDraft['action'] }))}
              >
                <Select.Trigger aria-label="O que fazer ao encontrar">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="block">Bloquear a mensagem</Select.Item>
                  <Select.Item value="modify">Substituir o termo</Select.Item>
                </Select.Content>
              </Select>
            </FormField.Control>
          </FormField>

          {draft.action === 'modify' ? (
            <FormField id="guardrail-replacement" invalid={Boolean(fieldProblems.replacement)}>
              <FormField.Label>Substituir por</FormField.Label>
              <FormField.Control>
                <Input
                  aria-label="Substituir por"
                  size="md"
                  value={draft.replacement}
                  onChange={(e) => setDraft((d) => ({ ...d, replacement: e.target.value }))}
                />
              </FormField.Control>
              {fieldProblems.replacement ? (
                <FormField.Error>{fieldProblems.replacement}</FormField.Error>
              ) : null}
            </FormField>
          ) : null}

        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-medium">Teste antes de salvar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escreva uma mensagem de exemplo e veja o que aconteceria com ela. Este passo não
              altera nada — e é por ele que se chega ao salvar.
            </p>
          </div>

          <FormField id="guardrail-sample">
            <FormField.Label>Mensagem de exemplo</FormField.Label>
            <FormField.Control>
              <Textarea
                aria-label="Mensagem de exemplo"
                rows={2}
                value={sample}
                placeholder="uma mensagem que contenha um dos termos acima"
                onChange={(e) => setSample(e.target.value)}
              />
            </FormField.Control>
          </FormField>

          <Button
            variant="secondary"
            disabled={problems.length > 0 || busy !== 'idle'}
            onClick={() => void onTest()}
          >
            <FlaskConical className="size-4" />
            {busy === 'testing' ? 'Testando…' : 'Testar'}
          </Button>

          {summary ? (
            <div role="status">
              <Alert intent="info" title={summary} />
            </div>
          ) : null}

          {testedSpec !== null && !verdictIsCurrent ? (
            <p className="text-sm text-muted-foreground" role="status">
              A regra mudou depois do teste. Teste de novo para poder salvar.
            </p>
          ) : null}
        </div>
      </Card>

      {error ? (
        <Alert intent="destructive" title={error.title} description={error.description} />
      ) : null}

      {/*
        A ação de gravar NÃO é renderizada sem veredito da spec vigente. Um botão desabilitado
        convidaria a procurar como habilitá-lo; a ausência diz que falta um passo, e o texto
        acima diz qual.
      */}
      {canSave ? (
        <Card>
          <div className="space-y-3">
            <p className="text-sm">
              Ao salvar, {cleanTerms(current.terms).length} termo(s) passam a valer imediatamente
              nas conversas deste workspace.
            </p>
            <Button disabled={busy !== 'idle'} onClick={() => void onSave()}>
              <ShieldCheck className="size-4" />
              {busy === 'saving' ? 'Salvando…' : 'Salvar e ativar'}
            </Button>
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}
