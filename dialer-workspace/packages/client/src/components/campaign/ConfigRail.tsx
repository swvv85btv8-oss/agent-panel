import { CampaignValues, Issue, PHASES, SectionDef, orderedSections, sectionChanges } from '@dialer/shared';

/**
 * The rail is one of the three issue surfaces: a dot marks WHERE a problem is, the
 * footer says HOW MANY, and the full list only appears when the user asks for it.
 */
export function ConfigRail({
  values,
  issues,
  isDirty,
  active,
  query,
  onQuery,
  onJump,
}: {
  values: CampaignValues;
  issues: Issue[];
  isDirty: (id: string) => boolean;
  active: string;
  query: string;
  onQuery: (v: string) => void;
  onJump: (sectionId: string) => void;
}) {
  const sections = orderedSections();
  let n = 0;

  return (
    <>
      <div className="railsearch">
        <label htmlFor="rail-search" style={{ position: 'absolute', left: -9999 }}>
          Search all settings
        </label>
        <input
          id="rail-search"
          type="search"
          placeholder="Search all settings…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {PHASES.map((phase) => {
        const inPhase = sections.filter((s) => s.phase === phase.id);
        if (!inPhase.length) return null;
        const phaseIssues = inPhase.some((s) => issues.some((i) => i.sec === s.id));
        const phaseChanges = inPhase.reduce((a, s) => a + sectionChanges(s, values, isDirty), 0);
        return (
          <div key={phase.id}>
            <div className="gh">
              {phase.title}
              {phaseIssues ? (
                <span className="issue" role="img" aria-label="Has a blocking issue" />
              ) : phaseChanges ? (
                <span className="cnt">{phaseChanges}</span>
              ) : null}
            </div>
            {inPhase.map((s: SectionDef) => {
              n += 1;
              const changes = sectionChanges(s, values, isDirty);
              const bad = issues.some((i) => i.sec === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`nav ${active === s.id ? 'on' : ''}`}
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={() => onJump(s.id)}
                >
                  <span className="chip" aria-hidden="true">
                    {n}
                  </span>
                  <span>{s.title}</span>
                  {bad ? (
                    <span className="issue" role="img" aria-label="Has a blocking issue" />
                  ) : changes ? (
                    <span className="cnt" aria-label={`${changes} unsaved changes`}>
                      {changes}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
