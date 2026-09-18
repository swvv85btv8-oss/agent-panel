import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AGENTS,
  CampaignValues,
  FieldDef,
  InboundQueue,
  Issue,
  QUEUE_SECTIONS,
  QUEUE_TIERS,
  didConflicts,
  queueFieldVisible,
  queueIssues,
} from '@dialer/shared';
import { ApiFailure, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import { Field } from '../components/fields';

interface CampaignResponse {
  id: string;
  name: string;
  values: CampaignValues;
  issues: Issue[];
}

/**
 * The inbound queue sub-page. A queue belongs to exactly one campaign and is reached
 * only from inside it — it never appears in the nav, because it does not exist
 * independently of its campaign.
 */
export default function QueueEditor() {
  const { id = '', qid = '' } = useParams();
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const { data } = useAsync<CampaignResponse>(() => api.get(`/campaigns/${id}`), [id]);
  const [queue, setQueue] = useState<InboundQueue | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const siblings = useMemo(
    () => (data?.values.queues ?? []).filter((q) => q.id !== qid),
    [data, qid],
  );

  useEffect(() => {
    const found = data?.values.queues.find((q) => q.id === qid);
    if (found) setQueue(found);
  }, [data, qid]);

  const save = useCallback(
    (next: InboundQueue) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await api.patch(`/campaigns/${id}/queues/${qid}`, next);
          setConflict(null);
        } catch (e) {
          // A DID collision is the one thing a draft save refuses, because an ambiguous
          // number has no defined destination.
          setConflict(e instanceof ApiFailure ? e.message : 'Could not save');
        }
      }, 500);
    },
    [id, qid],
  );

  const set = useCallback(
    (field: string, value: unknown) => {
      setQueue((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [field]: value } as InboundQueue;
        save(next);
        return next;
      });
    },
    [save],
  );

  const issues = useMemo(() => (queue ? queueIssues(queue) : []), [queue]);
  const dupes = useMemo(
    () => (queue ? didConflicts([...siblings, queue]).filter((d) => d.qid === queue.id) : []),
    [siblings, queue],
  );

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/campaigns">Campaigns</Link>
        <span className="sep">/</span>
        <Link to={`/campaigns/${id}`}>{data?.name || 'Campaign'}</Link>
        <span className="sep">/</span>
        <b>{queue?.name || 'Untitled queue'}</b>
      </>,
    );
  }, [setCrumb, id, data?.name, queue?.name]);

  useEffect(() => {
    setRail(
      <>
        <BackLink label="Back to campaign" to={`/campaigns/${id}`} />
        <div className="heading">{queue?.name || 'Inbound queue'}</div>
        {QUEUE_SECTIONS.map((s, i) => {
          const bad = issues.some((x) => x.sec === s.id);
          return (
            <button
              key={s.id}
              type="button"
              className="nav"
              onClick={() => {
                const el = document.getElementById(`qsec-${s.id}`);
                const main = document.getElementById('main');
                if (el && main) main.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
              }}
            >
              <span className="chip" aria-hidden="true">
                {i + 1}
              </span>
              <span>{s.title}</span>
              {bad ? <span className="issue" role="img" aria-label="Has a blocking issue" /> : null}
            </button>
          );
        })}
      </>,
    );
  }, [setRail, id, queue?.name, issues]);

  useEffect(() => {
    const open = issues.length + dupes.length;
    setFooter(
      <>
        <div className="st">
          {open ? (
            <button className="stlink" onClick={() => setShowIssues(true)} type="button">
              {open} thing{open > 1 ? 's' : ''} still to finish
            </button>
          ) : (
            'Inbound queue is complete.'
          )}
          {conflict ? (
            <span style={{ marginLeft: 10, color: 'var(--dangerText)' }}>{conflict}</span>
          ) : null}
        </div>
        <div className="act">
          <button className="btn pri" onClick={() => nav(`/campaigns/${id}`)} type="button">
            Back to campaign
          </button>
        </div>
      </>,
    );
  }, [setFooter, issues, dupes, conflict, nav, id]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  if (!queue || !data) return <div className="wrap">Loading…</div>;

  const campaignValue = (fieldId: string) => String(data.values[fieldId] ?? '');

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <span className="grouptag">Belongs to {data.name || 'this campaign'}</span>
          <h1 style={{ marginTop: 8 }}>{queue.name || 'Untitled queue'}</h1>
          <p>
            Owned by this campaign and unavailable to any other.{' '}
            {siblings.length ? `One of ${siblings.length + 1} queues here.` : ''}
          </p>
        </div>
      </div>

      {siblings.length ? (
        <section className="card" aria-labelledby="siblings-head">
          <div className="ch">
            <div>
              <h3 id="siblings-head">Queues on this campaign</h3>
              <p>Switch between them without going back.</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[...siblings, queue]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((q) => {
                const n = queueIssues(q).length;
                return (
                  <button
                    key={q.id}
                    className={`btn ${q.id === queue.id ? 'pri' : 'sec'} sm`}
                    onClick={() => nav(`/campaigns/${id}/queues/${q.id}`)}
                    type="button"
                  >
                    {q.name || 'Untitled'}
                    {n ? ` · ${n}` : ''}
                  </button>
                );
              })}
          </div>
        </section>
      ) : null}

      {showIssues && issues.length + dupes.length ? (
        <div className="issues" role="alert">
          <h4>
            {issues.length + dupes.length} thing{issues.length + dupes.length > 1 ? 's' : ''} to finish
            <button className="dismiss" onClick={() => setShowIssues(false)} aria-label="Dismiss">
              ×
            </button>
          </h4>
          <ul>
            {[...issues, ...dupes].map((x, n) => (
              <li key={`${x.id}-${n}`}>
                <button
                  type="button"
                  onClick={() => document.getElementById(`qsec-${x.sec}`)?.scrollIntoView({ behavior: 'smooth' })}
                >
                  {x.label} — in {x.secTitle}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {QUEUE_SECTIONS.map((s) => (
        <section className="card" id={`qsec-${s.id}`} key={s.id} aria-labelledby={`qhead-${s.id}`}>
          <div className="ch">
            <div>
              <h3 id={`qhead-${s.id}`}>{s.title}</h3>
              <p>{s.sub}</p>
            </div>
          </div>
          <div className="grid">
            {s.fields
              .filter((f) => queueFieldVisible(f, queue))
              .map((f: FieldDef) =>
                f.kind === 'agents' ? (
                  <AgentPicker key={f.id} queue={queue} siblings={siblings} onChange={set} />
                ) : (
                  <Field
                    key={f.id}
                    field={f}
                    value={queue[f.id]}
                    invalid={issues.some((i) => i.id === f.id) || (f.id === 'dids' && dupes.length > 0)}
                    error={f.id === 'dids' && dupes.length ? dupes[0].label : undefined}
                    /* A twinned field shows the campaign's value for reference only. */
                    compareTo={f.cmp ? { label: f.cmp, value: campaignValue(f.cmp) } : undefined}
                    onChange={(v) => set(f.id, v)}
                  />
                ),
              )}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Agents, and the tiered fallback. Tiers are three buckets rather than a per-agent
 * integer priority: "try these, then these" is the decision a supervisor actually makes.
 */
function AgentPicker({
  queue,
  siblings,
  onChange,
}: {
  queue: InboundQueue;
  siblings: InboundQueue[];
  onChange: (field: string, value: unknown) => void;
}) {
  const selected = queue.agents;
  const overlap = siblings
    .map((o) => {
      const shared = o.agents.filter((a) => selected.includes(a)).length;
      return shared ? `${shared} also in ${o.name || 'Untitled queue'}` : '';
    })
    .filter(Boolean);

  const toggleAgent = (agent: string) => {
    const set = new Set(selected);
    if (set.has(agent)) set.delete(agent);
    else set.add(agent);
    onChange('agents', AGENTS.filter((a) => set.has(a)));
  };

  const cycleTier = (agent: string) => {
    const current = queue.tiers[agent] ?? 1;
    const next = current >= 3 ? 1 : ((current + 1) as 1 | 2 | 3);
    onChange('tiers', { ...queue.tiers, [agent]: next });
  };

  return (
    <div className="full">
      <div className="f" style={{ marginBottom: 18 }}>
        <label id="agents-label">
          Agents in this queue<span className="req">*</span>
        </label>
        <div role="group" aria-labelledby="agents-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {AGENTS.map((a) => {
            const on = selected.includes(a);
            return (
              <button
                key={a}
                type="button"
                role="checkbox"
                aria-checked={on}
                className="ib"
                style={
                  on
                    ? {
                        background: 'var(--accentSoft)',
                        borderColor: 'var(--accentBorder)',
                        color: 'var(--accentDark)',
                        fontWeight: 600,
                        borderRadius: 'var(--radiusPill)',
                        padding: '6px 13px',
                      }
                    : { borderRadius: 'var(--radiusPill)', padding: '6px 13px' }
                }
                onClick={() => toggleAgent(a)}
              >
                {a}
              </button>
            );
          })}
        </div>
        <div className="help">
          {selected.length} of {AGENTS.length} selected
          <button
            className="addlink"
            style={{ padding: '0 4px' }}
            type="button"
            onClick={() => onChange('agents', selected.length === AGENTS.length ? [] : [...AGENTS])}
          >
            {selected.length === AGENTS.length ? 'Clear all' : 'Select all'}
          </button>
        </div>
        {siblings.length ? (
          <div className="cmpref">
            Agents can answer more than one queue on this campaign.{' '}
            {overlap.length ? overlap.join(' · ') : 'No overlap with the other queues yet.'}
          </div>
        ) : null}
      </div>

      <div className="tog" style={{ marginBottom: queue.priority ? 16 : 0 }}>
        <button
          type="button"
          role="switch"
          aria-checked={queue.priority}
          aria-label="Try some agents before others"
          className="sw"
          onClick={() => onChange('priority', !queue.priority)}
        />
        <div>
          <div className="tl">Try some agents before others</div>
          <div className="th">
            Calls go to tier 1 first and only fall to tier 2 when nobody there is free.
          </div>
        </div>
      </div>

      {queue.priority ? (
        <>
          <div className="fade" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 11 }}>
            {QUEUE_TIERS.map((tier) => {
              const inTier = selected.filter((a) => (queue.tiers[a] ?? 1) === tier);
              return (
                <div
                  key={tier}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radiusControlLg)',
                    background: '#fbfcfd',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '.5px',
                      textTransform: 'uppercase',
                      color: 'var(--label)',
                      padding: '9px 12px',
                      borderBottom: '1px solid var(--divider)',
                      display: 'flex',
                      gap: 7,
                    }}
                  >
                    Tier {tier}
                    {tier === 1 ? ' · tried first' : ''}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontFamily: 'var(--fontMono)',
                        background: '#eef1f4',
                        borderRadius: 'var(--radiusPill)',
                        padding: '1px 7px',
                        color: 'var(--inkMuted)',
                      }}
                    >
                      {inTier.length}
                    </span>
                  </div>
                  <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 52 }}>
                    {inTier.length ? (
                      inTier.map((a) => (
                        <button
                          key={a}
                          type="button"
                          className="ib"
                          style={{
                            borderRadius: 'var(--radiusPill)',
                            background: 'var(--accentSoft)',
                            borderColor: 'var(--accentBorder)',
                            color: 'var(--accentDark)',
                          }}
                          aria-label={`${a} is in tier ${tier}. Move to the next tier`}
                          onClick={() => cycleTier(a)}
                        >
                          {a}
                        </button>
                      ))
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--placeholder)', fontStyle: 'italic' }}>
                        empty
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="help" style={{ marginTop: 9 }}>
            Click an agent to move them down a tier. Everyone starts in tier 1, so priority does
            nothing until you move someone.
          </div>
        </>
      ) : null}
    </div>
  );
}
