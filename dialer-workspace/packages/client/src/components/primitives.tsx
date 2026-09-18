import { ReactNode, useEffect, useId, useRef } from 'react';
import { Icon, IconName } from './icons';

/**
 * The shared list surface. Every list page in the product is this shape: card container,
 * toolbar, uppercase column headers, an Action column hugging its icons, and a pager
 * reading "Showing N of M". Building it once is what keeps them consistent.
 */

/* --------------------------------------------------------------- buttons */

export function IconButton({
  icon,
  label,
  onClick,
  variant,
  disabled,
  title,
}: {
  icon: IconName;
  /** Icon-only buttons always carry an accessible name. */
  label: string;
  onClick?: () => void;
  variant?: 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`iba ${variant ?? ''}`}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Toolbar button: bigger, with a hover/focus tooltip carrying the same text as its name. */
export function ToolButton({
  icon,
  label,
  onClick,
  variant,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  variant?: 'primary';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tbtn ${variant ?? ''}`}
      data-tip={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

/* ------------------------------------------------------------- list card */

export function ListCard({ children }: { children: ReactNode }) {
  return <div className="listcard">{children}</div>;
}

export function Toolbar({
  title,
  titleNode,
  placeholder,
  query,
  onQuery,
  meta,
  actions,
}: {
  title?: string;
  titleNode?: ReactNode;
  placeholder: string;
  query: string;
  onQuery: (v: string) => void;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const searchId = useId();
  return (
    <div className="lctop">
      {titleNode ?? <h2>{title}</h2>}
      {meta}
      <div className="lctools">
        <div className="srch">
          <span className="ic" aria-hidden="true">
            ⌕
          </span>
          <label className="sr-only" htmlFor={searchId} style={{ position: 'absolute', left: -9999 }}>
            {placeholder}
          </label>
          <input
            id={searchId}
            type="search"
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        {actions}
      </div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Narrow action column that hugs its buttons. */
  action?: boolean;
  width?: string;
  render: (row: T, index: number) => ReactNode;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage,
  rowKey,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyMessage: string;
  rowKey: (row: T, index: number) => string;
  caption: string;
}) {
  return (
    <table className="dtable">
      <caption style={{ position: 'absolute', left: -9999 }}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.action ? 'thact' : undefined} style={c.width ? { width: c.width } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>
              <div className="emptyrow">{emptyMessage}</div>
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={onRowClick ? 'clickrow' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key}>{c.render(row, i)}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export function Pager({
  shown,
  total,
  page,
  pages,
  onPage,
}: {
  shown: number;
  total: number;
  page?: number;
  pages?: number;
  onPage?: (p: number) => void;
}) {
  const goId = useId();
  const simple = !onPage || !pages || pages <= 1;
  return (
    <nav className="pager" aria-label="Pagination">
      <span>
        Showing <b>{shown}</b> of {total.toLocaleString()}
      </span>
      <div className="right">
        {simple ? (
          <>
            <button className="pchip" disabled aria-label="Previous page">
              ‹
            </button>
            <button className="pchip on" aria-current="page">
              1
            </button>
            <button className="pchip" disabled aria-label="Next page">
              ›
            </button>
          </>
        ) : (
          <>
            <label htmlFor={goId}>Go to</label>
            <input
              id={goId}
              className="pgo"
              defaultValue={page}
              key={page}
              onBlur={(e) => onPage(Math.max(1, Math.min(Number(e.target.value) || 1, pages)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span>
              /{pages} page{pages > 1 ? 's' : ''}
            </span>
            <button
              className="pchip"
              disabled={(page ?? 1) <= 1}
              onClick={() => onPage((page ?? 1) - 1)}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              className="pchip"
              disabled={(page ?? 1) >= pages}
              onClick={() => onPage((page ?? 1) + 1)}
              aria-label="Next page"
            >
              ›
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------- modal/drawer */

function useDismiss(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(onClose);
  useEffect(() => {
    // Move focus into the dialog so a keyboard user is not left behind on the page.
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        style={wide ? { width: 'min(860px, calc(100vw - 48px))' } : undefined}
      >
        <div className="mh">
          <div>
            <h3 id={titleId}>{title}</h3>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="mb">{children}</div>
        {footer ? <div className="mf">{footer}</div> : null}
      </div>
    </>
  );
}

export function Drawer({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useDismiss(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mh">
          <div>
            <h3 id={titleId}>{title}</h3>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="mb">{children}</div>
        {footer ? <div className="mf">{footer}</div> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- fragments */

export function StatusPill({ running }: { running: boolean }) {
  return (
    <span className={`pill ${running ? '' : 'draft'}`}>
      <span className="dot" aria-hidden="true" />
      {running ? 'Running' : 'Draft'}
    </span>
  );
}

export function Stat({ tone, glyph, children }: { tone: 'ok' | 'no' | 'idle'; glyph: string; children: ReactNode }) {
  return (
    <span className={`stat ${tone}`}>
      <span className="dot2" aria-hidden="true">
        {glyph}
      </span>
      {children}
    </span>
  );
}

/** Inline-editable page title. Uncontrolled so typing never re-renders the input. */
export function EditableTitle({
  value,
  placeholder,
  onCommit,
  label,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
  label: string;
}) {
  return (
    <h2>
      <input
        className="h1edit"
        defaultValue={value}
        key={value}
        placeholder={placeholder}
        aria-label={label}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </h2>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="emptyrow" style={{ padding: '60px 20px' }}>
      <div style={{ fontSize: 15, color: 'var(--inkMuted)', marginBottom: 7 }}>{title}</div>
      <p style={{ maxWidth: 430, margin: '0 auto 16px', lineHeight: 1.6 }}>{body}</p>
      {action}
    </div>
  );
}
