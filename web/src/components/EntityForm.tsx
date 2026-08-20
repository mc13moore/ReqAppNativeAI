import { useMemo, useState, type FormEvent } from 'react';
import type { EntityDef, FieldDef, Record365 } from '../lib/types';

interface EntityFormProps {
  entity: EntityDef;
  /** Fields to hide entirely -- keys supplied by the route, for example. */
  hidden?: string[];
  initialValues?: Record<string, string>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: Record365) => void | Promise<void>;
  onCancel?: () => void;
}

/**
 * Renders a create form directly from the field descriptors the API serves.
 *
 * Nothing about purchase requisitions is hard-coded here: correcting a field
 * name in the server's entities.ts changes this form with no edit on this side.
 */
export function EntityForm({
  entity,
  hidden = [],
  initialValues = {},
  submitLabel,
  busy = false,
  onSubmit,
  onCancel,
}: EntityFormProps) {
  const fields = useMemo(
    () => entity.fields.filter((f) => !f.readOnly && !hidden.includes(f.name)),
    [entity, hidden],
  );

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of fields) seed[field.name] = initialValues[field.name] ?? '';
    return seed;
  });

  const setValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    // Blank optional inputs are dropped rather than sent as empty strings,
    // which D365 rejects on typed fields.
    const payload: Record365 = {};
    for (const [name, value] of Object.entries(values)) {
      if (value !== '') payload[name] = value;
    }
    void onSubmit(payload);
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="form__grid">
        {fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={values[field.name] ?? ''}
            onChange={(value) => setValue(field.name, value)}
            disabled={busy}
          />
        ))}
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = `field-${field.name}`;
  const describedBy = field.hint ? `${id}-hint` : undefined;

  const common = {
    id,
    name: field.name,
    value,
    disabled,
    required: field.required,
    'aria-describedby': describedBy,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>

      {field.type === 'enum' && field.options ? (
        <select className="field__input" {...common}>
          <option value="">— Select —</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <select className="field__input" {...common}>
          <option value="">— Select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input
          className="field__input"
          type={inputType(field)}
          step={field.type === 'number' ? 'any' : undefined}
          {...common}
        />
      )}

      {field.hint && (
        <p className="field__hint" id={describedBy}>
          {field.hint}
        </p>
      )}
    </div>
  );
}

function inputType(field: FieldDef): string {
  switch (field.type) {
    case 'number':
    case 'integer':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime-local';
    default:
      return 'text';
  }
}
