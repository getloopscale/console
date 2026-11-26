import { Alert as UiAlert, type AlertProps } from '@getloopscale/ui';

/**
 * `Alert` — a thin guard over the `@getloopscale/ui` `Alert` that closes issue getloopscale/loop-console#175.
 *
 * The design-system `Alert` renders only `title` / `description` / `action` and **silently drops JSX
 * `children`** (which its type still allows via `HTMLAttributes`), so `<Alert>{body}</Alert>` shipped
 * title-only errors across the dashboard. This wrapper forwards every prop unchanged, but when a body
 * is passed as `children` and no explicit `description` is given, it renders the `children` as the
 * `description` so the actionable detail is visible AND announced (non-destructive Alerts are
 * `role="status"`). An explicit `description` always wins — `children` is the fallback only.
 *
 * Import THIS as `Alert` in feature pages; the safe path is then the default. (Upstream hardening —
 * `Omit<…, "children">` on `AlertProps` — is filed separately.)
 */
export function Alert({ description, children, ...rest }: AlertProps & { children?: React.ReactNode }) {
  const body = description ?? children;
  return <UiAlert description={body} {...rest} />;
}

export type { AlertProps };
