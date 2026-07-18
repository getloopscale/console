import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/**
 * AppModal — the system-wide standardized modal primitive.
 *
 * A traditional CENTERED modal (overlay + centered panel), built directly on
 * `@radix-ui/react-dialog` so it renders correctly regardless of the design system.
 *
 * Why not the `@usetheo/ui` `Dialog`? In `@usetheo/ui@0.28.2` both `Dialog` and `Sheet`
 * are the SAME object (`DialogPrimitive.Root`), and `Sheet.Content = <drawer>` runs after
 * `Dialog.Content = <centered>`, clobbering it — so `Dialog.Content` renders as a right-
 * anchored SHEET (drawer) everywhere. AppModal bypasses that bug by composing Radix
 * primitives itself, and delegates focus-trap / focus-restore / ESC / overlay-click / the
 * WAI-ARIA `role="dialog"` + `aria-modal` contract to Radix (Rule 9 — Don't Reinvent).
 *
 * Use this instead of `<Dialog.Content>` for every transient action screen — it is the
 * traditional-modal pattern for the whole dashboard (New folder / New page / connect / …).
 *
 * Controlled only: pass `open` + `onClose`. All exits (ESC / overlay / X) call `onClose`.
 */
export type AppModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** Size token → max-width. One width scale instead of an ad-hoc `max-w-*` per call site. */
const SIZE_MAX_WIDTH: Record<AppModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface AppModalProps {
  /** Controlled open state. */
  readonly open: boolean;
  /** Called on every close path (ESC / overlay / close button). */
  readonly onClose: () => void;
  /** The dialog's accessible name — required (Radix warns without a Title). */
  readonly title: ReactNode;
  /** Optional supporting copy under the title. */
  readonly description?: ReactNode;
  /** Width token — defaults to `md`. */
  readonly size?: AppModalSize;
  /** Footer actions (e.g. Cancel + primary). Omitted → no footer region. */
  readonly footer?: ReactNode;
  /** Modal body. */
  readonly children?: ReactNode;
  /** Escape hatch for a rare bespoke width/spacing; merged after the size token. */
  readonly contentClassName?: string;
  /** Hide the built-in close (X) button (Radix still closes on ESC/overlay). */
  readonly hideCloseButton?: boolean;
}

export function AppModal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  contentClassName,
  hideCloseButton,
}: AppModalProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
        <RadixDialog.Content
          className={twMerge(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-background p-6 text-foreground shadow-2xl animate-fade-in',
            SIZE_MAX_WIDTH[size],
            contentClassName,
          )}
        >
          <div className="flex flex-col gap-1.5 pr-6">
            <RadixDialog.Title className="text-lg font-semibold leading-none tracking-tight text-foreground">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-sm text-muted-foreground">{description}</RadixDialog.Description>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2">{footer}</div> : null}
          {!hideCloseButton ? (
            <RadixDialog.Close
              aria-label="Close"
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </RadixDialog.Close>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
