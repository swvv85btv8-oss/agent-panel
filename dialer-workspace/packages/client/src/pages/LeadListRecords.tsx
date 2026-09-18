import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CustomColumn,
  DedupeScope,
  DuplicateMode,
  FixedColumn,
  LeadList,
  MAX_CUSTOM,
  VisibleColumn,
  maskValue,
  shouldMask,
} from '@dialer/shared';
import { api, qs, type Page } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import {
  DataTable,
  Drawer,
  EmptyState,
  IconButton,
  ListCard,
  Modal,
  Pager,
  Toolbar,
  ToolButton,
} from '../components/primitives';
import { Icon } from '../components/icons';

interface ListDetail extends LeadList {
  columns: number;
  visibleColumns: VisibleColumn[];
}
type Row = Record<string, string> & { id: string };

export default function LeadListRecords() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [structureOpen, setStructureOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const debounced = useDebounced(query);

  const { data: list, reload: reloadList } = useAsync<ListDetail>(
    () => api.get(`/lead-lists/${id}`),
    [id, version],
  );
  const { data: records, reload: reloadRecords } = useAsync<Page<Row> & { columns: VisibleColumn[] }>(
    () => api.get(`/lead-lists/${id}/records${qs({ q: debounced, page, perPage: 10 })}`),
    [id, debounced, page, version],
  );

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/library/lead-lists">Lead Lists</Link>
        <span className="sep">/</span>
        <b>{list?.name || 'Untitled'}</b>
      </>,
    );
    setRail(<BackLink label={from ? 'Back to campaign' : 'All lead lists'} to={from ?? '/library/lead-lists'} />);
  }, [setCrumb, setRail, list?.name, from]);

  useEffect(() => {
    setFooter(
      <>
        <div className="st">
          {list ? `${list.visibleColumns.length} visible columns · ${list.records.toLocaleString()} records` : ''}
        </div>
        <div className="act">
          <button className="btn sec" onClick={() => setStructureOpen(true)} type="button">
            Edit structure
          </button>
          <button className="btn pri" onClick={() => nav(from ?? '/library/lead-lists')} type="button">
            Done
          </button>
        </div>
      </>,
    );
  }, [setFooter, list, nav, from]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  if (!list) return <div className="wrap">Loading…</div>;

  const cols = records?.columns ?? list.visibleColumns;
  const hidden = list.custom.filter((c) => c.hidden).length;
  const masked = [...list.fixed, ...list.custom].filter((c) => c.sensitive).length;

  return (
    <div className="wrap wide">
      {banner ? <div className="note">{banner}</div> : null}
      <ListCard>
        <Toolbar
          titleNode={
            <h2>
              <input
                className="h1edit"
                defaultValue={list.name}
                key={list.id}
                placeholder="Name this lead list"
                aria-label="Lead list name"
                onBlur={async (e) => {
                  if (e.target.value !== list.name) {
                    await api.patch(`/lead-lists/${id}`, { name: e.target.value });
                    reloadList();
                  }
                }}
              />
            </h2>
          }
          meta={
            <span className="metapill">
              {list.records.toLocaleString()} records · {cols.length} columns
              {hidden ? ` · ${hidden} hidden` : ''}
              {masked ? ` · ${masked} masked` : ''}
            </span>
          }
          placeholder="Search records"
          query={query}
          onQuery={(v) => {
            setQuery(v);
            setPage(1);
          }}
          actions={
            <>
              <ToolButton icon="sliders" label="Edit structure" onClick={() => setStructureOpen(true)} />
              <ToolButton
                icon="download"
                label="Download sample CSV"
                onClick={() => window.open(`/api/lead-lists/${id}/sample.csv`, '_blank')}
              />
              <ToolButton icon="upload" label="Upload leads" variant="primary" onClick={() => setUploadOpen(true)} />
              <ToolButton icon="more" label="More actions" onClick={() => setMoreOpen(true)} />
            </>
          }
        />
        {list.records ? (
          <>
            <div className="tablewrap">
              <DataTable<Row>
                caption={`Records in ${list.name}`}
                rows={records?.rows ?? []}
                rowKey={(r) => r.id}
                onRowClick={(r) => setEditing(r)}
                emptyMessage={`No records match "${query}".`}
                columns={[
                  {
                    key: 'n',
                    header: 'S.No.',
                    width: '52px',
                    render: (_r, i) => (
                      <span className="dt-num">{((records?.page ?? 1) - 1) * 10 + i + 1}</span>
                    ),
                  },
                  ...cols.map((c, ci) => ({
                    key: c.key,
                    header: (
                      <>
                        {c.label}
                        {c.sensitive ? <span className="mtag">masked</span> : null}
                      </>
                    ),
                    render: (r: Row) => {
                      // Admin masking follows POLICY.sensitiveScope (open decision §10.5).
                      const mask = shouldMask(c, 'admin');
                      return (
                        <span className={ci === 0 ? 'dt-link2' : mask ? 'dt-mask' : 'dt-cell'}>
                          {mask ? maskValue(r[c.key], c.phone) : r[c.key]}
                        </span>
                      );
                    },
                  })),
                  {
                    key: 'action',
                    header: 'Action',
                    action: true,
                    render: (r: Row) => (
                      <div className="rowact">
                        <IconButton icon="edit" label="Edit lead" variant="primary" onClick={() => setEditing(r)} />
                        <IconButton
                          icon="trash"
                          label="Remove lead"
                          variant="danger"
                          onClick={async () => {
                            if (!window.confirm(`Remove ${r.name || 'this lead'} (${r.phone})?`)) return;
                            await api.del(`/lead-lists/${id}/records/${r.id}`);
                            setVersion((v) => v + 1);
                          }}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <Pager
              shown={records?.rows.length ?? 0}
              total={records?.total ?? 0}
              page={records?.page}
              pages={records?.pages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No records yet"
            body={`This list has ${cols.length} columns defined. Download the sample file, fill it, and upload — the template always matches the structure.`}
            action={
              <button className="hdrbtn" onClick={() => setUploadOpen(true)} type="button">
                <Icon name="upload" /> Upload leads
              </button>
            }
          />
        )}
      </ListCard>

      {structureOpen ? (
        <StructureDrawer
          list={list}
          onClose={() => {
            setStructureOpen(false);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
      {uploadOpen ? (
        <UploadModal
          list={list}
          onClose={() => setUploadOpen(false)}
          onDone={(msg) => {
            setBanner(msg);
            setUploadOpen(false);
            setPage(1);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
      {editing ? (
        <LeadEditor
          list={list}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadRecords();
          }}
        />
      ) : null}
      {moreOpen ? (
        <Modal title={list.name || 'Lead list'} sub="List-level actions." onClose={() => setMoreOpen(false)}>
          <button
            className="libitem"
            type="button"
            style={{ cursor: 'pointer' }}
            onClick={() => window.open(`/api/lead-lists/${id}/sample.csv`, '_blank')}
          >
            <div>
              <div className="nm">Download sample CSV</div>
              <div className="meta">Header row generated from the {cols.length} columns in this list</div>
            </div>
          </button>
          <button
            className="libitem"
            type="button"
            style={{ cursor: 'pointer' }}
            onClick={async () => {
              const copy = await api.post<{ id: string }>(`/lead-lists/${id}/duplicate`);
              setMoreOpen(false);
              nav(`/library/lead-lists/${copy.id}`);
            }}
          >
            <div>
              <div className="nm">Clone list</div>
              <div className="meta">Copies the structure, leaves the records behind</div>
            </div>
          </button>
          <button
            className="libitem"
            type="button"
            style={{ cursor: 'pointer' }}
            onClick={async () => {
              if (!window.confirm(`Clear all ${list.records.toLocaleString()} records? The ${cols.length} columns stay.`))
                return;
              await api.post(`/lead-lists/${id}/records/clear`);
              setMoreOpen(false);
              setVersion((v) => v + 1);
            }}
          >
            <div>
              <div className="nm" style={{ color: 'var(--dangerText)' }}>
                Clear records
              </div>
              <div className="meta">
                Empties the list but keeps the {cols.length} columns, so it can be reloaded next month
              </div>
            </div>
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- structure */

function StructureDrawer({ list, onClose }: { list: ListDetail; onClose: () => void }) {
  const [fixed, setFixed] = useState<FixedColumn[]>(list.fixed);
  const [custom, setCustom] = useState<CustomColumn[]>(list.custom);
  const [warning, setWarning] = useState<string | null>(null);
  const room = MAX_CUSTOM - custom.length;

  const save = async () => {
    const res = await api.patch<{ removedColumns: Array<{ label: string }>; affectedRecords: number }>(
      `/lead-lists/${list.id}/schema`,
      { fixed, custom },
    );
    if (res.removedColumns.length && res.affectedRecords) {
      window.alert(
        `${res.removedColumns.map((c) => c.label || 'Untitled').join(', ')} removed from ` +
          `${res.affectedRecords.toLocaleString()} records.`,
      );
    }
    onClose();
  };

  const removeCustom = (i: number) => {
    const col = custom[i];
    if (list.records && !window.confirm(
      `Remove "${col.label || 'this column'}"? ${list.records.toLocaleString()} records already carry it.`,
    )) {
      return;
    }
    setCustom(custom.filter((_, x) => x !== i));
  };

  const preview = [
    ...fixed.map((f) => f.label),
    ...custom.filter((c) => !c.hidden).map((c) => c.label || 'Untitled'),
  ];

  return (
    <Drawer
      title="Structure"
      sub={`Six fixed columns, plus up to ${MAX_CUSTOM} of your own. Changes apply to the records already loaded.`}
      onClose={onClose}
      footer={
        <button className="btn pri" onClick={save} type="button">
          Save
        </button>
      }
    >
      <div className="sechead" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--label)', marginBottom: 10 }}>
        Fixed columns
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {fixed.map((f, i) => (
          <div
            key={f.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radiusControlLg)',
              padding: '10px 12px',
              background: 'var(--inputSubtle)',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 2 }}>{f.note}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              {f.nosens ? (
                // phone is dialed and altphone is a real number: neither can be masked.
                <span className="ib" style={{ borderStyle: 'dashed', opacity: 0.65, cursor: 'default' }}>
                  always visible
                </span>
              ) : (
                <button
                  type="button"
                  className="ib"
                  aria-pressed={f.sensitive}
                  style={
                    f.sensitive
                      ? { background: 'var(--accentSoft)', borderColor: 'var(--accentBorder)', color: 'var(--accentDark)' }
                      : undefined
                  }
                  onClick={() => setFixed(fixed.map((x, j) => (j === i ? { ...x, sensitive: !x.sensitive } : x)))}
                >
                  {f.sensitive ? 'Masked' : 'Mask'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--label)', margin: '22px 0 10px', display: 'flex', gap: 9 }}>
        Your columns
        <span className="mtag" style={{ fontFamily: 'var(--fontMono)' }}>
          {custom.length} of {MAX_CUSTOM}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {custom.length ? (
          custom.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radiusControlLg)',
                padding: '10px 12px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  value={c.label}
                  placeholder="Column name"
                  aria-label={`Custom column ${i + 1} name`}
                  style={{ width: '100%', border: '1px solid var(--borderInput)', borderRadius: 7, padding: '7px 9px', fontSize: 13 }}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 2 }}>Field {6 + i}</div>
              </div>
              <button
                type="button"
                className="ib"
                aria-pressed={c.sensitive}
                title="Masked in the agent panel"
                style={c.sensitive ? { background: 'var(--accentSoft)', borderColor: 'var(--accentBorder)', color: 'var(--accentDark)' } : undefined}
                onClick={() => setCustom(custom.map((x, j) => (j === i ? { ...x, sensitive: !x.sensitive } : x)))}
              >
                Mask
              </button>
              <button
                type="button"
                className="ib"
                aria-pressed={c.hidden}
                title="Excluded from the agent panel and the sample CSV"
                style={c.hidden ? { background: 'var(--accentSoft)', borderColor: 'var(--accentBorder)', color: 'var(--accentDark)' } : undefined}
                onClick={() => setCustom(custom.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)))}
              >
                Hide
              </button>
              <IconButton icon="x" label={`Remove column ${c.label || i + 1}`} onClick={() => removeCustom(i)} />
            </div>
          ))
        ) : (
          <div className="empty">None yet. The six fixed columns are often enough to start.</div>
        )}
      </div>
      <button
        className="addlink"
        style={{ marginTop: 12 }}
        disabled={room <= 0}
        onClick={() => setCustom([...custom, { id: '', label: '', sensitive: false, hidden: false }])}
        type="button"
      >
        {room > 0 ? `+ Add column (${room} left)` : `All ${MAX_CUSTOM} columns used`}
      </button>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--label)', margin: '24px 0 10px' }}>
        Sample file
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: 12, background: '#fbfcfd', border: '1px solid var(--border)', borderRadius: 'var(--radiusControl)' }}>
        {preview.map((label, i) => (
          <span
            key={i}
            style={{ fontFamily: 'var(--fontMono)', fontSize: 11.5, background: 'var(--surface)', border: '1px solid var(--borderInput)', borderRadius: 5, padding: '4px 9px', color: 'var(--inkMuted)' }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="help" style={{ marginTop: 8 }}>
        Hidden columns are excluded from the template and never reach the agent panel.
      </div>
      {warning ? <div className="warnbox">{warning}</div> : null}
    </Drawer>
  );
}

/* ---------------------------------------------------------------- upload */

function UploadModal({
  list,
  onClose,
  onDone,
}: {
  list: ListDetail;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip');
  const [dedupeScope, setDedupeScope] = useState<DedupeScope>('list');
  const [busy, setBusy] = useState(false);

  /** The POC posts generated rows rather than parsing a CSV, so the duplicate rules are
      exercised end to end without a file picker in the way. */
  const run = async () => {
    setBusy(true);
    try {
      const rows = Array.from({ length: 25 }, (_, i) => {
        const row: Record<string, string> = {
          phone: `+9190${String(10000000 + Math.floor(Math.random() * 8999999)).slice(0, 8)}`,
          name: `Uploaded ${i + 1}`,
          email: `uploaded${i + 1}@example.com`,
        };
        list.custom.forEach((c) => {
          row[c.id] = `Value ${i + 1}`;
        });
        return row;
      });
      const res = await api.post<{ added: number; skipped: number; overwritten: number; cloned: number }>(
        `/lead-lists/${list.id}/records/upload`,
        { rows, duplicateMode, dedupeScope },
      );
      onDone(
        `Uploaded. ${res.added} added, ${res.skipped} skipped, ${res.overwritten} overwritten, ` +
          `${res.cloned} cloned across ${list.visibleColumns.length} columns.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const radio = <T extends string>(
    group: string,
    current: T,
    setter: (v: T) => void,
    options: Array<[T, string, string]>,
  ) => (
    <div className="radios" role="radiogroup" aria-label={group}>
      {options.map(([value, title, desc]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          className="radio"
          onClick={() => setter(value)}
        >
          <span className="rt">{title}</span>
          <span className="rd">{desc}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      title="Upload leads"
      sub={`Matched against the ${list.visibleColumns.length} columns in ${list.name}.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={run} disabled={busy} type="button">
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      <button className="drop" type="button" onClick={run}>
        Choose a file, or drop it here
      </button>
      <div className="help" style={{ marginTop: 7 }}>
        Up to 100MB, maximum 5 lakh records per upload.
        <button
          className="addlink"
          style={{ padding: '0 4px' }}
          type="button"
          onClick={() => window.open(`/api/lead-lists/${list.id}/sample.csv`, '_blank')}
        >
          Download sample CSV
        </button>
      </div>

      <div className="f" style={{ marginTop: 22 }}>
        <label>When a number already exists</label>
        {radio<DuplicateMode>('When a number already exists', duplicateMode, setDuplicateMode, [
          ['skip', 'Skip', 'Keep what is already there'],
          ['overwrite', 'Overwrite', 'Replace it with the new row'],
          ['clone', 'Clone', 'Keep both copies'],
        ])}
      </div>
      <div className="f" style={{ marginTop: 18 }}>
        <label>Look for duplicates in</label>
        {radio<DedupeScope>('Look for duplicates in', dedupeScope, setDedupeScope, [
          ['list', 'This list only', 'Faster, and normal for a fresh monthly file'],
          ['all', 'Every lead list', 'Stops the same person being dialed from two campaigns'],
        ])}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ lead detail */

function LeadEditor({
  list,
  row,
  onClose,
  onSaved,
}: {
  list: ListDetail;
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Row>({ ...row });
  const changed = Object.keys(draft).filter((k) => String(draft[k] ?? '') !== String(row[k] ?? ''));

  const save = async () => {
    await api.patch(`/lead-lists/${list.id}/records/${row.id}`, draft);
    onSaved();
  };

  const field = (key: string, label: string, flags?: { sensitive?: boolean; hidden?: boolean }) => (
    <div className="f" key={key}>
      <label htmlFor={`lead-${key}`}>
        {label}
        {changed.includes(key) ? <span className="dirty" aria-label="Changed" /> : null}
        {flags?.sensitive ? <span className="mtag">masked for agents</span> : null}
        {flags?.hidden ? <span className="mtag">hidden from agents</span> : null}
      </label>
      <input
        id={`lead-${key}`}
        value={draft[key] ?? ''}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Modal
      title={draft.name || draft.phone || 'Lead'}
      sub={`In ${list.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className={`btn pri ${changed.length ? '' : 'blocked'}`} onClick={save} type="button">
            Save lead
          </button>
        </>
      }
    >
      <div className="grid">
        {list.fixed.map((f) => field(f.key, f.label, { sensitive: f.sensitive }))}
      </div>
      {list.custom.length ? (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--label)', margin: '22px 0 12px' }}>
            {list.custom.length} custom columns
          </div>
          <div className="grid">
            {list.custom.map((c) => field(c.id, c.label || 'Untitled column', { sensitive: c.sensitive, hidden: c.hidden }))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
