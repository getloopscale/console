import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { arquivosDoManifestoDeRotas } from '@/test/manifesto-de-rotas';

const SRC = resolve(__dirname, '..');
// B-003 — as rotas moraram todas em `app.tsx` até 2026-08-09. Ler só ele
// agora mediria um terço delas.
const ARQUIVOS_DE_ROTA = arquivosDoManifestoDeRotas();
const APP = ARQUIVOS_DE_ROTA.join('\n');
const MENUS = readFileSync(join(SRC, 'components/layout/app-sidebar-menus.ts'), 'utf8');

/**
 * B-069 / B-076 — uma rota que diz "ainda não construída" avisa ANTES do clique.
 *
 * ## O que o item alegava, e o que a medição achou
 *
 * O item afirma que trabalho incompleto é escondido **apagando a rota**, e cita
 * `pages/previews.tsx` como prova: um arquivo vivo, sem importador, cuja rota
 * fora removida. **A evidência envelheceu** — o arquivo já não existe (verificado
 * 2026-08-08), e a varredura por páginas sem rota E sem importador retorna
 * **zero**. `test-only-module-guard.test.ts` já cobre essa classe.
 *
 * O que existe é o oposto de esconder: **8 rotas navegáveis** renderizam
 * `SubPagePlaceholder`, uma tela que diz o que a página fará e oferece o comando
 * de CLI equivalente. É honesto — mas só **depois** do clique.
 *
 * ## O defeito medido
 *
 * Sete das oito estão no menu **sem nenhuma marca**. A pessoa lê "Members",
 * clica, e descobre. E em três casos é pior: o menu tem DUAS entradas para o
 * mesmo assunto, uma funcionando e outra em placeholder —
 *
 * - `Team` → `/team` (tela real) · `Members` → `/settings/members` (placeholder)
 * - `Billing` → `/billing` (tela real) · `Billing` → `/settings/billing` (placeholder)
 *
 * Duas entradas com o mesmo rótulo, uma delas mentindo por omissão.
 *
 * ## O que este teste exige
 *
 * Que toda rota com `SubPagePlaceholder` presente no menu esteja marcada
 * `comingSoon`. O selo já existe (`app-sidebar.tsx`), é anunciado por leitor de
 * tela, e foi construído para `/databases` — o que faltava era aplicá-lo aos
 * outros sete.
 *
 * Não exige o contrário: uma rota em placeholder pode legitimamente ficar FORA
 * do menu (alcançável só por link direto), e aí não há o que avisar.
 */

/** Rotas cujo `element` renderiza `SubPagePlaceholder`. */
export function rotasComPlaceholder(): string[] {
  const out: string[] = [];
  // Casa `path="…"` seguido, dentro do mesmo <Route>, de SubPagePlaceholder.
  // O `(?![\s\S]*?path=)` impede atravessar para a rota seguinte e atribuir o
  // placeholder de uma a outra — o erro que faria o teste medir a rota errada.
  // POR ARQUIVO, e não sobre a concatenação: a busca não pode atravessar a
  // fronteira entre dois arquivos de rota. Ver `routes/manifesto.ts`.
  for (const arquivo of ARQUIVOS_DE_ROTA) {
    for (const m of arquivo.matchAll(/path="([^"]+)"(?:(?!path=)[\s\S])*?SubPagePlaceholder/g)) {
      out.push(m[1]);
    }
  }
  return out;
}

/** A rota aparece no menu lateral? E está marcada como ainda não disponível? */
function noMenu(rota: string): { presente: boolean; marcada: boolean } {
  const alvo = `'${rota}'`;
  const i = MENUS.indexOf(alvo);
  if (i === -1) return { presente: false, marcada: false };
  // A marca vive no mesmo objeto literal — a janela cobre o item inteiro sem
  // alcançar o vizinho.
  const janela = MENUS.slice(i, i + 220);
  return { presente: true, marcada: janela.includes('comingSoon') };
}

