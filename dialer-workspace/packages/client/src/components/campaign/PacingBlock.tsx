import { CampaignValues, DialMethod, PACING } from '@dialer/shared';
import { Field } from '../fields';

/**
 * Pacing is revealed by the Dial method select and sits inside the Dialing section,
 * next to the control that reveals it — never in a section of its own.
 */
export function PacingBlock({
  values,
  essentialsOnly,
  isDirty,
  errors,
  onChange,
}: {
  values: CampaignValues;
  essentialsOnly: boolean;
  isDirty: (id: string) => boolean;
  errors: Record<string, string>;
  onChange: (id: string, value: unknown) => void;
}) {
  const pacing = PACING[values.dialMethod as DialMethod];
  if (!pacing) return null;
  const fields = pacing.fields.filter((f) => !essentialsOnly || f.req || isDirty(f.id));

  return (
    <div className="pacing">
      <div className="ph">
        <h4>{values.dialMethod} pacing</h4>
        <span className="rule">{pacing.rule}</span>
      </div>
      <p className="pnote" style={{ marginBottom: fields.length ? 14 : 0 }}>
        {pacing.note}
      </p>
      {fields.length ? (
        <div className="grid">
          {fields.map((f) => (
            <Field
              key={f.id}
              field={f}
              value={values[f.id]}
              dirty={isDirty(f.id)}
              invalid={!!errors[f.id]}
              error={errors[f.id]}
              onChange={(v) => onChange(f.id, v)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
