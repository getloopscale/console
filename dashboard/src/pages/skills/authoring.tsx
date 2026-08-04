import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Input, PageShell } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import {
  createSkill,
  fetchOperation,
  promotionRefusal,
  validateSkill,
  validationDiagnostic,
} from '@/components/skills/skills-api';

/**
 * M31 — `/skills/nova`: escrever uma skill sem publicar às cegas.
 *
 * O M30 entregou a API da autoria e ela ficou **sem consumidor**: `POST /v1/skills:validate` valida
 * sem efeito colateral e o erro traz `field` e `line` — e nada disso alcançava um autor, porque não
 * havia tela de autoria.
 *
 * A jornada é: escrever → **validar** (sem publicar) → corrigir com o erro posicionado → publicar
 * **acompanhando a operação** → testar a descoberta. O último passo importa: publicar e voltar à
 * lista deixaria o autor sem saber se a skill é encontrável, que é a única coisa que ele quer saber.
 */

const MODELO = `---
name: Converter moeda
description: Converte moeda estrangeira para reais usando a cotação do dia.
---

# Converter moeda

Quando o usuário pedir conversão de moeda, use a cotação do dia.
`;

interface ValidacaoOk {
  readonly ok: boolean;
  readonly name?: string;
  readonly description?: string;
  readonly execution?: string;
}

interface OperacaoEstado {
  readonly operation_id: string;
  readonly state?: string;
  readonly error?: string | null;
}

