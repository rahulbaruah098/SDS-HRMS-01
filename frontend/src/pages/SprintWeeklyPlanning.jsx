import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, Plus, Trash2, RefreshCw, Send,
  ClipboardCheck, FileText, AlertCircle, Save
} from 'lucide-react';
import {
  getMonthlyPlans, getWeeklyPlans, createWeeklyPlan,
  submitWeeklyPlan, reportDailyActivity,
  createDailyChangeRequest
} from '../api/sprintPlanning';
import { useCustomAlert } from '../components/CustomAlertProvider';

const emptyActivity = () => ({
  planned_date: '',
  title: '',
  description: '',
  expected_deliverable: ''
});

const cleanDate = (value) => String(value || '').slice(0, 10);

const getId = (item) => String(item?._id || item?.id || '');

const getItems = (response) => {
  if (Array.isArray(response)) return response;
  return response?.items || response?.data?.items || [];
};

const messageOf = (error) => error?.message || 'The operation could not be completed.';

const statusColor = (status) => ({
  approved: '#168354',
  rejected: '#bf3a36',
  pending_approval: '#a66b16',
  draft: '#64748b',
  completed: '#168354',
  not_completed: '#bf3a36',
  in_progress: '#a66b16'
}[status] || '#64748b');

const statusLabel = (status) => ({
  approved: 'Approved',
  rejected: 'Rejected',
  pending_approval: 'Pending Approval',
  draft: 'Draft',
  planned: 'Planned',
  completed: 'Completed',
  not_completed: 'Not Completed',
  in_progress: 'In Progress'
}[status] || status || 'Unknown');

const parseEvidence = (value) => {
  const reference = value.trim();
  if (!reference) return [];
  return [{
    type: /^https?:\/\//i.test(reference) ? 'link' : 'document',
    reference
  }];
};

