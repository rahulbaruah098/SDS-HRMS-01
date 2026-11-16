import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, AlertTriangle, CalendarDays, UserRound
} from 'lucide-react';
import SprintMonthlySavedFields from '../components/SprintMonthlySavedFields';
import { getMonthlyReviewInbox, reviewMonthlyPlan } from '../api/sprintPlanning';
import { useCustomAlert } from '../components/CustomAlertProvider';

const planId = plan => String(plan?._id || plan?.id || '');
const valueOrDash = value => value === undefined || value === null || value === '' ? '—' : String(value);
const planRows = plan => {
  if (Array.isArray(plan?.sheet_rows) && plan.sheet_rows.length) return plan.sheet_rows;
  return (Array.isArray(plan?.goals) ? plan.goals : []).map(goal => ({
    activity: typeof goal === 'string' ? goal : goal?.activity || goal?.title || goal?.description || ''
  }));
};

export default function SprintMonthlyApprovalQueue({ month = '' }) {
  const { notify, confirm: customConfirm } = useCustomAlert();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [remarks, setRemarks] = useState({});
  const [expanded, setExpanded] = useState({});
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await getMonthlyReviewInbox(month);
      const payload = response?.data?.items ? response.data : response;
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTruncated(Boolean(payload?.truncated));
    } catch (error) {
      const message = error?.message || 'Request failed.';
      setLoadError(message);
      notify({ type: 'error', title: 'Unable to load monthly approvals', message });
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => { load(); }, [load]);

  const review = async (plan, decision) => {
    const id = planId(plan);
    if (!id || busyId) return;
    const note = String(remarks[id] || '').trim();
    if (decision === 'rejected' && note.length < 5) {
      notify({
        type: 'warning',
        title: 'Rejection reason required',
        message: 'Enter at least five characters explaining the correction needed.'
      });
      return;
    }
    const confirmed = await customConfirm(
      `Do you want to ${decision === 'approved' ? 'approve' : 'reject'} this monthly plan?`,
      { title: 'Review Monthly Work Plan', confirmText: decision === 'approved' ? 'Approve' : 'Reject' }
    );
    if (!confirmed) return;

    setBusyId(id);
    try {
      await reviewMonthlyPlan(id, decision, note);
      notify({
        type: 'success', title: 'Monthly review recorded',
        message: decision === 'approved' ? 'Plan approved successfully.' : 'Plan returned for correction.'
      });
      setRemarks(previous => ({ ...previous, [id]: '' }));
      await load();
    } catch (error) {
      notify({
        type: 'error', title: 'Unable to review monthly plan',
        message: error?.message || 'Request failed.'
      });
    } finally {
      setBusyId('');
    }
  };

  if (!loading && !loadError && !items.length && !truncated) return null;

  return (
    <section className="sma-queue" aria-label="Monthly planning approval queue">
      <style>{`
        .sma-queue { --sma-ink:var(--text, #26334b); --sma-muted:var(--text-muted, #64748b); --sma-line:var(--border, #e2e8f0); --sma-bg:var(--surface, #fff); --sma-soft:var(--surface-secondary, #f8fafc); --sma-accent:var(--primary, #5142ce); color:var(--sma-ink); padding:clamp(14px, 2vw, 22px); margin:18px 0; background:var(--sma-bg); border:1px solid var(--sma-line); border-radius:16px; min-width:0; box-shadow:0 3px 12px rgba(25,35,85,.035); }
        .sma-queue * { box-sizing:border-box; }
        .sma-heading, .sma-card-head, .sma-actions { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
        .sma-heading h2 { display:flex; gap:9px; align-items:center; font-size:clamp(17px, 2.2vw, 21px); margin:0; line-height:1.3; }
        .sma-subtle { color:var(--sma-muted); font-size:13px; line-height:1.55; margin:7px 0 0; overflow-wrap:anywhere; }
        .sma-button { display:inline-flex; justify-content:center; align-items:center; gap:8px; min-height:42px; padding:9px 14px; border:1px solid var(--sma-line); border-radius:10px; background:var(--sma-bg); color:var(--sma-ink); font:inherit; font-size:13px; font-weight:650; cursor:pointer; text-align:center; }
        .sma-button:hover:not(:disabled) { background:var(--sma-soft); }
        .sma-button:focus-visible, .sma-remarks:focus-visible { outline:3px solid var(--sma-accent); outline-offset:2px; }
        .sma-button:disabled { opacity:.6; cursor:not-allowed; }
        .sma-button-primary { background:var(--sma-accent); border-color:var(--sma-accent); color:#fff; font-weight:700; }
        .sma-button-primary:hover:not(:disabled) { filter:brightness(.94); background:var(--sma-accent); }
        .sma-card { min-width:0; background:var(--sma-bg); border:1px solid var(--sma-line); padding:clamp(13px, 2vw, 20px); border-radius:13px; margin-top:14px; box-shadow:0 2px 8px rgba(25,35,85,.025); }
        .sma-card h3 { font-size:16px; margin:0; overflow-wrap:anywhere; }
        .sma-status { border:1px solid #f1ddb1; border-radius:999px; padding:6px 11px; font-size:12px; font-weight:700; color:#805313; background:#fff7e7; white-space:nowrap; }
        .sma-meta { display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:10px; color:var(--sma-muted); font-size:12px; line-height:1.5; }
        .sma-meta span { display:inline-flex; align-items:center; gap:5px; }
        .sma-table-wrap { max-width:100%; overflow-x:auto; overscroll-behavior-x:contain; border:1px solid var(--sma-line); border-radius:11px; margin-top:15px; }
        .sma-table { width:100%; min-width:850px; border-collapse:collapse; font-size:13px; }
        .sma-table th { background:var(--sma-soft); font-weight:750; text-align:left; padding:12px; border-bottom:1px solid var(--sma-line); white-space:nowrap; }
        .sma-table td { border-bottom:1px solid var(--sma-line); padding:11px 12px; vertical-align:top; overflow-wrap:anywhere; max-width:260px; }
        .sma-table tr:last-child td { border-bottom:0; }
        .sma-review { background:var(--sma-soft); border:1px solid var(--sma-line); border-radius:11px; padding:clamp(12px, 2vw, 18px); margin-top:15px; }
        .sma-remarks { display:block; width:100%; resize:vertical; margin:9px 0 12px; padding:11px 12px; min-height:92px; border-radius:9px; border:1px solid var(--sma-line); background:var(--sma-bg); color:var(--sma-ink); font:inherit; font-size:14px; }
        .sma-warning { color:#9a5e12; background:var(--sma-soft); border:1px solid var(--sma-line); border-radius:10px; padding:12px; margin:14px 0 0; font-size:13px; display:flex; gap:9px; align-items:flex-start; }
        .sma-saved-fields { min-width:0; max-width:100%; overflow-x:auto; margin-top:16px; }
        @media (max-width:600px) {
          .sma-heading { align-items:stretch; }
          .sma-queue { padding:max(12px,env(safe-area-inset-left)) max(12px,env(safe-area-inset-right)); }
          .sma-heading > .sma-button { width:100%; }
          .sma-card-head { align-items:flex-start; }
          .sma-actions { display:grid; grid-template-columns:1fr; }
          .sma-actions .sma-button { width:100%; }
          .sma-meta { display:grid; gap:7px; }
        }
        @media print { .sma-queue .sma-no-print { display:none!important; } .sma-queue { border:0; padding:0; } .sma-table-wrap { overflow:visible; } }
      `}</style>

      <div className="sma-heading">
        <div>
          <h2><ClipboardCheck size={21} aria-hidden="true" /> Monthly Plans Awaiting Your Approval</h2>
          <p className="sma-subtle">Review assigned monthly plans.</p>
        </div>
        <button type="button" className="sma-button sma-no-print" onClick={load} disabled={loading || Boolean(busyId)}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh Queue'}
        </button>
      </div>

      {loading && <p role="status" className="sma-subtle">Checking your monthly approval queue…</p>}
      {!loading && loadError && (
        <div className="sma-warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>Unable to load monthly approvals: {loadError}</div>
        </div>
      )}
      {!loading && !loadError && truncated && (
        <div className="sma-warning" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>The approval search reached its record limit. Some plans may not be displayed.</div>
        </div>
      )}

      {!loading && !loadError && items.map(plan => {
        const id = planId(plan);
        const rows = planRows(plan);
        const isExpanded = Boolean(expanded[id]);
        const department = [plan.department_name, plan.department]
          .find(value => typeof value === 'string' && value.trim()) || '';
        return (
          <article className="sma-card" key={id}>
            <div className="sma-card-head">
              <div style={{ minWidth: 0 }}>
                <h3>{plan.title || 'Monthly Work Plan'}</h3>
                <div className="sma-meta">
                  <span><CalendarDays size={14} aria-hidden="true" /> {valueOrDash(plan.month)}</span>
                  <span>{rows.length} {rows.length === 1 ? 'activity' : 'activities'}</span>
                  <span><UserRound size={14} aria-hidden="true" /> Employee: {valueOrDash(plan.employee_name || plan.requester_name || plan.employee?.name || 'Employee profile unavailable')}</span>
                  {department && <span>Department: {department.trim()}</span>}
                  <span>{plan.reviewer_label || 'Assigned Approver'}</span>
                </div>
              </div>
              <span className="sma-status">Pending Approval</span>
            </div>
            <button
              type="button" className="sma-button sma-no-print" style={{ marginTop: 14 }}
              aria-expanded={isExpanded} aria-controls={`sma-details-${id}`}
              onClick={() => setExpanded(old => ({ ...old, [id]: !old[id] }))}
            >
              <ChevronDown size={16} aria-hidden="true" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }} />
              {isExpanded ? 'Hide Plan Details' : 'Review Plan Details'}
            </button>
            {isExpanded && (
              <div id={`sma-details-${id}`}>
                <div className="sma-table-wrap" role="region" aria-label={`Planning activities for ${plan.title || 'monthly plan'}`} tabIndex={0}>
                  <table className="sma-table">
                    <thead><tr>
                      <th scope="col">No.</th><th scope="col">Objective</th><th scope="col">Activity</th>
                      <th scope="col">Deliverable</th><th scope="col">KPI</th>
                      <th scope="col">Target Date</th><th scope="col">Weightage</th>
                    </tr></thead>
                    <tbody>
                      {rows.length ? rows.map((row, index) => (
                        <tr key={row.row_id || row.key || index}>
                          <td>{index + 1}</td>
                          <td>{valueOrDash(row.objective)}</td>
                          <td>{valueOrDash(row.activity)}</td>
                          <td>{valueOrDash(row.deliverable)}</td>
                          <td>{valueOrDash(row.kpi)}</td>
                          <td>{valueOrDash(row.end_date)}</td>
                          <td>{valueOrDash(row.weightage)}</td>
                        </tr>
                      )) : <tr><td colSpan={7}>No activities are available in this planning sheet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="sma-saved-fields">
                  <SprintMonthlySavedFields template={plan.sprint_template_snapshot || null} rows={rows} />
                </div>
                <div className="sma-review">
                  <label htmlFor={`sma-review-note-${id}`} style={{ fontSize: 14, fontWeight: 750 }}>Review Remarks</label>
                  <p className="sma-subtle">Explain any changes required. A reason of at least five characters is mandatory when rejecting.</p>
                  <textarea
                    id={`sma-review-note-${id}`} className="sma-remarks" rows={3}
                    value={remarks[id] || ''}
                    onChange={event => setRemarks(old => ({ ...old, [id]: event.target.value }))}
                    maxLength={2000} placeholder="Approval comments or rejection reason"
                  />
                  <div className="sma-actions sma-no-print">
                    <button
                      type="button" className="sma-button sma-button-primary"
                      disabled={Boolean(busyId)} onClick={() => review(plan, 'approved')}
                    ><CheckCircle2 size={16} aria-hidden="true" /> {busyId === id ? 'Processing…' : 'Approve Monthly Plan'}</button>
                    <button
                      type="button" className="sma-button"
                      disabled={Boolean(busyId)} onClick={() => review(plan, 'rejected')}
                    ><XCircle size={16} aria-hidden="true" /> Return for Correction</button>
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
