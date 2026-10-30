import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, ClipboardList, Plus, Trash2,
  RefreshCw, Send, CheckCircle2, Clock3, FileText
} from 'lucide-react';
import {
  createMonthlyPlan,
  getMonthlyPlans,
  submitMonthlyPlan
} from '../api/sprintPlanning';
import { useCustomAlert } from '../components/CustomAlertProvider';

const todayMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const statusLabels = {
  draft: 'Draft',
  submitted: 'Awaiting Approval',
  pending_approval: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Returned / Rejected',
};

const statusColors = {
  approved: '#168354',
  rejected: '#c2413b',
  draft: '#697586',
  submitted: '#b7791f',
  pending_approval: '#b7791f',
};

function extractItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data?.items)) return response.data.items;
  return [];
}

function errorMessage(error) {
  return error?.message || 'The request could not be completed.';
}

export default function SprintMonthlyPlanning() {
  const { notify, confirm: customConfirm } = useCustomAlert();
  const [month, setMonth] = useState(todayMonth());
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState(['']);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingId, setSubmittingId] = useState(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMonthlyPlans();
      setPlans(extractItems(response));
    } catch (error) {
      notify({ type: 'error', title: 'Unable to load plans', message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const updateGoal = (index, value) => {
    setGoals((current) => current.map((item, i) => i === index ? value : item));
  };

  const removeGoal = (index) => {
    setGoals((current) => current.filter((_, i) => i !== index));
  };

  const savePlan = async (event) => {
    event.preventDefault();

    const cleanedGoals = goals.map((goal) => goal.trim()).filter(Boolean);

    if (!month || !title.trim() || cleanedGoals.length === 0) {
      notify({
        type: 'warning',
        title: 'Missing details',
        message: 'Select a month, enter a plan title and add at least one goal.',
      });
      return;
    }

    setSaving(true);
    try {
      await createMonthlyPlan({
        month,
        title: title.trim(),
        goals: cleanedGoals,
      });

      notify({
        type: 'success',
        title: 'Monthly plan created',
        message: 'Your draft was saved successfully. Submit it for Team Leader approval.',
      });

      setTitle('');
      setGoals(['']);
      await loadPlans();
    } catch (error) {
      notify({ type: 'error', title: 'Plan creation failed', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const submitPlan = async (plan) => {
    const confirmed = await customConfirm(
      'Submit this monthly planning sheet to your Reporting Team Leader for approval?',
      { title: 'Submit Monthly Plan', confirmText: 'Submit Plan' }
    );
    if (!confirmed) return;

    const id = plan._id || plan.id;
    setSubmittingId(id);

    try {
      await submitMonthlyPlan(id);
      notify({
        type: 'success',
        title: 'Plan submitted',
        message: 'Your monthly plan has been sent for Team Leader approval.',
      });
      await loadPlans();
    } catch (error) {
      notify({ type: 'error', title: 'Submission failed', message: errorMessage(error) });
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="sprint-monthly-page" style={{ padding: 'clamp(12px, 2vw, 28px)', maxWidth: 1360, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarDays size={27} color="var(--primary, #2563eb)" />
            <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 30px)' }}>Monthly Planning</h1>
          </div>
          <p style={{ color: 'var(--text-muted, #64748b)', marginTop: 8 }}>
            Prepare monthly work plans and submit them to your Reporting Team Leader.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadPlans} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20, alignItems: 'start' }}>
        <form onSubmit={savePlan} className="card" style={{ padding: 24, borderRadius: 16 }}>
          <h2 style={{ fontSize: 19, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={19} /> New Monthly Plan
          </h2>

          <label htmlFor="sprint-month">Planning month</label>
          <input id="sprint-month" className="form-control" type="month" value={month}
            onChange={(event) => setMonth(event.target.value)} required
            style={{ width: '100%', margin: '8px 0 18px' }} />

          <label htmlFor="sprint-title">Plan title</label>
          <input id="sprint-title" className="form-control" type="text" maxLength={200}
            value={title} onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. November Department Work Plan" required
            style={{ width: '100%', margin: '8px 0 18px' }} />

          <label>Monthly goals and expected deliverables</label>
          <p style={{ fontSize: 13, color: '#64748b', margin: '5px 0 12px' }}>
            Enter each planned activity or target separately.
          </p>

          {goals.map((goal, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <textarea className="form-control" rows={2} maxLength={500}
                value={goal} onChange={(event) => updateGoal(index, event.target.value)}
                placeholder={`Goal ${index + 1}`} aria-label={`Monthly goal ${index + 1}`}
                style={{ flex: 1, resize: 'vertical', minWidth: 0 }} />
              <button type="button" className="btn btn-secondary" title="Remove goal"
                disabled={goals.length === 1} onClick={() => removeGoal(index)}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          <button type="button" className="btn btn-secondary" onClick={() => setGoals((current) => [...current, ''])}
            disabled={goals.length >= 100} style={{ marginBottom: 20 }}>
            <Plus size={16} /> Add Another Goal
          </button>

          <button type="submit" className="btn btn-primary" disabled={saving}
            style={{ display: 'flex', justifyContent: 'center', gap: 8, width: '100%' }}>
            <FileText size={17} /> {saving ? 'Saving...' : 'Save Monthly Plan'}
          </button>
        </form>

        <section className="card" style={{ padding: 24, borderRadius: 16 }}>
          <h2 style={{ fontSize: 19, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={19} /> My Monthly Planning Sheets
          </h2>

          {loading ? (
            <p>Loading monthly planning sheets...</p>
          ) : plans.length === 0 ? (
            <p style={{ color: '#64748b', padding: '25px 0' }}>
              No monthly planning sheets yet. Create your first plan using the form.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {plans.map((plan) => {
                const id = plan._id || plan.id;
                const status = String(plan.status || 'draft').toLowerCase();
                return (
                  <article key={id} style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <strong>{plan.title || 'Untitled Plan'}</strong>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 5 }}>{plan.month}</div>
                      </div>
                      <span style={{ color: statusColors[status] || '#64748b', fontSize: 12, fontWeight: 700 }}>
                        {status === 'approved' ? <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <Clock3 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                        {statusLabels[status] || status}
                      </span>
                    </div>

                    <ul style={{ margin: '14px 0', paddingLeft: 20, fontSize: 14 }}>
                      {(plan.goals || []).map((goal, index) => <li key={index} style={{ marginBottom: 5 }}>{goal}</li>)}
                    </ul>

                    {status === 'draft' && (
                      <button type="button" className="btn btn-primary"
                        disabled={submittingId === id} onClick={() => submitPlan(plan)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Send size={15} /> {submittingId === id ? 'Submitting...' : 'Submit for Approval'}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}