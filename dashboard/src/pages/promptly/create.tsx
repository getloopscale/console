import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, Card, FormField, PageShell, Textarea } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { createRevision } from '@/components/promptly/promptly-api';
import { validarCriacao, fraseDePermanencia } from '@/components/promptly/create-form';
import { camposDeVariaveis, renderTemplate, variaveisDoTexto } from '@/components/promptly/preview';
import { mensagemDeRecusa } from '@/components/promptly/rollback';

/**
 * M12 T3 — `/promptly/new`: autorar uma revisão.
 *
 * A tela que faltava para o catálogo deixar de ser um beco: até o M25 o operador via o que
 * existia e era mandado para a CLI para criar qualquer coisa.
 *
 * Duas coisas que a tela diz e que a API não obriga ninguém a dizer:
 *  - **a permanência**. Revisões são imutáveis e o produto não expõe `DELETE`. Descobrir isso
 *    depois de salvar é tarde;
 *  - **o render**. O preview mostra o texto com as variáveis substituídas ANTES de gravar, e é
 *    substituição local: nenhuma chamada a modelo, nenhum custo.
 */
export function PromptlyCreatePage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Nova revisão'), [setPageTitle]);
  useRequireAuth();

  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Vindo do detalhe de um prompt, o nome chega pronto e o operador não o redigita — redigitar
  // um nome é como se cria um prompt novo por engano.
  const nomeSugerido = params.get('name') ?? '';
  const proximaVersao = Number(params.get('next') ?? '1') || 1;

  const [nome, setNome] = useState(nomeSugerido);
  const [conteudo, setConteudo] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [recusa, setRecusa] = useState<string | null>(null);

  // `useMutation` e não `async/await` cru num handler: é a convenção do repositório para escritas
  // (`detail.tsx` faz assim na promoção e na reversão) e dispensa dois `useState` mantidos à mão.
  //
  // HONESTIDADE SOBRE O MOTIVO: eu troquei isto acreditando que resolveria os testes de recusa,
  // que o vitest reporta como rejeição não tratada. **Não resolveu** — o teste continua vermelho
  // pelo mesmo motivo depois da troca. A hipótese estava errada, e fica registrada como errada
  // para ninguém a repetir. A mudança permanece porque se sustenta sozinha (consistência com as
  // outras duas escritas do módulo, menos estado à mão), não pelo motivo que me trouxe até ela.
  const criar = useMutation({
    mutationFn: () => createRevision<unknown>(nome.trim(), conteudo),
    onSuccess: () => navigate(`/promptly/${encodeURIComponent(nome.trim())}`),
    onError: (err: unknown) => setRecusa(mensagemDeRecusa(err)),
  });

  const validacao = validarCriacao(nome);

  // As variáveis desta tela ainda não têm resposta da API para consultar — o conteúdo está sendo
  // digitado agora. Aqui, e SÓ aqui, elas são extraídas do texto; em toda tela de leitura a
  // lista vem de `variables`, que o serviço declara.
  const declaradas = useMemo(() => variaveisDoTexto(conteudo), [conteudo]);

  const campos = camposDeVariaveis(declaradas, conteudo);
  const renderizado = renderTemplate(conteudo, { ...campos, ...valores });

  function salvar() {
    if (!validacao.ok) return;
    setRecusa(null);
    criar.mutate();
  }

  return (
    <PageShell
      title="Nova revisão"
      description={fraseDePermanencia(nomeSugerido !== '', proximaVersao)}
    >
      {recusa ? (
        <Alert intent="destructive" title="A revisão não foi criada" description={recusa} />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Conteúdo</h2>
          </Card.Title>
          <Card.Description>
            Use <code>{'{{variavel}}'}</code> para os trechos que mudam a cada chamada.
          </Card.Description>
        </Card.Header>

        <div className="space-y-4 p-6 pt-0">
          <FormField id="promptly-nome">
            <FormField.Label>Nome do prompt</FormField.Label>
            <FormField.Control>
              <input
                aria-label="Nome do prompt"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                readOnly={nomeSugerido !== ''}
                placeholder="onboarding.welcome"
              />
            </FormField.Control>
            {nome !== '' && !validacao.ok ? (
              <FormField.Error>{validacao.erroNome}</FormField.Error>
            ) : null}
          </FormField>

          <FormField id="promptly-conteudo">
            <FormField.Label>Texto do prompt</FormField.Label>
            <FormField.Control>
              <Textarea
                aria-label="Texto do prompt"
                rows={12}
                className="font-mono text-sm"
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                placeholder={'Você é um assistente de {{produto}}. Responda em {{idioma}}.'}
              />
            </FormField.Control>
          </FormField>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Prever o resultado</h2>
          </Card.Title>
          <Card.Description>
            Substituição local — nenhuma chamada a modelo, nenhum custo. Campo em branco deixa o
            marcador à vista, para o buraco não passar despercebido.
          </Card.Description>
        </Card.Header>

        <div className="space-y-4 p-6 pt-0">
          {declaradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma variável no texto — o prompt é servido exatamente como está escrito.
            </p>
          ) : (
            declaradas.map((v) => (
              <FormField key={v} id={`promptly-var-${v}`}>
                <FormField.Label>{v}</FormField.Label>
                <FormField.Control>
                  <input
                    aria-label={v}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={valores[v] ?? ''}
                    onChange={(e) => setValores((atual) => ({ ...atual, [v]: e.target.value }))}
                  />
                </FormField.Control>
              </FormField>
            ))
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium">O que o modelo receberia</h3>
            <pre
              data-testid="promptly-preview"
              className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs"
            >
              {renderizado}
            </pre>
          </div>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button onClick={salvar} disabled={!validacao.ok || criar.isPending}>
          {criar.isPending ? 'Criando…' : `Criar revisão v${proximaVersao}`}
        </Button>
        {/* Saída explícita. Um formulário sem volta prende o operador na tela que ele abriu por
            engano — e aqui a tecla de escape é voltar, não gravar algo imutável. */}
        <Button variant="ghost" asChild>
          <Link to={nomeSugerido ? `/promptly/${encodeURIComponent(nomeSugerido)}` : '/promptly'}>
            Cancelar
          </Link>
        </Button>
      </div>
    </PageShell>
  );
}

export default PromptlyCreatePage;
