import { Link } from 'react-router-dom';
import { ABAS, rotaDaAba } from '@/pages/promptly/detail-tabs';

interface Props {
  promptName: string;
  latestVersion: number | null;
  abaAtiva: string;
}

/**
 * O caminho de volta e as quatro abas do prompt.
 *
 * ## As abas vivem na ROTA, nunca em estado (M21 DoD-1)
 *
 * O endereço fica compartilhável, o botão voltar volta UMA aba e recarregar não
 * perde o lugar. Numa tela de onde sai uma promoção, perder o lugar ao recarregar
 * é perder o contexto da decisão que estava sendo tomada.
 *
 * Por isso os itens são `<Link>` e não botões: quem clica com o meio abre em
 * outra guia, e quem copia o endereço copia a aba.
 */
export function CabecalhoDoPrompt({ promptName, latestVersion, abaAtiva }: Props) {
  return (
    <>
    {/* Caminho de VOLTA explícito: sem ele o detalhe é uma sala sem porta. */}
    <div className="flex flex-wrap items-center gap-4">
      <Link to="/promptly" className="text-sm underline-offset-4 hover:underline">
        ← Catálogo de prompts
      </Link>
      {/* M12: as duas ações POR PROMPT ficam aqui, não no menu — uma entrada de menu para elas
          exigiria um nome que o menu não tem e levaria a lugar nenhum. */}
      {/* M14: o playground e alcancado DAQUI, nao do submenu — ele e sempre de UM prompt, e um
          item de menu levaria a uma tela que nao sabe de qual. */}
      <Link
        to={`/promptly/${encodeURIComponent(promptName)}/playground`}
        className="text-sm underline-offset-4 hover:underline"
      >
        Playground
      </Link>
      <Link
        to={`/promptly/${encodeURIComponent(promptName)}/diff`}
        className="text-sm underline-offset-4 hover:underline"
      >
        Comparar revisões
      </Link>
      <Link
        to={`/promptly/new?name=${encodeURIComponent(promptName)}&next=${(latestVersion ?? 0) + 1}`}
        className="text-sm underline-offset-4 hover:underline"
      >
        Nova revisão deste prompt
      </Link>
    </div>

    {/* M21 DoD-1 — as quatro perguntas. São quatro coisas diferentes sobre o mesmo objeto, e
        empilhá-las numa coluna fazia o operador rolar por três respostas que não pediu para
        chegar na que pediu. */}
    <nav aria-label="Seções do prompt" className="flex flex-wrap gap-1 border-b">
      {ABAS.map((aba) => (
        <Link
          key={aba.id}
          to={rotaDaAba(promptName, aba.id)}
          aria-current={abaAtiva === aba.id ? 'page' : undefined}
          title={aba.pergunta}
          className={
            abaAtiva === aba.id
              ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
              : 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
          }
        >
          {aba.rotulo}
        </Link>
      ))}
    </nav>
    </>
  );
}
