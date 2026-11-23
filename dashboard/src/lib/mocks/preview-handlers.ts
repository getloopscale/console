import { registerRoute } from './server';
import { previewsFixture } from './fixtures';
import type { Preview, PreviewListResponse } from '@/lib/api/types';

/**
 * Handlers de previews — extraídos de `handlers.ts` (B-112, 2026-08-10).
 *
 * ## Por que saíram de lá
 *
 * Pelo mesmo motivo que os de domínios saíram no B-107, e a catraca de `loc-budget-ratchet.test.ts`
 * disse de novo em voz alta: `handlers.ts` está na dívida registrada de `max-lines` com teto
 * anotado, e o número só desce. Registrar os quatro agregados de capacidade da Overview custava
 * quatro linhas — um import e uma chamada com o seu comentário — e a catraca reprovou.
 *
 * A alternativa era encurtar o comentário até caber, trocando a explicação por duas linhas de
 * orçamento. Isso é a falsa economia que a catraca não deveria causar; o contrato dela diz a saída
 * certa: *"decompor um arquivo baixa o número e o teste segue verde"*.
 *
 * Previews é o bloco que sai mais limpo: `db.previews` era usado só aqui e no `resetMockDB`, então
 * a extração não corta nada ao meio — a mesma condição que tornou a de domínios segura.
 */
const estado: { previews: Preview[] } = { previews: [...previewsFixture] as Preview[] };

/** Repõe as fixtures. Chamado por `resetMockDB()`. */
export function resetPreviewMocks(): void {
  estado.previews = [...previewsFixture] as Preview[];
}

function err(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

export function registerPreviewHandlers() {
  registerRoute('GET', '/api/v1/projects/{project}/previews', async (_req, { project }) => {
    const previews = estado.previews.filter((p) => p.project === project);
    const body: PreviewListResponse = { previews, total: previews.length };
    return Response.json(body);
  });

  registerRoute('GET', '/api/v1/projects/{project}/previews/{id}', async (_req, { id }) => {
    const preview = estado.previews.find((p) => p.id === id);
    if (!preview) return err('NOT_FOUND', `Preview "${id}" not found`, 404);
    return Response.json(preview);
  });

  registerRoute('POST', '/api/v1/projects/{project}/previews', async (req, { project }) => {
    const body = (await req.json()) as { branch?: string; commit_sha?: string };
    if (!body.branch) return err('INVALID_INPUT', 'branch required', 400);
    const preview: Preview = {
      id: `prv-${Date.now()}`,
      project,
      branch: body.branch,
      url: `https://${body.branch.replace(/\W/g, '-')}.preview.acme.com`,
      status: 'creating',
      created_by: 'demo@example.com',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
    estado.previews.push(preview);
    return Response.json(preview, { status: 201 });
  });

  registerRoute('DELETE', '/api/v1/projects/{project}/previews/{id}', async (_req, { id }) => {
    const i = estado.previews.findIndex((p) => p.id === id);
    if (i < 0) return err('NOT_FOUND', `Preview "${id}" not found`, 404);
    estado.previews.splice(i, 1);
    return new Response(null, { status: 204 });
  });
}
