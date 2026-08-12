import { describe, expect, it } from 'vitest';

import {
  channelAnomalies,
  currentChannelOf,
  versionRows,
  type ChannelsPayload,
  type VersionsPayload,
} from './projections';

/**
 * M26 T2.1 — a projeção de versões × canais, testada FORA do React.
 *
 * As formas usadas aqui foram medidas na definição das rotas do `theo-skills`
 * (`packages/api/src/server/handlers/publishing.ts`), não inferidas do nome dos métodos:
 * `{versions:[{version, revision_id}]}` e `{channels:[{channel, revision_id, previous_revision_id}]}`.
 */

const versions: VersionsPayload = {
  versions: [
    { version: '1.0.0', revision_id: 'rev_a' },
    { version: '1.2.0', revision_id: 'rev_c' },
    { version: '1.10.0', revision_id: 'rev_d' },
  ],
};

describe('versionRows', () => {
  it('mantém na lista a versão que nenhum canal serve', () => {
    // Uma versão publicada e não promovida é EXATAMENTE a que o operador procura quando vai
    // promover. Some-la da lista tiraria da tela o insumo da única ação da jornada.
    const channels: ChannelsPayload = {
      channels: [{ channel: 'stable', revision_id: 'rev_a', previous_revision_id: null }],
    };

    const rows = versionRows(versions, channels);

    const semCanal = rows.filter((r) => r.channels.length === 0).map((r) => r.version);
    expect(semCanal).toContain('1.2.0');
    expect(semCanal).toContain('1.10.0');
    expect(rows).toHaveLength(3);
  });

  it('marca na linha certa o canal que a serve', () => {
    const channels: ChannelsPayload = {
      channels: [
        { channel: 'stable', revision_id: 'rev_a', previous_revision_id: null },
        { channel: 'beta', revision_id: 'rev_d', previous_revision_id: 'rev_c' },
      ],
    };

    const rows = versionRows(versions, channels);

    expect(rows.find((r) => r.version === '1.0.0')?.channels).toEqual(['stable']);
    expect(rows.find((r) => r.version === '1.10.0')?.channels).toEqual(['beta']);
  });

  it('ordena por versão de forma numérica, não alfabética', () => {
    // Alfabeticamente "1.10.0" < "1.2.0" — a ordenação ingênua colocaria a versão mais nova
    // no meio da lista, e o operador promoveria a errada lendo "a primeira".
    const rows = versionRows(versions, { channels: [] });

    expect(rows.map((r) => r.version)).toEqual(['1.10.0', '1.2.0', '1.0.0']);
  });

  it('não explode quando o serviço não mandou versões', () => {
    expect(versionRows({}, {})).toEqual([]);
    expect(versionRows(null, null)).toEqual([]);
  });
});

describe('channelAnomalies', () => {
  it('denuncia duas revisões diferentes para o MESMO canal — estado impossível', () => {
    // Um canal aponta para UMA revisão. Duas entradas com o mesmo nome e revisões diferentes
    // não é um caso a resolver por desempate: é o serviço afirmando duas coisas incompatíveis.
    // Escolher uma em silêncio faria a tela mostrar um estado que não existe, e a promoção
    // seguinte partiria de premissa falsa.
    const channels: ChannelsPayload = {
      channels: [
        { channel: 'stable', revision_id: 'rev_a', previous_revision_id: null },
        { channel: 'stable', revision_id: 'rev_c', previous_revision_id: null },
      ],
    };

    const anomalies = channelAnomalies(channels);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].channel).toBe('stable');
    expect(anomalies[0].revisionIds).toEqual(['rev_a', 'rev_c']);
  });

  it('não denuncia a repetição idêntica — não há contradição alguma nela', () => {
    const channels: ChannelsPayload = {
      channels: [
        { channel: 'stable', revision_id: 'rev_a', previous_revision_id: null },
        { channel: 'stable', revision_id: 'rev_a', previous_revision_id: null },
      ],
    };

    expect(channelAnomalies(channels)).toEqual([]);
  });

  it('está vazio no caso normal', () => {
    const channels: ChannelsPayload = {
      channels: [
        { channel: 'stable', revision_id: 'rev_a', previous_revision_id: null },
        { channel: 'beta', revision_id: 'rev_c', previous_revision_id: null },
      ],
    };

    expect(channelAnomalies(channels)).toEqual([]);
  });
});

describe('currentChannelOf', () => {
  it('devolve a revisão vigente do canal', () => {
    const channels: ChannelsPayload = {
      channels: [{ channel: 'stable', revision_id: 'rev_a', previous_revision_id: 'rev_z' }],
    };

    expect(currentChannelOf(channels, 'stable')).toEqual({
      channel: 'stable',
      revision_id: 'rev_a',
      previous_revision_id: 'rev_z',
    });
  });

  it('devolve null para canal que não existe — nunca um objeto vazio plausível', () => {
    expect(currentChannelOf({ channels: [] }, 'stable')).toBeNull();
  });
});
