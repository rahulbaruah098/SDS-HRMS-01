import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, Plus, Trash2, RefreshCw, Send,
  ClipboardCheck, FileText, AlertCircle, Save, ChevronRight
} from 'lucide-react';
import {
  getMonthlyPlans, getWeeklyPlans, createWeeklyPlan,
  submitWeeklyPlan, reportDailyActivity,
  createDailyChangeRequest
} from '../api/sprintPlanning';
import { getMySprintTemplate } from '../api/sprintPlanning';
import { prepareDailyActivityTemplate } from '../api/sprintPlanning';
import SprintWeeklyCustomFields from '../components/SprintWeeklyCustomFields';
import SprintAttachmentField from '../components/SprintAttachmentField';
import { updateWeeklyActivityCustomFields } from '../api/sprintPlanning';
import SprintDailyCustomFields from '../components/SprintDailyCustomFields';
import { useCustomAlert } from '../components/CustomAlertProvider';
import { currentUser } from '../api/client';

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

// STEP 44B.53E.14R - Restore previously saved evidence
const savedEvidenceReference = (evidence) => {
  if (typeof evidence === 'string') {
    return evidence;
  }

  if (Array.isArray(evidence)) {
    const first = evidence.find(item =>
      typeof item === 'string' ||
      (item && typeof item.reference === 'string')
    );

    if (typeof first === 'string') {
      return first;
    }

    return first?.reference || '';
  }

  if (evidence && typeof evidence.reference === 'string') {
    return evidence.reference;
  }

  return '';
};

