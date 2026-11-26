import { FileText, Download, Link2, Trash2 } from 'lucide-react';
import { Button, Badge, Skeleton, Sheet, CopyButton, CodeBlock } from '@getloopscale/ui';

import { formatBytes, previewKind, type StorageFile } from './helpers';

type PreviewData = { kind: 'image'; url: string } | { kind: 'text'; text: string };

interface Props {
  preview: StorageFile | null;
  prefix: string;
  query: { isLoading: boolean; isError: boolean; data?: PreviewData };
  shareUrl: string | null;
  onClose: () => void;
  onDownload: (f: StorageFile) => void;
  onShare: (path: string) => void;
  onDelete: (f: StorageFile) => void;
}

/**
 * The file preview side-panel (extracted from workspace.tsx to keep that file
 * under the LoC budget and to give the preview its own presentational unit).
 * Renders text/code inline (CodeBlock), images (object URL), or a no-preview
 * placeholder, plus Download / Share / Delete actions.
 */
export function WorkspacePreviewSheet({ preview, prefix, query, shareUrl, onClose, onDownload, onShare, onDelete }: Props) {
  return (
    <Sheet open={!!preview} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Sheet.Content side="right" className="flex w-full flex-col sm:max-w-xl">
        {preview && (
          <>
            <Sheet.Header>
              <Sheet.Title className="flex items-center gap-2 pr-6">
                <span className="truncate font-mono text-sm">{preview.path.slice(prefix.length)}</span>
                <Badge variant="outline" className="shrink-0 font-normal">{preview.content_type}</Badge>
              </Sheet.Title>
              <Sheet.Description>
                {formatBytes(preview.size)} · <span className="font-mono">{preview.path}</span>
              </Sheet.Description>
            </Sheet.Header>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {previewKind(preview.content_type) === 'none' ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FileText className="h-8 w-8" />
                  <p className="text-sm">No inline preview for this file type.</p>
                </div>
              ) : query.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : query.isError ? (
                <p className="text-sm text-destructive">Could not load this file.</p>
              ) : query.data?.kind === 'image' ? (
                <img src={query.data.url} alt={preview.path} className="mx-auto max-h-[60vh] rounded-lg border border-border/60" />
              ) : query.data ? (
                <CodeBlock code={query.data.text} language={preview.content_type.includes('json') ? 'json' : 'text'} />
              ) : null}
            </div>

            <div className="space-y-3 border-t border-border/60 p-4">
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2" data-testid="share-link">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</span>
                  <CopyButton value={shareUrl} variant="ghost" size="sm" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => onDownload(preview)}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => onShare(preview.path)}>
                  <Link2 className="h-3.5 w-3.5" /> Share link
                </Button>
                <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-destructive hover:text-destructive" onClick={() => onDelete(preview)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          </>
        )}
      </Sheet.Content>
    </Sheet>
  );
}
