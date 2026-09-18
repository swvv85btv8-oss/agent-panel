import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CampaignValues,
  FieldDef,
  InboundQueue,
  Issue,
  LIBRARY_GROUPS,
  LeadList,
  LibraryKey,
  PHASES,
  SectionDef,
  campaignIssues,
  campaignWarnings,
  essentialCount,
  essentialFields,
  hasDependents,
  makeDirtyCheck,
  newQueue,
  orderedSections,
  phaseOf,
  sectionChanges,
  sectionSummary,
  totalChanges,
  totalFieldCount,
  visible,
} from '@dialer/shared';
import { ApiFailure, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import { DenseToggle, Field, type LibOption } from '../components/fields';
import { StatusPill } from '../components/primitives';
import { ConfigRail } from '../components/campaign/ConfigRail';
import { LeadListsPanel } from '../components/campaign/LeadListsPanel';
import { PacingBlock } from '../components/campaign/PacingBlock';
import { QueuesPanel } from '../components/campaign/QueuesPanel';
import { useInlineCreate } from '../components/campaign/InlineCreate';

interface CampaignResponse {
  id: string;
  name: string;
  status: 'running' | 'draft';
  values: CampaignValues;
  published: CampaignValues;
  issues: Issue[];
  warnings: Issue[];
}

type LibraryIndex = Record<string, LibOption[]>;

export default function CampaignConfig() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const { data, reload } = useAsync<CampaignResponse>(() => api.get(`/campaigns/${id}`), [id]);
  const { data: library, reload: reloadLibrary } = useAsync<LibraryIndex>(
    () => api.get('/meta/library'),
    [],
  );
  const { data: allLists } = useAsync<{ rows: LeadList[] }>(() => api.get('/lead-lists?perPage=100'), []);

  const [values, setValues] = useState<CampaignValues | null>(null);
  const [published, setPublished] = useState<CampaignValues | null>(null);
  const [status, setStatus] = useState<'running' | 'draft'>('draft');
  const [mode, setMode] = useState<'essentials' | 'all'>('essentials');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showIssues, setShowIssues] = useState(false);
  const [active, setActive] = useState('basics');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!data) return;
    setValues(data.values);
    setPublished(data.published);
    setStatus(data.status);
  }, [data]);

  const isDirty = useMemo(
    () => (values && published ? makeDirtyCheck(values, published) : () => false),
    [values, published],
  );

  const attachedLists = useMemo(
    () => (allLists?.rows ?? []).filter((l) => (values?.leadLists ?? []).includes(l.id)),
    [allLists, values],
  );

  const issues = useMemo(
    () => (values ? campaignIssues(values, { leadLists: attachedLists }) : []),
    [values, attachedLists],
  );
  const warnings = useMemo(
    () => (values ? campaignWarnings(values, { leadLists: attachedLists }) : []),
    [values, attachedLists],
  );

  const inline = useInlineCreate(id, reloadLibrary);

  /* ------------------------------------------------------------- draft save */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraft = useCallback(
    (next: CampaignValues) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState('saving');
        try {
          await api.patch(`/campaigns/${id}`, next);
          setSaveState('saved');
          setServerErrors({});
        } catch (e) {
          setSaveState('error');
          if (e instanceof ApiFailure) setServerErrors(e.byField());
        }
      }, 700);
    },
    [id],
  );

  const set = useCallback(
    (fieldId: string, value: unknown) => {
      setValues((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [fieldId]: value };
        saveDraft(next);
        return next;
      });
    },
    [saveDraft],
  );

  /* ------------------------------------------------------------ navigation */
  const jump = useCallback((sectionId: string) => {
    setActive(sectionId);
    setQuery('');
    const el = document.getElementById(`sec-${sectionId}`);
    const main = document.getElementById('main');
    if (el && main) main.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  }, []);

  const revealIssues = useCallback(() => {
    if (!issues.length) return;
    setShowIssues(true);
    if (mode === 'all') setOpen(Object.fromEntries(orderedSections().map((s) => [s.id, true])));
    document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [issues.length, mode]);

  const publish = useCallback(async () => {
    if (!values) return;
    try {
      const res = await api.post<CampaignResponse>(`/campaigns/${id}/publish`, { values });
      setPublished(res.published);
      setStatus(res.status);
      setServerErrors({});
      setSaveState('saved');
    } catch (e) {
      if (e instanceof ApiFailure) {
        setServerErrors(e.byField());
        revealIssues();
      }
    }
  }, [id, values, revealIssues]);

  const discard = useCallback(() => {
    if (!published) return;
    setValues(JSON.parse(JSON.stringify(published)));
    saveDraft(JSON.parse(JSON.stringify(published)));
  }, [published, saveDraft]);

  /* ------------------------------------------------------------ shell slots */
  useEffect(() => {
    setCrumb(
      <>
        <Link to="/campaigns">Campaigns</Link>
        <span className="sep">/</span>
        <b>{values?.name || 'Untitled campaign'}</b>
        <StatusPill running={status === 'running'} />
      </>,
    );
  }, [setCrumb, values?.name, status]);

  useEffect(() => {
    if (!values) return;
    setRail(
      <>
        <BackLink label="All campaigns" to="/campaigns" />
        <ConfigRail
          values={values}
          issues={issues}
          isDirty={isDirty}
          active={active}
          query={query}
          onQuery={setQuery}
          onJump={jump}
        />
      </>,
    );
  }, [setRail, values, issues, isDirty, active, query, jump]);

  useEffect(() => {
    if (!values) return;
    const changes = totalChanges(values, isDirty);
    const text =
      changes === 0
        ? status === 'running'
          ? 'Published — configuration is live.'
          : 'No changes since last publish.'
        : `${changes} unsaved change${changes > 1 ? 's' : ''}` +
          (issues.length ? ` · ${issues.length} blocking issue${issues.length > 1 ? 's' : ''}` : '');
    setFooter(
      <>
        <div className="st">
          {issues.length ? (
            <button className="stlink" onClick={revealIssues} type="button">
              {text}
            </button>
          ) : (
            text
          )}
          {saveState === 'saving' ? <span style={{ marginLeft: 10 }}>saving…</span> : null}
          {saveState === 'error' ? (
            <span style={{ marginLeft: 10, color: 'var(--dangerText)' }}>draft not saved</span>
          ) : null}
        </div>
        <div className="act">
          <button className="btn sec" onClick={discard} type="button">
            Discard
          </button>
          {/* Never disabled: a disabled button cannot explain itself. */}
          <button
            className={`btn pri ${issues.length ? 'blocked' : ''}`}
            onClick={issues.length ? revealIssues : publish}
            type="button"
          >
            {issues.length ? `Fix ${issues.length} to publish` : 'Publish changes'}
          </button>
        </div>
      </>,
    );
  }, [setFooter, values, isDirty, issues, status, saveState, revealIssues, publish, discard]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  if (!values || !published) return <div className="wrap">Loading…</div>;

  /* ----------------------------------------------------------- section list */
  const q = query.trim().toLowerCase();
  const essentialsOnly = mode === 'essentials' && !q;
  const sections = orderedSections();
  let matches = 0;

  const isOpen = (s: SectionDef) => {
    if (q || essentialsOnly) return true;
    // Auto-expand a section holding a blocking issue or an unsaved change.
    if (open[s.id] !== undefined) return open[s.id];
    return issues.some((i) => i.sec === s.id) || sectionChanges(s, values, isDirty) > 0;
  };

  const optionsFor = (lib?: LibraryKey) => (lib ? (library?.[lib] ?? []) : undefined);

  const addQueue = async () => {
    const created = await api.post<InboundQueue>(`/campaigns/${id}/queues`, {
      ...newQueue('', values.queues.length ? '' : `${values.name || 'Campaign'} returns`),
      id: undefined,
    });
    await reload();
    nav(`/campaigns/${id}/queues/${created.id}`);
  };

  const deleteQueue = async (queue: InboundQueue) => {
    const ok = window.confirm(
      `Delete "${queue.name || 'Untitled queue'}"?` +
        (queue.dids.length ? ` ${queue.dids.join(', ')} will stop reaching this campaign.` : ''),
    );
    if (!ok) return;
    await api.del(`/campaigns/${id}/queues/${queue.id}`);
    const fresh = await api.get<CampaignResponse>(`/campaigns/${id}`);
    setValues(fresh.values);
  };

  const cards = sections.map((s) => {
    let fields = s.fields.filter((f) => visible(f, values));
    if (essentialsOnly) fields = essentialFields(s, values, isDirty);
    if (q) {
      fields = fields.filter((f) => f.label?.toLowerCase().includes(q));
      matches += fields.length;
    }
    const showPacing = s.dialing && !q;
    if ((q || essentialsOnly) && !fields.length && !showPacing) return null;

    const changes = sectionChanges(s, values, isDirty);
    const bad = issues.filter((i) => i.sec === s.id).length;
    const opened = isOpen(s);
    const group = s.lib ? LIBRARY_GROUPS.find((g) => g.id === s.lib) : null;
    const phase = phaseOf(s.id);

    // Standalone toggles go in the dense band; toggles that reveal something stay in
    // the grid, beside what they reveal.
    const dense: FieldDef[] = [];
    const grid: FieldDef[] = [];
    fields.forEach((f) => {
      if (f.kind === 'toggle' && !hasDependents(s, f)) dense.push(f);
      else grid.push(f);
    });

    const header = (
      <div className={`ch ${!q && !essentialsOnly ? 'clickable' : ''}`}>
        {!q && !essentialsOnly ? (
          <button
            className={`car2 ${opened ? 'o' : ''}`}
            type="button"
            aria-expanded={opened}
            aria-controls={`secbody-${s.id}`}
            aria-label={`${opened ? 'Collapse' : 'Expand'} ${s.title}`}
            onClick={() => setOpen({ ...open, [s.id]: !opened })}
          >
            ▸
          </button>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <h3 id={`sechead-${s.id}`}>{s.title}</h3>
          {opened ? null : <p className="sumline">{sectionSummary(s, values)}</p>}
        </div>
        {bad ? <span className="qbad">{bad} to fix</span> : null}
        {changes ? (
          <span className="badge">
            {changes} change{changes > 1 ? 's' : ''}
          </span>
        ) : null}
        {group && opened ? <span className="grouptag">{group.title}</span> : null}
        {!opened && phase ? <span className="phtag">{phase.title}</span> : null}
      </div>
    );

    return (
      <section
        className={`card ${opened ? '' : 'closed'}`}
        id={`sec-${s.id}`}
        key={s.id}
        aria-labelledby={`sechead-${s.id}`}
      >
        {header}
        {opened ? (
          <div id={`secbody-${s.id}`}>
            {grid.length || showPacing ? (
              <div className="grid">
                {grid.map((f) => {
                  if (f.kind === 'leads') {
                    return (
                      <LeadListsPanel
                        key={f.id}
                        campaignId={id}
                        attached={values.leadLists}
                        lists={attachedLists}
                        onChange={(next) => set('leadLists', next)}
                      />
                    );
                  }
                  if (f.kind === 'queue') {
                    return (
                      <QueuesPanel
                        key={f.id}
                        campaignId={id}
                        queues={values.queues}
                        onAdd={addQueue}
                        onDelete={deleteQueue}
                      />
                    );
                  }
                  return (
                    <Field
                      key={f.id}
                      field={f}
                      value={values[f.id]}
                      dirty={isDirty(f.id)}
                      invalid={!!serverErrors[f.id] || issues.some((i) => i.id === f.id)}
                      error={serverErrors[f.id]}
                      options={optionsFor(f.lib)}
                      onCreateNew={(lib) => inline.start(lib as LibraryKey, (newId) => set(f.id, newId))}
                      onChange={(v) => set(f.id, v)}
                    />
                  );
                })}
                {showPacing ? (
                  <PacingBlock
                    values={values}
                    essentialsOnly={essentialsOnly}
                    isDirty={isDirty}
                    errors={serverErrors}
                    onChange={set}
                  />
                ) : null}
              </div>
            ) : null}
            {dense.length ? (
              <div className="dband">
                {dense.map((f) => (
                  <DenseToggle
                    key={f.id}
                    field={f}
                    checked={!!values[f.id]}
                    dirty={isDirty(f.id)}
                    onChange={(v) => set(f.id, v)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  });

  return (
    <div className="wrap" ref={mainRef as never}>
      {q ? (
        <div className="note">
          {matches} setting{matches === 1 ? '' : 's'} match &quot;{query}&quot; ·{' '}
          <button className="addlink" style={{ padding: 0 }} onClick={() => setQuery('')} type="button">
            Clear
          </button>
        </div>
      ) : (
        <>
          <div className="modeseg" role="group" aria-label="How much to show">
            <button
              className="ms"
              aria-pressed={essentialsOnly}
              onClick={() => {
                setMode('essentials');
                setShowIssues(false);
              }}
              type="button"
            >
              Essentials <span>{essentialCount(values, isDirty)}</span>
            </button>
            <button
              className="ms"
              aria-pressed={!essentialsOnly}
              onClick={() => setMode('all')}
              type="button"
            >
              All settings <span>{totalFieldCount(values)}</span>
            </button>
            {essentialsOnly ? (
              <span className="segnote">Showing what must be set, plus anything you have changed.</span>
            ) : (
              <span className="segnote">
                <button
                  className="ib"
                  onClick={() => setOpen(Object.fromEntries(sections.map((s) => [s.id, true])))}
                  type="button"
                >
                  Expand all
                </button>
                <button
                  className="ib"
                  onClick={() => setOpen(Object.fromEntries(sections.map((s) => [s.id, false])))}
                  type="button"
                >
                  Collapse all
                </button>
              </span>
            )}
          </div>

          {warnings.length ? (
            <div className="note">
              {warnings.map((w) => (
                <div key={`${w.id}-${w.label}`}>{w.label}</div>
              ))}
            </div>
          ) : null}

          {/* The full list appears only when the user asks for it. */}
          {showIssues && issues.length ? (
            <div className="issues" role="alert">
              <h4>
                {issues.length} thing{issues.length > 1 ? 's' : ''} to fix before publishing
                <button className="dismiss" onClick={() => setShowIssues(false)} aria-label="Dismiss">
                  ×
                </button>
              </h4>
              <ul>
                {issues.map((i, n) => (
                  <li key={`${i.id}-${n}`}>
                    <button type="button" onClick={() => jump(i.sec)}>
                      {i.label} — in {i.secTitle}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      {cards}
      {inline.element}
    </div>
  );
}

export { PHASES };
