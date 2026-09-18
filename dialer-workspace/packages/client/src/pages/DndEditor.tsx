import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DndEntry, DndList, maskValue } from '@dialer/shared';
import { api, qs, type Page } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import {
  DataTable,
  EmptyState,
  IconButton,
  ListCard,
  Modal,
  Pager,
  Stat,
  Toolbar,
  ToolButton,
} from '../components/primitives';
import { Icon } from '../components/icons';

export default function DndEditor() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reveal, setReveal] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const debounced = useDebounced(query);

  const { data: list, reload: reloadList } = useAsync<DndList>(() => api.get(`/dnd-lists/${id}`), [id, version]);
  const { data: entries } = useAsync<Page<DndEntry>>(
    () => api.get(`/dnd-lists/${id}/entries${qs({ q: debounced, page, perPage: 10 })}`),
    [id, debounced, page, version],
  );

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/library/dnd">DND</Link>
        <span className="sep">/</span>
        <b>{list?.name || 'Untitled'}</b>
      </>,
    );
    setRail(<BackLink label={from ? 'Back to campaign' : 'All DND lists'} to={from ?? '/library/dnd'} />);
  }, [setCrumb, setRail, list?.name, from]);

  useEffect(() => {
    setFooter(
      <>
        <div className="st">{list ? `${list.count.toLocaleString()} numbers suppressed` : ''}</div>
        <div className="act">
          <button className="btn pri" onClick={() => nav(from ?? '/library/dnd')} type="button">
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

  const addNumber = async () => {
    const value = window.prompt('Number or prefix to suppress');
    if (!value) return;
    await api.post(`/dnd-lists/${id}/entries`, { value });
    setPage(1);
    setVersion((v) => v + 1);
  };

  return (
    <div className="wrap wide">
      <ListCard>
        <Toolbar
          titleNode={
            <h2>
              <input
                className="h1edit"
                defaultValue={list.name}
                key={list.id}
                placeholder="Name this DND list"
                aria-label="DND list name"
                onBlur={async (e) => {
                  if (e.target.value !== list.name) {
                    await api.patch(`/dnd-lists/${id}`, { name: e.target.value });
                    reloadList();
                  }
                }}
              />
            </h2>
          }
          meta={<span className="metapill">{list.count.toLocaleString()} entries</span>}
          placeholder="Search a number"
          query={query}
          onQuery={(v) => {
            setQuery(v);
            setPage(1);
          }}
          actions={
            <>
              <ToolButton
                icon="eye"
                label={reveal ? 'Hide full numbers' : 'Show full numbers'}
                variant={reveal ? 'primary' : undefined}
                onClick={() => setReveal((r) => !r)}
              />
              <ToolButton icon="plus" label="Add a number" variant="primary" onClick={addNumber} />
              <ToolButton
                icon="upload"
                label="Upload CSV"
                onClick={async () => {
                  const rows = Array.from({ length: 40 }, () => ({
                    value: '+9198' + String(10000000 + Math.floor(Math.random() * 8999999)).slice(0, 8),
                  }));
                  await api.post(`/dnd-lists/${id}/entries/upload`, { rows });
                  setVersion((v) => v + 1);
                }}
              />
              <ToolButton icon="more" label="More actions" onClick={() => setMoreOpen(true)} />
            </>
          }
        />
        {list.count ? (
          <>
            <DataTable<DndEntry>
              caption={`Entries in ${list.name}`}
              rows={entries?.rows ?? []}
              rowKey={(r) => r.id}
              emptyMessage={`No number matches "${query}".`}
              columns={[
                {
                  key: 'n',
                  header: 'S.No.',
                  width: '52px',
                  render: (_r, i) => <span className="dt-num">{((entries?.page ?? 1) - 1) * 10 + i + 1}</span>,
                },
                {
                  key: 'value',
                  header: 'Number',
                  render: (r) => {
                    // A prefix is not somebody's number, so it is never masked.
                    const show = reveal || r.type === 'Prefix';
                    return <span className={show ? 'dt-link2' : 'dt-mask'}>{show ? r.value : maskValue(r.value, true)}</span>;
                  },
                },
                {
                  key: 'type',
                  header: 'Type',
                  render: (r) => (
                    <Stat tone={r.type === 'Prefix' ? 'idle' : 'ok'} glyph={r.type === 'Prefix' ? '#' : '✓'}>
                      {r.type}
                    </Stat>
                  ),
                },
                {
                  key: 'action',
                  header: 'Action',
                  action: true,
                  render: (r) => (
                    <div className="rowact">
                      <IconButton
                        icon="trash"
                        label={`Remove ${r.value}`}
                        variant="danger"
                        onClick={async () => {
                          await api.del(`/dnd-lists/${id}/entries/${r.id}`);
                          setVersion((v) => v + 1);
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            />
            <Pager
              shown={entries?.rows.length ?? 0}
              total={entries?.total ?? 0}
              page={entries?.page}
              pages={entries?.pages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="Nothing suppressed yet"
            body="Numbers in this list are never dialed by any campaign that uses it. Add one by hand, or upload a CSV."
            action={
              <button className="hdrbtn" onClick={addNumber} type="button">
                <Icon name="plus" /> Add a number
              </button>
            }
          />
        )}
      </ListCard>
      <div className="note">
        A <b>Number</b> blocks that exact line and is masked here. A <b>Prefix</b> blocks everything
        starting with it — that is how a whole series or circle gets suppressed at once — and is
        shown in full, since a prefix is not somebody&apos;s number.
      </div>

      {moreOpen ? (
        <Modal title={list.name} sub="List-level actions." onClose={() => setMoreOpen(false)}>
          <button
            className="libitem"
            type="button"
            style={{ cursor: 'pointer' }}
            onClick={async () => {
              if (!window.confirm(`Remove all ${list.count.toLocaleString()} entries from "${list.name}"?`)) return;
              await api.post(`/dnd-lists/${id}/entries/clear`);
              setMoreOpen(false);
              setVersion((v) => v + 1);
            }}
          >
            <div>
              <div className="nm" style={{ color: 'var(--dangerText)' }}>
                Clear the list
              </div>
              <div className="meta">Removes every entry but keeps the list itself</div>
            </div>
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
