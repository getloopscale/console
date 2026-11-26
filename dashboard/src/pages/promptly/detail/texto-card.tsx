import { Card } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import type { TextMode } from '@/pages/promptly/components/composicao';
import { Button } from '@getloopscale/ui';

interface Props {
  textMode: TextMode;
  text: ReturnType<typeof import('@/pages/promptly/components/composicao').displayedText>;
  setTextMode: (m: TextMode) => void;
}

/**
 * O par escrito/resolvido do texto do prompt.
 *
 * O alternador só aparece quando o prompt de fato referencia outro: dois textos
 * idênticos lado a lado seriam ruído, e resolver custa uma travessia do grafo.
 *
 * ## Por que saiu do `detail.tsx` (B-009)
 *
 * A tela tinha 887 linhas num ÚNICO componente — nenhuma fronteira de função
 * para seguir. A divisão precisou ser DESENHADA, e o desenho veio dos cartões:
 * cada um responde uma pergunta própria e recebe entre um e seis símbolos.
 * Cortar por tamanho teria produzido metades sem nome.
 */
export function PromptCardText({ text, textMode, setTextMode }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Prompt text</h2>
        </Card.Title>
        <Card.Description>
          This prompt references others. <strong>As written</strong> shows the placeholders;{' '}
          <strong>resolved</strong> shows the text the model actually receives.
        </Card.Description>
      </Card.Header>
      <div className="space-y-3 p-4 pt-0">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Which text to show">
          <Button
            variant={textMode === 'escrito' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={textMode === 'escrito'}
            onClick={() => { setTextMode('escrito'); }}
          >
            As written
          </Button>
          <Button
            variant={textMode === 'resolvido' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={textMode === 'resolvido'}
            onClick={() => { setTextMode('resolvido'); }}
          >
            Resolved
          </Button>
        </div>
        {text.estado === 'falhou' ? (
          // NUNCA cair para o texto escrito aqui: seria mostrar um texto correto sob um rótulo
          // errado, e o operador leria marcadores literais achando ver a composição.
          <Alert
            intent="destructive"
            title="Could not resolve the composition"
            description="The resolved text could not be read. Switch back to see the text as it was written."
          />
        ) : text.estado === 'carregando' ? (
          <p className="text-sm text-muted-foreground">Resolving references…</p>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {text.text || '(vazio)'}
          </pre>
        )}
      </div>
    </Card>
  );
}
