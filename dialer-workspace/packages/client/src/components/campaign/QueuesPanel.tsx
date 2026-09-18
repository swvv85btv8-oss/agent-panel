import { useNavigate } from 'react-router-dom';
import { InboundQueue, queueIssues } from '@dialer/shared';
import { IconButton } from '../primitives';

/**
 * Inbound queues are CAMPAIGN-OWNED and never shared, despite there being many per
 * campaign. They are created here, deleted with the campaign, and do not appear in the nav.
 */
export function QueuesPanel({
  campaignId,
  queues,
  onAdd,
  onDelete,
}: {
  campaignId: string;
  queues: InboundQueue[];
  onAdd: () => void;
  onDelete: (queue: InboundQueue) => void;
}) {
  const nav = useNavigate();

  return (
    <div className="owned fade">
      <div className="oh">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <h4>Inbound queues</h4>
          <span className="tagi">Belong to this campaign</span>
        </div>
        <div className="act">
          <button className="btn sec sm" onClick={onAdd} type="button">
            Add queue
          </button>
        </div>
      </div>
      <p className="note2">
        A campaign can have several queues — the inbound number decides which one a call reaches. A
        queue is never shared with another campaign.
      </p>

      {queues.length ? (
        queues.map((q) => {
          const open = queueIssues(q).length;
          return (
            <div
              className="qrow"
              key={q.id}
              role="button"
              tabIndex={0}
              onClick={() => nav(`/campaigns/${campaignId}/queues/${q.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  nav(`/campaigns/${campaignId}/queues/${q.id}`);
                }
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="nm">{q.name || 'Untitled queue'}</div>
                <div className="meta">
                  {q.dids.length ? q.dids.join(', ') : 'no number yet'} · {q.strategy} ·{' '}
                  {q.agents.length} agent{q.agents.length === 1 ? '' : 's'}
                  {q.priority ? ' (tiered)' : ''} · timeout {q.queueTimeout}s → {q.failoverDest}
                </div>
              </div>
              {open ? (
                <span className="qbad">{open} to finish</span>
              ) : (
                <span className="tagd" style={{ marginLeft: 'auto' }}>
                  Ready
                </span>
              )}
              <IconButton
                icon="trash"
                label={`Delete ${q.name || 'queue'}`}
                variant="danger"
                onClick={() => onDelete(q)}
              />
            </div>
          );
        })
      ) : (
        <div className="empty">No queues yet. Add one so inbound calls have somewhere to land.</div>
      )}
    </div>
  );
}
