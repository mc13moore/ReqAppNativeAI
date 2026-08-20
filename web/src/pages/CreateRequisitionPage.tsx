import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EntityForm } from '../components/EntityForm';
import { ErrorBanner } from '../components/Feedback';
import { api } from '../lib/api';
import { useApp } from '../lib/AppContext';
import type { Record365 } from '../lib/types';

export function CreateRequisitionPage() {
  const { config, schema } = useApp();
  const navigate = useNavigate();

  const [company, setCompany] = useState(config.defaultCompany);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (values: Record365) => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.createRequisition({ ...values, dataAreaId: company });
      const number = String(created['RequisitionNumber'] ?? '');
      const createdCompany = String(created['dataAreaId'] ?? company);

      // F&O may assign the number from a sequence, so navigate using what came
      // back rather than what was submitted.
      if (number) {
        navigate(
          `/requisitions/${encodeURIComponent(createdCompany)}/${encodeURIComponent(number)}`,
        );
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <Link className="back-link" to="/">
        ← All requisitions
      </Link>

      <header className="page-head">
        <div>
          <h1>New requisition</h1>
          <p className="page-head__sub">
            Creates a record in <code>{config.headerEntitySet}</code>. Lines are added afterwards
            from the requisition page.
          </p>
        </div>
      </header>

      {error ? <ErrorBanner error={error} /> : null}

      <div className="card">
        <div className="field field--standalone">
          <label className="field__label" htmlFor="create-company">
            Company
          </label>
          <input
            id="create-company"
            className="field__input"
            value={company}
            onChange={(e) => setCompany(e.target.value.trim())}
            disabled={saving}
          />
          <p className="field__hint">Legal entity (dataAreaId) the requisition belongs to.</p>
        </div>

        <EntityForm
          entity={schema.header}
          hidden={['dataAreaId']}
          submitLabel="Create requisition"
          busy={saving}
          onSubmit={submit}
          onCancel={() => navigate('/')}
        />
      </div>
    </section>
  );
}
