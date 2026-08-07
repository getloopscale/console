import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, FormField, PageShell, Skeleton, Textarea } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { createRevision, runPlayground } from '@/hooks/promptly/promptly-api';
import {
  camposDeVariaveis,
  classificarFalha,
  podeRodar,
  type CampoVariavel,
  type Falha,
} from '@/pages/promptly/components/playground';
import { variaveisDoTexto } from '@/pages/promptly/components/preview';
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

  const [conteudo, setConteudo] = useState('');
  const [campos, setCampos] = useState<readonly CampoVariavel[]>([]);
  const [credencial, setCredencial] = useState('');
  const [saida, setSaida] = useState<SaidaModelo | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [recusaAoSalvar, setRecusaAoSalvar] = useState<string | null>(null);
  // M17 — a afinação desta execução, e o porquê da revisão que ela pode virar.
  const [temperatura, setTemperatura] = useState('');
  const [descricao, setDescricao] = useState('');


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
  const editado = prompt.data != null && conteudo !== prompt.data.content;
  const declaradas = useMemo(
    () => (editado ? variaveisDoTexto(conteudo) : ((prompt.data?.variables ?? []) as readonly string[])),
    [editado, conteudo, prompt.data],
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
    setCampos((atuais) => camposDeVariaveis(declaradas, atuais));
  }, [declaradas]);

  /**
   * M17 ADR-2 — a config com que se invoca é a MESMA que o salvar leva adiante.
   *
   * O laço fechado é o milestone inteiro: sem ele, a invocação rodaria com o padrão do
   * ambiente enquanto a revisão guardaria outra coisa. `temperature` ausente significa
   * "não afinei" — e aí nada é gravado, em vez de gravar um default que ninguém escolheu.
   */
  const configUsada = temperatura === '' ? null : { temperature: Number(temperatura) };

  const rodar = useMutation({
    mutationFn: () =>
      runPlayground<SaidaModelo>(
        promptName,
        conteudo,
        Object.fromEntries(campos.map((c) => [c.nome, c.valor])),
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

  const salvar = useMutation({
    mutationFn: () =>
      createRevision<unknown>(promptName, conteudo, {
        changeDescription: descricao.trim(),
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
      setRecusaAoSalvar('Não foi possível criar a revisão. Tente de novo em instantes.'),
  });

  const habilitado = podeRodar(campos, credencial) && !rodar.isPending;

  function alterarCampo(nome: string, valor: string) {
    setCampos((atuais) => atuais.map((c) => (c.nome === nome ? { ...c, valor } : c)));
  }

  return (
    <PageShell
      title={`Playground — ${promptName}`}
      description="Rode o prompt com valores de exemplo e veja a saída do modelo antes de promover."
    >
      {/* Caminho de VOLTA explícito — mesma razão do detalhe: sem ele a tela é uma
          sala sem porta, e o item de menu levaria ao overview, não a este prompt. */}
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to={`/promptly/${encodeURIComponent(promptName)}`}
          className="text-sm underline-offset-4 hover:underline"
        >
          ← Voltar ao prompt
        </Link>
      </div>

      {prompt.error ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar este prompt"
          description="A leitura falhou. Isso é diferente de o prompt não existir — recarregue a página."
        />
      ) : null}

      {recusaAoSalvar ? (
        <Alert intent="destructive" title="A revisão não foi criada" description={recusaAoSalvar} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Conteúdo</h2>
          </Card.Title>
          <Card.Description>
            O que estiver aqui é o que será rodado — e o que será salvo, se você salvar.
          </Card.Description>
        </Card.Header>
        <div className="space-y-4 p-6 pt-0">
          {prompt.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <FormField id="playground-conteudo">
              <FormField.Label>Conteúdo do prompt</FormField.Label>
              <FormField.Control>
                <Textarea
                  aria-label="Conteúdo do prompt"
                  className="min-h-32 font-mono text-sm"
                  value={conteudo}
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
            <h2>Valores de exemplo</h2>
          </Card.Title>
          <Card.Description>
            {declaradas.length === 0
              ? 'Este prompt não declara variáveis.'
              : 'Um campo por variável declarada pelo prompt.'}
          </Card.Description>
        </Card.Header>
        <div className="space-y-4 p-6 pt-0">
          {campos.map((campo) => (
            <FormField key={campo.nome} id={`playground-var-${campo.nome}`}>
              <FormField.Label>{campo.nome}</FormField.Label>
              <FormField.Control>
                <input
                  aria-label={campo.nome}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                  value={campo.valor}
                  onChange={(e) => alterarCampo(campo.nome, e.target.value)}
                />
              </FormField.Control>
              {falha?.tipo === 'validacao' && falha.variavelFaltante === campo.nome ? (
                <FormField.Error>Preencha este campo antes de rodar.</FormField.Error>
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
                placeholder="deixe vazio para não afinar"
              />
            </FormField.Control>
            <FormField.Hint>
              Esta afinação é usada ao rodar E gravada ao salvar. Vazio significa
              &quot;não afinei&quot; — nada é gravado, em vez de um default que ninguém escolheu.
            </FormField.Hint>
          </FormField>

          <FormField id="playground-descricao">
            <FormField.Label>Por que esta revisão existe</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Por que esta revisão existe"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                maxLength={500}
                placeholder="afinei para extração"
              />
            </FormField.Control>
          </FormField>

          <FormField id="playground-credencial">
            <FormField.Label>Chave de API do modelo</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Chave de API do modelo"
                type="password"
                autoComplete="off"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                value={credencial}
                onChange={(e) => setCredencial(e.target.value)}
                placeholder="sk-..."
              />
            </FormField.Control>
            <FormField.Hint>
              A chave é usada só nesta execução e não fica guardada em lugar nenhum — nem aqui, nem
              no servidor. Recarregar a página pede a chave de novo.
            </FormField.Hint>
          </FormField>

          {/*
            O aviso PRECEDE o botão de propósito. Este é o primeiro controle
            faturável numa tela de autoria do produto, e a frase nomeia a
            consequência ("consome a quota da sua chave"), não a ação.
          */}
          <p className="text-sm text-muted-foreground" data-testid="playground-aviso-custo">
            Rodar chama o modelo de verdade e <strong>consome a quota da sua chave</strong>. Uma
            execução por clique.
          </p>

          <div className="flex gap-2">
            <Button onClick={() => rodar.mutate()} disabled={!habilitado}>
              {rodar.isPending ? 'Rodando…' : 'Rodar'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setRecusaAoSalvar(null);
                salvar.mutate();
              }}
              disabled={salvar.isPending || conteudo.trim() === ''}
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar como nova revisão'}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Saída</h2>
          </Card.Title>
        </Card.Header>
        <div className="p-6 pt-0" data-testid="playground-saida">
          <SaidaDoModelo pendente={rodar.isPending} falha={falha} saida={saida} />
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
            falha.mensagem ??
            `O provedor respondeu ${String(falha.providerStatus ?? '')} e recusou a invocação. Confira a chave e a quota da sua conta.`
          }
        />
      );
    }
    if (falha.tipo === 'validacao') {
      return (
        <Alert
          intent="destructive"
          title="Nada foi enviado ao modelo"
          description={
            falha.variavelFaltante !== undefined
              ? `A variável "${falha.variavelFaltante}" ficou em branco. Nenhuma chamada foi feita, e nada foi cobrado.`
              : (falha.motivo ??
                'O prompt não pôde ser preparado. Nenhuma chamada foi feita, e nada foi cobrado.')
          }
        />
      );
    }
    if (falha.tipo === 'sessao') {
      return (
        <Alert
          intent="destructive"
          title="Sua sessão expirou"
          description="Entre de novo para continuar. Isso não tem relação com a chave do modelo."
        />
      );
    }
    return (
      <Alert
        intent="destructive"
        title="Não foi possível falar com o serviço"
        description="A chamada não completou. Isso é diferente de o modelo ter recusado — tente de novo em instantes."
      />
    );
  }

  if (saida === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Rode para ver a saída do modelo aqui. Nada foi executado ainda.
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
