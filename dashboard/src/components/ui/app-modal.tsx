import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { Dialog } from '@usetheo/ui';

/**
 * AppModal — the system-wide standardized modal primitive (M14).
 *
 * A thin, opinionated wrapper over the design-system `Dialog` (which is built on
 * `@radix-ui/react-dialog`). It does NOT reimplement any dialog behaviour — focus
 * trap, focus RESTORE to the trigger, ESC-to-close, overlay-click, scroll lock and
 * the WAI-ARIA `role="dialog"` / `aria-modal` contract are all delegated to Radix
 * (Rule 9 — Don't Reinvent). What it standardizes is the *shape* every transient
 * action screen should share: a `size` token, a required `title` (the dialog's
 * accessible name), an optional `description`, a body, and a footer-actions slot.
 *
 * Use this instead of hand-rolling `<Dialog.Content>` per screen — it is the pattern
 * for New-folder / New-page / and future action dialogs across the dashboard.
 *
 * Controlled only: pass `open` + `onClose`. All three exits (ESC, overlay, X) route
 * through Radix's `onOpenChange(false)` → `onClose`.
 *
 * @example
 *   <AppModal open={open} onClose={close} title="New folder" size="sm"
 *     footer={<><Button variant="secondary" onClick={close}>Cancel</Button>
 *              <Button onClick={create}>Create folder</Button></>}>
 *     <Input ... />
 *   </AppModal>
 */
export type AppModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** Size token → max-width. The wrapper's single reason to exist beyond `Dialog`:
 * one width scale instead of an ad-hoc `max-w-*` per call site. */
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
  /** Optional supporting copy under the title (the dialog's description). */
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* twMerge so the size token wins over any default `max-w-*` on Content,
          instead of relying on Tailwind stylesheet order (a real bug for widths
          smaller than the default). */}
      <Dialog.Content hideCloseButton={hideCloseButton} className={twMerge('w-full', SIZE_MAX_WIDTH[size], contentClassName)}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          {description ? <Dialog.Description>{description}</Dialog.Description> : null}
        </Dialog.Header>
        <Dialog.Body>{children}</Dialog.Body>
        {footer ? <Dialog.Footer>{footer}</Dialog.Footer> : null}
      </Dialog.Content>
    </Dialog>
  );
}
