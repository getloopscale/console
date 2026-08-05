import { describe, it, expect } from 'vitest';
import { ABAS, abaDaRota, rotaDaAba } from './detail-tabs';
import { resolveActiveMenu } from '@/components/layout/app-sidebar-menus';

/**
 * M21 DoD-1 — quatro abas, e nenhum endereço que já circulava deixa de resolver.
 *
 * O mapeamento rota⇄aba é lógica **pura**, e vive fora do React pelo mesmo motivo que a composição
 * do M20: é aqui que mora a decisão que erra em silêncio. Uma aba ativa errada não quebra a tela —
 * ela mostra a resposta certa sob o rótulo errado, e o operador conclui coisa diferente do que o
 * dado diz.
 *
 * O caso que o DoD-1 cobra explicitamente é o primeiro: `/promptly/:name`, sem sufixo, **continua
 * resolvendo**. Links para ele existem no catálogo, no diff e na lista de dependentes que o M20
 * acabou de criar; quebrá-lo trocaria uma tela melhor por três caminhos mortos.
 */
describe('M21 — o mapa de abas do detalhe', () => {
  it('as quatro perguntas estão declaradas, e só elas', () => {
    // Quatro, porque são quatro perguntas diferentes sobre o mesmo objeto. Uma quinta aba sem
    // pergunta própria é um cartão que alguém não soube onde pôr.
    expect(ABAS.map((a) => a.id)).toEqual(['conteudo', 'config', 'producao', 'consumo']);
  });

  it('o endereço antigo continua resolvendo, e é a aba de conteúdo', () => {
    expect(abaDaRota('/promptly/saudacao')).toBe('conteudo');
    // Com barra final também — um link colado do navegador costuma trazê-la.
    expect(abaDaRota('/promptly/saudacao/')).toBe('conteudo');
  });

  it('cada sufixo resolve para a sua aba', () => {
    expect(abaDaRota('/promptly/saudacao/config')).toBe('config');
    expect(abaDaRota('/promptly/saudacao/producao')).toBe('producao');
    expect(abaDaRota('/promptly/saudacao/consumo')).toBe('consumo');
  });

  it('um sufixo que NÃO é aba não vira aba nenhuma', () => {
    // `playground` e `diff` são telas próprias, irmãs do detalhe, não abas dele. Tratá-las como aba
    // desconhecida e cair no `conteudo` acenderia a aba errada numa tela que nem é esta.
    expect(abaDaRota('/promptly/saudacao/playground')).toBeNull();
    expect(abaDaRota('/promptly/saudacao/diff')).toBeNull();
  });

  it('nome de prompt com barra codificada não confunde o mapeamento', () => {
    // O M16 trouxe pastas: `m16-sup/relatorio` é um NOME, e chega na URL codificado. Se o mapeador
    // fatiasse por `/` cru, o segmento `relatorio` viraria "aba desconhecida" e a tela abriria com
    // aba nenhuma ativa — num prompt que existe e cujo endereço o catálogo publica.
    expect(abaDaRota('/promptly/m16-sup%2Frelatorio')).toBe('conteudo');
    expect(abaDaRota('/promptly/m16-sup%2Frelatorio/config')).toBe('config');
  });

  it('rotaDaAba e abaDaRota são inversas — ida e volta preserva a aba', () => {
    // O par existe para que a barra de abas e o roteador não possam divergir: quem constrói o link
    // e quem o lê usam a mesma regra.
    for (const aba of ABAS) {
      expect(abaDaRota(rotaDaAba('saudacao', aba.id))).toBe(aba.id);
    }
  });

  it('rotaDaAba codifica o nome — pasta não vira caminho', () => {
    expect(rotaDaAba('m16-sup/relatorio', 'config')).toBe('/promptly/m16-sup%2Frelatorio/config');
  });

  it('o menu lateral reconhece TODAS as rotas de aba', () => {
    // A segunda metade da navegação, e a que ninguém lembra: declarar o submenu não basta. No M20
    // do `theo-trust`, quatro telas ficaram alcançáveis só digitando a URL porque esta linha não
    // existia — e três rodadas de validação passaram por cima, porque validar abrindo o endereço é
    // usar o único caminho que o usuário real não tem.
    for (const aba of ABAS) {
      expect(resolveActiveMenu(rotaDaAba('saudacao', aba.id))).toMatchObject({ id: 'promptly' });
    }
  });
});
