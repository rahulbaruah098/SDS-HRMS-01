import SprintMonthlySavedFields from '../components/SprintMonthlySavedFields';
import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck, CheckCircle2, XCircle, RefreshCw
} from 'lucide-react';
import {
  getMonthlyReviewInbox, reviewMonthlyPlan
} from '../api/sprintPlanning';
import { useCustomAlert } from '../components/CustomAlertProvider';

export default function SprintMonthlyApprovalQueue({ month }) {
  const { notify, confirm: customConfirm } = useCustomAlert();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [remarks, setRemarks] = useState({});
  const [expanded, setExpanded] = useState({});
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMonthlyReviewInbox(month);
      setItems(Array.isArray(response?.items) ? response.items : []);
      setTruncated(Boolean(response?.truncated));
    } catch (error) {
      notify({
        type: 'error',
        title: 'Unable to load monthly approvals',
        message: error?.message || 'Request failed.',
      });
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => { load(); }, [load]);

  const review = async (plan, decision) => {
    const id = String(plan._id || plan.id || '');
    const note = (remarks[id] || '').trim();

    if (decision === 'rejected' && note.length < 5) {
      notify({
        type: 'warning',
        title: 'Rejection reason required',
        message: 'Enter at least five characters.',
      });
      return;
    }

    const confirmed = await customConfirm(
      `Do you want to ${decision === 'approved' ? 'approve' : 'reject'} this monthly plan?`,
      {
        title: 'Review Monthly Work Plan',
        confirmText: decision === 'approved' ? 'Approve' : 'Reject',
      }
    );

    if (!confirmed) return;

    setBusyId(id);
    try {
      await reviewMonthlyPlan(id, decision, note);
      notify({
        type: 'success',
        title: 'Monthly review recorded',
        message: `Plan ${decision} successfully.`,
      });
      await load();
    } catch (error) {
      notify({
        type: 'error',
        title: 'Unable to review monthly plan',
        message: error?.message || 'Request failed.',
      });
    } finally {
      setBusyId('');
    }
  };

  if (loading) {
    return <section className="mws-card">
      <p className="mws-muted">Checking your monthly approval queue...</p>
    </section>;
  }

  if (!items.length && !truncated) return null;

  return (
    <section className="mws-card">
      <div className="mws-section-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>
            <ClipboardCheck size={19} style={{ verticalAlign: 'middle' }}/>
            {' '}Monthly Plans Awaiting Your Approval
          </h2>
          <p className="mws-muted">
            Only plans assigned to your actual reporting relationship appear here.
          </p>
        </div>
        <button type="button" className="mws-button"
          onClick={load} disabled={Boolean(busyId)}>
          <RefreshCw size={14}/> Refresh Queue
        </button>
      </div>

      {truncated && (
        <p style={{ color: '#b45309', fontSize: 13 }}>
          The approval search reached its record limit.
          Some plans may not appear until the queue is filtered further.
        </p>
      )}

      {items.map(plan => {
        const id = String(plan._id || plan.id || '');
        const isExpanded = Boolean(expanded[id]);
        const goals = Array.isArray(plan.goals) ? plan.goals : [];
        const rows = Array.isArray(plan.sheet_rows) ? plan.sheet_rows : [];

        return (
          <article key={id} className="mws-history">
            <div className="mws-section-head">
              <div>
                <strong>{plan.title || 'Monthly Work Plan'}</strong>
                <p className="mws-muted">
                  {plan.month} ? {goals.length} activities ?
                  {' '}{plan.reviewer_label || 'Assigned Approver'}
                </p>
                <p className="mws-muted">
                  Employee ID: {plan.employee_id || 'Unavailable'}
                </p>
              </div>
              <span className="mws-status">Pending Approval</span>
            </div>

            <div className="mws-toolbar" style={{
              marginTop: 12, justifyContent: 'flex-start'
            }}>
              <button type="button" className="mws-button"
                onClick={() => setExpanded(old => ({
                  ...old, [id]: !old[id]
                }))}>
                {isExpanded ? 'Hide Plan Details' : 'Review Plan Details'}
              </button>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 14 }}>
                <div className="mws-scroll">
                  <table className="mws-table" style={{ minWidth: 900 }}>
                    <thead><tr>
                      <th>Sl. No.</th>
                      <th>Objective</th>
                      <th>Activity</th>
                      <th>Deliverable</th>
                      <th>KPI</th>
                      <th>Target Date</th>
                      <th>Weightage</th>
                    </tr></thead>
                    <tbody>
                      {goals.map((goal, index) => {
                        const row = rows[index] || {};
                        return (
                          <tr key={index}>
                            <td>{index + 1}</td>
                            <td>{row.objective || '?'}</td>
                            <td>{row.activity || goal}</td>
                            <td>{row.deliverable || '?'}</td>
                            <td>{row.kpi || '?'}</td>
                            <td>{row.end_date || '?'}</td>
                            <td>{row.weightage ?? '?'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* STEP 44B.53D.3 - Saved department planning columns */}
                  <SprintMonthlySavedFields
                    template={plan.sprint_template_snapshot || null}
                    rows={rows}
                  />

                </div>

                <div className="mws-approval">
                  <strong>Review Remarks</strong>
                  <textarea
                    value={remarks[id] || ''}
                    onChange={event => setRemarks(old => ({
                      ...old,
                      [id]: event.target.value
                    }))}
                    placeholder="Approval comments or rejection reason"
                    style={{
                      boxSizing: 'border-box',
                      width: '100%',
                      marginTop: 10,
                      padding: 12,
                      minHeight: 75,
                      borderRadius: 9,
                      border: '1px solid #dce2ef'
                    }}
                  />

                  <div style={{
                    display: 'flex', gap: 10,
                    flexWrap: 'wrap', marginTop: 12
                  }}>
                    <button type="button"
                      className="mws-button mws-primary"
                      disabled={busyId === id}
                      onClick={() => review(plan, 'approved')}>
                      <CheckCircle2 size={15}/> Approve Monthly Plan
                    </button>
                    <button type="button"
                      className="mws-button"
                      disabled={busyId === id}
                      onClick={() => review(plan, 'rejected')}>
                      <XCircle size={15}/> Return for Correction
                    </button>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
