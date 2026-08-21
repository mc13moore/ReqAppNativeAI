import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconAlert, IconChevronLeft, IconDoc, IconPlus, IconClose } from '../components/Icons';
import { Badge, EmptyState, ErrorBanner, Skeleton } from '../components/primitives';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { money, todayIso } from '../lib/format';
import { useAsync } from '../lib/hooks';
import type { CreateWithLinesResult, LookupResult, Record365 } from '../lib/types';

/** A line held locally until the whole requisition is submitted. */
interface DraftLine {
  id: number;
  category: string;
  requisitioner: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vendor: string;
  requestedDate: string;
}

const emptyLine = (id: number, preparer: string): DraftLine => ({
  id,
  category: '',
  requisitioner: preparer,
  description: '',
  quantity: '1',
  unit: '',
  unitPrice: '',
  vendor: '',
  requestedDate: todayIso(),
});

/** Net amount for a draft line. Quantity x unit price, to two decimals. */
function netAmount(line: DraftLine): number {
  const quantity = Number(line.quantity);
  const price = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
  return Math.round(quantity * price * 100) / 100;
}

export function CreateRequisitionPage() {
  const { config, schema } = useApp();
  const navigate = useNavigate();

  const lookups = useAsync(() => api.lookups(), []);

  const [company, setCompany] = useState(config.defaultCompany.toUpperCase());
  const [header, setHeader] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<DraftLine[]>([
    emptyLine(1, config.preparerPersonnelNumber),
  ]);
  const [nextId, setNextId] = useState(2);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CreateWithLinesResult | null>(null);

  const headerFields = useMemo(
    () => schema.header.fields.filter((f) => !f.readOnly),
    [schema.header.fields],
  );

  const total = lines.reduce((sum, line) => sum + netAmount(line), 0);

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine(nextId, config.preparerPersonnelNumber)]);
    setNextId((n) => n + 1);
  };

  const updateLine = (id: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  const removeLine = (id: number) => setLines((prev) => prev.filter((line) => line.id !== id));

  const missingHeader = headerFields.filter((f) => f.required && !header[f.name]?.trim());
  const incompleteLines = lines.filter(
    (line) => !line.description.trim() || !Number(line.quantity) || !line.requisitioner.trim(),
  );
  const canSubmit =
    !saving && missingHeader.length === 0 && lines.length > 0 && incompleteLines.length === 0;

  const submit = async () => {
    setSaving(true);
    setError(null);
    setResult(null);

    try {
      const headerPayload: Record365 = {};
      for (const [name, value] of Object.entries(header)) {
        if (value.trim()) headerPayload[name] = value;
      }

      const linePayload: Record365[] = lines.map((line) => {
        const payload: Record365 = {
          LineDescription: line.description,
          RequestedPurchaseQuantity: Number(line.quantity),
          RequisitionerPersonnelNumber: line.requisitioner,
          RequestedDate: line.requestedDate,
        };
        // Blank optional values are omitted rather than sent empty: D365
        // rejects empty strings on typed fields.
        if (line.category) payload['ProcurementProductCategoryName'] = line.category;
        if (line.unit) payload['PurchaseUnitSymbol'] = line.unit;
        if (line.unitPrice) payload['PurchasePrice'] = Number(line.unitPrice);
        if (line.vendor) payload['VendorAccountNumber'] = line.vendor;
        return payload;
      });

      const created = await api.createRequisitionWithLines({
        company,
        header: headerPayload,
        lines: linePayload,
      });

      setResult(created);

      // Only leave the page when everything landed; a partial result needs to
      // stay on screen so the failures can actually be read.
      if (created.failures.length === 0) {
        navigate(
          `/requisitions/${created.company.toLowerCase()}/${encodeURIComponent(created.requisitionNumber)}`,
        );
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <Link
        to="/requisitions"
        className="small row"
        style={{ gap: '0.25rem', marginBottom: '0.75rem' }}
      >
        <IconChevronLeft size={14} />
        All requisitions
      </Link>

      <div className="page__head">
        <div>
          <div className="page__eyebrow">Create</div>
          <h1>New requisition</h1>
          <p className="page__sub">
            Header and lines are written to Dynamics 365 together when you submit.
          </p>
        </div>
        <div className="row">
          <Badge tone="info">Preparer {config.preparerPersonnelNumber}</Badge>
        </div>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      {result && result.failures.length > 0 && (
        <div className="banner banner--warning" style={{ marginBottom: '1rem' }}>
          <IconAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div className="banner__title">
              Requisition {result.requisitionNumber} was created, but{' '}
              {result.failures.length} of {result.linesRequested} lines failed
            </div>
            <p>
              {result.linesCreated} line{result.linesCreated === 1 ? '' : 's'} saved. The header
              exists in Dynamics 365 and was not rolled back.
            </p>
            <ul className="banner__list">
              {result.failures.map((failure) => (
                <li key={failure.index}>
                  Line {failure.index + 1}: {failure.message}
                </li>
              ))}
            </ul>
            <Link
              to={`/requisitions/${result.company.toLowerCase()}/${encodeURIComponent(result.requisitionNumber)}`}
              className="small"
              style={{ fontWeight: 650 }}
            >
              Open {result.requisitionNumber} →
            </Link>
          </div>
        </div>
      )}

      {/* --- Header ------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card__head">
          <h2 className="card__title">
            <IconDoc size={15} />
            Requisition header
          </h2>
          <span className="card__hint">
            Number assigned by Dynamics 365 · preparer {config.preparerPersonnelNumber}
          </span>
        </div>

        <div className="form__grid">
          <div className="field">
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
            <p className="field__hint">Sets the buying legal entity.</p>
          </div>

          {headerFields.map((field) => {
            const id = `header-${field.name}`;
            return (
              <div className="field" key={field.name}>
                <label className="field__label" htmlFor={id}>
                  {field.label}
                  {field.required && <span className="field__required"> *</span>}
                </label>
                {field.type === 'enum' && field.options ? (
                  <select
                    id={id}
                    className="field__input"
                    value={header[field.name] ?? ''}
                    onChange={(e) => setHeader((h) => ({ ...h, [field.name]: e.target.value }))}
                    disabled={saving}
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
                    type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                    value={header[field.name] ?? ''}
                    onChange={(e) => setHeader((h) => ({ ...h, [field.name]: e.target.value }))}
                    disabled={saving}
                  />
                )}
                {field.hint && <p className="field__hint">{field.hint}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* --- Lines -------------------------------------------------------- */}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Lines ({lines.length})</h2>
          <div className="row">
            {lookups.data && <LookupNotice lookups={lookups.data} />}
            <button type="button" className="btn btn--ghost btn--sm" onClick={addLine} disabled={saving}>
              <IconPlus size={14} />
              Add line
            </button>
          </div>
        </div>

        {lookups.loading && <Skeleton variant="row" count={2} />}

        {lines.length === 0 ? (
          <EmptyState
            title="No lines yet"
            hint="A requisition needs at least one line."
            action={
              <button type="button" className="btn btn--primary btn--sm" onClick={addLine}>
                <IconPlus size={14} />
                Add the first line
              </button>
            }
          />
        ) : (
          <div className="stack">
            {lines.map((line, index) => (
              <LineEditor
                key={line.id}
                index={index}
                line={line}
                lookups={lookups.data}
                disabled={saving}
                onChange={(patch) => updateLine(line.id, patch)}
                onRemove={lines.length > 1 ? () => removeLine(line.id) : undefined}
              />
            ))}
          </div>
        )}

        <div style={{ marginTop: '1.15rem', marginLeft: 'auto', maxWidth: 320 }}>
          <div className="total-row total-row--grand">
            <span>Requisition total</span>
            <span className="numeric">{money(total)}</span>
          </div>
          <p className="tiny dim" style={{ marginTop: '0.3rem' }}>
            Calculated locally from quantity × unit price. Dynamics 365 recalculates on save.
          </p>
        </div>

        <div className="form__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {saving ? 'Creating…' : `Create requisition with ${lines.length} line${lines.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            className="btn btn--subtle"
            onClick={() => navigate('/requisitions')}
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        {(missingHeader.length > 0 || incompleteLines.length > 0) && (
          <p className="field__hint" style={{ marginTop: '0.6rem', color: 'var(--danger)' }}>
            {missingHeader.length > 0 && `Header needs: ${missingHeader.map((f) => f.label).join(', ')}. `}
            {incompleteLines.length > 0 &&
              `${incompleteLines.length} line${incompleteLines.length === 1 ? '' : 's'} still need a description, quantity and employee.`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Warns when a dropdown fell back to values observed on existing lines. */
function LookupNotice({ lookups }: { lookups: Record<string, LookupResult> }) {
  const degraded = Object.values(lookups).filter((l) => l.source !== 'entity');
  if (degraded.length === 0) return null;

  return (
    <Badge tone="warning" dot>
      {degraded.length} list{degraded.length === 1 ? '' : 's'} from existing lines
    </Badge>
  );
}

function LineEditor({
  index,
  line,
  lookups,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  line: DraftLine;
  lookups: Record<string, LookupResult> | null;
  disabled: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove?: () => void;
}) {
  const amount = netAmount(line);

  return (
    <div className="inset">
      <div className="row row--between" style={{ marginBottom: '0.75rem' }}>
        <h3 className="inset__title" style={{ margin: 0 }}>
          Line {index + 1}
        </h3>
        <div className="row" style={{ gap: '0.6rem' }}>
          <span className="small muted">
            Net <strong className="numeric">{money(amount)}</strong>
          </span>
          {onRemove && (
            <button
              type="button"
              className="btn btn--subtle btn--icon btn--sm"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove line ${index + 1}`}
            >
              <IconClose size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="form__grid">
        <LookupField
          label="Procurement category"
          lookup={lookups?.['categories']}
          value={line.category}
          onChange={(value) => onChange({ category: value })}
          disabled={disabled}
        />

        <LookupField
          label="Employee"
          required
          lookup={lookups?.['employees']}
          value={line.requisitioner}
          onChange={(value) => onChange({ requisitioner: value })}
          disabled={disabled}
          hint="Requisitioner personnel number."
        />

        <div className="field" style={{ gridColumn: 'span 2', minWidth: 240 }}>
          <label className="field__label">
            Item description<span className="field__required"> *</span>
          </label>
          <input
            className="field__input"
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
            disabled={disabled}
            placeholder="What is being requested"
          />
        </div>

        <div className="field">
          <label className="field__label">
            Quantity<span className="field__required"> *</span>
          </label>
          <input
            className="field__input numeric"
            type="number"
            min="0"
            step="any"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            disabled={disabled}
          />
        </div>

        <LookupField
          label="Unit of measure"
          lookup={lookups?.['units']}
          value={line.unit}
          onChange={(value) => onChange({ unit: value })}
          disabled={disabled}
        />

        <div className="field">
          <label className="field__label">Unit price</label>
          <input
            className="field__input numeric"
            type="number"
            min="0"
            step="any"
            value={line.unitPrice}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label className="field__label">Net amount</label>
          <input
            className="field__input numeric"
            value={money(amount)}
            readOnly
            disabled
            tabIndex={-1}
            aria-label="Net amount, calculated"
          />
          <p className="field__hint">Quantity × unit price.</p>
        </div>

        <LookupField
          label="Vendor account"
          lookup={lookups?.['vendors']}
          value={line.vendor}
          onChange={(value) => onChange({ vendor: value })}
          disabled={disabled}
        />

        <div className="field">
          <label className="field__label">Requested date</label>
          <input
            className="field__input"
            type="date"
            value={line.requestedDate}
            onChange={(e) => onChange({ requestedDate: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Dropdown backed by D365 reference data.
 *
 * Degrades to a free-text input when the lookup returned nothing, so a missing
 * or misnamed reference entity narrows the form rather than blocking it.
 */
function LookupField({
  label,
  lookup,
  value,
  onChange,
  disabled,
  required,
  hint,
}: {
  label: string;
  lookup?: LookupResult;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
  hint?: string;
}) {
  const hasOptions = (lookup?.options.length ?? 0) > 0;

  return (
    <div className="field">
      <label className="field__label">
        {label}
        {required && <span className="field__required"> *</span>}
      </label>

      {hasOptions ? (
        <select
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">— Select —</option>
          {lookup!.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label === option.value ? option.label : `${option.label} (${option.value})`}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Type a value"
        />
      )}

      {hint && <p className="field__hint">{hint}</p>}
      {!hasOptions && lookup && (
        <p className="field__hint" style={{ color: 'var(--warning)' }}>
          No list available — enter the value directly.
        </p>
      )}
    </div>
  );
}
