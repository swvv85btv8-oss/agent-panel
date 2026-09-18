import { ReactNode, useId } from 'react';
import { FieldDef, KEEP_HELP } from '@dialer/shared';
import { IconButton } from './primitives';

/**
 * Data-driven field rendering. Every input here is CONTROLLED with no `key` derived from
 * its own value, so React updates the value in place and never remounts the element —
 * which is what keeps the caret where the user put it while typing. (The prototype
 * replaced innerHTML on every keystroke and had to hand-patch sibling nodes to work
 * around it; in React the correct behaviour is the default, as long as nothing remounts.)
 */

export interface LibOption {
  id: string;
  name: string;
  def?: boolean;
}

export function Toggle({
  checked,
  onChange,
  label,
  help,
  dirty,
  small,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  help?: string;
  dirty?: boolean;
  small?: boolean;
  describedBy?: string;
}) {
  const helpId = useId();
  return (
    <div className="tog">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={help ? helpId : describedBy}
        className={`sw ${small ? 'sm' : ''}`}
        onClick={() => onChange(!checked)}
      />
      <div>
        <div className="tl">{label}</div>
        {help ? (
          <div className="th" id={helpId}>
            {help}
          </div>
        ) : null}
      </div>
      {dirty ? <span className="dirty" aria-label="Changed since last publish" /> : null}
    </div>
  );
}

/** Compact three-across band for standalone toggles that reveal nothing. */
export function DenseToggle({
  field,
  checked,
  onChange,
  dirty,
}: {
  field: FieldDef;
  checked: boolean;
  onChange: (next: boolean) => void;
  dirty?: boolean;
}) {
  return (
    <div className="dtog" title={field.help}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={field.label ?? field.id}
        className="sw sm"
        onClick={() => onChange(!checked)}
      />
      <span className={`dl ${field.help ? 'hashelp' : ''}`}>{field.label}</span>
      {dirty ? <span className="dirty" aria-label="Changed since last publish" /> : null}
    </div>
  );
}

function Label({
  htmlFor,
  field,
  dirty,
  suffix,
}: {
  htmlFor: string;
  field: FieldDef;
  dirty?: boolean;
  suffix?: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor}>
      {field.label}
      {field.req ? (
        <span className="req" aria-hidden="true">
          *
        </span>
      ) : null}
      {dirty ? <span className="dirty" aria-label="Changed since last publish" /> : null}
      {suffix}
    </label>
  );
}

export interface FieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  dirty?: boolean;
  invalid?: boolean;
  error?: string;
  /** Library options when `field.lib` is set. */
  options?: LibOption[];
  onCreateNew?: (lib: string) => void;
  /** Read-only reference to the campaign's twinned value; never copied into this field. */
  compareTo?: { label: string; value: string };
}

export function Field({
  field,
  value,
  onChange,
  dirty,
  invalid,
  error,
  options,
  onCreateNew,
  compareTo,
}: FieldProps) {
  const inputId = useId();
  const helpId = useId();
  const errId = useId();
  const showHelp = field.help && KEEP_HELP.has(field.id);
  const describedBy = [showHelp ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;

  if (field.kind === 'toggle') {
    return (
      <div className={`f ${field.when ? 'fade' : ''}`}>
        <Toggle
          checked={!!value}
          onChange={onChange}
          label={field.label ?? field.id}
          help={field.help}
          dirty={dirty}
        />
      </div>
    );
  }

  if (field.kind === 'picker' || field.kind === 'chips') {
    const arr = (value as string[]) ?? [];
    const isChips = field.kind === 'chips';
    return (
      <div className={`f ${field.when ? 'fade' : ''} ${isChips ? 'full' : ''}`}>
        <Label htmlFor={inputId} field={field} dirty={dirty} />
        <div className={`chips ${invalid ? 'bad' : ''}`} id={inputId} role="group" aria-label={field.label}>
          {arr.map((entry, i) => (
            <span className="chip2" key={`${entry}-${i}`}>
              {entry}
              <button
                type="button"
                className="x"
                aria-label={`Remove ${entry}`}
                onClick={() => onChange(arr.filter((_, x) => x !== i))}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="addlink"
            onClick={() => {
              const next = window.prompt(isChips ? 'Inbound number' : `Add ${field.label}`);
              if (next) onChange([...arr, next]);
            }}
          >
            {isChips ? '+ Add number' : '+ Add'}
          </button>
        </div>
        {showHelp ? (
          <div className="help" id={helpId}>
            {field.help}
          </div>
        ) : null}
        {error ? (
          <div className="err" id={errId}>
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  if (field.kind === 'select') {
    const isLib = !!field.lib;
    const select = (
      <div className="selwrap">
        <select
          id={inputId}
          className={invalid ? 'bad' : ''}
          value={String(value ?? '')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {isLib ? (
            <>
              <option value="">Select an option</option>
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name || 'Untitled'}
                  {o.def ? ' (default)' : ''}
                </option>
              ))}
            </>
          ) : (
            (field.opts ?? []).map((o) => (
              <option key={o} value={o}>
                {o === '' ? 'Select an option' : o}
              </option>
            ))
          )}
        </select>
      </div>
    );
    return (
      <div className={`f ${field.when ? 'fade' : ''}`}>
        <Label htmlFor={inputId} field={field} dirty={dirty} />
        {isLib ? (
          <div className="withnew">
            {select}
            {/* Inline creation: build the object and select it without leaving the page. */}
            <button type="button" className="newbtn" onClick={() => onCreateNew?.(field.lib!)}>
              + New
            </button>
          </div>
        ) : (
          select
        )}
        {showHelp ? (
          <div className="help" id={helpId}>
            {field.help}
          </div>
        ) : null}
        {error ? (
          <div className="err" id={errId}>
            {error}
          </div>
        ) : null}
        {compareTo ? (
          <div className="cmpref">
            Campaign uses <b>{compareTo.value || 'nothing'}</b> for its outbound leg
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`f ${field.when ? 'fade' : ''}`}>
      <Label htmlFor={inputId} field={field} dirty={dirty} />
      <input
        id={inputId}
        type={field.kind === 'number' ? 'number' : 'text'}
        className={invalid ? 'bad' : ''}
        value={String(value ?? '')}
        placeholder={field.ph ?? ''}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {showHelp ? (
        <div className="help" id={helpId}>
          {field.help}
        </div>
      ) : null}
      {error ? (
        <div className="err" id={errId}>
          {error}
        </div>
      ) : null}
      {compareTo ? (
        <div className="cmpref">
          Campaign uses <b>{compareTo.value || 'nothing'}</b> for its outbound leg
        </div>
      ) : null}
    </div>
  );
}

/** Simple labelled controls used by the survey and structure editors. */
export function TextInput({
  label,
  value,
  onChange,
  required,
  placeholder,
  type,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: string;
  invalid?: boolean;
}) {
  const inputId = useId();
  return (
    <div className="f">
      <label htmlFor={inputId}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        id={inputId}
        type={type ?? 'text'}
        className={invalid ? 'bad' : ''}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SelectInput({
  label,
  value,
  options,
  onChange,
  required,
  invalid,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  const inputId = useId();
  return (
    <div className="f">
      <label htmlFor={inputId}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="selwrap">
        <select
          id={inputId}
          className={invalid ? 'bad' : ''}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o === '' ? 'Select an option' : o}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export { IconButton };