export function SkillAuthoringPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Nova skill'), [setPageTitle]);
  useRequireAuth();

  const [skillId, setSkillId] = useState('');
  const [conteudo, setConteudo] = useState(MODELO);
  const [diagnostico, setDiagnostico] = useState<{ message: string; field?: string; line?: number } | null>(null);
  const [validada, setValidada] = useState<ValidacaoOk | null>(null);
  const [operacaoId, setOperacaoId] = useState<string | null>(null);
  const [erroPublicacao, setErroPublicacao] = useState<string | null>(null);

  const validar = useMutation({
    mutationFn: () => validateSkill<ValidacaoOk>(conteudo),
    onSuccess: (data) => {
      setDiagnostico(null);
      setValidada(data);
    },
    onError: (err) => {
      setValidada(null);
      // O diagnóstico POSICIONADO — sem `field`/`line` o autor lê "inválido" e procura o problema
      // no texto inteiro.
      setDiagnostico(validationDiagnostic(err));
    },
  });

  const publicar = useMutation({
    mutationFn: () => createSkill<{ operation_id?: string }>(skillId.trim(), conteudo),
    onSuccess: (data) => {
      setErroPublicacao(null);
      setOperacaoId(typeof data?.operation_id === 'string' ? data.operation_id : null);
    },
    onError: (err) => setErroPublicacao(promotionRefusal(err, 'Não foi possível publicar.')),
  });

  // ACOMPANHA a operação em vez de anunciar sucesso no 202 — que significa "aceito", não "pronto".
  // Anunciar no aceite faria o autor procurar a skill num acervo onde ela ainda não está.
  const operacao = useQuery({
    queryKey: ['cloud', '/v1/dashboard/operations', operacaoId] as const,
    queryFn: () => fetchOperation<OperacaoEstado>(operacaoId ?? ''),
    enabled: operacaoId !== null,
    refetchInterval: (q) => {
      const estado = (q.state.data as OperacaoEstado | undefined)?.state;
      // Para de sondar em estado TERMINAL. Sem isto o polling seguiria para sempre numa aba
      // esquecida aberta, custando requisição por segundo sem ninguém lendo.
      return estado === 'succeeded' || estado === 'failed' ? false : 1500;
    },
  });

  const estado = operacao.data?.state;
  const concluida = estado === 'succeeded';
  const falhou = estado === 'failed';

  return (
    <PageShell
      title="Nova skill"
      description="Escreva, valide sem publicar, e publique acompanhando a operação."
    >
      <Link to="/skills" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Voltar ao acervo
      </Link>

      {erroPublicacao !== null ? (
        <Alert intent="destructive" title="A skill não foi publicada" description={erroPublicacao} />
      ) : null}

      {diagnostico !== null ? (
        <Alert
          intent="destructive"
          title="O conteúdo tem um problema"
          description={
            <>
              {diagnostico.message}
              {/* A POSIÇÃO é o que distingue um diagnóstico de um "inválido". */}
              {diagnostico.field !== undefined || diagnostico.line !== undefined ? (
                <span className="mt-1 block font-mono text-xs">
                  {diagnostico.field !== undefined ? `campo: ${diagnostico.field}` : null}
                  {diagnostico.field !== undefined && diagnostico.line !== undefined ? ' · ' : null}
                  {diagnostico.line !== undefined ? `linha ${diagnostico.line}` : null}
                </span>
              ) : null}
            </>
          }
        />
      ) : null}

      {validada !== null && operacaoId === null ? (
        <Alert
          intent="success"
          title="Conteúdo válido — nada foi publicado ainda"
          description={
            <>
              Lida como <strong>{validada.name}</strong>
              {validada.execution ? (
                <>
                  {' '}
                  · execução <Badge variant="outline">{validada.execution}</Badge>
                </>
              ) : null}
              . Dê um identificador abaixo e publique.
            </>
          }
        />
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Conteúdo</h2>
          </Card.Title>
          <Card.Description>
            O <code className="font-mono text-xs">SKILL.md</code> — frontmatter com{' '}
            <code className="font-mono text-xs">name</code> e{' '}
            <code className="font-mono text-xs">description</code>, e a instrução que o agente vai
            carregar.
          </Card.Description>
        </Card.Header>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <textarea
            aria-label="Conteúdo da skill"
            className="min-h-64 w-full rounded-md border bg-background p-3 font-mono text-xs"
            value={conteudo}
            onChange={(e) => {
              setConteudo(e.target.value);
              // Editar invalida a validação anterior: exibir "válido" sobre um texto que mudou
              // afirmaria algo que ninguém verificou.
              setValidada(null);
              setDiagnostico(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => validar.mutate()} disabled={validar.isPending}>
              {validar.isPending ? 'Validando…' : 'Validar sem publicar'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Validar não cria nada — é seguro repetir quantas vezes quiser.
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Publicar</h2>
          </Card.Title>
          <Card.Description>
            O identificador é permanente e aparece em logs e erros. Publicar é assíncrono: a
            ingestão gera os vetores que tornam a skill descobrível.
          </Card.Description>
        </Card.Header>
        <div className="flex flex-wrap items-end gap-2 px-6 pb-6">
          <label className="flex flex-col gap-1 text-sm">
            <span>Identificador</span>
            <Input
              aria-label="Identificador da skill"
              placeholder="ex.: converter-moeda"
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
            />
          </label>
          {/* Publicar exige ter VALIDADO antes: é o que impede publicar às cegas, que é o nome do
              critério. O botão desabilitado com o motivo ao lado ensina a regra sem erro. */}
          <Button
            onClick={() => publicar.mutate()}
            disabled={skillId.trim() === '' || validada === null || publicar.isPending || operacaoId !== null}
          >
            {publicar.isPending ? 'Enviando…' : 'Publicar'}
          </Button>
          {validada === null ? (
            <span className="text-xs text-muted-foreground">Valide o conteúdo antes de publicar.</span>
          ) : null}
        </div>
      </Card>

      {operacaoId !== null ? (
        <Card>
          <Card.Header>
            <Card.Title asChild>
              <h2>Publicação</h2>
            </Card.Title>
            <Card.Description>
              {/* O 202 significa ACEITO, não pronto. A tela mostra o estado real. */}
              {concluida
                ? 'Concluída — a skill já está no acervo e é descobrível.'
                : falhou
                  ? 'A ingestão falhou. A skill não está no acervo.'
                  : 'Em andamento — a ingestão está gerando os vetores da descoberta.'}
            </Card.Description>
          </Card.Header>
          <div className="flex flex-wrap items-center gap-2 px-6 pb-6">
            <Badge variant={concluida ? 'success' : falhou ? 'destructive' : 'outline'}>
              {estado ?? 'aguardando'}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{operacaoId}</span>

            {concluida ? (
              <>
                {/* O sucesso oferece TESTAR A DESCOBERTA, não "voltar à lista": saber se a skill é
                    encontrável é a única coisa que o autor quer saber depois de publicar. */}
                <Button asChild size="sm">
                  <Link to="/skills/descoberta">Testar a descoberta</Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/skills/${encodeURIComponent(skillId.trim())}`}>Ver a skill</Link>
                </Button>
              </>
            ) : null}

            {falhou && operacao.data?.error ? (
              <span className="text-xs text-destructive">{operacao.data.error}</span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}