describe('honestidade dos placeholders (B-069/B-076)', () => {
  it('toda rota-placeholder que está no menu avisa ANTES do clique', () => {
    const semAviso = rotasComPlaceholder()
      .filter((r) => {
        const m = noMenu(r);
        return m.presente && !m.marcada;
      })
      .sort();

    expect(
      semAviso,
      'Rota no menu que leva a "ainda não construída", sem avisar.\n\n' +
        'Quem avalia o produto conta o que está pronto pelo menu. Um item que\n' +
        'parece entregue e não está custa a confiança de quem clicou — e o custo\n' +
        'é maior quando existe outra entrada, com o mesmo assunto, que funciona.\n\n' +
        'Marque o item com `comingSoon: true` em `app-sidebar-menus.ts`. O selo\n' +
        'já existe e é anunciado por leitor de tela, não só visível.\n\n' +
        'Se a rota não deveria estar no menu, tire-a de lá — um placeholder\n' +
        'alcançável só por link direto não precisa de aviso.\n',
    ).toEqual([]);
  });

  it('todo item de menu aponta para uma rota que existe', () => {
    const rotas = new Set<string>();
    for (const m of APP.matchAll(/path="([^"]+)"/g)) {
      // O CATCH-ALL FICA DE FORA, e essa linha é o teste inteiro.
      //
      // `path="*"` é a rota de 404. Incluí-la faz o regex virar `^.*$`, que casa
      // QUALQUER caminho — e a asserção passa a não poder falhar. Foi o que
      // aconteceu na primeira versão: pus `/faturamento` no menu, uma rota que
      // não existe, e o teste ficou verde.
      //
      // A sonda é o que apanhou. Sem ela eu teria commitado um guard que afirma
      // detectar rota morta e detecta nada — a mesma tautologia que este
      // repositório já pagou três vezes hoje.
      if (m[1] !== '*') rotas.add(m[1]);
    }

    const mortos: string[] = [];
    for (const m of MENUS.matchAll(/label:\s*'([^']+)'[^}]*?path:\s*'([^']+)'/g)) {
      const [, label, path] = m;
      if (path.startsWith('http')) continue;
      // Casa rota exata ou paramétrica (`/projects/:name/...`).
      const existe = [...rotas].some((r) => {
        if (r === path) return true;
        const re = new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+').replace(/\*$/, '.*') + '$');
        return re.test(path);
      });
      if (!existe) mortos.push(`'${label}' → ${path}`);
    }

    expect(
      mortos,
      'Item de menu apontando para rota que não existe — clicar dá 404.\n\n' +
        'Esta asserção existe porque a correção que a motivou quase criou o\n' +
        'defeito: ao repontar `Members` e `Billing` para as telas reais, uma\n' +
        'rota digitada errado teria trocado "ainda não construída" por um 404,\n' +
        'que é pior — o placeholder ao menos diz o que fazer pela CLI.\n',
    ).toEqual([]);
  });

  it('não há duas entradas de menu para o mesmo assunto com uma em placeholder', () => {
    const placeholders = new Set(rotasComPlaceholder());
    const rotulos = new Map<string, string[]>();
    for (const m of MENUS.matchAll(/label:\s*'([^']+)'[^}]*?path:\s*'([^']+)'/g)) {
      const [, label, path] = m;
      rotulos.set(label, [...(rotulos.get(label) ?? []), path]);
    }

    const ambiguos: string[] = [];
    for (const [label, paths] of rotulos) {
      if (paths.length < 2) continue;
      const comPlaceholder = paths.filter((p) => placeholders.has(p));
      if (comPlaceholder.length > 0 && comPlaceholder.length < paths.length) {
        ambiguos.push(`'${label}': ${paths.join(' e ')} — placeholder em ${comPlaceholder.join(', ')}`);
      }
    }

    expect(
      ambiguos,
      'Duas entradas de menu com o MESMO rótulo, uma funcionando e outra em\n' +
        'placeholder.\n\n' +
        'Quem clica não tem como saber qual das duas é a real, e metade das vezes\n' +
        'conclui que a funcionalidade não existe. Uma das duas está errada:\n' +
        'aponte as duas para a tela real, ou remova a entrada em placeholder.\n',
    ).toEqual([]);
  });
});

