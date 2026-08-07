import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@usetheo/ui';

import { useBuildLogs } from '@/hooks/use-build-logs';
import { LogViewer } from '@/components/logs/log-viewer';

/**
 * LogsTab — Plan J-17 T5.4 + LIVE bug fix 2026-06-06.
 *
 * Duas camadas de carregamento (espelha o design de Vercel/Railway):
 *
 *  1. **Historico via REST** — o GET /logs devolve toda linha que o Loki reteve
 *     para este build (7 dias, chunks em S3/MinIO). Vale para SUCCEEDED, FAILED,
 *     CANCELLED e RUNNING igualmente: o usuario sempre ve o que ja foi captado,
 *     mesmo depois de o Pod do workflow ter sido coletado.
 *
 *  2. **SSE vivo apenas em voo** — se o status e nao-terminal, o stream tambem
 *     abre, e as linhas novas aparecem em tempo real sobre o snapshot. Builds
 *     terminais nao abrem SSE (nao chegara mais linha; abrir so penduraria a
 *     conexao) — era a UX de "viewer travado vazio" de antes do fix.
 *
 * B-045 — toda essa mecanica (snapshot + stream + merge + refresh + cap) mora em
 * `useBuildLogs`. Esta pagina e so render: ela decide pausa e desenha. O que
 * motivou a extracao foi concreto — com dois `setHistorical` espalhados pelo
 * componente, o teto FIFO de B-016 foi aplicado ao snapshot inicial e esquecido
 * no Refresh manual. Um dono unico torna esse escape impossivel.
 */
export function LogsTab() {
  const { id = '' } = useParams<{ name: string; id: string }>();
  const [paused, setPaused] = useState(false);
  const { lines, connected, error, refresh, refreshing, clear } = useBuildLogs(id, paused);

  return (
    <Card className="overflow-hidden">
      <div className="h-[640px]">
        <LogViewer
          lines={lines}
          connected={connected}
          error={error}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onClear={clear}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      </div>
    </Card>
  );
}
