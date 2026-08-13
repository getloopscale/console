import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, FormField, PageShell, Skeleton, Textarea } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { createRevision, runPlayground } from '@/hooks/promptly/promptly-api';
import {
  variableFields,
  classificarFalha,
  canRun,
  type VariableField,
  type Falha,
} from '@/pages/promptly/components/playground';
import { textVariables } from '@/pages/promptly/components/preview';
import { usePrompt, useInvalidatePrompt } from '@/hooks/promptly/use-promptly';

interface PromptWire {
  readonly name: string;
  readonly content: string;
  readonly version: number;
  readonly variables?: readonly string[];
}

interface SaidaModelo {
  readonly text: string;
  readonly latencyMs?: number;
  readonly costUsd?: number;
}

/**
 * M14 — `/promptly/:promptName/playground`: rodar antes de prometer.
 *
 * Até aqui o operador escrevia e promovia sem nunca ver a saída: uma revisão
 * guarda nome, conteúdo, versão e autor — e nada que diga se **funciona**.
 *
 * Três decisões desta tela vieram de medir o que os peers fazem, e duas delas
 * são deliberadamente diferentes do que o peer faz:
 *
 *  - **o erro fica na área de saída, não num toast.** O `langfuse` colapsa recusa
 *    do provider e queda de rede em `err.message` num toast que some, e a área
 *    de saída volta a ficar vazia — indistinguível de "ainda não rodei". Aqui
 *    cada caso tem estado próprio e permanece na tela;
 *  - **os campos vêm de `variables`, que a API declara.** Nunca adivinhados do
 *    texto: é o mesmo contrato do preview de autoria do M12;
 *  - **a credencial vive em `useState` e em lugar nenhum além dele.** Sem
 *    `localStorage`, sem query string, sem cache de query. O preço é redigitar a
 *    cada sessão, e ele é conhecido: o ADR de credencial-por-requisição não
 *    compra um subsistema de segredos para poupar um campo.
 */
