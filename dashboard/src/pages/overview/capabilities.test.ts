import { describe, it, expect } from 'vitest';
import { MENUS } from '@/components/layout/app-sidebar-menus';
import { CAPACIDADES, estadoDaCapacidade, type EstadoDaCapacidade } from './capabilities';

/**
 * A Overview é da PLATAFORMA, e o registro do menu é a única lista (B-112).
 *
 * ## O defeito que este arquivo trava
 *
 * Medido em 2026-08-10: `/` consumia `useProjects`, `useBuildStats` e billing — nada mais. O
 * menu declarava OITO capacidades sob `Capabilities` (Memory, Knowledge Base, Databases,
 * Workspace, Observability, Trust, Skills, Prompts) e **nenhuma** aparecia na tela inicial.
 *
 * A assimetria que tornava isso caro: cada capacidade já tinha a SUA página de overview —
 * `lens/`, `memory/`, `promptly/`, `rag/`. A plataforma tinha sete overviews de capacidade e
 * nenhuma de plataforma. Quem chegava concluía, da tela inicial, que o produto é um PaaS de
 * deploy.
 *
 * ## Por que quantificar sobre o REGISTRO
 *
 * Um teste que listasse as oito à mão passaria verde no dia em que a nona fosse criada e
 * esquecida — que é este mesmo defeito, um nível acima. O precedente está no próprio
 * repositório: `LENS_CAPABILITIES` foi criado no M70 para que *"a barra lateral e a grade da
 * Overview nunca divirjam"*. Aqui a mesma forma sobe um nível: um registro, dois consumidores.
 */

/** O grupo do menu que declara o que a plataforma oferece. */
function capacidadesDeclaradas(): { label: string; path: string }[] {
  const grupo = MENUS.main?.groups.find((g) => g.title === 'Capabilities');
  if (!grupo) throw new Error('o grupo `Capabilities` sumiu do registro do menu');
  return grupo.items.map((i) => ({ label: i.label, path: i.path }));
}

describe('as capacidades da Overview derivam do registro do menu', () => {
  it('toda capacidade declarada no menu tem um descritor na Overview', () => {
    const declaradas = capacidadesDeclaradas();

    expect(declaradas.length, 'o registro do menu não declara capacidade alguma').toBeGreaterThanOrEqual(8);

    const semCard = declaradas.filter((d) => !CAPACIDADES.some((c) => c.path === d.path));

    expect(
      semCard.map((d) => `${d.label} (${d.path})`),
      'Capacidade declarada no menu e AUSENTE da Overview.\n\n' +
        'A tela inicial é onde o produto se apresenta. Uma capacidade que não aparece nela é,\n' +
        'para quem chega, indistinguível de uma capacidade que não existe — e foi exatamente\n' +
        'assim que sete delas ficaram invisíveis até alguém reparar.\n\n' +
        'Acrescente o descritor em `capabilities.ts`. Ele exige um SINAL: um card que só repete\n' +
        'o nome e o link é a barra lateral desenhada de outro jeito, e não responde nada que o\n' +
        'menu já não responda.\n',
    ).toEqual([]);
  });

  it('nenhum descritor aponta para uma capacidade que o menu não declara', () => {
    // A contraparte. Sem ela, o primeiro caso passaria com um registro inflado por capacidades
    // que não existem mais — e a Overview passaria a prometer o que o produto não tem.
    const paths = new Set(capacidadesDeclaradas().map((d) => d.path));
    const orfas = CAPACIDADES.filter((c) => !paths.has(c.path)).map((c) => c.path);

    expect(orfas, 'descritor de uma capacidade que o menu não declara').toEqual([]);
  });

  it('os quatro estados são discriminados no TIPO, nunca deduzidos do texto', () => {
    // A lição de B-111, aplicada antes de o defeito existir: aquele item nasceu de um código que
    // decidia o campo de um erro lendo a mensagem humana, e quebrou em silêncio no dia em que as
    // frases mudaram. Aqui a tentação seria a mesma — distinguir "vazio" de "falhou" pela frase.
    //
    // `nao-lida` é o estado que mais importa manter separado: uma capacidade que aparece como
    // não adotada por falha de leitura convida o usuário a concluir que ela não serve para nada.
    const estados: EstadoDaCapacidade[] = ['em-uso', 'nao-adotada', 'nao-lida', 'em-breve'];
    expect(new Set(estados).size, 'dois estados colapsaram num só').toBe(4);
  });

  it('toda capacidade declara COMO obter o seu sinal — ou que não tem sinal', () => {
    // O que separa um overview de um segundo menu (decisão D1 de `platform-overview-plan.md`). Um card sem sinal não informa
    // estado; `em-breve` é a única ausência legítima, e ela é declarada.
    const semFonte = CAPACIDADES.filter((c) => c.sinal.tipo !== 'em-breve' && !('rota' in c.sinal));

    expect(
      semFonte.map((c) => c.path),
      'capacidade sem fonte de sinal — o card seria só nome e link, e isso é o menu de novo',
    ).toEqual([]);
  });
});

