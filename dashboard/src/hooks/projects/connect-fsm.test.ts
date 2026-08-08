import { describe, it, expect } from 'vitest';
import { derivarConexaoEfetiva, derivarEstado } from './connect-fsm';

/**
 * B-047 — a FSM do fluxo de conexão, testada direto.
 *
 * Ela era um `useMemo` dentro de uma página de 696 linhas: exercitável só
 * montando a árvore inteira e clicando. Virou função pura quando ganhou um
 * segundo chamador — o `refetchInterval` do `useConexaoDoProjeto` — e é ela que
 * decide **se o polling continua**.
 *
 * As duas falhas possíveis são caras e silenciosas: `installing` que nunca sai
 * bate no backend a cada 2 s para sempre; `installing` que nunca entra deixa a
 * pessoa olhando uma tela que espera um tique que ninguém vai agendar.
 */

const LIMPO = { busy: false, repoUrl: '', connectError: null, installError: null };
const INSTALANDO = { ...LIMPO, busy: true };

describe('derivarConexaoEfetiva (B-047)', () => {
  it('sem resposta e sem id na URL, não há conexão a mostrar', () => {
    expect(derivarConexaoEfetiva(null, undefined)).toBeNull();
  });

  it('o id da URL vale ANTES da resposta chegar', () => {
    // É o que faz o seletor de repositório aparecer logo após o redirect do
    // GitHub, sem esperar o backend confirmar.
    expect(derivarConexaoEfetiva(null, 42)).toEqual({ connected: false, installation_id: 42 });
  });

  it('o backend vence o id da URL quando já tem o seu', () => {
    const doBackend = { connected: false, installation_id: 7 };
    expect(derivarConexaoEfetiva(doBackend, 42)).toBe(doBackend);
  });

  it('o id da URL preenche a lacuna quando o backend ainda não persistiu', () => {
    expect(derivarConexaoEfetiva({ connected: false }, 42)).toEqual({
      connected: false,
      installation_id: 42,
    });
  });
});

describe('derivarEstado (B-047)', () => {
  it('sem conexão efetiva, o fluxo está parado', () => {
    expect(derivarEstado(null, LIMPO)).toBe('idle');
  });

  it('conectado vence tudo', () => {
    expect(derivarEstado({ connected: true, installation_id: 1 }, INSTALANDO)).toBe('connected');
  });

  it('com id de instalação, o passo é escolher o repositório', () => {
    expect(derivarEstado({ connected: false, installation_id: 1 }, INSTALANDO)).toBe(
      'has_installation',
    );
  });

  it('instalando exige ocupado E nenhum erro E nenhum repo digitado', () => {
    expect(derivarEstado({ connected: false }, INSTALANDO)).toBe('installing');
  });

  it('um erro de install TIRA de instalando — é assim que o prazo para o polling', () => {
    // O prazo de 5 min escreve a mensagem em `installError`. Esta linha é o que
    // transforma isso em "pare de buscar": sem ela o polling seguiria com a
    // mensagem de falha na tela.
    expect(derivarEstado({ connected: false }, { ...INSTALANDO, installError: 'estourou' })).toBe(
      'idle',
    );
  });

  it('um erro de conexão também tira, pelo mesmo motivo', () => {
    expect(derivarEstado({ connected: false }, { ...INSTALANDO, connectError: 'falhou' })).toBe(
      'idle',
    );
  });

  it('um repo já digitado tira: quem digitou não está esperando o install', () => {
    expect(derivarEstado({ connected: false }, { ...INSTALANDO, repoUrl: 'a/b' })).toBe('idle');
  });
});
