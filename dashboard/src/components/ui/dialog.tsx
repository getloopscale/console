import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/**
 * Dialog — a centered, traditional modal compound, a DROP-IN replacement for the
 * `@usetheo/ui` `Dialog` (same sub-component API: `Dialog` root + `.Trigger` `.Close`
 * `.Content` `.Header` `.Body` `.Footer` `.Title` `.Description`).
 *
 * Why local? `@usetheo/ui@0.28.2` has a bug where `Dialog` and `Sheet` are the SAME
 * object (`DialogPrimitive.Root`) and `Sheet.Content` (a right-side DRAWER) is assigned
 * AFTER `Dialog.Content` (centered), clobbering it — so every `<Dialog.Content>` rendered
 * as a lateral sheet across the whole dashboard. This local compound is built directly on
 * `@radix-ui/react-dialog` and renders a proper CENTERED modal, so existing screens become
 * traditional modals by swapping ONLY the import (JSX unchanged). It delegates focus-trap /
 * focus-restore / ESC / overlay-click / the ARIA dialog contract to Radix (Rule 9).
 *
 * For NEW action screens, prefer `AppModal` (title/description/footer/size props). This
 * compound exists to un-lateral the existing `<Dialog.Content>` call sites cheaply.
 */

function Overlay(props: ComponentPropsWithoutRef<typeof RadixDialog.Overlay>) {
  return <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" {...props} />;
}

interface ContentProps extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  hideCloseButton?: boolean;
}

function Content({ className, children, hideCloseButton, ...props }: ContentProps) {
  return (
    <RadixDialog.Portal>
      <Overlay />
      <RadixDialog.Content
        className={twMerge(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-background p-6 text-foreground shadow-2xl animate-fade-in',
          className,
        )}
        {...props}
      >
        {children}
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
  );
}

function Header({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge('flex flex-col gap-1.5 pr-6', className)} {...props} />;
}

function Body({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge('min-h-0 flex-1 overflow-y-auto', className)} {...props} />;
}

function Footer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge('flex items-center justify-end gap-2', className)} {...props} />;
}

function Title({ className, ...props }: ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title
      className={twMerge('text-lg font-semibold leading-none tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

function Description({ className, ...props }: ComponentPropsWithoutRef<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className={twMerge('text-sm text-muted-foreground', className)} {...props} />;
}

/** `Dialog` root — same props as the `@usetheo/ui` Dialog (Radix Root: `open`, `onOpenChange`). */
export const Dialog = Object.assign(
  (props: ComponentPropsWithoutRef<typeof RadixDialog.Root>) => <RadixDialog.Root {...props} />,
  {
    Trigger: RadixDialog.Trigger,
    Close: RadixDialog.Close,
    Content,
    Overlay,
    Header,
    Body,
    Footer,
    Title,
    Description,
  },
);

export type { ReactNode };