// UI wording only: the backend remains responsible for selecting and enforcing
// the authorised reviewer for every submitted weekly plan.
const getWeeklySubmissionCopy = (user) => {
  const rawRoles = [
    user?.role, user?.primary_role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
    ...(Array.isArray(user?.effective_roles) ? user.effective_roles : [])
  ];
  const roles = new Set(rawRoles.filter(Boolean).map(value =>
    String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  ));
  const isTeamLeader = user?.is_team_leader === true ||
    roles.has('team_leader') || roles.has('teamleader') || roles.has('tl');

  // A TL's own plan goes to the Reporting Officer, not back to the TL.
  if (isTeamLeader) return {
    button: 'Submit for Reporting Officer Approval',
    confirm: 'Submit this weekly planning sheet for Reporting Officer approval?',
    success: 'Your weekly plan has been submitted for Reporting Officer review.'
  };

  const isEmployee = roles.has('employee') || roles.has('staff') ||
    roles.has('team_member');
  if (isEmployee) return {
    button: 'Submit for Team Leader Approval',
    confirm: 'Submit this weekly planning sheet for Team Leader approval?',
    success: 'Your weekly plan has been submitted for Team Leader review.'
  };

  // Do not incorrectly promise a particular reviewer for an unknown role.
  return {
    button: 'Submit Weekly Plan for Approval',
    confirm: 'Submit this weekly planning sheet for approval?',
    success: 'Your weekly plan has been submitted to the assigned reviewer.'
  };
};

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
  const submissionCopy = getWeeklySubmissionCopy(currentUser());

  const [monthly, setMonthly] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [monthId, setMonthId] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [weekEnd, setWeekEnd] = useState('');
  const [activities, setActivities] = useState([emptyActivity()]);
  // STEP 44B.53E.3 - Weekly department template
  const [weeklyTemplate, setWeeklyTemplate] = useState(null);
  const [weeklyTemplateLoading, setWeeklyTemplateLoading] = useState(true);
  const [weeklyTemplateError, setWeeklyTemplateError] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState({});
  // STEP 44B.53E.6R - Daily department reporting fields
  const [dailyTemplate, setDailyTemplate] = useState(null);
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState('');

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setWeeklyTemplateLoading(true);
        setWeeklyTemplateError('');
        const response = await getMySprintTemplate('weekly');
        if (!active) return;
        setWeeklyTemplate(
          response?.sprint_enabled === true &&
          response?.template_configured === true
            ? response.template
            : null
        );
      } catch (error) {
        if (active) {
          setWeeklyTemplateError(
            error?.message || 'Unable to verify department template.'
          );
        }
      } finally {
        if (active) setWeeklyTemplateLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  const updateWeeklyCustomField = (index, field, value) => {
    setActivities(previous => previous.map((activity, i) =>
      i === index ? {
        ...activity,
        custom_values: {
          ...(activity.custom_values || {}),
          [field]: value,
        },
      } : activity
    ));
  };

  const updateActivity = (index, field, value) => {
    setActivities(items => items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };


  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setDailyLoading(true);
        setDailyError('');

        const response = await getMySprintTemplate('daily');
        if (!mounted) return;

        const enabled = response?.sprint_enabled === true;

        setDailyEnabled(enabled);
        setDailyTemplate(
          enabled && response?.template_configured === true
            ? response.template
            : null
        );
      } catch (error) {
        if (mounted) {
          setDailyError(
            error?.message || 'Unable to load daily reporting template.'
          );
        }
      } finally {
        if (mounted) setDailyLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

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

    if (weeklyTemplateLoading || weeklyTemplateError) {
      alert(
        'error',
        'Department template unavailable',
        weeklyTemplateError || 'Weekly template is still loading.'
      );
      return;
    }

    if (weeklyTemplate?.columns?.length) {
      for (const [index, activity] of activities.entries()) {
        for (const column of weeklyTemplate.columns) {
          const value = activity.custom_values?.[column.key];
          const missing = value === null || value === undefined ||
            (typeof value === 'string' && !value.trim());
          // Files are uploaded only after the draft has an activity ID.
          if (column.required && missing && column.type !== 'file') {
            alert(
              'warning',
              'Incomplete department planning fields',
              `Activity ${index + 1}: ${column.label} is required.`
            );
            return;
          }
        }
      }
    }

    const days = activities.map(a => ({
      ...a,
      ...(weeklyTemplate?.columns?.length
        ? { custom_values: a.custom_values || {} }
        : {}),
      ...(!weeklyTemplate?.columns?.length
        ? { custom_values: undefined }
        : {}),
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
      submissionCopy.confirm,
      { title: 'Submit Weekly Plan', confirmText: 'Submit Plan' }
    );
    if (!yes) return;

    setBusy(true);
    try {
      await submitWeeklyPlan(getId(plan));
      alert('success', 'Plan submitted', submissionCopy.success);
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
    const reason = (data.incomplete_reason ?? activity.incomplete_reason ?? '').trim();
    const evidence = parseEvidence(
      data.evidence ?? savedEvidenceReference(activity.evidence)
    );

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

    // STEP 44B.53E.9 - Validate before entering saving state
// STEP 44B.53E.6R - Per-activity daily values
    if (dailyLoading || dailyError) {
      alert(
        'error',
        'Daily reporting template unavailable',
        dailyError || 'Daily reporting fields are still loading.'
      );
      return;
    }

    const template = dailyEnabled
      ? (activity.daily_template_snapshot || dailyTemplate)
      : null;

    const values = reports[activity.activity_id]?.daily_custom_values
      || activity.daily_custom_values
      || {};

    if (template?.columns?.length) {
      for (const column of template.columns) {
        const value = values[column.key];
        const missing = value === null || value === undefined ||
          (typeof value === 'string' && !value.trim());

        if (column.required && missing) {
          alert(
            'warning',
            'Daily fields required',
            `${column.label} is required for ${activity.title}.`
          );
          return;
        }
      }
    }

    const dailyCustomPayload = template?.columns?.length
      ? { daily_custom_values: values }
      : {};

    setBusy(true);
    try {

    await reportDailyActivity(getId(plan), id, {
        status,
        evidence,
        incomplete_reason: reason,
        remarks: data.remarks ?? activity.employee_remarks ?? activity.remarks ?? '',
        ...dailyCustomPayload
      });
      alert('success', 'Daily activity updated', 'Your work status was saved.');
      await load();
      setReports(previous => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
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
    // Keep submitted defaults consistent with the visible prefilled fields.
    const changedTitle = (data.title ?? activity?.title ?? '').trim();
    const changedDate = data.planned_date || activity?.planned_date || '';

    if (!changedTitle || !changedDate || reason.length < 10) {
      alert('warning', 'Change details required', 'Provide the date, activity title and a reason of at least 10 characters.');
      return;
    }

    setBusy(true);
    try {
      await createDailyChangeRequest({
        weekly_plan_id: getId(plan),
        change_type: activity ? 'modify_activity' : 'add_activity',
        ...(activity ? { activity_id: activity.activity_id } : {}),
        planned_date: changedDate,
        title: changedTitle,
        description: data.description ?? activity?.description ?? '',
        expected_deliverable: data.expected_deliverable ?? activity?.expected_deliverable ?? '',
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
  const card = { padding: 'clamp(14px, 2vw, 24px)', borderRadius: 14, marginBottom: 18 };
  const label = { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 };
  const stack = { display: 'grid', gap: 13 };

  const changeForm = (plan, activity) => {
    const key = activity?.activity_id || `add-${getId(plan)}`;
    const data = changes[key] || {};
    const fieldId = (name) => `swp-change-${getId(plan)}-${activity?.activity_id || 'new'}-${name}`;
    return (
      <div className="swp-change-form" style={{ ...stack, padding: 16, border: '1px solid var(--border, #dbe1e8)', background: 'var(--surface-secondary, #f8f9ff)', borderRadius: 12, marginTop: 12 }}>
        <strong>{activity ? 'Request Activity Modification' : 'Request Additional Activity'}</strong>
        <div>
          <label style={label} htmlFor={fieldId('date')}>Activity date <span aria-hidden="true">*</span></label>
          <input id={fieldId('date')} type="date" style={field} required
            min={plan.week_start} max={plan.week_end}
            value={data.planned_date || activity?.planned_date || ''}
            onChange={e => updateChange(key, { planned_date: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor={fieldId('title')}>Activity title <span aria-hidden="true">*</span></label>
          <input id={fieldId('title')} style={field} placeholder="Enter the activity title" maxLength={200} required
            value={data.title ?? activity?.title ?? ''}
            onChange={e => updateChange(key, { title: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor={fieldId('description')}>Description <span className="swp-muted">(optional)</span></label>
          <textarea id={fieldId('description')} style={field} rows={2} placeholder="Describe the activity"
            value={data.description ?? activity?.description ?? ''}
            onChange={e => updateChange(key, { description: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor={fieldId('deliverable')}>Expected deliverable <span className="swp-muted">(optional)</span></label>
          <input id={fieldId('deliverable')} style={field} placeholder="Expected result or output"
            value={data.expected_deliverable ?? activity?.expected_deliverable ?? ''}
            onChange={e => updateChange(key, { expected_deliverable: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor={fieldId('reason')}>Reason for change <span aria-hidden="true">*</span></label>
          <textarea id={fieldId('reason')} style={field} rows={2} minLength={10} required
            placeholder="Explain why the change is needed (at least 10 characters)"
            value={data.reason || ''} onChange={e => updateChange(key, { reason: e.target.value })} />
        </div>
        <button className="btn btn-secondary" type="button" disabled={busy}
          onClick={() => requestChange(plan, activity)}>
          <Send size={15} /> Submit Change Request
        </button>
      </div>
    );
  };

  return (
    <main className="swp-page" style={{ padding: 'clamp(12px,2vw,28px)', maxWidth: 1360, margin: 'auto' }}>
      <style>{`
        .swp-page { min-width:0; color:var(--text, inherit); }
        .swp-page .swp-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
        .swp-page .swp-heading { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:clamp(22px, 3vw, 30px); line-height:1.25; }
        .swp-page .swp-subtitle { margin:0; line-height:1.65; max-width:780px; color:var(--text-muted, #64748b); flex-basis:100%; order:3; }
        .swp-page .swp-header > .btn { margin-left:auto; }
        .swp-page .swp-heading { min-width:0; }
        @media(max-width:700px) {
          .swp-page .swp-header > .btn { margin-left:0; order:3; }
          .swp-page .swp-subtitle { order:2; }
        }
        .swp-page .card { min-width:0; border:1px solid var(--border, #dbe1e8); border-radius:16px; background:var(--surface, var(--card-bg, #fff)); }
        .swp-page .swp-section-heading { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 16px; font-size:clamp(17px, 2vw, 20px); }
        .swp-page .swp-form-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; }
        .swp-page .swp-activity-card { min-width:0; padding:clamp(14px,2vw,18px); background:var(--surface-secondary, var(--surface, #fff)); border:1px solid var(--border,#dbe1e8); border-radius:14px; }
        .swp-page .swp-activity-top { display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; }
        .swp-page .swp-plan-card { min-width:0; padding:clamp(14px,2vw,20px); margin-bottom:16px; border:1px solid var(--border,#dbe1e8); border-radius:14px; background:var(--surface,#fff); }
        .swp-page .swp-plan-top { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; }
        .swp-page .swp-plan-dates { display:block; font-weight:700; overflow-wrap:anywhere; }
        .swp-page .swp-plan-status { font-size:12px; font-weight:700; padding:5px 10px; border:1px solid currentColor; border-radius:999px; }
        .swp-page .swp-plan-activity { padding:16px 0; border-top:1px solid var(--border,#dbe1e8); margin-top:12px; min-width:0; }
        .swp-page .swp-activity-name { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .swp-page .swp-activity-name strong { overflow-wrap:anywhere; }
        .swp-page .swp-muted { color:var(--text-muted,#64748b); line-height:1.55; }
        .swp-page .swp-attachment { margin:12px 0; padding:clamp(12px,2vw,16px); border:1px solid var(--border,#dbe1e8); border-radius:12px; }
        .swp-page .swp-daily-fields { min-width:0; padding:14px; border:1px solid var(--border,#dbe1e8); border-radius:12px; background:var(--surface-secondary,var(--surface,#fff)); }
        .swp-page .swp-daily-fields > * { min-width:0; }
        .swp-page .swp-page-actions { display:flex; gap:10px; flex-wrap:wrap; }
        .swp-page input, .swp-page select, .swp-page textarea { max-width:100%; font-size:16px; }
        .swp-page input:focus-visible, .swp-page select:focus-visible, .swp-page textarea:focus-visible, .swp-page button:focus-visible { outline:2px solid var(--primary,#5142ce); outline-offset:2px; }
        .swp-page .btn { min-height:42px; display:inline-flex; justify-content:center; align-items:center; gap:8px; white-space:normal; text-align:center; }
        .swp-page .swp-disclosure { display:flex; align-items:center; flex-wrap:wrap; gap:9px; list-style:none; padding:11px 12px; cursor:pointer; font-weight:650; border-radius:10px; background:var(--surface-secondary, #f8f9ff); border:1px solid var(--border,#dbe1e8); line-height:1.45; }
        .swp-page .swp-disclosure::-webkit-details-marker { display:none; }
        .swp-page .swp-disclosure-icon { display:inline-flex; flex:0 0 auto; color:var(--primary,#6354d9); transition:transform .2s ease; }
        .swp-page details[open] > .swp-disclosure .swp-disclosure-icon { transform:rotate(90deg); }
        .swp-page .swp-disclosure-text { min-width:0; flex:1 1 160px; overflow-wrap:break-word; }
        .swp-page .swp-empty { padding:16px; border:1px dashed var(--border,#dbe1e8); border-radius:12px; color:var(--text-muted,#64748b); }
        @media(max-width:700px) {
          .swp-page .swp-form-grid { grid-template-columns:minmax(0,1fr); }
          .swp-page .swp-header > .btn { width:100%; }
          .swp-page .swp-page-actions > .btn { flex:1 1 180px; }
          .swp-page .swp-plan-card > .btn { width:100%; }
        }
        @media(max-width:480px) {
          .swp-page { padding:12px !important; }
          .swp-page .swp-header { margin-bottom:16px !important; }
          .swp-page .swp-plan-top { align-items:flex-start; }
          .swp-page .swp-plan-status { align-self:flex-start; }
          .swp-page .swp-activity-top .btn { min-width:44px; }
          .swp-page .swp-daily-fields .btn, .swp-page .swp-change-form .btn { width:100%; }
        }
        @media(prefers-reduced-motion:reduce) { .swp-page * { scroll-behavior:auto !important; } }
      `}</style>
      <header className="swp-header" style={{ marginBottom: 24 }}>
        <h1 className="swp-heading" style={{ margin: 0 }}>
          <CalendarDays size={27} /> Weekly & Day-Wise Planning
        </h1>
        <p className="swp-subtitle">
          Plan each day's activities, report work honestly and request approval for unexpected assignments.
        </p>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Refresh Plans
        </button>
      </header>

      <section className="card" style={card}>
        <h2 className="swp-section-heading">Create Weekly Planning Sheet</h2>
        <form onSubmit={createPlan} style={stack}>
          <div>
            <label style={label} htmlFor="swp-monthly-plan">Approved Monthly Plan</label>
            <select id="swp-monthly-plan" style={field} required value={monthId} onChange={e => setMonthId(e.target.value)}>
              <option value="">Select approved monthly plan</option>
              {monthly.filter(x => x.status === 'approved').map(x => (
                <option key={getId(x)} value={getId(x)}>{x.title} — {x.month}</option>
              ))}
            </select>
          </div>
          {monthly.filter(x => x.status === 'approved').length === 0 && !loading && (
            <p className="swp-empty" role="status">No approved monthly plan is available yet. Create and obtain approval for a monthly plan before saving a weekly plan.</p>
          )}
          <div className="swp-form-grid">
            <div><label htmlFor="swp-week-start" style={label}>Week Start</label>
              <input id="swp-week-start" type="date" style={field} required value={weekStart}
                onChange={e => setWeekStart(e.target.value)} /></div>
            <div><label htmlFor="swp-week-end" style={label}>Week End</label>
              <input id="swp-week-end" type="date" style={field} required value={weekEnd}
                onChange={e => setWeekEnd(e.target.value)} /></div>
          </div>

          <h3 style={{ fontSize: 16, marginBottom: 0 }}>Day-Wise Planned Activities</h3>
          {activities.map((activity, index) => (
            <div key={index} className="swp-activity-card" style={stack}>
              <div className="swp-activity-top">
                <strong>Activity {index + 1}</strong>
                <button type="button" className="btn btn-secondary" title="Remove activity" aria-label={`Remove activity ${index + 1}`}
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
          <div className="swp-page-actions">
          <button type="button" className="btn btn-secondary"
            disabled={activities.length >= 200}
            onClick={() => setActivities(items => [...items, emptyActivity()])}>
            <Plus size={16} /> Add Day-Wise Activity
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || weeklyTemplateLoading || Boolean(weeklyTemplateError) || monthly.filter(x => x.status === 'approved').length === 0}>
            <Save size={16} /> {busy ? 'Saving...' : 'Save Weekly Plan'}
          </button>
          </div>

          {/* STEP 44B.53E.3 - Per-activity weekly fields */}
          {weeklyTemplateLoading && (
            <p>Loading department weekly fields...</p>
          )}
          {weeklyTemplateError && (
            <p role="alert" style={{ color: '#b91c1c' }}>
              {weeklyTemplateError}
            </p>
          )}
          <SprintWeeklyCustomFields
            template={weeklyTemplate}
            activities={activities}
            onChange={updateWeeklyCustomField}
            disabled={busy || weeklyTemplateLoading}
          />
</form>
      </section>

      <section className="card" style={card}>
        <h2 className="swp-section-heading">
          <ClipboardCheck size={20} /> My Weekly Planning Sheets
        </h2>
        {loading ? <p>Loading planning sheets...</p> : weekly.length === 0
          ? <p className="swp-empty">No weekly plans created yet.</p>
          : weekly.map(plan => (
            <article key={getId(plan)} className="swp-plan-card">
              <div className="swp-plan-top">
                <strong className="swp-plan-dates">{plan.week_start} to {plan.week_end}</strong>
                <span className="swp-plan-status" style={{ color: statusColor(plan.status) }}>
                  {statusLabel(plan.status)}
                </span>
              </div>
              {plan.status === 'draft' && (
                <button className="btn btn-primary" style={{ marginTop: 12 }}
                  type="button" disabled={busy} onClick={() => submit(plan)}>
                  <Send size={15} /> {submissionCopy.button}
                </button>
              )}

              {(plan.activities || []).map(activity => {
                const id = activity.activity_id;
                const report = reports[id] || {};
                const currentStatus = report.status || activity.status || 'planned';
                return (
                  <div key={id} className="swp-plan-activity">
                    <div className="swp-activity-name">
                      <FileText size={17} />
                      <strong>{activity.title}</strong>
                      <span style={{ fontSize: 13, color: statusColor(currentStatus) }}>{statusLabel(currentStatus)}</span>
                    </div>
                    <p className="swp-muted" style={{ fontSize: 13, margin: '7px 0' }}>
                      {cleanDate(activity.planned_date)} — {activity.description || activity.expected_deliverable || 'No description'}
                    </p>

                                        {/* STEP 44B.53G.8F.8-R3 */}
                    {['draft', 'rejected'].includes(plan.status) &&
                      (plan.sprint_template_snapshot?.columns || [])
                        .filter(column => column.type === 'file')
                        .map(column => (
                          <div
                            key={`${id}-${column.key}`}
                            className="swp-attachment"
                          >
                            <SprintAttachmentField
                              label={column.label}
                              planType="weekly"
                              planId={getId(plan)}
                              activityId={id}
                              fieldKey={column.key}
                              value={activity.custom_values?.[column.key] || ''}
                              disabled={busy}
                              onChange={async (reference) => {
                                await updateWeeklyActivityCustomFields(
                                  getId(plan),
                                  id,
                                  {
                                    ...(activity.custom_values || {}),
                                    [column.key]: reference,
                                  },
                                );
                                await load();
                                alert(
                                  'success',
                                  'Attachment saved',
                                  'Weekly activity attachment saved successfully.',
                                );
                              }}
                            />
                          </div>
                        ))}

{plan.status === 'approved' && (
                      <>
                        <div className="swp-daily-fields" style={{ ...stack, marginTop: 12 }}>
                          <label style={label} htmlFor={`swp-status-${id}`}>Actual Work Status</label>
                          <select id={`swp-status-${id}`} style={field} value={currentStatus}
                            onChange={e => updateReport(id, { status: e.target.value })}>
                            <option value="planned">Not Updated</option>
                            <option value="completed">Completed</option>
                            <option value="in_progress">In Progress</option>
                            <option value="not_completed">Not Completed</option>
                          </select>
                          {currentStatus === 'completed' ? (
                            <input style={field} placeholder="Evidence URL or document reference (required)"
                              aria-label="Work evidence"
                              value={
                                report.evidence ??
                                savedEvidenceReference(activity.evidence)
                              }
                              onChange={e => updateReport(id, { evidence: e.target.value })} />
                          ) : ['in_progress', 'not_completed'].includes(currentStatus) ? (
                            <textarea style={field} rows={2}
                              placeholder="Why was this task not completed? (required)"
                              value={report.incomplete_reason ?? activity.incomplete_reason ?? ''}
                              onChange={e => updateReport(id, { incomplete_reason: e.target.value })} />
                          ) : null}
                          <label style={label} htmlFor={`swp-remarks-${id}`}>Additional work remarks <span className="swp-muted">(optional)</span></label>
                          <textarea id={`swp-remarks-${id}`} style={field} rows={3} maxLength={2000} placeholder="Add context about the work completed, challenges, or follow-up actions"
                            value={report.remarks ?? activity.employee_remarks ?? activity.remarks ?? ''}
                            onChange={e => updateReport(id, { remarks: e.target.value })} />

                          {/* STEP 44B.53E.6R - Daily custom fields */}
                          {dailyLoading && (
                            <p>Loading daily department fields...</p>
                          )}
                          {dailyError && (
                            <p role="alert">{dailyError}</p>
                          )}
                          {/* STEP 44B.53G.8F.18 */}
                          {dailyEnabled &&
                            !activity.daily_template_snapshot &&
                            !dailyLoading &&
                            !dailyError &&
                            dailyTemplate?.columns?.some(
                              column => column.type === 'file'
                            ) && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={busy}
                                onClick={async () => {
                                  setBusy(true);
                                  try {
                                    await prepareDailyActivityTemplate(
                                      getId(plan),
                                      id,
                                    );
                                    await load();
                                    alert(
                                      'success',
                                      'File uploads ready',
                                      'The daily reporting template is prepared. You can now upload the required files.',
                                    );
                                  } catch (error) {
                                    alert(
                                      'error',
                                      'Unable to prepare file uploads',
                                      messageOf(error),
                                    );
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                Prepare File Uploads
                              </button>
                            )}
                          <SprintDailyCustomFields
                            template={
                              dailyEnabled
                                ? (activity.daily_template_snapshot || dailyTemplate)
                                : null
                            }
                            values={
                              report.daily_custom_values ||
                              activity.daily_custom_values ||
                              {}
                            }
                            planId={getId(plan)}
                            activityId={id}
                            uploadReady={Boolean(activity.daily_template_snapshot)}
                            disabled={busy || dailyLoading}
                            onChange={(key, value) => {
                              updateReport(id, {
                                daily_custom_values: {
                                  ...(report.daily_custom_values ||
                                     activity.daily_custom_values || {}),
                                  [key]: value,
                                },
                              });
                            }}
                          />
<button type="button" className="btn btn-primary" disabled={busy}
                            onClick={() => saveReport(plan, activity)}>
                            <Save size={15} /> Save Daily Work Update
                          </button>
                        </div>
                        <details style={{ marginTop: 12 }}>
                          <summary className="swp-disclosure">
                            <span className="swp-disclosure-icon"><ChevronRight size={17} aria-hidden="true" /></span>
                            <span className="swp-disclosure-text">Request a Change to This Activity</span>
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
                  <summary className="swp-disclosure">
                    <span className="swp-disclosure-icon"><ChevronRight size={17} aria-hidden="true" /></span>
                    <Plus size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span className="swp-disclosure-text">Add Unplanned Activity (Approval Required)</span>
                  </summary>
                  <p className="swp-muted" style={{ fontSize: 13 }}>
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