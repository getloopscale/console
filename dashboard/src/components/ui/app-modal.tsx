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
 * Why not the `@usetheo/ui` `Dialog`? The original reason was a bug: in
 * `@usetheo/ui@0.28.2` `Dialog` and `Sheet` were the SAME object, and `Sheet.Content =
 * <drawer>` ran after `Dialog.Content = <centered>` and clobbered it, so every "dialog"
 * rendered as a right-anchored drawer.
 *
 * THAT BUG IS FIXED. Measured on the installed `@usetheo/ui@0.35.1`
 * (2026-08-10): `dist/` ships a separate `primitives/dialog/`, and the bundle carries a
 * centered panel (`left-1/2 top-1/2 -translate-x-1/2`) alongside the lateral sheet
 * (`inset-y-0 right-0`). Leaving the old rationale in place would have been a Rule-9
 * justification that stopped being true — the kind of stale claim that outlives its
 * own reason and then defends whatever is there.
 *
 * So what still justifies a local primitive is NOT the bug; it is the width scale below
 * (`AppModalSize`), which is the whole point of this file: "how wide is a modal" has ONE
 * answer in this product. Adopting the upstream `Dialog` would mean either giving that
 * up or re-implementing it on top — a real question, and a separate one. It is filed
 * rather than decided here, because deciding it inside a consolidation plan is how a
 * migration turns into a redesign.
 *
 * Radix still owns focus-trap / focus-restore / ESC / overlay-click and the WAI-ARIA
 * `role="dialog"` + `aria-modal` contract (Rule 9 — Don't Reinvent).
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
  /**
   * Footer actions (e.g. Cancel + primary). Omitted → no footer region.
   *
   * ⚠️ The footer renders as a SIBLING of `children`, not inside it. A `type="submit"`
   * button here is therefore OUTSIDE any `<form>` in the body, and clicking it does
   * nothing — while the screen renders identically. This cost the modal consolidation
   * its most expensive defect; on a destructive confirmation it is the worst possible
   * failure mode, because the operator sees no error either.
   *
   * Give the `<form>` an `id` and the button `form="<id>"` — the native HTML association,
   * already the idiom in `create-project-sheet.tsx`. Enforced over EVERY call site by
   * `modal-primitive.test.ts § "todo botão de enviar dentro de um modal alcança o seu
   * form"`, not by review.
   */
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
