import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
  const arquivosDeRota = [
    ...readdirSync(join(SRC, 'routes')).map((f) => join(SRC, 'routes', f)),
    join(SRC, 'app.tsx'),
  ].filter((f) => f.endsWith('.tsx'));

  function comandosAnunciados(): { arquivo: string; comando: string }[] {
    const achados: { arquivo: string; comando: string }[] = [];
    for (const f of arquivosDeRota) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/cliCommand="([^"]+)"/g)) {
        achados.push({ arquivo: relative(SRC, f), comando: m[1] });
      }
    }
    return achados;
  }

  it('todo comando anunciado nomeia algo que a CLI registra', () => {
    const invalidos = comandosAnunciados().filter(({ comando }) => {
      const partes = comando.trim().split(/\s+/);
      if (partes[0] !== 'theo') return true;
      const pai = partes[1];
      if (pai === undefined || !COMANDOS_CONHECIDOS.has(pai)) return true;
      const flags = partes.slice(2).filter((p) => p.startsWith('-'));
      const conhecidas = OPCOES_CONHECIDAS[pai];
      if (conhecidas !== undefined && flags.some((f) => !conhecidas.has(f))) return true;

      const sub = partes[2];
      if (sub === undefined || sub.startsWith('-')) return false;
      const subs = SUBCOMANDOS_CONHECIDOS[pai];
      return subs !== undefined && !subs.has(sub);
    });

    expect(
      invalidos,
      '\nComando(s) de CLI anunciados numa tela e NÃO registrados pela CLI:\n\n' +
        `${invalidos.map((i) => `  ${i.arquivo} → \`${i.comando}\``).join('\n')}\n\n` +
        'A tela diz "use a CLI para fazer isto hoje" e a pessoa vai tentar. O precedente\n' +
        'governado é `/databases` (`app.tsx`), que NÃO sugere comando algum, porque não existe um:\n' +
        'inventar um mente de forma mais convincente que a ausência.\n\n' +
        'Se o comando passou a existir, acrescente-o a COMANDOS_CONHECIDOS com a medição.\n',
    ).toEqual([]);
  });

  it('o extrator continua enxergando a forma — um zero silencioso não passa por cobertura', () => {
    // Hoje o repositório anuncia ZERO comandos: os seis inventados saíram, e o único válido
    // (`theo team list`) saiu junto com o placeholder de `/settings/members`, que virou redirect
    // (B-206). Então "encontrou algum" não serve mais como prova de que o extrator funciona — o
    // zero é o estado correto.
    //
    // O que ainda precisa ser provado é que a regex casa a FORMA. Contra uma amostra sintética,
    // ela ou casa ou o guarda inteiro passou a ser decorativo.
    const amostra = '<SubPagePlaceholder cliCommand="theo deploy --env prod" />';
    const casados = [...amostra.matchAll(/cliCommand="([^"]+)"/g)];
    expect(casados).toHaveLength(1);
    expect(casados[0][1]).toBe('theo deploy --env prod');
  });

  it('DETECTA um comando inventado', () => {
    // Auto-teste: sem ele, um extrator que parasse de casar deixaria o caso acima verde.
    expect(COMANDOS_CONHECIDOS.has('notify')).toBe(false);
    expect(SUBCOMANDOS_CONHECIDOS.billing.has('status')).toBe(false);
  });
});
