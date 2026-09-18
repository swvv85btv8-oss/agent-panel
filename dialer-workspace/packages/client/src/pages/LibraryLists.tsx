import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIBRARY_GROUPS, LibraryKey } from '@dialer/shared';
import { api, qs, type Page } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import {
  Column,
  DataTable,
  IconButton,
  ListCard,
  Modal,
  Note,
  Pager,
  Stat,
  Toolbar,
  ToolButton,
} from '../components/primitives';
import { LIBRARY_ROUTES, useShell } from '../components/Shell';
import { SurveyTypeDrawer } from '../components/campaign/InlineCreate';

interface Row {
  id: string;
  name: string;
  def?: boolean;
  usedByCampaigns: number;
  [key: string]: unknown;
}

/** Shared scaffolding: every library list page is the same shape, differing only in columns. */
function LibraryPage({
  libKey,
  endpoint,
  searchPlaceholder,
  columns,
  extraActions,
  onCreate,
  note,
  onOpen,
}: {
  libKey: LibraryKey;
  endpoint: string;
  searchPlaceholder: string;
  columns: (reload: () => void) => Column<Row>[];
  extraActions?: ReactNode;
  onCreate: () => void;
  note: ReactNode;
  onOpen: (row: Row) => void;
}) {
  const { setCrumb, setRail, setFooter } = useShell();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const route = LIBRARY_ROUTES[libKey];
  const group = LIBRARY_GROUPS.find((g) => g.keys.includes(libKey));

  const { data, reload } = useAsync<Page<Row>>(
    () => api.get(`${endpoint}${qs({ q: debounced, perPage: 50 })}`),
    [debounced, endpoint],
  );

  useEffect(() => {
    setCrumb(
      <>
        <span>Library</span>
        <span className="sep">/</span>
        <b>{route.title}</b>
      </>,
    );
    setRail(null);
    setFooter(null);
  }, [setCrumb, setRail, setFooter, route.title]);

  const rows = data?.rows ?? [];

  return (
    <div className="wrap wide">
      <ListCard>
        <Toolbar
          title={route.title}
          placeholder={searchPlaceholder}
          query={query}
          onQuery={setQuery}
          actions={
            <>
              {extraActions}
              <ToolButton icon="plus" label={`Add ${route.singular}`} variant="primary" onClick={onCreate} />
            </>
          }
        />
        <DataTable<Row>
          caption={route.title}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={onOpen}
          emptyMessage={query ? `Nothing matches "${query}".` : `No ${route.title.toLowerCase()} yet.`}
          columns={columns(reload)}
        />
        <Pager shown={rows.length} total={data?.total ?? 0} />
      </ListCard>
      <Note>
        {group ? `${group.sub} ` : ''}
        {note}
      </Note>
    </div>
  );
}

/** Name + "seeded default" subtitle, used by every library list. */
const nameColumn = (): Column<Row> => ({
  key: 'name',
  header: 'Name',
  render: (r) => (
    <>
      <span className="dt-link">{r.name || 'Untitled'}</span>
      {r.def ? <div className="dt-sub">Seeded default</div> : null}
    </>
  ),
});

const usageColumn = (): Column<Row> => ({
  key: 'used',
  header: 'Used by',
  render: (r) => (
    <span className="dt-num">
      {r.usedByCampaigns} campaign{r.usedByCampaigns === 1 ? '' : 's'}
    </span>
  ),
});

function actionColumn(
  endpoint: string,
  reload: () => void,
  open: (r: Row) => void,
  extra?: (r: Row) => ReactNode,
): Column<Row> {
  return {
    key: 'action',
    header: 'Action',
    action: true,
    render: (r) => (
      <div className="rowact">
        <IconButton icon="edit" label={`Edit ${r.name}`} variant="primary" onClick={() => open(r)} />
        {extra?.(r)}
        <IconButton
          icon="copy"
          label={`Duplicate ${r.name}`}
          onClick={async () => {
            await api.post(`${endpoint}/${r.id}/duplicate`);
            reload();
          }}
        />
        <IconButton
          icon="trash"
          label={`Delete ${r.name}`}
          variant="danger"
          disabled={r.def}
          title={r.def ? 'The seeded default cannot be deleted' : `Delete ${r.name}`}
          onClick={async () => {
            if (!window.confirm(`Delete "${r.name}"? Campaigns using it will need another one.`)) return;
            await api.del(`${endpoint}/${r.id}`);
            reload();
          }}
        />
      </div>
    ),
  };
}

