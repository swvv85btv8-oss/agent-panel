import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DESTINATIONS,
  DTMF_KEYS,
  RECORDINGS,
  RESPONSE_TYPES,
  ResponseType,
  Survey,
  VoiceSurvey,
  WebSurvey,
  hasOptions,
  surveyIssues,
} from '@dialer/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import { SelectInput, TextInput } from '../components/fields';
import { IconButton } from '../components/primitives';

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export default function SurveyEditor() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const { data } = useAsync<Survey>(() => api.get(`/surveys/${id}`), [id]);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data) setSurvey(data);
  }, [data]);

  const update = useCallback(
    (fn: (draft: Survey) => void) => {
      setSurvey((prev) => {
        if (!prev) return prev;
        const next = JSON.parse(JSON.stringify(prev)) as Survey;
        fn(next);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          // id and type are immutable server-side; never send them back.
          const { id: _i, type: _t, ...body } = next as unknown as Record<string, unknown>;
          api.patch(`/surveys/${id}`, body).catch(() => undefined);
        }, 500);
        return next;
      });
    },
    [id],
  );

  const issues = survey ? surveyIssues(survey) : [];

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/library/surveys">Surveys</Link>
        <span className="sep">/</span>
        <b>{survey?.name || 'Untitled'}</b>
      </>,
    );
    setRail(<BackLink label={from ? 'Back to campaign' : 'All surveys'} to={from ?? '/library/surveys'} />);
  }, [setCrumb, setRail, survey?.name, from]);

  useEffect(() => {
    setFooter(
      <>
        <div className="st">
          {issues.length ? (
            <button className="stlink" onClick={() => setShowIssues(true)} type="button">
              {issues.length} thing{issues.length > 1 ? 's' : ''} to finish
            </button>
          ) : survey ? (
            `${survey.type === 'voice' ? `${survey.entries.length} recording entries` : `${survey.questions.length} questions`} · ready`
          ) : (
            ''
          )}
        </div>
        <div className="act">
          <button
            className={`btn pri ${issues.length ? 'blocked' : ''}`}
            onClick={() => (issues.length ? setShowIssues(true) : nav(from ?? '/library/surveys'))}
            type="button"
          >
            Done
          </button>
        </div>
      </>,
    );
  }, [setFooter, issues.length, survey, nav, from]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  if (!survey) return <div className="wrap">Loading…</div>;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <span className="grouptag">Call outcomes</span>
          <h1 style={{ marginTop: 8 }}>{survey.name || 'Untitled survey'}</h1>
          <p>
            {survey.type === 'voice'
              ? 'Voice CSAT · played to the customer over the phone'
              : 'Web survey · filled in by the agent on screen'}
          </p>
        </div>
      </div>

      {showIssues && issues.length ? (
        <div className="issues" role="alert">
          <h4>
            {issues.length} thing{issues.length > 1 ? 's' : ''} to finish
            <button className="dismiss" onClick={() => setShowIssues(false)} aria-label="Dismiss">
              ×
            </button>
          </h4>
          <ul>
            {issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card" aria-labelledby="general-head">
        <div className="ch">
          <div>
            <h3 id="general-head">General</h3>
          </div>
          {/* The type is fixed at creation: converting would discard every type-specific setting. */}
          <span className="grouptag">{survey.type === 'voice' ? 'Voice' : 'Web'}</span>
        </div>
        <div className="grid">
          <TextInput
            label="Name"
            required
            value={survey.name}
            invalid={!survey.name.trim()}
            placeholder="e.g. Post-call CSAT"
            onChange={(v) => update((d) => { d.name = v; })}
          />
          <TextInput label="Description" value={survey.desc} onChange={(v) => update((d) => { d.desc = v; })} />
          {survey.type === 'voice' ? (
            <TextInput
              label="Digit timeout (sec)"
              required
              type="number"
              value={survey.digitTimeout}
              onChange={(v) => update((d) => { (d as VoiceSurvey).digitTimeout = v; })}
            />
          ) : null}
        </div>
      </section>

      {survey.type === 'voice' ? (
        <VoiceEditor survey={survey} update={update} />
      ) : (
        <WebEditor survey={survey} update={update} />
      )}
    </div>
  );
}

function VoiceEditor({ survey, update }: { survey: VoiceSurvey; update: (fn: (d: Survey) => void) => void }) {
  const v = (d: Survey) => d as VoiceSurvey;
  return (
    <>
      <section className="card" aria-labelledby="entries-head">
        <div className="ch">
          <div>
            <h3 id="entries-head">Recording entries</h3>
            <p>What the customer hears, and which key moves them on.</p>
          </div>
          <button className="ib" style={{ marginLeft: 'auto' }} onClick={() => update((d) => { v(d).entries.push({ id: uid('e'), rec: '', dtmf: '1', dest: 'Next Recording' }); })} type="button">
            + Add entry
          </button>
        </div>
        {survey.entries.map((e, i) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, border: '1px solid var(--border)', borderRadius: 10, marginBottom: 9 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--accentSoft)', color: 'var(--accentDark)', display: 'grid', placeItems: 'center', fontFamily: 'var(--fontMono)', fontSize: 11.5, fontWeight: 600, marginTop: 22, flexShrink: 0 }}>
              {i + 1}
            </span>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.4fr .8fr 1fr', gap: 16, minWidth: 0 }}>
              <SelectInput label="Recording" required value={e.rec} options={RECORDINGS} invalid={!e.rec}
                onChange={(val) => update((d) => { const t = v(d).entries.find((x) => x.id === e.id); if (t) t.rec = val; })} />
              <SelectInput label="Key pressed" required value={e.dtmf} options={DTMF_KEYS}
                onChange={(val) => update((d) => { const t = v(d).entries.find((x) => x.id === e.id); if (t) t.dtmf = val; })} />
              <SelectInput label="Then" required value={e.dest} options={DESTINATIONS}
                onChange={(val) => update((d) => { const t = v(d).entries.find((x) => x.id === e.id); if (t) t.dest = val; })} />
            </div>
            <div style={{ marginTop: 22 }}>
              <IconButton icon="trash" label={`Remove entry ${i + 1}`} variant="danger"
                onClick={() => update((d) => { v(d).entries = v(d).entries.filter((x) => x.id !== e.id); })} />
            </div>
          </div>
        ))}
        {survey.entries.length ? null : <div className="empty">No entries yet. Add one so the survey has something to play.</div>}
      </section>

      {(['inv', 'tmo'] as const).map((key) => (
        <section className="card" key={key} aria-labelledby={`${key}-head`}>
          <div className="ch">
            <div>
              <h3 id={`${key}-head`}>
                {key === 'inv' ? 'If the customer presses the wrong key' : 'If the customer presses nothing'}
              </h3>
              {key === 'tmo' ? <p>Triggered after {survey.digitTimeout || '0'} seconds of silence.</p> : null}
            </div>
          </div>
          <div className="grid">
            <SelectInput label="Recording" required value={survey[key].rec} options={RECORDINGS} invalid={!survey[key].rec}
              onChange={(val) => update((d) => { v(d)[key].rec = val; })} />
            <TextInput label="Retries allowed" required type="number" value={survey[key].retries}
              onChange={(val) => update((d) => { v(d)[key].retries = val; })} />
            <SelectInput label="Retry recording" value={survey[key].retryRec} options={RECORDINGS}
              onChange={(val) => update((d) => { v(d)[key].retryRec = val; })} />
            <SelectInput label="After the last retry" value={survey[key].dest} options={DESTINATIONS}
              onChange={(val) => update((d) => { v(d)[key].dest = val; })} />
          </div>
        </section>
      ))}
    </>
  );
}

