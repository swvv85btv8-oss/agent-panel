import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LeadList } from '@dialer/shared';
import { api, qs, type Page } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import {
  DataTable,
  IconButton,
  ListCard,
  Note,
  Pager,
  Toolbar,
  ToolButton,
} from '../components/primitives';
import { useShell } from '../components/Shell';

interface Row extends LeadList {
  usedByCampaigns: number;
  columns: number;
}

export default function LeadListsList() {
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);

  const { data, reload } = useAsync<Page<Row>>(
    () => api.get(`/lead-lists${qs({ q: debounced, perPage: 50 })}`),
    [debounced],
  );

  useEffect(() => {
    setCrumb(
      <>
        <span>Library</span>
        <span className="sep">/</span>
        <b>Lead Lists</b>
      </>,
    );
    setRail(null);
    setFooter(null);
  }, [setCrumb, setRail, setFooter]);

  const rows = data?.rows ?? [];

  return (
    <div className="wrap wide">
      <ListCard>
        <Toolbar
          title="Lead Lists"
          placeholder="Search lead lists"
          query={query}
          onQuery={setQuery}
          actions={
            <ToolButton
              icon="plus"
              label="Add lead list"
              variant="primary"
              onClick={async () => {
                const created = await api.post<{ id: string }>('/lead-lists', { name: '', desc: '' });
                nav(`/library/lead-lists/${created.id}`);
              }}
            />
          }
        />
        <DataTable<Row>
          caption="Lead lists"
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/library/lead-lists/${r.id}`)}
          emptyMessage={query ? `No lead lists match "${query}".` : 'No lead lists yet.'}
          columns={[
            { key: 'n', header: 'S.No.', width: '52px', render: (_r, i) => <span className="dt-num">{i + 1}</span> },
            {
              key: 'name',
              header: 'Name',
              render: (r) => <span className="dt-link">{r.name || 'Untitled'}</span>,
            },
            {
              key: 'desc',
              header: 'Description',
              render: (r) => <span style={{ color: 'var(--textMuted)' }}>{r.desc || '—'}</span>,
            },
            { key: 'columns', header: 'Columns', render: (r) => <span className="dt-num">{r.columns}</span> },
            { key: 'records', header: 'Records', render: (r) => <span className="dt-num">{r.records.toLocaleString()}</span> },
            {
              key: 'used',
              header: 'Used by',
              render: (r) => (
                <span className="dt-num">
                  {r.usedByCampaigns} campaign{r.usedByCampaigns === 1 ? '' : 's'}
                </span>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              action: true,
              render: (r) => (
                <div className="rowact">
                  <IconButton icon="edit" label={`Edit ${r.name}`} variant="primary" onClick={() => nav(`/library/lead-lists/${r.id}`)} />
                  <IconButton
                    icon="copy"
                    label={`Clone ${r.name}`}
                    onClick={async () => {
                      const copy = await api.post<{ id: string }>(`/lead-lists/${r.id}/duplicate`);
                      nav(`/library/lead-lists/${copy.id}`);
                    }}
                  />
                  <IconButton
                    icon="trash"
                    label={`Delete ${r.name}`}
                    variant="danger"
                    onClick={async () => {
                      const msg = r.usedByCampaigns
                        ? `Delete "${r.name}"? It is attached to ${r.usedByCampaigns} campaign${r.usedByCampaigns > 1 ? 's' : ''}.`
                        : `Delete "${r.name}"?`;
                      if (!window.confirm(msg)) return;
                      await api.del(`/lead-lists/${r.id}`);
                      reload();
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
        <Pager shown={rows.length} total={data?.total ?? 0} />
      </ListCard>
      <Note>
        Structure and records are separate jobs, so they are separate buttons. Lead lists are shared:
        a campaign attaches up to three, and editing one here changes it everywhere it is used.
      </Note>
    </div>
  );
}