/**
 * B-132/B-133 — as telas anunciavam comandos de CLI que não existem.
 *
 * Sete `cliCommand` estavam nas rotas; SEIS nomeavam algo que `theo-cli` não registra:
 * `billing status` (existe `billing`, com `portal` — não `status`), `notify` (nenhum comando
 * `notify` é registrado), `team delete` (existem list/add/remove/role/switch), `session`,
 * `account`, e a opção `--rotate-credentials` de `login` (as opções são
 * `--token/--team/--refresh-token/--expires-in/--device-flow`).
 *
 * O custo não é cosmético: a tela diz "use a CLI para fazer isto hoje" e a pessoa vai tentar. Uma
 * funcionalidade ausente que se admite ausente custa uma decepção; uma que aponta para um caminho
 * inexistente custa a decepção MAIS o tempo de descobrir que o caminho não existe — e alguma
 * confiança no resto do que a tela diz.
 *
 * ## Limite honesto deste guarda
 *
 * `theo-cli` é outro repositório e pode não estar clonado onde esta suíte roda, então este teste
 * NÃO o lê. Ele confere contra `COMANDOS_CONHECIDOS`, uma lista que este repositório mantém e que
 * foi MEDIDA em 2026-08-11 com
 * `grep -rho "\.command('[a-z:-]*'" theo-cli/src/register/*.ts`.
 *
 * Isso pega o que importa — uma tela inventando um comando — e NÃO pega `theo-cli` removendo um
 * que existia. Esse segundo caso é um item de ecossistema, não deste repo, e fingir que um teste
 * local o cobre seria a mesma classe de afirmação que ele existe para impedir.
 */
const COMANDOS_CONHECIDOS = new Set([
  'audit', 'auth', 'billing', 'build', 'connect', 'deploy', 'disconnect', 'doctor',
  'domain', 'env', 'login', 'logout', 'logs', 'preview', 'project', 'promote',
  'rollback', 'scale', 'secret', 'status', 'storage', 'team', 'validate', 'whoami',
]);

/** Subcomandos medidos por comando-pai. Ausência aqui = o pai não tem subcomandos declarados. */
const SUBCOMANDOS_CONHECIDOS: Record<string, Set<string>> = {
  billing: new Set(['portal']),
  team: new Set(['list', 'add', 'remove', 'role', 'switch']),
};

/**
 * Opções medidas, só para os comandos que alguma tela anuncia COM uma flag.
 *
 * A tabela é deliberadamente pequena: enumerar todas as opções de 24 comandos seria uma segunda
 * cópia da CLI dentro deste repo, e uma cópia que ninguém atualiza é pior que nenhuma. Ela cobre
 * exatamente o que as telas afirmam — que é o que este guarda existe para manter verdadeiro.
 *
 * `login` está aqui porque uma tela anunciava `theo login --rotate-credentials`, e as opções
 * medidas são `--token/--team/--refresh-token/--expires-in/--device-flow`.
 */
const OPCOES_CONHECIDAS: Record<string, Set<string>> = {
  login: new Set(['--token', '--team', '--refresh-token', '--expires-in', '--device-flow']),
};

