import type { ElementType } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@usetheo/ui';
import { MENUS } from '@/components/layout/app-sidebar-menus';
import { useCloudApi } from '@/hooks/use-api';
import { formatNumber } from '@/lib/formatting/format';
import {
  CAPACIDADES,
  estadoDaCapacidade,
  type Capacidade,
  type EstadoDaCapacidade,
} from './capabilities';

/**
 * O grid de capacidades da Overview (B-112).
 *
 * ## O defeito que ele fecha
 *
 * A tela `/` chamava-se Overview e era o overview de UM subsistema: `useProjects`,
 * `useBuildStats` e billing. As oito capacidades que o menu declara — Memory, Knowledge Base,
 * Databases, Workspace, Observability, Trust, Skills, Prompts — não apareciam nela. Quem chegava
 * concluía, da tela inicial, que o produto é um PaaS de deploy.
 *
 * ## De onde vem a lista, e por que não daqui
 *
 * O grid **itera o registro do menu**, não uma lista escrita neste arquivo. Uma lista local
 * passaria verde no dia em que a nona capacidade fosse criada e esquecida — que é este mesmo
 * defeito, um nível acima. `capabilities.ts` acrescenta o SINAL de cada uma, e
 * `capabilities.test.ts` reprova quando os dois divergem.
 *
 * O precedente é do próprio repositório: `LENS_CAPABILITIES` foi criado no M70 para que *"a barra
 * lateral e a grade da Overview nunca divirjam"*. Aqui a mesma forma sobe um nível.
 *
 * ## Por que cada card busca o seu próprio sinal (decisão D4 de `platform-overview-plan.md`)
 *
 * O grid renderiza do registro, sem esperar rede, e cada card degrada sozinho. O problema que o
 * item descreve é resolvido pelo GRID, não pelos números: bloquear a página mais visitada do
 * produto em sete requisições trocaria um defeito de descoberta por um de latência.
 */
export function CapabilityGrid() {
  const grupo = MENUS.main?.groups.find((g) => g.title === 'Capabilities');
  const itens = grupo?.items ?? [];

  if (itens.length === 0) return null;

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {itens.map((item) => (
        <CapabilityCard
          key={item.path}
          path={item.path}
          label={item.label}
          icon={item.icon}
          disponivel={!item.comingSoon}
        />
      ))}
    </ul>
  );
}

interface CapabilityCardProps {
  readonly path: string;
  readonly label: string;
  /** O mesmo `ElementType` que `MenuItem` declara — o ícone vem do registro, não daqui. */
  readonly icon?: ElementType;
  /** Vem do registro do menu (`comingSoon`) — a MESMA fonte que decide o link na barra lateral. */
  readonly disponivel: boolean;
}

function CapabilityCard({ path, label, icon: Icon, disponivel }: CapabilityCardProps) {
  const descritor: Capacidade | undefined = CAPACIDADES.find((c) => c.path === path);
  const sinal = descritor?.sinal;
  const rota = sinal && 'rota' in sinal ? sinal.rota : null;

  // As chaves de query são as MESMAS das páginas de capacidade (`['cloud', rota]`, decisão D3 de `platform-overview-plan.md`), então
  // abrir a Overview aquece o cache e clicar na capacidade renderiza sem esperar. A requisição não
  // é a mais — é mais cedo.
  const consulta = useCloudApi<unknown>(rota ?? '', { enabled: rota !== null });

  const estado = sinal
    ? estadoDaCapacidade(sinal, {
        falhou: consulta.error,
        carregando: consulta.loading,
        dados: consulta.data,
      })
    : null;

  const conteudo = (
    <>
      <div className="flex items-start gap-2.5">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden={true} /> : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{label}</h3>
          {descritor ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{descritor.resumo}</p>
          ) : null}
        </div>
        {disponivel ? (
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden={true} />
        ) : null}
      </div>
      <div className="mt-3">
        <SinalDoCard estado={estado} sinal={sinal} dados={consulta.data} />
      </div>
    </>
  );

  return (
    <li data-testid={`capability-card-${path}`}>
      <Card className={disponivel ? 'h-full transition-colors hover:border-primary/40' : 'h-full'}>
        <Card.Body className="p-4">
          {disponivel ? (
            <Link to={path} className="block focus-visible:outline-none">
              {conteudo}
            </Link>
          ) : (
            conteudo
          )}
        </Card.Body>
      </Card>
    </li>
  );
}

/**
 * A linha de estado do card.
 *
 * Os quatro estados são discriminados no TIPO e nunca deduzidos do texto — a lição do `B-111`,
 * onde um código decidia comportamento lendo a mensagem humana e quebrou em silêncio no dia em que
 * as frases mudaram.
 *
 * `nao-lida` é o que mais importa manter separado de `nao-adotada`: uma capacidade que aparece
 * como não adotada por causa de uma falha de leitura convida o usuário a concluir que ela não
 * serve para nada — e ele não volta para conferir.
 */
function SinalDoCard({
  estado,
  sinal,
  dados,
}: {
  readonly estado: EstadoDaCapacidade | 'carregando' | null;
  readonly sinal: Capacidade['sinal'] | undefined;
  readonly dados: unknown;
}) {
  if (estado === null) {
    // Capacidade no menu sem descritor. Não some da tela — some do SINAL, e `capabilities.test.ts`
    // é quem reprova. Esconder o card aqui trocaria uma falha de CI por uma omissão silenciosa.
    return <span className="text-xs text-muted-foreground">&mdash;</span>;
  }

  if (estado === 'carregando') {
    // Um card que ainda não sabe não afirma nada. A barra é a ausência de resposta, desenhada.
    return (
      <span
        aria-busy="true"
        aria-label="Loading"
        className="block h-3.5 w-16 animate-pulse rounded bg-muted"
      />
    );
  }

  if (estado === 'em-breve') {
    return <span className="text-xs font-medium text-muted-foreground">Coming soon</span>;
  }

  if (estado === 'nao-lida') {
    return <span className="text-xs font-medium text-warning">Couldn&apos;t load</span>;
  }

  if (estado === 'nao-adotada') {
    return <span className="text-xs text-muted-foreground">Not set up yet</span>;
  }

  if (sinal?.tipo === 'contagem') {
    const n = sinal.extrair(dados);
    // `n` não é `null` aqui: `estadoDaCapacidade` já teria devolvido `nao-lida`. O guarda existe
    // porque o tipo não sabe disso, e inventar um `0` seria publicar um número que ninguém leu.
    if (n === null) return <span className="text-xs font-medium text-warning">Couldn&apos;t load</span>;
    return (
      <span className="text-sm font-semibold text-foreground">
        {formatNumber(n, sinal.formato ?? 'grouped')}{' '}
        <span className="text-xs font-normal text-muted-foreground">{sinal.unidade}</span>
      </span>
    );
  }

  // `presenca`: responde ADOÇÃO e não finge quantidade. Somar os baldes de uma série para produzir
  // uma manchete atribuiria ao número uma janela que esta tela não declara.
  return <span className="text-xs font-medium text-success">In use</span>;
}
