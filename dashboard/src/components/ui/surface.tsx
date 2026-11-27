import type { ElementType, ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';

/**
 * The blocks a page is made of, in the structure of the brand reference: a page header, and
 * surfaces. A surface is one bordered box on the card color, with an optional title strip and
 * rows split by a divider. A page built from these reads as the same product on every screen.
 */

/** The vertical rhythm between the surfaces of a page. */
export const STACK = 'space-y-4';

/** The widest a line of prose gets before it is hard to read. */
const READABLE = 'max-w-3xl';

export function PageHeader({
  title,
  lede,
  above,
  actions,
}: {
  title: ReactNode;
  /** One or two sentences under the title. */
  lede?: ReactNode;
  /** A line above the title, such as the way back. */
  above?: ReactNode;
  /** The actions of the page, on the right of the title. */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {above ? <div className="mb-1 text-sm text-muted-foreground">{above}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {lede ? <p className={`mt-1 text-sm text-muted-foreground ${READABLE}`}>{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SurfaceHeading({
  title,
  icon: Icon,
  count,
  lede,
  action,
  as: Tag = 'h2',
}: {
  title: ReactNode;
  icon?: ElementType;
  count?: number;
  lede?: ReactNode;
  action?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b border-border px-4 py-2">
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
      <Tag className="shrink-0 text-sm font-semibold text-foreground">{title}</Tag>
      {count !== undefined ? (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      ) : null}
      {lede ? <span className="ml-1 min-w-0 truncate text-xs text-muted-foreground">{lede}</span> : null}
      {action ? <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">{action}</span> : null}
    </div>
  );
}

export function Surface({
  title,
  icon,
  count,
  lede,
  action,
  label,
  padded = false,
  className = '',
  children,
}: {
  title?: ReactNode;
  icon?: ElementType;
  count?: number;
  lede?: ReactNode;
  action?: ReactNode;
  /** The name of the region when the title is absent or is not plain text. */
  label?: string;
  /** Pads the body. Leave it off for rows and tables, which reach the border. */
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={`w-full overflow-hidden rounded-xl border border-border bg-card ${className}`}
    >
      {title ? <SurfaceHeading title={title} icon={icon} count={count} lede={lede} action={action} /> : null}
      {padded ? <div className="space-y-3 p-4">{children}</div> : children}
    </section>
  );
}

export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {children}
    </ul>
  );
}

const ROW = 'flex w-full items-center gap-3 px-4 py-2.5 text-left';

export function Row({
  to,
  lead,
  title,
  meta,
  trail,
  children,
}: {
  /** Makes the whole row a link. */
  to?: To;
  /** What comes before the text: an icon or a status dot. */
  lead?: ReactNode;
  title?: ReactNode;
  /** A second line in the mono typeface: an id, a kind, a hash. */
  meta?: ReactNode;
  /** What sits at the right end: a time, a badge, a button. */
  trail?: ReactNode;
  /** Replaces title and meta when the row needs its own body. */
  children?: ReactNode;
}) {
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        {children ?? (
          <>
            {title ? <span className="block truncate text-sm font-medium text-foreground">{title}</span> : null}
            {meta ? (
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{meta}</span>
            ) : null}
          </>
        )}
      </span>
      {trail ? (
        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">{trail}</span>
      ) : null}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className={`${ROW} hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring`}>
          {body}
        </Link>
      ) : (
        <div className={ROW}>{body}</div>
      )}
    </li>
  );
}

/** A line of muted text inside a surface: nothing to list, or a note. */
export function Quiet({ children, role }: { children: ReactNode; role?: 'status' }) {
  return (
    <p role={role} className="px-4 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Figures side by side: the name above, the value in the mono typeface. */
export function Stats({
  items,
  label,
}: {
  items: { label: ReactNode; value: ReactNode; note?: ReactNode; icon?: ElementType }[];
  label?: string;
}) {
  return (
    <dl aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] divide-x divide-border">
      {items.map(({ label: name, value, note, icon: Icon }, index) => (
        <div key={index} className="px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
            {name}
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">{value}</dd>
          {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