describe('o estado de uma capacidade nunca confunde ignorância com ausência', () => {
  const contagem = CAPACIDADES.find((c) => c.sinal.tipo === 'contagem')!.sinal;
  const presenca = CAPACIDADES.find((c) => c.sinal.tipo === 'presenca')!.sinal;

  it('leitura que FALHOU não vira "não adotada"', () => {
    // A asserção central da DoD-2, e a razão de ela existir: um card que diz "não adotada"
    // porque a leitura caiu convida o usuário a concluir que a capacidade não serve para nada —
    // e ele não volta para conferir. É a mesma distinção que este repositório defende em toda
    // superfície de leitura: "não consegui ler" ≠ "não há".
    expect(estadoDaCapacidade(contagem, { failed: true, loading: false, dados: null })).toBe('nao-lida');
    expect(estadoDaCapacidade(presenca, { failed: true, loading: false, dados: null })).toBe('nao-lida');
  });

  it('consulta ASSENTADA sem dado também é falha, não vazio', () => {
    // O caso que `system-status-indicator.tsx` documenta: um 2xx sem corpo, ou um erro que a
    // camada engoliu, chega como "assentada e vazia". Tratá-lo como capacidade não adotada é
    // publicar uma afirmação sobre o workspace a partir de uma resposta que não a sustenta.
    expect(estadoDaCapacidade(contagem, { failed: false, loading: false, dados: null })).toBe('nao-lida');
  });

  it('zero é zero — capacidade lida e genuinamente vazia é "não adotada"', () => {
    // A contraparte. Sem ela, o conserto acima poderia ter sido "tudo vira não-lida", e a tela
    // deixaria de distinguir quem nunca usou de quem não conseguiu ler.
    expect(
      estadoDaCapacidade(contagem, { failed: false, loading: false, dados: { total_memories: 0 } }),
    ).toBe('nao-adotada');
    expect(
      estadoDaCapacidade(contagem, { failed: false, loading: false, dados: { total_memories: 12 } }),
    ).toBe('em-uso');
  });

  it('`em-breve` ignora a consulta — não há o que ler', () => {
    const emBreve = CAPACIDADES.find((c) => c.sinal.tipo === 'em-breve')!.sinal;
    expect(estadoDaCapacidade(emBreve, { failed: true, loading: true, dados: null })).toBe('em-breve');
  });

  it('presença responde ADOÇÃO, e não finge quantidade', () => {
    expect(
      estadoDaCapacidade(presenca, { failed: false, loading: false, dados: { traffic: [] } }),
    ).toBe('nao-adotada');
    expect(
      estadoDaCapacidade(presenca, { failed: false, loading: false, dados: { traffic: [{}] } }),
    ).toBe('em-uso');
  });
});
