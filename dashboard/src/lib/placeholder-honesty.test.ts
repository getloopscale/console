import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const APP = readFileSync(join(SRC, 'app.tsx'), 'utf8');
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
  for (const m of APP.matchAll(/path="([^"]+)"(?:(?!path=)[\s\S])*?SubPagePlaceholder/g)) {
    out.push(m[1]);
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
