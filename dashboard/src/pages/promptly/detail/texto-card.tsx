import { Card } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import type { ModoDeTexto } from '@/pages/promptly/components/composicao';
import { Button } from '@usetheo/ui';

interface Props {
  modoDeTexto: ModoDeTexto;
  texto: ReturnType<typeof import('@/pages/promptly/components/composicao').textoExibido>;
  setModoDeTexto: (m: ModoDeTexto) => void;
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
export function TextoDoPromptCard({ texto, modoDeTexto, setModoDeTexto }: Props) {
  return (
    <Card>
      <Card.Header>
        <Card.Title asChild>
          <h2>Texto do prompt</h2>
        </Card.Title>
        <Card.Description>
          Este prompt referencia outros. <strong>Como foi escrito</strong> mostra os marcadores;{' '}
          <strong>resolvido</strong> mostra o texto que o modelo de fato recebe.
        </Card.Description>
      </Card.Header>
      <div className="space-y-3 p-4 pt-0">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Qual texto exibir">
          <Button
            variant={modoDeTexto === 'escrito' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={modoDeTexto === 'escrito'}
            onClick={() => { setModoDeTexto('escrito'); }}
          >
            Como foi escrito
          </Button>
          <Button
            variant={modoDeTexto === 'resolvido' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={modoDeTexto === 'resolvido'}
            onClick={() => { setModoDeTexto('resolvido'); }}
          >
            Resolvido
          </Button>
        </div>
        {texto.estado === 'falhou' ? (
          // NUNCA cair para o texto escrito aqui: seria mostrar um texto correto sob um rótulo
          // errado, e o operador leria marcadores literais achando ver a composição.
          <Alert
            intent="destructive"
            title="Não foi possível resolver a composição"
            description="O texto resolvido não pôde ser lido. Alterne de volta para ver o texto como foi escrito."
          />
        ) : texto.estado === 'carregando' ? (
          <p className="text-sm text-muted-foreground">Resolvendo as referências…</p>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {texto.texto || '(vazio)'}
          </pre>
        )}
      </div>
    </Card>
  );
}
