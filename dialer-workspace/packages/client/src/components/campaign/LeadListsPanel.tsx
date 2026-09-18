import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LeadList, MAX_LEAD_LISTS, columnCount, schemaSignature } from '@dialer/shared';
import { api, type Page } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { IconButton, Modal } from '../primitives';

interface LeadListRow extends LeadList {
  usedByCampaigns: number;
  columns: number;
}

/**
 * Lead lists are SHARED library objects, not campaign children, despite the cap of
 * three per campaign — editing one here changes it everywhere it is used. The cap is a
 * product rule about how many a campaign may dial, not a statement about ownership.
 */
export function LeadListsPanel({
  attached,
  lists,
  campaignId,
  onChange,
}: {
  attached: string[];
  lists: LeadList[];
  campaignId: string;
  onChange: (next: string[]) => void;
}) {
  const nav = useNavigate();
  const [picking, setPicking] = useState(false);
  const full = attached.length >= MAX_LEAD_LISTS;

  const signatures = new Set(lists.map(schemaSignature));
  const mismatch = lists.length > 1 && signatures.size > 1;
  const totalLeads = lists.reduce((a, l) => a + l.records, 0);

  return (
    <div className="owned">
      <div className="oh">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <h4>Lead lists</h4>
          <span className="tagi2">From Library</span>
        </div>
        <div className="act">
          <button className="btn sec sm" disabled={full} onClick={() => setPicking(true)} type="button">
            {full ? `${MAX_LEAD_LISTS} of ${MAX_LEAD_LISTS} attached` : 'Attach list'}
          </button>
        </div>
      </div>
      <p className="note2">
        Up to {MAX_LEAD_LISTS}. Lists are shared objects — editing one here changes it everywhere it
        is used.
      </p>

      {lists.length ? (
        lists.map((l) => (
          <div
            className="llrow clickable2"
            key={l.id}
            role="button"
            tabIndex={0}
            onClick={() => nav(`/library/lead-lists/${l.id}?from=/campaigns/${campaignId}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                nav(`/library/lead-lists/${l.id}?from=/campaigns/${campaignId}`);
              }
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="nm">{l.name || 'Untitled'}</div>
              <div className="meta">
                {columnCount(l)} columns · updated {l.updated}
              </div>
            </div>
            <span className="rc">{l.records.toLocaleString()} leads</span>
            <IconButton
              icon="edit"
              label={`Edit ${l.name}`}
              onClick={() => nav(`/library/lead-lists/${l.id}?from=/campaigns/${campaignId}`)}
            />
            <IconButton
              icon="x"
              label={`Detach ${l.name} from this campaign`}
              onClick={() => onChange(attached.filter((x) => x !== l.id))}
            />
          </div>
        ))
      ) : (
        <div className="empty">
          No leads attached. This campaign cannot publish without at least one list.
        </div>
      )}

      {mismatch ? (
        <div className="warnbox">
          <b>These lists have different columns.</b>{' '}
          {lists.map((l) => `${l.name} (${columnCount(l)})`).join(' · ')} — the agent panel shows the
          columns of whichever list a lead came from, so agents will see a different layout depending
          on who they are calling.
        </div>
      ) : null}

      {lists.length ? (
        <div className="totalrow">{totalLeads.toLocaleString()} leads in total</div>
      ) : null}

      {picking ? (
        <AttachModal
          attached={attached}
          onClose={() => setPicking(false)}
          onAttach={(id) => {
            onChange([...attached, id]);
            setPicking(false);
          }}
          onCreated={(id) => {
            onChange([...attached, id]);
            setPicking(false);
            nav(`/library/lead-lists/${id}?from=/campaigns/${campaignId}`);
          }}
        />
      ) : null}
    </div>
  );
}

function AttachModal({
  attached,
  onClose,
  onAttach,
  onCreated,
}: {
  attached: string[];
  onClose: () => void;
  onAttach: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const { data } = useAsync<Page<LeadListRow>>(() => api.get('/lead-lists?perPage=100'), []);
  const slots = MAX_LEAD_LISTS - attached.length;

  const create = async () => {
    const created = await api.post<{ id: string }>('/lead-lists', { name: '', desc: '' });
    onCreated(created.id);
  };

  return (
    <Modal
      title="Attach a lead list"
      sub={`Pick from Library, or build a new one. ${slots} slot${slots === 1 ? '' : 's'} left.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={create} type="button">
            Build a new list
          </button>
        </>
      }
    >
      {(data?.rows ?? []).map((l) => {
        const on = attached.includes(l.id);
        return (
          <button
            className="libitem"
            key={l.id}
            type="button"
            disabled={on}
            style={{ cursor: on ? 'default' : 'pointer' }}
            onClick={() => !on && onAttach(l.id)}
          >
            <div>
              <div className="nm">{l.name || 'Untitled'}</div>
              <div className="meta">
                {l.columns} columns · {l.records.toLocaleString()} records · {l.desc || '—'}
              </div>
            </div>
            <div className="act">
              {on ? <span className="tagd">Attached</span> : <span className="btn sec sm">Attach</span>}
            </div>
          </button>
        );
      })}
    </Modal>
  );
}
