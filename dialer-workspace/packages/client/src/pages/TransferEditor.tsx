import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TransferDirectory, TransferEntry } from '@dialer/shared';
import { api } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import {
  DataTable,
  EmptyState,
  IconButton,
  ListCard,
  Modal,
  Pager,
  Toolbar,
  ToolButton,
} from '../components/primitives';
import { Icon } from '../components/icons';

export default function TransferEditor() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TransferEntry | 'new' | null>(null);
  const debounced = useDebounced(query);

  const { data: dir, reload } = useAsync<TransferDirectory>(() => api.get(`/transfer-directories/${id}`), [id]);

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/library/transfer-directories">Transfer Directory</Link>
        <span className="sep">/</span>
        <b>{dir?.name || 'Untitled'}</b>
      </>,
    );
    setRail(
      <BackLink
        label={from ? 'Back to campaign' : 'All directories'}
        to={from ?? '/library/transfer-directories'}
      />,
    );
  }, [setCrumb, setRail, dir?.name, from]);

  useEffect(() => {
    setFooter(
      <>
        <div className="st">
          {dir ? `${dir.entries.length} destination${dir.entries.length === 1 ? '' : 's'}` : ''}
        </div>
        <div className="act">
          <button className="btn pri" onClick={() => nav(from ?? '/library/transfer-directories')} type="button">
            Done
          </button>
        </div>
      </>,
    );
  }, [setFooter, dir, nav, from]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  if (!dir) return <div className="wrap">Loading…</div>;

  const q = debounced.toLowerCase();
  const rows = dir.entries.filter(
    (e) => !q || e.name.toLowerCase().includes(q) || e.number.replace(/\s/g, '').includes(debounced.replace(/\s/g, '')),
  );

  const saveEntries = async (entries: TransferEntry[]) => {
    await api.patch(`/transfer-directories/${id}`, { entries });
    reload();
  };

  return (
    <div className="wrap wide">
      <ListCard>
        <Toolbar
          titleNode={
            <h2>
              <input
                className="h1edit"
                defaultValue={dir.name}
                key={dir.id}
                placeholder="Name this directory"
                aria-label="Directory name"
                onBlur={async (e) => {
                  if (e.target.value !== dir.name) {
                    await api.patch(`/transfer-directories/${id}`, { name: e.target.value });
                    reload();
                  }
                }}
              />
            </h2>
          }
          meta={
            <span className="metapill">
              {dir.entries.length} destination{dir.entries.length === 1 ? '' : 's'}
            </span>
          }
          placeholder="Search name or number"
          query={query}
          onQuery={setQuery}
          actions={<ToolButton icon="plus" label="Add destination" variant="primary" onClick={() => setEditing('new')} />}
        />
        {dir.entries.length ? (
          <>
            <DataTable<TransferEntry>
              caption={`Destinations in ${dir.name}`}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setEditing(r)}
              emptyMessage={`Nothing matches "${query}".`}
              columns={[
                { key: 'n', header: 'S.No.', width: '52px', render: (_r, i) => <span className="dt-num">{i + 1}</span> },
                { key: 'name', header: 'Name', render: (r) => <span className="dt-link">{r.name}</span> },
                { key: 'number', header: 'Number', render: (r) => <span className="dt-link2">{r.number}</span> },
                {
                  key: 'action',
                  header: 'Action',
                  action: true,
                  render: (r) => (
                    <div className="rowact">
                      <IconButton icon="edit" label={`Edit ${r.name}`} variant="primary" onClick={() => setEditing(r)} />
                      <IconButton
                        icon="trash"
                        label={`Remove ${r.name}`}
                        variant="danger"
                        onClick={async () => {
                          if (!window.confirm(`Remove "${r.name}"? Agents will no longer see it as a transfer option.`))
                            return;
                          await saveEntries(dir.entries.filter((e) => e.id !== r.id));
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            />
            <Pager shown={rows.length} total={dir.entries.length} />
          </>
        ) : (
          <EmptyState
            title="No destinations yet"
            body="Add the desks and people an agent should be able to transfer a live call to. They appear in the agent panel as one-tap options."
            action={
              <button className="hdrbtn" onClick={() => setEditing('new')} type="button">
                <Icon name="plus" /> Add destination
              </button>
            }
          />
        )}
      </ListCard>
      <div className="note">
        A campaign points at one directory. Agents only see it when <b>Allow transfer / conference</b>{' '}
        is on under Transfers.
      </div>

      {editing ? (
        <EntryModal
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (entry) => {
            const next =
              editing === 'new'
                ? [...dir.entries, { ...entry, id: `t_${Math.random().toString(36).slice(2, 10)}` }]
                : dir.entries.map((e) => (e.id === entry.id ? entry : e));
            await saveEntries(next);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EntryModal({
  entry,
  onClose,
  onSave,
}: {
  entry: TransferEntry | null;
  onClose: () => void;
  onSave: (entry: TransferEntry) => void;
}) {
  const [name, setName] = useState(entry?.name ?? '');
  const [number, setNumber] = useState(entry?.number ?? '');
  const [touched, setTouched] = useState(false);

  const save = () => {
    if (!name.trim() || !number.trim()) {
      setTouched(true);
      return;
    }
    onSave({ id: entry?.id ?? '', name: name.trim(), number: number.trim() });
  };

  return (
    <Modal
      title={`${entry ? 'Edit' : 'Add'} destination`}
      sub="Agents see the name, the call goes to the number."
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={save} type="button">
            {entry ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="grid">
        <div className="f">
          <label htmlFor="tr-name">
            Name<span className="req">*</span>
          </label>
          <input
            id="tr-name"
            value={name}
            className={touched && !name.trim() ? 'bad' : ''}
            placeholder="e.g. Supervisor desk"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="f">
          <label htmlFor="tr-number">
            Number<span className="req">*</span>
          </label>
          <input
            id="tr-number"
            value={number}
            className={touched && !number.trim() ? 'bad' : ''}
            placeholder="+91..."
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