export default function SprintWeeklyPlanning() {
  const { notify, confirm: customConfirm } = useCustomAlert();

  const [monthly, setMonthly] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [monthId, setMonthId] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [weekEnd, setWeekEnd] = useState('');
  const [activities, setActivities] = useState([emptyActivity()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState({});
  const [changes, setChanges] = useState({});

  const alert = useCallback((type, title, message) => {
    notify({ type, title, message });
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [months, weeks] = await Promise.all([
        getMonthlyPlans(),
        getWeeklyPlans()
      ]);
      setMonthly(getItems(months));
      setWeekly(getItems(weeks));
    } catch (error) {
      alert('error', 'Unable to load planning sheets', messageOf(error));
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => { load(); }, [load]);

  const updateActivity = (index, field, value) => {
    setActivities(items => items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const updateReport = (id, patch) => {
    setReports(prev => ({
      ...prev,
      [id]: { ...prev[id], ...patch }
    }));
  };

  const updateChange = (id, patch) => {
    setChanges(prev => ({
      ...prev,
      [id]: { ...prev[id], ...patch }
    }));
  };

  const createPlan = async (event) => {
    event.preventDefault();

    if (!monthId || !weekStart || !weekEnd || weekEnd < weekStart) {
      alert('warning', 'Check planning dates', 'Select an approved monthly plan and valid weekly dates.');
      return;
    }

    const days = activities.map(a => ({
      ...a,
      title: a.title.trim(),
      description: a.description.trim(),
      expected_deliverable: a.expected_deliverable.trim()
    }));

    if (days.some(a => !a.planned_date || !a.title ||
      a.planned_date < weekStart || a.planned_date > weekEnd)) {
      alert('warning', 'Activities incomplete', 'Every activity needs a title and a date within the selected week.');
      return;
    }

    setBusy(true);
    try {
      await createWeeklyPlan({
        monthly_plan_id: monthId,
        week_start: weekStart,
        week_end: weekEnd,
        activities: days
      });
      alert('success', 'Weekly plan saved', 'Your planning sheet is saved as a draft.');
      setActivities([emptyActivity()]);
      await load();
    } catch (error) {
      alert('error', 'Unable to save weekly plan', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (plan) => {
    const yes = await customConfirm(
      'Submit this weekly planning sheet to your Reporting Team Leader?',
      { title: 'Submit Weekly Plan', confirmText: 'Submit Plan' }
    );
    if (!yes) return;

    setBusy(true);
    try {
      await submitWeeklyPlan(getId(plan));
      alert('success', 'Plan submitted', 'Your Team Leader can now review the weekly plan.');
      await load();
    } catch (error) {
      alert('error', 'Submission failed', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const saveReport = async (plan, activity) => {
    const id = activity.activity_id;
    const data = reports[id] || {};
    const status = data.status || activity.status;
    const reason = (data.incomplete_reason || '').trim();
    const evidence = parseEvidence(data.evidence || '');

    if (status === 'completed' && !evidence.length) {
      alert('warning', 'Evidence required', 'Provide a valid work evidence reference or link.');
      return;
    }

    if (['in_progress', 'not_completed'].includes(status) && reason.length < 10) {
      alert('warning', 'Explanation required', 'Explain why this work is unfinished, using at least 10 characters.');
      return;
    }

    if (!['completed', 'in_progress', 'not_completed'].includes(status)) {
      alert('warning', 'Select work status', 'Select the actual status of this activity.');
      return;
    }

    setBusy(true);
    try {
      await reportDailyActivity(getId(plan), id, {
        status,
        evidence,
        incomplete_reason: reason,
        remarks: data.remarks || ''
      });
      alert('success', 'Daily activity updated', 'Your work status was saved.');
      await load();
    } catch (error) {
      alert('error', 'Unable to update activity', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const requestChange = async (plan, activity = null) => {
    const key = activity?.activity_id || `add-${getId(plan)}`;
    const data = changes[key] || {};
    const reason = (data.reason || '').trim();

    if (!data.title?.trim() || !data.planned_date || reason.length < 10) {
      alert('warning', 'Change details required', 'Provide the date, activity title and a reason of at least 10 characters.');
      return;
    }

    setBusy(true);
    try {
      await createDailyChangeRequest({
        weekly_plan_id: getId(plan),
        change_type: activity ? 'modify_activity' : 'add_activity',
        ...(activity ? { activity_id: activity.activity_id } : {}),
        planned_date: data.planned_date,
        title: data.title.trim(),
        description: data.description || '',
        expected_deliverable: data.expected_deliverable || '',
        reason
      });
      alert('success', 'Change request submitted', 'This change requires both Team Leader and Reporting Officer approval.');
      setChanges(prev => ({ ...prev, [key]: {} }));
    } catch (error) {
      alert('error', 'Change request failed', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const field = { width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border, #dbe1e8)', background: 'var(--surface, #fff)',
    color: 'inherit', boxSizing: 'border-box' };
  const card = { padding: 22, borderRadius: 14, marginBottom: 18 };
  const label = { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 };
  const stack = { display: 'grid', gap: 13 };

  const changeForm = (plan, activity) => {
    const key = activity?.activity_id || `add-${getId(plan)}`;
    const data = changes[key] || {};
    return (
      <div style={{ ...stack, padding: 14, border: '1px dashed var(--border, #dbe1e8)', borderRadius: 10, marginTop: 12 }}>
        <strong>{activity ? 'Request Activity Modification' : 'Request Additional Activity'}</strong>
        <input type="date" style={field} aria-label="Changed activity date"
          min={plan.week_start} max={plan.week_end}
          value={data.planned_date || activity?.planned_date || ''}
          onChange={e => updateChange(key, { planned_date: e.target.value })} />
        <input style={field} placeholder="Activity title" aria-label="Changed activity title"
          value={data.title ?? activity?.title ?? ''}
          onChange={e => updateChange(key, { title: e.target.value })} />
        <textarea style={field} rows={2} placeholder="Description (optional)"
          value={data.description ?? activity?.description ?? ''}
          onChange={e => updateChange(key, { description: e.target.value })} />
        <input style={field} placeholder="Expected deliverable (optional)"
          value={data.expected_deliverable ?? activity?.expected_deliverable ?? ''}
          onChange={e => updateChange(key, { expected_deliverable: e.target.value })} />
        <textarea style={field} rows={2} placeholder="Why is this change required? (minimum 10 characters)"
          value={data.reason || ''} onChange={e => updateChange(key, { reason: e.target.value })} />
        <button className="btn btn-secondary" type="button" disabled={busy}
          onClick={() => requestChange(plan, activity)}>
          <Send size={15} /> Submit Change Request
        </button>
      </div>
    );
  };

  return (
    <main style={{ padding: 'clamp(12px,2vw,28px)', maxWidth: 1360, margin: 'auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
          <CalendarDays size={27} /> Weekly & Day-Wise Planning
        </h1>
        <p style={{ color: 'var(--text-muted, #64748b)' }}>
          Plan each day's activities, report work honestly and request approval for unexpected assignments.
        </p>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Refresh Plans
        </button>
      </header>

      <section className="card" style={card}>
        <h2 style={{ fontSize: 19, marginTop: 0 }}>Create Weekly Planning Sheet</h2>
        <form onSubmit={createPlan} style={stack}>
          <div>
            <label style={label}>Approved Monthly Plan</label>
            <select style={field} required value={monthId} onChange={e => setMonthId(e.target.value)}>
              <option value="">Select approved monthly plan</option>
              {monthly.filter(x => x.status === 'approved').map(x => (
                <option key={getId(x)} value={getId(x)}>{x.title} — {x.month}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <div><label style={label}>Week Start</label>
              <input type="date" style={field} required value={weekStart}
                onChange={e => setWeekStart(e.target.value)} /></div>
            <div><label style={label}>Week End</label>
              <input type="date" style={field} required value={weekEnd}
                onChange={e => setWeekEnd(e.target.value)} /></div>
          </div>

          <h3 style={{ fontSize: 16, marginBottom: 0 }}>Day-Wise Planned Activities</h3>
          {activities.map((activity, index) => (
            <div key={index} style={{ ...stack, padding: 16, border: '1px solid var(--border, #dbe1e8)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Activity {index + 1}</strong>
                <button type="button" className="btn btn-secondary" title="Remove activity"
                  disabled={activities.length === 1}
                  onClick={() => setActivities(items => items.filter((_, i) => i !== index))}>
                  <Trash2 size={15} />
                </button>
              </div>
              <input type="date" style={field} required min={weekStart || undefined}
                max={weekEnd || undefined} aria-label="Planned activity date"
                value={activity.planned_date} onChange={e => updateActivity(index, 'planned_date', e.target.value)} />
              <input style={field} required maxLength={200} placeholder="Planned activity"
                value={activity.title} onChange={e => updateActivity(index, 'title', e.target.value)} />
              <textarea style={field} rows={2} placeholder="Description"
                value={activity.description} onChange={e => updateActivity(index, 'description', e.target.value)} />
              <input style={field} placeholder="Expected deliverable"
                value={activity.expected_deliverable}
                onChange={e => updateActivity(index, 'expected_deliverable', e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary"
            disabled={activities.length >= 200}
            onClick={() => setActivities(items => [...items, emptyActivity()])}>
            <Plus size={16} /> Add Day-Wise Activity
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Save size={16} /> {busy ? 'Saving...' : 'Save Weekly Plan'}
          </button>
        </form>
      </section>

      <section className="card" style={card}>
        <h2 style={{ fontSize: 19, display: 'flex', gap: 8, alignItems: 'center' }}>
          <ClipboardCheck size={20} /> My Weekly Planning Sheets
        </h2>
        {loading ? <p>Loading planning sheets...</p> : weekly.length === 0
          ? <p>No weekly plans created yet.</p>
          : weekly.map(plan => (
            <article key={getId(plan)} style={{ padding: 16, marginBottom: 16, border: '1px solid var(--border, #dbe1e8)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>{plan.week_start} to {plan.week_end}</strong>
                <span style={{ color: statusColor(plan.status), fontWeight: 700 }}>
                  {statusLabel(plan.status)}
                </span>
              </div>
              {plan.status === 'draft' && (
                <button className="btn btn-primary" style={{ marginTop: 12 }}
                  type="button" disabled={busy} onClick={() => submit(plan)}>
                  <Send size={15} /> Submit for Team Leader Approval
                </button>
              )}

              {(plan.activities || []).map(activity => {
                const id = activity.activity_id;
                const report = reports[id] || {};
                const currentStatus = report.status || activity.status || 'planned';
                return (
                  <div key={id} style={{ padding: '14px 0', borderTop: '1px solid var(--border, #dbe1e8)', marginTop: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <FileText size={17} />
                      <strong>{activity.title}</strong>
                      <span style={{ fontSize: 13, color: statusColor(currentStatus) }}>{statusLabel(currentStatus)}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#64748b', margin: '7px 0' }}>
                      {cleanDate(activity.planned_date)} — {activity.description || activity.expected_deliverable || 'No description'}
                    </p>

                    {plan.status === 'approved' && (
                      <>
                        <div style={{ ...stack, marginTop: 12 }}>
                          <label style={label}>Actual Work Status</label>
                          <select style={field} value={currentStatus}
                            onChange={e => updateReport(id, { status: e.target.value })}>
                            <option value="planned">Not Updated</option>
                            <option value="completed">Completed</option>
                            <option value="in_progress">In Progress</option>
                            <option value="not_completed">Not Completed</option>
                          </select>
                          {currentStatus === 'completed' ? (
                            <input style={field} placeholder="Evidence URL or document reference (required)"
                              aria-label="Work evidence"
                              value={report.evidence || ''}
                              onChange={e => updateReport(id, { evidence: e.target.value })} />
                          ) : ['in_progress', 'not_completed'].includes(currentStatus) ? (
                            <textarea style={field} rows={2}
                              placeholder="Why was this task not completed? (required)"
                              value={report.incomplete_reason ?? activity.incomplete_reason ?? ''}
                              onChange={e => updateReport(id, { incomplete_reason: e.target.value })} />
                          ) : null}
                          <textarea style={field} rows={2} placeholder="Additional work remarks (optional)"
                            value={report.remarks || ''}
                            onChange={e => updateReport(id, { remarks: e.target.value })} />
                          <button type="button" className="btn btn-primary" disabled={busy}
                            onClick={() => saveReport(plan, activity)}>
                            <Save size={15} /> Save Daily Work Update
                          </button>
                        </div>
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                            Request a Change to This Activity
                          </summary>
                          {changeForm(plan, activity)}
                        </details>
                      </>
                    )}
                  </div>
                );
              })}

              {plan.status === 'approved' && (
                <details style={{ marginTop: 15 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={15} style={{ verticalAlign: 'middle' }} /> Add Unplanned Activity (Approval Required)
                  </summary>
                  <p style={{ fontSize: 13, color: '#64748b' }}>
                    <AlertCircle size={14} style={{ verticalAlign: 'middle' }} />
                    {' '}The new activity is not added until approved by both reporting authorities.
                  </p>
                  {changeForm(plan, null)}
                </details>
              )}
            </article>
          ))}
      </section>
    </main>
  );
}