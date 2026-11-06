/**
 * Upload de skill como ÁRVORE de arquivos — o que um `SKILL.md` sozinho não representa.
 *
 * Uma skill de verdade frequentemente carrega script (Python, Bash), `assets/`, um `reference/`.
 * O registro sempre aceitou isso: `POST /v1/skills` recebe `zippedFilesystem`, um zip em base64, e
 * a CLI publica por esse caminho desde o M12. Pela TELA era impossível — o formulário só tinha
 * textarea, e o BFF só sabia decodificar `skill_md`.
 *
 * A lógica vive aqui, FORA do React, porque é o que precisa de teste: decidir se um arquivo é
 * aceitável e o que dizer quando não é. Um teste que precisa montar componente para verificar uma
 * regra de validação testa o React, não a regra.
 */

/** O que o formulário sabe fazer com um arquivo escolhido. */
export type FileChoice =
  | { readonly aceito: true; readonly name: string; readonly bytes: number }
  | { readonly aceito: false; readonly reason: string };

/**
 * Teto do zip, em bytes do ARQUIVO (não do base64).
 *
 * O registro aceita ~35 MB **depois** do envelope base64, que infla o conteúdo em ~4/3. Recusar
 * aqui pelo tamanho do arquivo evita o pior desfecho: o autor esperar um upload de 30 MB para
 * receber uma recusa do outro lado da rede.
 *
 * 25 MiB × 4/3 ≈ 33 MB de base64 — dentro do teto, com margem para o resto do JSON.
 */
export const ZIP_BYTES_CEILING = 25 * 1024 * 1024;

/**
 * Decide se o arquivo escolhido pode ser enviado.
 *
 * A recusa NOMEIA o que fazer. "Arquivo inválido" faria o autor tentar o mesmo arquivo de novo —
 * o erro precisa dizer qual é a forma esperada, e no caso do tamanho, qual é o número.
 */
export function evaluateFile(file: { name: string; size: number } | null): FileChoice {
  if (file === null) {
    return { aceito: false, reason: 'Choose a .zip file containing the skill folder.' };
  }
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return {
      aceito: false,
      reason: `“${file.name}” is not a .zip. Zip the skill folder — SKILL.md at its root, plus any scripts and assets — and upload that.`,
    };
  }
  // Um zip vazio passa pela extensão e falha no registro com uma mensagem sobre estrutura. Barrar
  // aqui custa uma linha e evita uma viagem de rede para descobrir o óbvio.
  if (file.size === 0) {
    return { aceito: false, reason: `“${file.name}” is empty.` };
  }
  if (file.size > ZIP_BYTES_CEILING) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      aceito: false,
      reason: `“${file.name}” is ${mb} MB. The limit is 25 MB — the registry rejects anything larger once base64-encoded.`,
    };
  }
  return { aceito: true, name: file.name, bytes: file.size };
}

/**
 * Converte o `ArrayBuffer` do zip em base64, que é o que `zippedFilesystem` transporta.
 *
 * Feito em BLOCOS. `String.fromCharCode(...bytes)` com um zip de alguns MB estoura o limite de
 * argumentos do runtime (`RangeError: too many arguments`) — falha que só aparece com arquivo
 * grande, ou seja, exatamente no caso que motivou o recurso.
 */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const BLOCO = 0x8000;
  let binario = '';
  for (let i = 0; i < bytes.length; i += BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(binario);
}

/**
 * O corpo de `POST /v1/dashboard/skills`, com a forma que o BFF aceita.
 *
 * Markdown **ou** zip, nunca os dois: o registro prioriza `skillMd` quando ambos chegam, e o zip
 * seria descartado em silêncio — a skill entraria no acervo sem os scripts, com 202 e sem erro.
 * O BFF recusa esse par na fronteira; esta função garante que a tela nunca o monte.
 */
export function publicationBody(
  skillId: string,
  source: { readonly tipo: 'markdown'; readonly content: string } | { readonly tipo: 'zip'; readonly base64: string },
): Record<string, string> {
  return source.tipo === 'zip'
    ? { skill_id: skillId, zipped_filesystem: source.base64 }
    : { skill_id: skillId, skill_md: source.content };
}