describe('B-132/B-133 — a tela não anuncia comando de CLI que não existe', () => {
  /**
   * Varre TODO o `src/`, e não só as rotas.
   *
   * A PRIMEIRA versão deste guarda lia `src/routes/*.tsx` + `src/app.tsx` e casava apenas a forma
   * `cliCommand="…"`. Ela reportou VERDE enquanto `pages/settings/profile.tsx` mostrava
   * `theo account delete` num bloco de código copiável — um dos comandos que o próprio docblock
   * deste guarda diz não existir. A revisão pegou; um guarda que aprova por não olhar é pior que
   * nenhum, porque produz a sensação de cobertura.
   *
   * O escopo agora é qualquer menção a `theo <comando>` em qualquer fonte de produção, em qualquer
   * forma — atributo JSX, literal de template, propriedade de objeto. É onde a pessoa que lê a
   * tela encontra o comando, então é onde o guarda tem de olhar.
   */
  function fontesDeProducao(): string[] {
    const achados: string[] = [];
    const pilha = [SRC];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      if (atual === undefined) break;
      for (const nome of readdirSync(atual)) {
        if (nome === 'test' || nome === 'mocks' || nome === 'vendor') continue;
        const caminho = join(atual, nome);
        if (statSync(caminho).isDirectory()) pilha.push(caminho);
        else if (/\.tsx?$/.test(nome) && !nome.includes('.test.')) achados.push(caminho);
      }
    }
    return achados;
  }

  function comandosAnunciados(): { arquivo: string; comando: string }[] {
    const achados: { arquivo: string; comando: string }[] = [];
    for (const f of fontesDeProducao()) {
      const fonte = readFileSync(f, 'utf-8');
      for (const linha of fonte.split('\n')) {
        // Uma linha que DIZ que o comando não existe é prosa correta, não uma afirmação de
        // produto — quatro dos sete achados iniciais eram exatamente isso, comentários explicando
        // por que aquela tela deliberadamente NÃO sugere um comando. Reprová-los obrigaria a
        // apagar a nota, que é a informação. Mesma dispensa do guarda de caminhos em
        // `docs-claims.test.ts`, pelo mesmo motivo.
        if (/nao ha comando|não há comando|is NOT a real|não existe|nao existe|inexistente|non-existent|does not exist|NAO e um comando|não é um comando|no CLI command yet/i.test(linha)) continue;
        for (const m of linha.matchAll(/\btheo ([a-z][a-z-]*)((?: --?[a-z][a-z-]*)*)/g)) {
          achados.push({ arquivo: relative(SRC, f), comando: `theo ${m[1]}${m[2]}` });
        }
      }
    }
    return achados;
  }

  /** O comando nomeia algo que a CLI registra? */
  function ehValido(comando: string): boolean {
    const partes = comando.trim().split(/\s+/);
    const pai = partes[1];
    if (pai === undefined || !COMANDOS_CONHECIDOS.has(pai)) return false;
    const conhecidas = OPCOES_CONHECIDAS[pai];
    const flags = partes.slice(2).filter((x) => x.startsWith('-'));
    if (conhecidas !== undefined && flags.some((x) => !conhecidas.has(x))) return false;
    const sub = partes[2];
    if (sub === undefined || sub.startsWith('-')) return true;
    const subs = SUBCOMANDOS_CONHECIDOS[pai];
    return subs === undefined || subs.has(sub);
  }

  it('todo comando anunciado nomeia algo que a CLI registra', () => {
    const invalidos = comandosAnunciados().filter((c) => !ehValido(c.comando));

    expect(
      invalidos,
      '\nComando(s) de CLI anunciados numa tela e NÃO registrados pela CLI:\n\n' +
        `${invalidos.map((i) => `  ${i.arquivo} → \`${i.comando}\``).join('\n')}\n\n` +
        'A tela diz "use a CLI para fazer isto hoje" e a pessoa vai tentar. O precedente\n' +
        'governado é `/databases` (`app.tsx`), que NÃO sugere comando algum, porque não existe um.\n\n' +
        'Se o comando passou a existir, acrescente-o a COMANDOS_CONHECIDOS com a medição.\n',
    ).toEqual([]);
  });

  it('o guarda encontra comandos de verdade — um zero silencioso não passa por cobertura', () => {
    // A primeira versão deste guarda filtrava um array VAZIO e passava verde por isso. A contagem
    // faz parte da prova: se ela cair a zero, o extrator parou de enxergar.
    expect(comandosAnunciados().length).toBeGreaterThan(0);
  });

  it('DETECTA um comando inventado, exercitando o predicado', () => {
    // O auto-teste anterior só afirmava coisas sobre as CONSTANTES e nunca chamava o predicado —
    // substituir o corpo dele por `return false` deixava tudo verde. Este chama.
    expect(ehValido('theo notify list')).toBe(false);
    expect(ehValido('theo billing status')).toBe(false);
    expect(ehValido('theo account delete')).toBe(false);
    expect(ehValido('theo login --rotate-credentials')).toBe(false);
    expect(ehValido('theo team delete')).toBe(false);

    expect(ehValido('theo whoami')).toBe(true);
    expect(ehValido('theo team list')).toBe(true);
    expect(ehValido('theo deploy --project x')).toBe(true);
    expect(ehValido('theo billing portal')).toBe(true);
  });
});