export function PromptlyPlaygroundPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Playground'), [setPageTitle]);
  useRequireAuth();

  const { promptName = '' } = useParams();
  const navigate = useNavigate();
  const invalidarPrompt = useInvalidatePrompt();

  const [content, setConteudo] = useState('');
  const [fields, setCampos] = useState<readonly VariableField[]>([]);
  const [credencial, setCredencial] = useState('');
  const [saida, setSaida] = useState<SaidaModelo | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [recusaAoSalvar, setRecusaAoSalvar] = useState<string | null>(null);
  // M17 — a afinação desta execução, e o porquê da revisão que ela pode virar.
  const [temperatura, setTemperatura] = useState('');
  const [description, setDescricao] = useState('');


  // B-052 — chave da factory, a mesma que `detail.tsx` usa para o mesmo prompt.
  // Antes eram duas tuplas escritas a mao que por sorte coincidiam; agora e
  // contrato.
  const prompt = usePrompt<PromptWire>(promptName);

  /**
   * De onde vem a lista de campos — e por que ela tem DOIS regimes.
   *
   * **Enquanto o conteúdo é o armazenado**, a lista é `variables`, declarada pelo
   * serviço (DoD-2). É o contrato: nunca adivinhada do texto.
   *
   * **Depois que o operador edita**, ela passa a acompanhar o texto editado. Sem
   * isso o fluxo central do milestone — editar, rodar, salvar — tem um beco sem
   * saída: acrescentar `{{fonte}}` ao texto deixaria "Rodar" habilitado (o cliente
   * só valida o que foi declarado), o servidor recusaria com `missing_variable:
   * fonte`, e **não haveria campo `fonte` na tela para preencher**. Recusa em
   * laço, sem saída.
   *
   * É o mesmo julgamento que a tela de autoria já faz (`create.tsx`): quando o
   * conteúdo está sendo digitado agora, ele é a única fonte que existe. E reusa a
   * mesma função — `variaveisDoTexto` — em vez de uma segunda derivação.
   */
  const editado = prompt.data != null && content !== prompt.data.content;
  const declaradas = useMemo(
    () => (editado ? textVariables(content) : ((prompt.data?.variables ?? []) as readonly string[])),
    [editado, content, prompt.data],
  );

  // Semeia o editor quando o prompt chega. Depois disso o operador é o dono do
  // texto — reescrever a cada render apagaria o que ele digitou.
  useEffect(() => {
    if (prompt.data === undefined || prompt.data === null) return;
    setConteudo(prompt.data.content);
  }, [prompt.data]);

  // Os campos acompanham a lista vigente, preservando o que já foi digitado para
  // as variáveis que sobreviveram.
  useEffect(() => {
    setCampos((atuais) => variableFields(declaradas, atuais));
  }, [declaradas]);

  /**
   * M17 ADR-2 — a config com que se invoca é a MESMA que o salvar leva adiante.
   *
   * O laço fechado é o milestone inteiro: sem ele, a invocação rodaria com o padrão do
   * ambiente enquanto a revisão guardaria outra coisa. `temperature` ausente significa
   * "não afinei" — e aí nada é gravado, em vez de gravar um default que ninguém escolheu.
   */
  const configUsada = temperatura === '' ? null : { temperature: Number(temperatura) };

  const run = useMutation({
    mutationFn: () =>
      runPlayground<SaidaModelo>(
        promptName,
        content,
        Object.fromEntries(fields.map((c) => [c.name, c.value])),
        credencial,
        configUsada,
      ),
    onSuccess: (out) => {
      setFalha(null);
      setSaida(out);
    },
    onError: (err: unknown) => {
      // A saída anterior é limpa: deixá-la na tela ao lado de um erro sugeriria
      // que ela veio desta execução.
      setSaida(null);
      setFalha(classificarFalha(err));
    },
  });

  const save = useMutation({
    mutationFn: () =>
      createRevision<unknown>(promptName, content, {
        changeDescription: description.trim(),
        // A config QUE ESTÁ NO CAMPO — a mesma que `rodar` usa. Uma versão anterior
        // gravava só a de uma execução bem-sucedida; era invariante minha, além do
        // ADR-2, e fazia a temperatura digitada sumir sem aviso quando o operador
        // salvava sem rodar. O que o ADR-2 exige é que a config chegue à INVOCAÇÃO,
        // e isso o adaptador entrega.
        modelConfig: configUsada,
      }),
    onSuccess: () => {
      // Invalidar ANTES de navegar. Sem isto o detalhe renderiza o cache anterior e a
      // revisão recém-criada **não aparece** — o DoD-6 promete que "o detalhe passa a
      // mostrá-la", e navegar sozinho não cumpre isso. O detalhe já faz o mesmo nas
      // escritas dele (`detail.tsx:142-143`); era esta tela que faltava.
      // B-052 — invalida o PROMPT pela hierarquia. A chave literal que estava
      // aqui deixou de ser lida no instante em que `detail.tsx` migrou: navegar
      // para o detalhe mostraria o cache anterior, e a revisao recem-criada NAO
      // apareceria — que e exatamente o que o DoD-6 promete que nao acontece.
      invalidarPrompt(promptName);
      navigate(`/promptly/${encodeURIComponent(promptName)}`);
    },
    onError: () =>
      setRecusaAoSalvar('Could not create the revision. Try again in a moment.'),
  });

  const habilitado = canRun(fields, credencial) && !run.isPending;

  function changeField(name: string, value: string) {
    setCampos((atuais) => atuais.map((c) => (c.name === name ? { ...c, value } : c)));
  }

  return (
    <PageShell
      title={`Playground — ${promptName}`}
      description="Run the prompt with sample values and see the model output before promoting."
    >
      {/* Caminho de VOLTA explícito — mesma razão do detalhe: sem ele a tela é uma
          sala sem porta, e o item de menu levaria ao overview, não a este prompt. */}
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to={`/promptly/${encodeURIComponent(promptName)}`}
          className="text-sm underline-offset-4 hover:underline"
        >
          ← Back to the prompt
        </Link>
      </div>

      {prompt.error ? (
        <Alert
          intent="destructive"
          title="Could not load this prompt"
          description="The read failed. That is different from the prompt not existing — reload the page."
        />
      ) : null}

      {recusaAoSalvar ? (
        <Alert intent="destructive" title="The revision was not created" description={recusaAoSalvar} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Content</h2>
          </Card.Title>
          <Card.Description>
            Whatever is here is what gets run — and what gets saved, if you save.
          </Card.Description>
        </Card.Header>
        <div className="space-y-4 p-6 pt-0">
          {prompt.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <FormField id="playground-conteudo">
              <FormField.Label>Prompt content</FormField.Label>
              <FormField.Control>
                <Textarea
                  aria-label="Prompt content"
                  className="min-h-32 font-mono text-sm"
                  value={content}
                  onChange={(e) => setConteudo(e.target.value)}
                />
              </FormField.Control>
            </FormField>
          )}
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Sample values</h2>
          </Card.Title>
          <Card.Description>
            {declaradas.length === 0
              ? 'This prompt declares no variables.'
              : 'One field per variable the prompt declares.'}
          </Card.Description>
        </Card.Header>
        <div className="space-y-4 p-6 pt-0">
          {fields.map((field) => (
            <FormField key={field.name} id={`playground-var-${field.name}`}>
              <FormField.Label>{field.name}</FormField.Label>
              <FormField.Control>
                <input
                  aria-label={field.name}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                  value={field.value}
                  onChange={(e) => changeField(field.name, e.target.value)}
                />
              </FormField.Control>
              {falha?.tipo === 'validacao' && falha.missingVariable === field.name ? (
                <FormField.Error>Fill this field before running.</FormField.Error>
              ) : null}
            </FormField>
          ))}

          <FormField id="playground-temperatura">
            <FormField.Label>Temperatura</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Temperatura"
                type="number"
                min={0}
                max={2}
                step={0.1}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                value={temperatura}
                onChange={(e) => setTemperatura(e.target.value)}
                placeholder="leave empty for no tuning"
              />
            </FormField.Control>
            <FormField.Hint>
              This tuning is used when running AND stored when saving. Empty means
              &quot;no tuning&quot; — nothing is stored, instead of a default nobody chose.
            </FormField.Hint>
          </FormField>

          <FormField id="playground-descricao">
            <FormField.Label>Why this revision exists</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Why this revision exists"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={description}
                onChange={(e) => setDescricao(e.target.value)}
                maxLength={500}
                placeholder="tuned for extraction"
              />
            </FormField.Control>
          </FormField>

          <FormField id="playground-credencial">
            <FormField.Label>Model API key</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Model API key"
                type="password"
                autoComplete="off"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                value={credencial}
                onChange={(e) => setCredencial(e.target.value)}
                placeholder="sk-..."
              />
            </FormField.Control>
            <FormField.Hint>
              The key is used only for this run and is not stored anywhere — not here, not on the
              server. Reloading the page asks for the key again.
            </FormField.Hint>
          </FormField>

          {/*
            O aviso PRECEDE o botão de propósito. Este é o primeiro controle
            faturável numa tela de autoria do produto, e a frase nomeia a
            consequência ("consome a quota da sua chave"), não a ação.
          */}
          <p className="text-sm text-muted-foreground" data-testid="playground-aviso-custo">
            Running calls the real model and <strong>consumes your key quota</strong>. One run
            per click.
          </p>

          <div className="flex gap-2">
            <Button onClick={() => run.mutate()} disabled={!habilitado}>
              {run.isPending ? 'Running…' : 'Run'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setRecusaAoSalvar(null);
                save.mutate();
              }}
              disabled={save.isPending || content.trim() === ''}
            >
              {save.isPending ? 'Saving…' : 'Save as a new revision'}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Output</h2>
          </Card.Title>
        </Card.Header>
        <div className="p-6 pt-0" data-testid="playground-saida">
          <SaidaDoModelo pendente={run.isPending} falha={falha} saida={saida} />
        </div>
      </Card>
    </PageShell>
  );
}