/* ------------------------------------------------------------------- pages */

export function DispositionsList() {
  const nav = useNavigate();
  const open = (r: Row) => nav(`/library/dispositions/${r.id}`);
  return (
    <LibraryPage
      libKey="disposition"
      endpoint="/disposition-sets"
      searchPlaceholder="Search disposition sets"
      onOpen={open}
      onCreate={async () => {
        const created = await api.post<{ id: string }>('/disposition-sets', { name: '' });
        nav(`/library/dispositions/${created.id}`);
      }}
      note="Outcome codes agents pick after a call, up to five relational levels. Actions cascade down the path."
      columns={(reload) => [
        nameColumn(),
        { key: 'n', header: 'Dispositions', render: (r) => <span className="dt-num">{String(r.dispositions)}</span> },
        { key: 'levels', header: 'Levels', render: (r) => <span className="dt-num">{String(r.levels)}</span> },
        {
          key: 'actions',
          header: 'Actions attached',
          render: (r) => {
            const n = Number(r.actions);
            const dnd = Number(r.dndActions);
            return n ? (
              <Stat tone={dnd ? 'no' : 'ok'} glyph={dnd ? '!' : '✓'}>
                {n}
                {dnd ? ` · ${dnd} DND` : ''}
              </Stat>
            ) : (
              <Stat tone="idle" glyph="·">
                None
              </Stat>
            );
          },
        },
        usageColumn(),
        actionColumn('/disposition-sets', reload, open),
      ]}
    />
  );
}

export function SurveysList() {
  const nav = useNavigate();
  const [picking, setPicking] = useState(false);
  const open = (r: Row) => nav(`/library/surveys/${r.id}`);
  return (
    <>
      <LibraryPage
        libKey="csat"
        endpoint="/surveys"
        searchPlaceholder="Search surveys"
        onOpen={open}
        onCreate={() => setPicking(true)}
        note="A voice CSAT plays recordings and reads keypad digits; a web survey is a form the agent fills in. The type is fixed at creation."
        columns={(reload) => [
          nameColumn(),
          {
            key: 'type',
            header: 'Type',
            render: (r) => (
              <Stat tone={r.type === 'voice' ? 'ok' : 'idle'} glyph={r.type === 'voice' ? '♪' : '≡'}>
                {r.type === 'voice' ? 'Voice' : 'Web'}
              </Stat>
            ),
          },
          { key: 'entries', header: 'Questions / entries', render: (r) => <span className="dt-num">{String(r.entries)}</span> },
          usageColumn(),
          actionColumn('/surveys', reload, open),
        ]}
      />
      {picking ? (
        <SurveyTypeDrawer
          onClose={() => setPicking(false)}
          onPick={async (type) => {
            const created = await api.post<{ id: string }>('/surveys', { name: '', type });
            setPicking(false);
            nav(`/library/surveys/${created.id}`);
          }}
        />
      ) : null}
    </>
  );
}

export function DndLists() {
  const nav = useNavigate();
  const open = (r: Row) => nav(`/library/dnd/${r.id}`);
  return (
    <LibraryPage
      libKey="dnd"
      endpoint="/dnd-lists"
      searchPlaceholder="Search DND lists"
      onOpen={open}
      onCreate={async () => {
        const created = await api.post<{ id: string }>('/dnd-lists', { name: '' });
        nav(`/library/dnd/${created.id}`);
      }}
      note="A campaign points at one DND list; every number in it is skipped when dialing."
      columns={(reload) => [
        nameColumn(),
        { key: 'desc', header: 'Description', render: (r) => <span style={{ color: 'var(--textMuted)' }}>{String(r.desc || '—')}</span> },
        { key: 'count', header: 'Entries', render: (r) => <span className="dt-num">{Number(r.count).toLocaleString()}</span> },
        usageColumn(),
        actionColumn('/dnd-lists', reload, open),
      ]}
    />
  );
}

