// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { dependentRows, displayedText, hasComposition } from './composicao';

describe('dependentRows — quem depende de mim', () => {
  it('projeta as linhas bem formadas, com o via', () => {
    expect(
      dependentRows([{ name: 'saudacao', version: 3, via: { version: 1, label: null } }]),
    ).toEqual([{ name: 'saudacao', version: 3, via: { version: 1, label: null } }]);
  });

  it('referencia por label é distinguida da referência por versão', () => {
    // A distinção que muda a decisão: só a por LABEL é movida por uma promoção.
    expect(
      dependentRows([{ name: 'x', version: 1, via: { version: null, label: 'production' } }]),
    ).toEqual([{ name: 'x', version: 1, via: { version: null, label: 'production' } }]);
  });

  it('linha sem via projeta via nulo em vez de quebrar', () => {
    // Defensiva: um serviço antigo, um cache, um mock desatualizado. A linha ainda é útil sem o
    // `via` — perder a lista inteira por causa de um campo seria pior que exibi-la incompleta.
    expect(dependentRows([{ name: 'y', version: 2 }])).toEqual([
      { name: 'y', version: 2, via: { version: null, label: null } },
    ]);
  });

  it('descarta linha malformada em vez de renderizar lixo', () => {
    // Uma linha `undefined vundefined` é PIOR que ausente: parece um prompt real com nome estranho,
    // e alguém vai procurá-lo. Esta lista é lida antes de promover.
    expect(
      dependentRows([
        { name: 'ok', version: 1, via: { version: 1, label: null } },
        { name: '', version: 2 },
        { name: 'sem-versao' },
        { version: 9 },
        null,
        'texto',
      ]),
    ).toEqual([{ name: 'ok', version: 1, via: { version: 1, label: null } }]);
  });

  it('resposta que não é lista devolve lista vazia', () => {
    expect(dependentRows(null)).toEqual([]);
    expect(dependentRows({ rows: [] })).toEqual([]);
  });
});

describe('textoExibido — o par resolvido / como escrito', () => {
  it('no modo escrito mostra o texto com o marcador visível', () => {
    const r = displayedText('escrito', 'antes @@@promptly:name=p|version=1@@@', {
      loading: false,
      failure: false,
      text: 'antes POLÍTICA',
    });
    expect(r).toEqual({ estado: 'texto', text: 'antes @@@promptly:name=p|version=1@@@' });
  });

  it('no modo resolvido mostra o texto composto', () => {
    const r = displayedText('resolvido', 'antes @@@promptly:name=p|version=1@@@', {
      loading: false,
      failure: false,
      text: 'antes POLÍTICA',
    });
    expect(r).toEqual({ estado: 'texto', text: 'antes POLÍTICA' });
  });

  it('resolução que falhou NÃO cai para o texto escrito', () => {
    // O caso que justifica esta função existir. Cair para o escrito mostraria um texto CORRETO sob
    // um rótulo ERRADO: o operador leria marcadores literais acreditando ver o texto composto, e
    // concluiria que a composição não funciona — quando o que falhou foi a leitura.
    const r = displayedText('resolvido', 'antes @@@promptly:name=p|version=1@@@', {
      loading: false,
      failure: true,
      text: null,
    });
    expect(r).toEqual({ estado: 'falhou' });
  });

  it('resolução em voo é carregando, e não texto vazio', () => {
    const r = displayedText('resolvido', 'x', { loading: true, failure: false, text: null });
    expect(r).toEqual({ estado: 'carregando' });
  });

  it('o texto escrito ainda não lido é carregando', () => {
    const r = displayedText('escrito', null, { loading: false, failure: false, text: null });
    expect(r).toEqual({ estado: 'carregando' });
  });
});

describe('temComposicao — quando o par vale ser oferecido', () => {
  it('reconhece referência por versão e por label', () => {
    expect(hasComposition('a @@@promptly:name=policy|version=3@@@ b')).toBe(true);
    expect(hasComposition('@@@promptly:name=tom|label=production@@@')).toBe(true);
  });

  it('prompt comum não ganha alternador entre dois textos idênticos', () => {
    expect(hasComposition('Você é um assistente cordial.')).toBe(false);
    expect(hasComposition(null)).toBe(false);
  });

  it('respeita o escape — falar do marcador não é invocá-lo', () => {
    // O escape existe para a documentação do produto poder ser escrita DENTRO do produto.
    expect(hasComposition('escreva @@@@promptly:name=x|version=1@@@ para referenciar')).toBe(false);
  });

  it('marcador malformado não conta como composição', () => {
    expect(hasComposition('@@@promptly:sem fecho e sem nada')).toBe(false);
  });
});
