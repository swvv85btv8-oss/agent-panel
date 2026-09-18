import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs, type Page } from '../lib/api';
import { useAsync, useDebounced } from '../lib/useAsync';
import {
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
import { useShell } from '../components/Shell';

interface CampaignRow {
  id: string;
  name: string;
  desc: string;
  method: string;
  agents: string;
  lists: string[];
  queues: number;
  status: 'running' | 'draft';
}

interface TemplateRow {
  id: string;
  label: string;
  desc: string;
  tag: string;
}

const AVATAR_COLOURS = ['#1d4ed8', '#16a34a', '#7c3aed', '#ea580c', '#0891b2', '#be123c'];
const initials = (n: string) =>
  n
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default function CampaignsList() {
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const debounced = useDebounced(query);

  const { data, reload } = useAsync<Page<CampaignRow>>(
    () => api.get(`/campaigns${qs({ q: debounced, perPage: 25 })}`),
    [debounced],
  );

  useEffect(() => {
    setCrumb(<b>Campaigns</b>);
    setRail(null);
    setFooter(null);
  }, [setCrumb, setRail, setFooter]);

  const rows = data?.rows ?? [];

  const duplicate = async (id: string) => {
    await api.post(`/campaigns/${id}/duplicate`);
    reload();
  };

  const remove = async (row: CampaignRow) => {
    const ok = window.confirm(
      `Delete "${row.name}"? Its ${row.queues} inbound queue${row.queues === 1 ? '' : 's'} go with it. ` +
        'Lead lists and library objects are not affected.',
    );
    if (!ok) return;
    const res = await api.del<{ cascadedQueues: Array<{ name: string; dids: string[] }> }>(
      `/campaigns/${row.id}`,
    );
    const dead = res.cascadedQueues.flatMap((q) => q.dids);
    if (dead.length) {
      window.alert(`${dead.join(', ')} no longer reach any campaign.`);
    }
    reload();
  };

  return (
    <div className="wrap wide">
      <ListCard>
        <Toolbar
          title="Campaigns"
          placeholder="Search campaigns"
          query={query}
          onQuery={setQuery}
          actions={
            <ToolButton icon="plus" label="New campaign" variant="primary" onClick={() => setPicking(true)} />
          }
        />
        <DataTable<CampaignRow>
          caption="Campaigns"
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/campaigns/${r.id}`)}
          emptyMessage={query ? `No campaigns match "${query}".` : 'No campaigns yet.'}
          columns={[
            {
              key: 'name',
              header: 'Campaign',
              render: (r) => (
                <>
                  <span className="dt-link">{r.name || 'Untitled campaign'}</span>
                  <div className="dt-sub">{r.desc}</div>
                </>
              ),
            },
            { key: 'method', header: 'Dial method', render: (r) => <span className="dt-num">{r.method}</span> },
            {
              key: 'agents',
              header: 'Agent group',
              render: (r, i) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span
                    className="av"
                    aria-hidden="true"
                    style={{
                      background: AVATAR_COLOURS[i % AVATAR_COLOURS.length],
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'inline-grid',
                      placeItems: 'center',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: '#fff',
                      border: '2px solid #fff',
                    }}
                  >
                    {initials(r.agents || '?')}
                  </span>
                  <span style={{ marginLeft: 8 }}>{r.agents || '—'}</span>
                </div>
              ),
            },
            { key: 'lists', header: 'Lead lists', render: (r) => <span className="dt-num">{r.lists.length}</span> },
            { key: 'queues', header: 'Queues', render: (r) => <span className="dt-num">{r.queues}</span> },
            {
              key: 'status',
              header: 'Status',
              render: (r) =>
                r.status === 'running' ? (
                  <Stat tone="ok" glyph="✓">
                    Running
                  </Stat>
                ) : (
                  <Stat tone="idle" glyph="·">
                    Draft
                  </Stat>
                ),
            },
            {
              key: 'action',
              header: 'Action',
              action: true,
              render: (r) => (
                <div className="rowact">
                  <IconButton icon="edit" label={`Edit ${r.name}`} variant="primary" onClick={() => nav(`/campaigns/${r.id}`)} />
                  <IconButton icon="copy" label={`Duplicate ${r.name}`} onClick={() => duplicate(r.id)} />
                  <IconButton icon="trash" label={`Delete ${r.name}`} variant="danger" onClick={() => remove(r)} />
                </div>
              ),
            },
          ]}
        />
        <Pager shown={rows.length} total={data?.total ?? 0} />
      </ListCard>

      <Note>
        <b>What changed.</b> Inbound queues are 1:many with a campaign and never shared, so they moved
        inside it. Lead lists are shared and reusable, so they sit in Library under <b>Lead data</b>,
        alongside <b>Call outcomes</b>, <b>Agent setup</b> and <b>Compliance</b> — and the campaign form
        uses those same words. Every library object ships with a working default.
      </Note>

      {picking ? <TemplatePicker onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

function TemplatePicker({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { data } = useAsync<TemplateRow[]>(() => api.get('/meta/templates'), []);

  const create = async (templateId: string) => {
    const created = await api.post<{ id: string }>('/campaigns', { templateId });
    onClose();
    nav(`/campaigns/${created.id}`);
  };

  return (
    <Modal
      title="Start a new campaign"
      sub="Templates pre-fill dialing, pacing and the library selections. You can change anything afterwards."
      onClose={onClose}
    >
      <div className="tpl">
        {(data ?? []).map((t) => (
          <button key={t.id} className="tplc" type="button" onClick={() => create(t.id)}>
            <h4>{t.label}</h4>
            <p>{t.desc}</p>
            <span className="tg">{t.tag}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
