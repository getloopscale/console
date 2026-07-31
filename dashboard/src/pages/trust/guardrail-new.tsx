import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, PageShell } from '@usetheo/ui';

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
  const currentSpec = useMemo(() => JSON.stringify(toCreateBody(current)), [current]);

  // O coração da tela: o veredito só vale para a spec que o produziu.
  const verdictIsCurrent = testedSpec !== null && testedSpec === currentSpec;
  // `busy` NÃO entra aqui de propósito: durante o save o botão precisa continuar renderizado
  // para mostrar progresso (`DESIGN.md § 2.2`). O que ele não pode é ser clicado de novo —
  // e disso cuida o `disabled` abaixo.
  const canSave = verdictIsCurrent && problems.length === 0;

  async function onTest() {
    setBusy('testing');
    setError(null);
    try {
      const result = await testGuardrail<DryRunVerdict>(toTestBody(current, sample));
      setVerdict(result ?? null);
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

  const summary = verdictIsCurrent ? verdictSummary(verdict) : null;

  return (
    <PageShell
      title="Nova guardrail"
      description="Os termos abaixo passam a ser bloqueados nas conversas deste workspace assim que a regra for salva."
    >
      <Card>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Nome</span>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={draft.name}
              aria-label="Nome"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Termos a bloquear (um por linha)</span>
            <textarea
              className="w-full rounded border px-3 py-2 font-mono text-sm"
              rows={4}
              value={termsText}
              aria-label="Termos a bloquear"
              onChange={(e) => setTermsText(e.target.value)}
            />
          </label>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">O que fazer ao encontrar</legend>
            <label className="mr-4 text-sm">
              <input
                type="radio"
                name="action"
                checked={draft.action === 'block'}
                onChange={() => setDraft((d) => ({ ...d, action: 'block' }))}
              />{' '}
              Bloquear a mensagem
            </label>
            <label className="text-sm">
              <input
                type="radio"
                name="action"
                checked={draft.action === 'modify'}
                onChange={() => setDraft((d) => ({ ...d, action: 'modify' }))}
              />{' '}
              Substituir o termo
            </label>
          </fieldset>

          {draft.action === 'modify' ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Substituir por</span>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={draft.replacement}
                aria-label="Substituir por"
                onChange={(e) => setDraft((d) => ({ ...d, replacement: e.target.value }))}
              />
            </label>
          ) : null}

          {problems.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-medium">Teste antes de salvar</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Escreva uma mensagem de exemplo e veja o que aconteceria com ela. Este passo não altera
          nada — e é por ele que se chega ao salvar.
        </p>
        <textarea
          className="mb-3 w-full rounded border px-3 py-2 text-sm"
          rows={2}
          value={sample}
          aria-label="Mensagem de exemplo"
          onChange={(e) => setSample(e.target.value)}
        />
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={problems.length > 0 || busy !== 'idle'}
          onClick={() => void onTest()}
        >
          {busy === 'testing' ? 'Testando…' : 'Testar'}
        </button>

        {summary ? (
          <p className="mt-3 rounded bg-muted p-3 text-sm" role="status">
            {summary}
          </p>
        ) : null}

        {testedSpec !== null && !verdictIsCurrent ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            A regra mudou depois do teste. Teste de novo para poder salvar.
          </p>
        ) : null}
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
          <p className="mb-3 text-sm">
            Ao salvar, {cleanTerms(current.terms).length} termo(s) passam a valer imediatamente nas
            conversas deste workspace.
          </p>
          <button
            type="button"
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={busy !== 'idle'}
            onClick={() => void onSave()}
          >
            {busy === 'saving' ? 'Salvando…' : 'Salvar e ativar'}
          </button>
        </Card>
      ) : null}
    </PageShell>
  );
}
