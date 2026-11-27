import { useEffect, type ElementType, type ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ActionBar, Button, EmptyState } from '@getloopscale/ui';
import { PageHeader, STACK, Surface } from './surface';

/**
 * The frame of a page: the header, the search of the page, and the body or the state that stands
 * in for it (loading, error, empty). It takes the props of the design system's PageShell and
 * lays them out as the brand reference does: the main action sits on the header line and is
 * neutral, because the brand color marks where you are and does not fill buttons.
 */
export interface PageShellProps {
  title: string;
  description?: ReactNode;
  /** Called with the title, so the layout can name the browser tab. */
  onTitleChange?: (title: string) => void;
  primaryAction?: {
    label: ReactNode;
    icon?: ElementType;
    onClick: () => void;
    loading?: boolean;
  };
  search?: {
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
  };
  onFilterClick?: () => void;
  loading?: boolean;
  /** Replaces the default loading surface, for a skeleton of the page. */
  loadingNode?: ReactNode;
  error?: {
    message: string;
    onRetry?: () => void;
    docsHref?: string;
  };
  empty?: {
    icon?: ElementType;
    title: string;
    description?: ReactNode;
    action?: { label: string; onClick: () => void };
  };
  children?: ReactNode;
  className?: string;
}

export function PageShell({
  title,
  description,
  onTitleChange,
  primaryAction,
  search,
  onFilterClick,
  loading = false,
  loadingNode,
  error,
  empty,
  children,
  className = '',
}: PageShellProps) {
  useEffect(() => {
    onTitleChange?.(title);
  }, [title, onTitleChange]);

  let content: ReactNode;
  if (loading) {
    content = loadingNode ?? (
      <Surface label="Loading">
        <div className="flex items-center justify-center gap-3 p-12 text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </Surface>
    );
  } else if (error) {
    content = (
      <Surface label="Error">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertCircle aria-hidden="true" className="size-8 text-destructive" />
          <p className="text-sm text-foreground">{error.message}</p>
          <div className="flex items-center gap-3">
            {error.onRetry ? (
              <Button variant="secondary" size="sm" onClick={error.onRetry}>
                Retry
              </Button>
            ) : null}
            {error.docsHref ? (
              <a href={error.docsHref} className="text-sm text-foreground underline underline-offset-4">
                View docs
              </a>
            ) : null}
          </div>
        </div>
      </Surface>
    );
  } else if (empty) {
    const emptyAction = empty.action;
    content = (
      <EmptyState
        icon={empty.icon as Parameters<typeof EmptyState>[0]['icon']}
        title={empty.title}
        description={empty.description}
        action={
          emptyAction ? (
            <Button variant="primary" size="sm" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    content = children;
  }

  const ActionIcon = primaryAction?.icon;

  return (
    <div data-slot="page-shell" aria-busy={loading || undefined} className={`${STACK} ${className}`}>
      <PageHeader
        title={title}
        lede={description}
        actions={
          primaryAction ? (
            <Button variant="primary" size="sm" onClick={primaryAction.onClick} disabled={primaryAction.loading}>
              {primaryAction.loading ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : ActionIcon ? (
                <ActionIcon aria-hidden="true" className="size-4" />
              ) : null}
              {primaryAction.label}
            </Button>
          ) : undefined
        }
      />
      {search !== undefined || onFilterClick !== undefined ? (
        <ActionBar search={search} onFilterClick={onFilterClick} />
      ) : null}
      <div className={STACK}>{content}</div>
    </div>
  );
}