function WebEditor({ survey, update }: { survey: WebSurvey; update: (fn: (d: Survey) => void) => void }) {
  const w = (d: Survey) => d as WebSurvey;
  return (
    <section className="card" aria-labelledby="questions-head">
      <div className="ch">
        <div>
          <h3 id="questions-head">Questions</h3>
          <p>Shown to the agent in order once the call ends.</p>
        </div>
        <button className="ib" style={{ marginLeft: 'auto' }} type="button"
          onClick={() => update((d) => { w(d).questions.push({ id: uid('q'), text: '', rtype: 'Dropdown', options: ['', ''] }); })}>
          + Add question
        </button>
      </div>
      {survey.questions.map((q, i) => (
        <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderBottom: '1px solid var(--divider)' }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--accentSoft)', color: 'var(--accentDark)', display: 'grid', placeItems: 'center', fontFamily: 'var(--fontMono)', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
              {i + 1}
            </span>
            <input
              value={q.text}
              placeholder="Type the question"
              aria-label={`Question ${i + 1}`}
              style={{ flex: 1, border: 'none', fontSize: 14.5, fontWeight: 500, outline: 'none', background: 'transparent', minWidth: 0 }}
              onChange={(e) => update((d) => { const t = w(d).questions.find((x) => x.id === q.id); if (t) t.text = e.target.value; })}
            />
            <IconButton icon="trash" label={`Remove question ${i + 1}`} variant="danger"
              onClick={() => update((d) => { w(d).questions = w(d).questions.filter((x) => x.id !== q.id); })} />
          </div>
          <div style={{ padding: 14, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ maxWidth: 230 }}>
              <SelectInput
                label="Answer type"
                value={q.rtype}
                options={RESPONSE_TYPES}
                onChange={(val) =>
                  update((d) => {
                    const t = w(d).questions.find((x) => x.id === q.id);
                    if (!t) return;
                    t.rtype = val as ResponseType;
                    // Options only exist for the choice types.
                    if (hasOptions(t.rtype) && t.options.length < 2) t.options = ['', ''];
                    if (!hasOptions(t.rtype)) t.options = [];
                  })
                }
              />
            </div>
            {hasOptions(q.rtype) ? (
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.3px', textTransform: 'uppercase', color: 'var(--label)', display: 'block', marginBottom: 7 }}>
                  Options
                </label>
                {q.options.map((o, oi) => (
                  <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <input
                      value={o}
                      placeholder={`Option ${oi + 1}`}
                      aria-label={`Question ${i + 1} option ${oi + 1}`}
                      style={{ flex: 1, border: '1px solid var(--borderInput)', borderRadius: 'var(--radiusControl)', padding: '8px 11px', fontSize: 13 }}
                      onChange={(e) => update((d) => { const t = w(d).questions.find((x) => x.id === q.id); if (t) t.options[oi] = e.target.value; })}
                    />
                    {q.options.length > 2 ? (
                      <IconButton icon="x" label={`Remove option ${oi + 1}`}
                        onClick={() => update((d) => { const t = w(d).questions.find((x) => x.id === q.id); if (t) t.options = t.options.filter((_, j) => j !== oi); })} />
                    ) : null}
                  </div>
                ))}
                <button className="addlink" style={{ paddingLeft: 0 }} type="button"
                  onClick={() => update((d) => { const t = w(d).questions.find((x) => x.id === q.id); if (t) t.options.push(''); })}>
                  + Add option
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: 'var(--hint)', background: 'var(--inputSubtle)', border: '1px solid var(--border)', borderRadius: 'var(--radiusControl)', padding: '11px 13px', lineHeight: 1.5 }}>
                {q.rtype === 'Short answer'
                  ? 'The agent types a free-text answer.'
                  : q.rtype === 'Date'
                    ? 'The agent picks a date.'
                    : 'The agent picks a date and time.'}
              </div>
            )}
          </div>
        </div>
      ))}
      {survey.questions.length ? null : <div className="empty">No questions yet.</div>}
    </section>
  );
}
