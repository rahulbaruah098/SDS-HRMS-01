import SprintMonthlyApprovalQueue from './SprintMonthlyApprovalQueue';
import SprintMonthlyTeamCompilation from './SprintMonthlyTeamCompilation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, CheckCircle2, XCircle,
  Clock3, CalendarDays, CalendarRange, ListChecks,
  Eye, ShieldCheck, AlertTriangle
} from 'lucide-react';

import {
  getSprintApprovalInbox,
  reviewMonthlyPlan,
  reviewWeeklyPlan,
  reviewDailyChangeRequest,
  applyApprovedDailyChange
} from '../api/sprintPlanning';

import { useCustomAlert } from '../components/CustomAlertProvider';
import SprintReviewActivityFields from '../components/SprintReviewActivityFields';

const getId = (item) => String(item?._id || item?.id || '');

const getItems = (response) => {
  const payload = response?.data || response;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const description = (error) =>
  error?.message || 'The requested operation could not be completed.';

const kindLabel = {
  monthly: 'Monthly Plan',
  weekly: 'Weekly Plan',
  daily_change: 'Day-Wise Change'
};

const kindIcon = {
  monthly: CalendarDays,
  weekly: CalendarRange,
  daily_change: ListChecks
};

function StatusTag({ value }) {
  const colors = {
    approved: '#15803d',
    rejected: '#b91c1c',
    pending: '#b45309',
    pending_approval: '#b45309',
    approved_pending_application: '#15803d',
    applied: '#15803d'
  };
  const label = String(value || 'pending')
    .replaceAll('_', ' ');

  return (
    <span style={{
      color: colors[value] || '#64748b',
      fontSize: 12,
      fontWeight: 700,
      textTransform: 'capitalize'
    }}>
      {label}
    </span>
  );
}

function RequestDetails({ item }) {
  return (
    <div style={{
      display: 'grid',
      gap: 12,
      marginTop: 14,
      padding: 14,
      background: 'var(--surface-secondary, #f8fafc)',
      borderRadius: 10
    }}>
      {item.planning_type === 'monthly' && (
        <>
          <strong>Monthly Goals</strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {(item.goals || []).map((goal, index) => (
              <li key={index} style={{ marginBottom: 5 }}>
                {typeof goal === 'string'
                  ? goal
                  : goal.title || goal.description || 'Planned goal'}
              </li>
            ))}
          </ul>
        </>
      )}

      {item.planning_type === 'weekly' && (
        <>
          <strong>Day-Wise Activities</strong>
          {(item.activities || []).map((activity, index) => (
            <div key={activity.activity_id || index}
              style={{ borderBottom: '1px solid var(--border, #e2e8f0)', paddingBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {activity.planned_date}
              </div>
              <strong>{activity.title}</strong>
              {/* STEP 44B.53E.12 - Reviewer field visibility */}
              <SprintReviewActivityFields
                activity={activity}
                weeklyTemplate={
                  item.sprint_template_snapshot ||
                  item.plan?.sprint_template_snapshot ||
                  null
                }
              />

              <div style={{ fontSize: 13 }}>
                {activity.expected_deliverable || activity.description}
              </div>
            </div>
          ))}
        </>
      )}

      {item.planning_type === 'daily_change' && (
        <>
          <strong>Proposed Change</strong>
          <div>Type: {String(item.change_type || '').replaceAll('_', ' ')}</div>
          <div>Date: {item.planned_date}</div>
          <div>Activity: {item.title}</div>
          {item.description && <div>{item.description}</div>}
          <div>
            <strong>Reason:</strong> {item.reason}
          </div>
          <div>
            Team Leader: <StatusTag value={item.tl_approval} />
          </div>
          <div>
            Reporting Officer: <StatusTag value={item.ro_approval} />
          </div>
          {item.original_activity?.title && (
            <div>
              <strong>Original activity:</strong>{' '}
              {item.original_activity.title}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SprintApprovalsBody() {
  const { notify, confirm: customConfirm } = useCustomAlert();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState('');
  const [filter, setFilter] = useState('all');
  const [detailsOpen, setDetailsOpen] = useState({});
  const [remarks, setRemarks] = useState({});

  const alert = useCallback((type, title, message) => {
    notify({ type, title, message });
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSprintApprovalInbox(100);
      setItems(getItems(result));
    } catch (error) {
      alert('error', 'Unable to load approvals', description(error));
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => (
    filter === 'all'
      ? items
      : items.filter(item => item.planning_type === filter)
  ), [items, filter]);

  const actionable = items.filter(item =>
    (item.allowed_actions || []).some(action =>
      ['tl_review', 'ro_review', 'apply_change'].includes(action)
    )
  ).length;

  const review = async (item, role, decision) => {
    const id = getId(item);
    const note = (remarks[`${id}:${role}`] || '').trim();

    if (decision === 'rejected' && note.length < 5) {
      alert('warning', 'Rejection reason required',
        'Please enter at least five characters explaining the rejection.');
      return;
    }

    const yes = await customConfirm(
      `Do you want to ${decision === 'approved' ? 'approve' : 'reject'} this request?`,
      {
        title: decision === 'approved' ? 'Approve Planning Request' : 'Reject Planning Request',
        confirmText: decision === 'approved' ? 'Approve' : 'Reject'
      }
    );

    if (!yes) return;

    setProcessing(id);
    try {
      if (item.planning_type === 'monthly') {
        await reviewMonthlyPlan(id, decision, note);
      } else if (item.planning_type === 'weekly') {
        await reviewWeeklyPlan(id, decision, note);
      } else {
        await reviewDailyChangeRequest(id, role, decision, note);
      }

      alert('success', 'Review submitted',
        'Your decision has been recorded successfully.');
      await load();
    } catch (error) {
      alert('error', 'Unable to submit review', description(error));
    } finally {
      setProcessing('');
    }
  };

  const applyChange = async (item) => {
    const id = getId(item);
    const yes = await customConfirm(
      'Apply this fully approved change to the weekly plan?',
      { title: 'Apply Approved Change', confirmText: 'Apply Change' }
    );
    if (!yes) return;

    setProcessing(id);
    try {
      await applyApprovedDailyChange(id);
      alert('success', 'Change applied',
        'The approved day-wise change has been applied.');
      await load();
    } catch (error) {
      alert('error', 'Unable to apply change', description(error));
    } finally {
      setProcessing('');
    }
  };

  return (
    <main style={{ maxWidth: 1350, margin: '0 auto', padding: 'clamp(12px,2vw,24px)' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        marginBottom: 22
      }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <ShieldCheck size={24} /> Sprint Planning Approvals
          </h2>
          <p style={{ color: 'var(--text-muted, #64748b)' }}>
            Review planning sheets and authorised day-wise changes.
          </p>
        </div>
        <button type="button" className="btn btn-secondary"
          onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
        gap: 12,
        marginBottom: 20
      }}>
        {[
          ['Visible Requests', items.length, ClipboardCheck],
          ['Awaiting My Action', actionable, Clock3]
        ].map(([label, value, Icon]) => (
          <div className="card" key={label} style={{ padding: 18, borderRadius: 12 }}>
            <Icon size={20} />
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
              {value}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 18
      }}>
        {[
          ['all', 'All Requests'],
          ['monthly', 'Monthly'],
          ['weekly', 'Weekly'],
          ['daily_change', 'Day-Wise Changes']
        ].map(([value, label]) => (
          <button key={value} type="button"
            className={filter === value ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: 22 }}>Loading approval requests...</div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={30} style={{ marginBottom: 12 }} />
          <p>No pending requests for this view.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {visible.map(item => {
            const id = getId(item);
            const Icon = kindIcon[item.planning_type] || ClipboardCheck;
            const actions = Array.isArray(item.allowed_actions)
              ? item.allowed_actions
              : [];
            const reviewActions = item.status === 'pending_approval'
              ? actions.filter(action =>
                  action === 'tl_review' || action === 'ro_review'
                )
              : [];
            const canApply =
              item.planning_type === 'daily_change' &&
              item.status === 'approved_pending_application' &&
              actions.includes('apply_change');

            return (
              <article className="card" key={`${item.planning_type}-${id}`}
                style={{ padding: 20, borderRadius: 14 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={19} />
                      <strong>{kindLabel[item.planning_type] || 'Planning Request'}</strong>
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 600 }}>
                      {item.title || item.month ||
                        `${item.week_start || ''} - ${item.week_end || ''}`}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 13, marginTop: 5 }}>
                      Employee ID: {item.employee_id}
                    </div>
                  </div>
                  <StatusTag value={item.status} />
                </div>

                <button type="button" className="btn btn-secondary"
                  style={{ marginTop: 14 }}
                  onClick={() => setDetailsOpen(previous => ({
                    ...previous, [id]: !previous[id]
                  }))}>
                  <Eye size={15} />
                  {detailsOpen[id] ? 'Hide Details' : 'View Details'}
                </button>

                {detailsOpen[id] && <RequestDetails item={item} />}

                {reviewActions.length === 0 && !canApply && (
                  <p style={{ fontSize: 13, color: '#64748b' }}>
                    <AlertTriangle size={14} style={{ verticalAlign: 'middle' }} />
                    {' '}Monitoring only — no approval action assigned to this login.
                  </p>
                )}

                {reviewActions.map(action => {
                  const role = action === 'ro_review' ? 'ro' : 'tl';
                  const key = `${id}:${role}`;
                  return (
                    <div key={action} style={{
                      marginTop: 16,
                      paddingTop: 14,
                      borderTop: '1px solid var(--border, #e2e8f0)'
                    }}>
                      <strong style={{ fontSize: 13 }}>
                        {role === 'tl' ? 'Team Leader Review' : 'Reporting Officer Review'}
                      </strong>
                      <textarea className="form-control" rows={2}
                        style={{ width: '100%', marginTop: 9, marginBottom: 10 }}
                        placeholder="Review remarks (required when rejecting)"
                        value={remarks[key] || ''}
                        onChange={event => setRemarks(previous => ({
                          ...previous, [key]: event.target.value
                        }))} />
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary"
                          disabled={processing === id}
                          onClick={() => review(item, role, 'approved')}>
                          <CheckCircle2 size={16} /> Approve
                        </button>
                        <button type="button" className="btn btn-secondary"
                          disabled={processing === id}
                          onClick={() => review(item, role, 'rejected')}>
                          <XCircle size={16} /> Reject
                        </button>
                      </div>
                    </div>
                  );
                })}

                {canApply && (
                  <button className="btn btn-primary" type="button"
                    style={{ marginTop: 15 }}
                    disabled={processing === id}
                    onClick={() => applyChange(item)}>
                    <CheckCircle2 size={16} /> Apply Approved Change
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 12, color: '#64748b', marginTop: 20 }}>
        Approval permissions are enforced by the backend. Displayed actions
        do not independently grant permission to approve employee records.
      </p>
    </main>
  );
}

/**
 * Centralised Sprint Approvals:
 * - Existing weekly and day-wise approval interfaces stay intact.
 * - Monthly individual approvals use their own reporting-line checks.
 * - Compiled team plans require separate Reporting Officer approval.
 */
export default function SprintApprovals(props) {
  return (
    <>
      <div style={{ padding: '0 clamp(12px, 2vw, 25px)' }}>
        <SprintMonthlyApprovalQueue month="" />
        <SprintMonthlyTeamCompilation month="" />
      </div>
      <SprintApprovalsBody {...props} />
    </>
  );
}
