// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { evaluateFile, publicationBody, toBase64, ZIP_BYTES_CEILING } from './skill-upload';

/**
 * Uma skill com script é uma ÁRVORE de arquivos. O registro aceita `zippedFilesystem` desde o M12
 * e a CLI publica assim; a TELA não tinha como — só textarea. A assimetria era da superfície.
 */

describe('avaliarArquivo', () => {
  it('aceita um .zip com conteúdo', () => {
    const r = evaluateFile({ name: 'minha-skill.zip', size: 4096 });
    expect(r.aceito).toBe(true);
  });

  it('recusa o que não é .zip DIZENDO qual é a forma esperada', () => {
    // "Arquivo inválido" faria o autor tentar o mesmo arquivo de novo. A recusa precisa ensinar.
    const r = evaluateFile({ name: 'SKILL.md', size: 200 });
    expect(r.aceito).toBe(false);
    if (r.aceito) return;
    expect(r.reason).toMatch(/zip the skill folder/i);
    expect(r.reason).toContain('SKILL.md');
  });

  it('recusa zip vazio antes de gastar uma viagem de rede', () => {
    const r = evaluateFile({ name: 'vazio.zip', size: 0 });
    expect(r.aceito).toBe(false);
  });

  it('recusa acima do teto e diz o NÚMERO', () => {
    // Sem o número, o autor não sabe se precisa cortar 1 MB ou 100.
    const r = evaluateFile({ name: 'grande.zip', size: ZIP_BYTES_CEILING + 1 });
    expect(r.aceito).toBe(false);
    if (r.aceito) return;
    expect(r.reason).toContain('25 MB');
  });

  it('aceita exatamente no teto — o limite é inclusivo', () => {
    expect(evaluateFile({ name: 'limite.zip', size: ZIP_BYTES_CEILING }).aceito).toBe(true);
  });

  it('nenhum arquivo escolhido não é erro de formato', () => {
    const r = evaluateFile(null);
    expect(r.aceito).toBe(false);
    if (r.aceito) return;
    expect(r.reason).toMatch(/choose a \.zip/i);
  });
});

describe('paraBase64', () => {
  it('codifica bytes conhecidos', () => {
    // "PK\x03\x04" — a assinatura de um zip.
    expect(toBase64(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)).toBe('UEsDBA==');
  });

  it('não estoura com um buffer grande', () => {
    // `String.fromCharCode(...bytes)` num zip de MBs dispara RangeError — falha que só aparece com
    // arquivo grande, ou seja, exatamente no caso que motivou o recurso. Daí a codificação em blocos.
    const grande = new Uint8Array(300_000).fill(65);
    expect(() => toBase64(grande.buffer)).not.toThrow();
    expect(toBase64(grande.buffer).length).toBeGreaterThan(390_000);
  });
});

describe('corpoDaPublicacao', () => {
  it('zip viaja como zipped_filesystem, SEM skill_md', () => {
    // O registro prioriza `skillMd` quando ambos chegam: mandar os dois descartaria os scripts em
    // silêncio, com 202 e sem erro. O BFF recusa o par; a tela nunca deve montá-lo.
    const c = publicationBody('sk_x', { tipo: 'zip', base64: 'UEsDBA==' });
    expect(c.zipped_filesystem).toBe('UEsDBA==');
    expect(c).not.toHaveProperty('skill_md');
  });

  it('markdown viaja como skill_md, SEM zipped_filesystem', () => {
    const c = publicationBody('sk_y', { tipo: 'markdown', content: '# Skill' });
    expect(c.skill_md).toBe('# Skill');
    expect(c).not.toHaveProperty('zipped_filesystem');
  });
});
