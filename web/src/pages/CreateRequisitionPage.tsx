import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconCheckCircle, IconChevronLeft } from '../components/Icons';
import { Badge, ErrorBanner } from '../components/primitives';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { money } from '../lib/format';
import type { FieldDef, Record365 } from '../lib/types';

/**
 * Multi-step requisition creation.
 *
 * The steps are driven by the schema the server publishes, so correcting a
 * field name in the D365 entity definitions changes this form with no edit
 * here. Only the grouping of fields into steps is decided in this file.
 */

interface StepDef {
  title: string;
  subtitle: string;
  /** Field names from the header schema shown in this step. */
  fields: string[];
}

const STEPS: StepDef[] = [
  {
    title: 'Basics',
    subtitle: 'What and why',
    fields: ['RequisitionName', 'RequisitionPurpose'],
  },
  {
    title: 'Scheduling',
    subtitle: 'Dates',
    fields: ['DefaultRequestedDate', 'DefaultAccountingDate'],
  },
  {
    title: 'Review',
    subtitle: 'Confirm and submit',
    fields: [],
  },
];

export function CreateRequisitionPage() {
  const { config, schema } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [company, setCompany] = useState(config.defaultCompany.toUpperCase());
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const editable = useMemo(
    () => schema.header.fields.filter((f) => !f.readOnly),
    [schema.header.fields],
  );

  const fieldByName = useMemo(() => {
    const map = new Map<string, FieldDef>();
    for (const field of editable) map.set(field.name, field);
    return map;
  }, [editable]);

  // Any editable field not explicitly placed in a step still needs to appear,
  // or a schema change could silently drop it from the form.
  const placed = new Set(STEPS.flatMap((s) => s.fields));
  const unplaced = editable.filter((f) => !placed.has(f.name));

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = editable.filter((f) => f.required && !values[f.name]?.trim());
  const canSubmit = missingRequired.length === 0 && company.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record365 = { dataAreaId: company.trim().toLowerCase() };
      for (const [name, value] of Object.entries(values)) {
        if (value !== '') payload[name] = value;
      }

      const created = await api.createRequisition(payload);
      const number = String(created['RequisitionNumber'] ?? '');
      const createdCompany = String(created['ProjectBuyingLegalEntityId'] ?? company);

      if (number) {
        navigate(`/requisitions/${createdCompany.toLowerCase()}/${encodeURIComponent(number)}`);
      } else {
        navigate('/requisitions');
      }
    } catch (err) {
      setError(err);
      // Send the user back to a step where the problem is fixable rather than
      // stranding them on a review screen with an error they cannot act on.
      setStep(0);
    } finally {
      setSaving(false);
    }
  };

  const currentStep = STEPS[step]!;
  const stepFields = [
    ...currentStep.fields.map((name) => fieldByName.get(name)).filter((f): f is FieldDef => !!f),
    ...(step === 0 ? unplaced : []),
  ];

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <Link to="/requisitions" className="small row" style={{ gap: '0.25rem', marginBottom: '0.75rem' }}>
        <IconChevronLeft size={14} />
        All requisitions
      </Link>

      <div className="page__head">
        <div>
          <div className="page__eyebrow">Create</div>
          <h1>New requisition</h1>
          <p className="page__sub">
            Creates a record in <code>{config.headerEntitySet}</code>. Lines are added afterwards
            from the requisition page.
          </p>
        </div>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      <div className="card" style={{ marginTop: error ? '1rem' : 0 }}>
        <div className="stepper">
          {STEPS.map((s, index) => (
            <button
              key={s.title}
              type="button"
              className={`step${index === step ? ' step--active' : ''}${index < step ? ' step--done' : ''}`}
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
            >
              <span className="step__num">
                {index < step ? <IconCheckCircle size={13} /> : index + 1}
              </span>
              <span>
                <span className="step__label" style={{ display: 'block' }}>
                  {s.title}
                </span>
                <span className="step__sub">{s.subtitle}</span>
              </span>
            </button>
          ))}
        </div>

        {step === 0 && (
          <div className="field" style={{ maxWidth: 260, marginBottom: '1rem' }}>
            <label className="field__label" htmlFor="company">
              Legal entity
            </label>
            <input
              id="company"
              className="field__input"
              value={company}
              onChange={(e) => setCompany(e.target.value.toUpperCase())}
              disabled={saving}
            />
            <p className="field__hint">Sets the buying legal entity on the requisition.</p>
          </div>
        )}

        {step < 2 ? (
          <>
            <div className="form__grid">
              {stepFields.map((field) => (
                <Field
                  key={field.name}
                  field={field}
                  value={values[field.name] ?? ''}
                  onChange={(v) => setValue(field.name, v)}
                  disabled={saving}
                />
              ))}
            </div>

            {step === 0 && (
              <p className="field__hint" style={{ marginTop: '0.9rem' }}>
                The requisition number is assigned by Dynamics 365, and the preparer is set from
                your signed-in account.
              </p>
            )}
          </>
        ) : (
          <ReviewStep company={company} values={values} fields={editable} />
        )}

        <div className="form__actions">
          {step > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={saving}
            >
              Back
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep((s) => s + 1)}>
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void submit()}
              disabled={saving || !canSubmit}
            >
              {saving ? 'Creating…' : 'Create requisition'}
            </button>
          )}

          <button
            type="button"
            className="btn btn--subtle"
            onClick={() => navigate('/requisitions')}
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        {step === STEPS.length - 1 && missingRequired.length > 0 && (
          <p className="field__hint" style={{ marginTop: '0.6rem', color: 'var(--danger)' }}>
            Still required: {missingRequired.map((f) => f.label).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
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
  const hintId = field.hint ? `${id}-hint` : undefined;

  const inputType =
    field.type === 'number' || field.type === 'integer'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'datetime'
          ? 'datetime-local'
          : 'text';

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>

      {field.type === 'enum' && field.options ? (
        <select
          id={id}
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={hintId}
        >
          <option value="">— Select —</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="field__input"
          type={inputType}
          step={field.type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={hintId}
        />
      )}

      {field.hint && (
        <p className="field__hint" id={hintId}>
          {field.hint}
        </p>
      )}
    </div>
  );
}

function ReviewStep({
  company,
  values,
  fields,
}: {
  company: string;
  values: Record<string, string>;
  fields: FieldDef[];
}) {
  const filled = fields.filter((f) => values[f.name]?.trim());

  return (
    <div>
      <div className="callout" style={{ marginBottom: '1rem' }}>
        <IconCheckCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }} />
        <div>
          <strong>Ready to create</strong>
          <div className="tiny dim" style={{ marginTop: '0.15rem' }}>
            This writes a purchase requisition header to Dynamics 365. Lines are added next.
          </div>
        </div>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>Legal entity</dt>
          <dd>
            <Badge tone="info">{company}</Badge>
          </dd>
        </div>
        {filled.map((field) => (
          <div key={field.name}>
            <dt>{field.label}</dt>
            <dd>
              {field.type === 'number' && !Number.isNaN(Number(values[field.name]))
                ? money(Number(values[field.name]))
                : values[field.name]}
            </dd>
          </div>
        ))}
        <div>
          <dt>Requisition number</dt>
          <dd className="dim">Assigned by Dynamics 365</dd>
        </div>
        <div>
          <dt>Preparer</dt>
          <dd className="dim">Your signed-in account</dd>
        </div>
      </dl>
    </div>
  );
}