/**
 * A área de saída, com os estados separados.
 *
 * Vazio, pendente, erro-de-provider, erro-de-validação, sessão e transporte são
 * fatos diferentes e ganham texto diferente. O estado vazio diz que ainda não
 * rodou — nunca fica em branco, porque "em branco" é o que o operador veria se a
 * chamada tivesse falhado em silêncio.
 */
function SaidaDoModelo({
  pendente,
  falha,
  saida,
}: {
  readonly pendente: boolean;
  readonly falha: Falha | null;
  readonly saida: SaidaModelo | null;
}) {
  if (pendente) return <Skeleton className="h-24 w-full" />;

  if (falha !== null) {
    if (falha.tipo === 'provider') {
      return (
        <Alert
          intent="destructive"
          title="O provedor do modelo recusou a chamada"
          description={
            falha.message ??
            `The provider replied ${String(falha.providerStatus ?? '')} and refused the invocation. Check the key and the quota on your account.`
          }
        />
      );
    }
    if (falha.tipo === 'validacao') {
      return (
        <Alert
          intent="destructive"
          title="Nothing was sent to the model"
          description={
            falha.missingVariable !== undefined
              ? `Variable "${falha.missingVariable}" was left blank. No call was made, and nothing was charged.`
              : (falha.reason ??
                'The prompt could not be prepared. No call was made, and nothing was charged.')
          }
        />
      );
    }
    if (falha.tipo === 'sessao') {
      return (
        <Alert
          intent="destructive"
          title="Your session expired"
          description="Sign in again to continue. This is unrelated to the model key."
        />
      );
    }
    return (
      <Alert
        intent="destructive"
        title="Could not reach the service"
        description="The call did not complete. That is different from the model refusing — try again in a moment."
      />
    );
  }

  if (saida === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Run to see the model output here. Nothing has been executed yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm">
        {saida.text}
      </pre>
      <p className="text-xs text-muted-foreground">
        {saida.latencyMs !== undefined ? `${String(saida.latencyMs)} ms` : null}
        {saida.costUsd !== undefined ? ` · $${saida.costUsd.toFixed(4)}` : null}
      </p>
    </div>
  );
}