export function TransferDirectories() {
  const nav = useNavigate();
  const open = (r: Row) => nav(`/library/transfer-directories/${r.id}`);
  return (
    <LibraryPage
      libKey="quick"
      endpoint="/transfer-directories"
      searchPlaceholder="Search directories"
      onOpen={open}
      onCreate={async () => {
        const created = await api.post<{ id: string }>('/transfer-directories', { name: '' });
        nav(`/library/transfer-directories/${created.id}`);
      }}
      note="Each directory is a set of named destinations; a campaign points at one of them."
      columns={(reload) => [
        nameColumn(),
        { key: 'desc', header: 'Description', render: (r) => <span style={{ color: 'var(--textMuted)' }}>{String(r.desc || '—')}</span> },
        { key: 'dest', header: 'Destinations', render: (r) => <span className="dt-num">{String(r.destinations)}</span> },
        usageColumn(),
        actionColumn('/transfer-directories', reload, open),
      ]}
    />
  );
}

/** Pause codes, skill lists and agent scripts are all the same simple named collection. */
export function SimpleLibraryList({
  libKey,
  endpoint,
  note,
}: {
  libKey: LibraryKey;
  endpoint: string;
  note: string;
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  return (
    <>
      <LibraryPage
        key={version}
        libKey={libKey}
        endpoint={endpoint}
        searchPlaceholder={`Search ${LIBRARY_ROUTES[libKey].title.toLowerCase()}`}
        onOpen={(r) => setEditing(r)}
        onCreate={() => setCreating(true)}
        note={note}
        columns={(reload) => [
          nameColumn(),
          { key: 'entries', header: 'Entries', render: (r) => <span className="dt-num">{String(r.entries)}</span> },
          usageColumn(),
          actionColumn(endpoint, reload, (r) => setEditing(r)),
        ]}
      />
      {editing || creating ? (
        <SimpleEditor
          endpoint={endpoint}
          singular={LIBRARY_ROUTES[libKey].singular}
          row={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </>
  );
}

function SimpleEditor({
  endpoint,
  singular,
  row,
  onClose,
  onSaved,
}: {
  endpoint: string;
  singular: string;
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data } = useAsync<{ name: string; codes: string[] }>(
    () => (row ? api.get(`${endpoint}/${row.id}`) : Promise.resolve({ name: '', codes: ['', '', ''] })),
    [row?.id],
  );
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setCodes(data.codes.length ? data.codes : ['', '', '']);
  }, [data]);

  const save = async () => {
    if (!name.trim()) {
      setTouched(true);
      return;
    }
    const body = { name: name.trim(), codes: codes.map((c) => c.trim()).filter(Boolean) };
    if (row) await api.patch(`${endpoint}/${row.id}`, body);
    else await api.post(endpoint, body);
    onSaved();
  };

  return (
    <Modal
      title={`${row ? 'Edit' : 'New'} ${singular}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={save} type="button">
            {row ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="f" style={{ marginBottom: 18 }}>
        <label htmlFor="simple-name">
          Name<span className="req">*</span>
        </label>
        <input
          id="simple-name"
          value={name}
          className={touched && !name.trim() ? 'bad' : ''}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="f">
        <label>Entries</label>
        {codes.map((c, i) => (
          <div className="itemrow" key={i}>
            <input
              value={c}
              aria-label={`Entry ${i + 1}`}
              placeholder={`Entry ${i + 1}`}
              onChange={(e) => setCodes(codes.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <IconButton icon="x" label={`Remove entry ${i + 1}`} onClick={() => setCodes(codes.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button className="addlink" style={{ paddingLeft: 0 }} onClick={() => setCodes([...codes, ''])} type="button">
          + Add entry
        </button>
      </div>
    </Modal>
  );
}
