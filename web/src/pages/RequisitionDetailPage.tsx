import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { EntityForm } from '../components/EntityForm';
import { Badge, ErrorBanner, Spinner, SuccessBanner } from '../components/Feedback';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { formatValue, statusTone, todayIso } from '../lib/format';
import { useAsync } from '../lib/hooks';
import type { Record365 } from '../lib/types';

export function RequisitionDetailPage() {
  const { schema } = useApp();
  const { company = '', requisitionNumber = '' } = useParams();

  const state = useAsync(
    () => api.getRequisition(company, requisitionNumber),
    [company, requisitionNumber],
  );

  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [savedLine, setSavedLine] = useState<string | null>(null);

  const addLine = async (values: Record365) => {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await api.createLine(company, requisitionNumber, values);
      setSavedLine(String(created['LineNumber'] ?? ''));
      setAdding(false);
      state.reload();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  if (state.loading) return <Spinner label="Loading requisition…" />;

  if (state.error) {
    const notFound = state.error instanceof ApiError && state.error.status === 404;
    return (
      <section>
        <Link className="back-link" to="/">
          ← All requisitions
        </Link>
        <ErrorBanner
          error={
            notFound
              ? new Error(`Requisition ${requisitionNumber} was not found in company ${company}.`)
              : state.error
          }
          onRetry={state.reload}
        />
      </section>
    );
  }

  const header = state.data?.header ?? {};
  const lines = state.data?.lines ?? [];
  const lineColumns = schema.line.fields.filter((f) => f.inList);

  return (
    <section>
      <Link className="back-link" to="/">
        ← All requisitions
      </Link>

      <header className="page-head">
        <div>
          <h1>
            {String(header['RequisitionNumber'] ?? requisitionNumber)}
            <Badge tone={statusTone(header['RequisitionStatus'])}>
              {String(header['RequisitionStatus'] ?? 'Unknown')}
            </Badge>
          </h1>
          <p className="page-head__sub">{String(header['RequisitionName'] ?? '')}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={state.reload}>
          Refresh
        </button>
      </header>

      <div className="card">
        <h2 className="card__title">Header</h2>
        <dl className="detail-grid">
          {schema.header.fields.map((field) => (
            <div className="detail-grid__item" key={field.name}>
              <dt>{field.label}</dt>
              <dd>{formatValue(field, header[field.name])}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Lines ({lines.length})</h2>
          {!adding && (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              Add line
            </button>
          )}
        </div>

        {savedLine !== null && !adding && (
          <SuccessBanner>
            Line {savedLine} was added to requisition {requisitionNumber}.
          </SuccessBanner>
        )}

        {adding && (
          <div className="inset">
            <h3 className="inset__title">New line</h3>
            {saveError ? <ErrorBanner error={saveError} /> : null}
            <EntityForm
              entity={schema.line}
              // The route already fixes the company and parent requisition, and
              // the server assigns the next line number.
              hidden={['dataAreaId', 'RequisitionNumber', 'LineNumber']}
              initialValues={{ RequestedDeliveryDate: todayIso() }}
              submitLabel="Add line"
              busy={saving}
              onSubmit={addLine}
              onCancel={() => {
                setAdding(false);
                setSaveError(null);
              }}
            />
          </div>
        )}

        <DataTable
          fields={lineColumns}
          rows={lines}
          emptyTitle="No lines yet"
          emptyHint="Add a line to this requisition to get started."
        />
      </div>
    </section>
  );
}
