import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconAlert, IconChevronLeft, IconClose, IconPlus } from '../components/Icons';
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
  employee: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vendor: string;
}

const emptyLine = (id: number, employee: string): DraftLine => ({
  id,
  category: '',
  employee,
  description: '',
  quantity: '1',
  unit: '',
  unitPrice: '',
  vendor: '',
});

/** Net amount for a line: quantity × unit price, to two decimals. */
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

  const [header, setHeader] = useState<Record<string, string>>({
    DefaultRequestedDate: todayIso(),
  });
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
    setLines((prev) => {
      // Carry the previous line's category and vendor forward: consecutive
      // lines on one requisition usually share them, and retyping is friction.
      const last = prev[prev.length - 1];
      const fresh = emptyLine(nextId, config.preparerPersonnelNumber);
      return [
        ...prev,
        last ? { ...fresh, category: last.category, vendor: last.vendor, unit: last.unit } : fresh,
      ];
    });
    setNextId((n) => n + 1);
  };

  const updateLine = (id: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  const removeLine = (id: number) => setLines((prev) => prev.filter((line) => line.id !== id));

  const missingHeader = headerFields.filter((f) => f.required && !header[f.name]?.trim());
  const incompleteLines = lines.filter(
    (line) => !line.description.trim() || !Number(line.quantity) || !line.employee.trim(),
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

      const requestedDate = header['DefaultRequestedDate'] ?? todayIso();

      const linePayload: Record365[] = lines.map((line) => {
        const payload: Record365 = {
          LineDescription: line.description,
          RequestedPurchaseQuantity: Number(line.quantity),
          RequisitionerPersonnelNumber: line.employee,
          // Lines inherit the header's requested date rather than each
          // carrying its own; one date per requisition is what this workflow
          // actually needs.
          RequestedDate: requestedDate,
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
        header: headerPayload,
        lines: linePayload,
      });

      setResult(created);

      // Only leave the page when everything landed; a partial result needs to
      // stay on screen so the failures can actually be read.
      if (created.failures.length === 0) {
        navigate(
          `/requisitions/${(created.company || 'usmf').toLowerCase()}/${encodeURIComponent(created.requisitionNumber)}`,
        );
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
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
          <Badge tone="neutral">Consumption</Badge>
        </div>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      {result && result.failures.length > 0 && (
        <div className="banner banner--warning" style={{ marginBottom: '1rem' }}>
          <IconAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div className="banner__title">
              {result.requisitionNumber} was created, but {result.failures.length} of{' '}
              {result.linesRequested} lines failed
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
              to={`/requisitions/${(result.company || 'usmf').toLowerCase()}/${encodeURIComponent(result.requisitionNumber)}`}
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
          <h2 className="card__title">Requisition details</h2>
          <span className="card__hint">
            Number, purpose and accounting date are set automatically
          </span>
        </div>

        <div className="form__grid">
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
                    type={
                      field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'
                    }
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

      {/* --- Lines: one row each ------------------------------------------ */}
      <div className="card card--flush">
        <div className="card__head" style={{ padding: '1.15rem 1.15rem 0' }}>
          <h2 className="card__title">Lines ({lines.length})</h2>
          <div className="row">
            {lookups.data && <LookupNotice lookups={lookups.data} />}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addLine}
              disabled={saving}
            >
              <IconPlus size={14} />
              Add line
            </button>
          </div>
        </div>

        <div style={{ padding: '0.9rem 1.15rem 1.15rem' }}>
          {lookups.loading ? (
            <Skeleton variant="row" count={2} />
          ) : lines.length === 0 ? (
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
            <div className="table-wrap">
              <table className="table line-editor">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th style={{ minWidth: 220 }}>Description *</th>
                    <th style={{ minWidth: 160 }}>Category</th>
                    <th style={{ minWidth: 150 }}>Employee *</th>
                    <th style={{ width: 90 }} className="num">
                      Qty *
                    </th>
                    <th style={{ width: 110 }}>Unit</th>
                    <th style={{ width: 120 }} className="num">
                      Unit price
                    </th>
                    <th style={{ width: 120 }} className="num">
                      Net amount
                    </th>
                    <th style={{ minWidth: 160 }}>Vendor</th>
                    <th style={{ width: 40 }} aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.id}>
                      <td className="dim mono">{index + 1}</td>

                      <td>
                        <input
                          className="cell-input"
                          value={line.description}
                          onChange={(e) => updateLine(line.id, { description: e.target.value })}
                          disabled={saving}
                          placeholder="What is being requested"
                          aria-label={`Line ${index + 1} description`}
                        />
                      </td>

                      <td>
                        <CellLookup
                          lookup={lookups.data?.['categories']}
                          value={line.category}
                          onChange={(value) => updateLine(line.id, { category: value })}
                          disabled={saving}
                          label={`Line ${index + 1} category`}
                        />
                      </td>

                      <td>
                        <CellLookup
                          lookup={lookups.data?.['employees']}
                          value={line.employee}
                          onChange={(value) => updateLine(line.id, { employee: value })}
                          disabled={saving}
                          label={`Line ${index + 1} employee`}
                        />
                      </td>

                      <td>
                        <input
                          className="cell-input num"
                          type="number"
                          min="0"
                          step="any"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                          disabled={saving}
                          aria-label={`Line ${index + 1} quantity`}
                        />
                      </td>

                      <td>
                        <CellLookup
                          lookup={lookups.data?.['units']}
                          value={line.unit}
                          onChange={(value) => updateLine(line.id, { unit: value })}
                          disabled={saving}
                          label={`Line ${index + 1} unit of measure`}
                        />
                      </td>

                      <td>
                        <input
                          className="cell-input num"
                          type="number"
                          min="0"
                          step="any"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                          disabled={saving}
                          placeholder="0.00"
                          aria-label={`Line ${index + 1} unit price`}
                        />
                      </td>

                      <td className="num numeric" style={{ fontWeight: 650 }}>
                        {money(netAmount(line))}
                      </td>

                      <td>
                        <CellLookup
                          lookup={lookups.data?.['vendors']}
                          value={line.vendor}
                          onChange={(value) => updateLine(line.id, { vendor: value })}
                          disabled={saving}
                          label={`Line ${index + 1} vendor`}
                        />
                      </td>

                      <td>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            className="btn btn--subtle btn--icon btn--sm"
                            onClick={() => removeLine(line.id)}
                            disabled={saving}
                            aria-label={`Remove line ${index + 1}`}
                          >
                            <IconClose size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: '1rem', marginLeft: 'auto', maxWidth: 300 }}>
            <div className="total-row total-row--grand">
              <span>Total</span>
              <span className="numeric">{money(total)}</span>
            </div>
            <p className="tiny dim" style={{ marginTop: '0.3rem' }}>
              Dynamics 365 recalculates amounts on save.
            </p>
          </div>

          <div className="form__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void submit()}
              disabled={!canSubmit}
            >
              {saving
                ? 'Creating…'
                : `Create requisition with ${lines.length} line${lines.length === 1 ? '' : 's'}`}
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
              {missingHeader.length > 0 &&
                `Header needs: ${missingHeader.map((f) => f.label).join(', ')}. `}
              {incompleteLines.length > 0 &&
                `${incompleteLines.length} line${incompleteLines.length === 1 ? '' : 's'} still need a description, quantity and employee.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Warns when a dropdown could not use a proper reference entity. */
function LookupNotice({ lookups }: { lookups: Record<string, LookupResult> }) {
  const degraded = Object.values(lookups).filter(
    (l) => l.source !== 'entity' && l.source !== 'discovered',
  );
  if (degraded.length === 0) return null;

  return (
    <Badge tone="warning" dot>
      {degraded.map((l) => l.kind).join(', ')} limited
    </Badge>
  );
}

/**
 * In-cell dropdown, degrading to a text input when no options exist.
 *
 * Rendered as a native select so long lists stay keyboard-searchable: typing
 * the first characters of a vendor account jumps to it, which matters when the
 * vendor master runs to hundreds of rows.
 */
function CellLookup({
  lookup,
  value,
  onChange,
  disabled,
  label,
}: {
  lookup?: LookupResult;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
}) {
  const options = lookup?.options ?? [];

  if (options.length === 0) {
    return (
      <input
        className="cell-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Type a value"
        aria-label={label}
      />
    );
  }

  return (
    <select
      className="cell-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={label}
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label === option.value ? option.label : `${option.value} · ${option.label}`}
        </option>
      ))}
    </select>
  );
}
