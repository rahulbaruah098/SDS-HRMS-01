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
import { getEmployeeDirectory } from '../api/client';


// Employee names are resolved from the existing tenant-scoped directory.
// Missing or inaccessible profiles fall back to a neutral label, never a guessed name.
const directoryItems = response => {
  const data = response?.data || response;
  return Array.isArray(data?.items) ? data.items : [];
};
const employeeById = people => new Map(people.map(person => [
  String(person?._id || person?.id || '').trim(), person
]).filter(([id]) => id));
// Prefer the tenant-scoped directory; use server-provided identity only as a
// fallback when a directory entry is not accessible. Never display raw IDs.
const requesterIdentity = (people, item) => {
  const identifier = String(item?.employee_id || '').trim();
  const person = people.get(identifier);
  const embedded = item?.employee && typeof item.employee === 'object'
    ? item.employee : null;
  const name = person?.name || person?.employee_name ||
    item?.employee_name || item?.requester_name ||
    embedded?.name || embedded?.employee_name || 'Employee profile unavailable';
  const code = person?.employee_code || embedded?.employee_code ||
    item?.employee_code || '';
  const department = person?.department || person?.department_name ||
    embedded?.department || embedded?.department_name ||
    item?.department_name || item?.department || '';
  return {
    name: String(name),
    meta: [code, department].filter(Boolean).join(' · ') ||
      (name === 'Employee profile unavailable' ? 'Identity unavailable' : 'Employee')
  };
};

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
    <span className="sra-status" style={{
      color: colors[value] || 'var(--text-muted, #64748b)',
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
    <div className="sra-request-details" style={{
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
                      <div><strong>Planned date:</strong> {item.planned_date}</div>
                      <div><strong>Activity:</strong> {item.title}</div>
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
  const [employeeLookup, setEmployeeLookup] = useState(() => new Map());
  const [directoryWarning, setDirectoryWarning] = useState(false);

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

  useEffect(() => {
    let active = true;
    const loadDirectory = async () => {
      try {
        // The server enforces the logged-in user's organisation scope.
        const response = await getEmployeeDirectory({ limit: 500 });
        if (active) {
          setEmployeeLookup(employeeById(directoryItems(response)));
          setDirectoryWarning(false);
        }
      } catch {
        if (active) setDirectoryWarning(true);
      }
    };
    loadDirectory();
    return () => { active = false; };
  }, []);

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
    <main className="sra-page" style={{ maxWidth: 1350, margin: '0 auto', padding: 'clamp(12px,2vw,24px)' }}>
      <style>{`
        .sra-page { color: var(--text, inherit); min-width: 0; }
        .sra-page .sra-summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-bottom:20px; }
        .sra-page .sra-stat { min-width:0; background:var(--surface, var(--card, #fff)); border:1px solid var(--border, #e2e8f0); }
        .sra-page .sra-filter-bar { display:flex; gap:8px; margin-bottom:18px; overflow-x:auto; max-width:100%; padding:3px 2px 8px; scrollbar-width:thin; }
        .sra-page .sra-filter-bar button { flex:0 0 auto; white-space:nowrap; }
        .sra-page .sra-filter-tab { border:1px solid var(--border,#dce2ef); background:var(--surface,#fff); color:var(--text,#24314d); border-radius:11px; padding:10px 15px; font-weight:700; box-shadow:none; transition:background .18s,border-color .18s; }
        .sra-page .sra-filter-tab:hover { background:var(--surface-secondary,#f6f4ff); border-color:var(--primary,#6355d8); }
        .sra-page .sra-filter-tab.is-active { border-color:var(--primary,#6355d8); background:var(--surface-secondary,#f5f3ff); color:var(--primary,#5142ce); box-shadow:inset 0 0 0 1px var(--primary,#6355d8); }
        .sra-page .sra-filter-tab:focus-visible { outline:2px solid var(--primary,#6355d8); outline-offset:2px; }
        .sra-page .sra-request { min-width:0; border:1px solid var(--border, #e2e8f0); background:var(--surface, var(--card, #fff)); overflow-wrap:anywhere; }
        .sra-page .sra-request-details { border:1px solid var(--border, #e2e8f0); color:var(--text, inherit); min-width:0; overflow-wrap:anywhere; }
        .sra-page .sra-status { display:inline-flex; align-items:center; border:1px solid currentColor; border-radius:999px; padding:6px 12px; max-width:100%; background:var(--surface-secondary,#f8fafc); letter-spacing:.01em; }
        .sra-page .sra-actions { display:flex; flex-wrap:wrap; gap:10px; }
        .sra-page .sra-review-box { padding:14px; margin-top:16px; border:1px solid var(--border, #e2e8f0); border-radius:12px; }
        .sra-page textarea.form-control { box-sizing:border-box; min-width:0; max-width:100%; background:var(--surface, #fff); color:var(--text, inherit); border-color:var(--border, #e2e8f0); }
        .sra-page button { min-height:42px; display:inline-flex; justify-content:center; align-items:center; gap:7px; }
        .sra-page button:focus-visible, .sra-page textarea:focus-visible { outline:2px solid var(--primary, #6355d8); outline-offset:3px; }
        .sra-page .sra-muted { color:var(--text-muted, #64748b); }
        .sra-page .sra-title { font-size:clamp(20px,2.5vw,27px); line-height:1.3; }
        /* Professional review workspace */
        .sra-page { --sra-accent:var(--primary,#5142ce); --sra-border:var(--border,#e1e5ee); }
        .sra-page .sra-summary-grid { gap:16px; }
        .sra-page .sra-stat { border-radius:16px!important; padding:20px!important; box-shadow:0 5px 22px rgba(25,35,75,.035); }
        .sra-page .sra-request { border-radius:18px!important; padding:24px!important; box-shadow:0 8px 26px rgba(20,30,60,.04); }
        .sra-page .sra-request-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
        .sra-page .sra-person { display:flex; align-items:center; gap:10px; margin-top:16px; padding:11px 13px; border-radius:12px; background:var(--surface-secondary,#f7f8fc); border:1px solid var(--sra-border); }
        .sra-page .sra-person-avatar { display:grid; place-items:center; height:38px; width:38px; flex:none; border-radius:11px; background:#ece9ff; color:#5142ce; font-weight:800; }
        .sra-page .sra-person-name { font-weight:750; font-size:14px; line-height:1.4; }
        .sra-page .sra-person-meta { font-size:12px; color:var(--text-muted,#64748b); margin-top:2px; }
        .sra-page .sra-request-title { font-size:17px; line-height:1.45; margin-top:8px; font-weight:750; }
        .sra-page .sra-review-box { background:var(--surface-secondary,#f8fafc); padding:18px; border-radius:14px; }
        .sra-page .sra-review-box textarea { display:block; width:100%; min-height:96px; border:1px solid var(--sra-border); border-radius:11px; padding:12px 14px; margin-top:9px; resize:vertical; font-size:14px; line-height:1.5; }
        .sra-page .sra-actions { margin-top:13px; }
        .sra-page .sra-actions button, .sra-page .sra-filter-bar button, .sra-page .sra-refresh { border-radius:10px; padding:10px 16px; font-weight:700; }
        .sra-page .sra-approve { background:#168048!important; color:white!important; border-color:#168048!important; }
        .sra-page .sra-reject { border:1px solid #f1c3c3!important; color:#ad3434!important; background:var(--surface,#fff)!important; }
        .sra-page .sra-apply { background:var(--sra-accent)!important; color:white!important; border-radius:11px; font-weight:700; padding:11px 17px; }
        .sra-page .sra-review-help { font-size:12px; line-height:1.5; color:var(--text-muted,#64748b); margin:8px 0 0; }
        .sra-page .sra-quiet { font-size:13px; background:var(--surface-secondary,#f8fafc); border:1px solid var(--sra-border); padding:11px 13px; border-radius:10px; margin-top:14px; color:var(--text-muted,#64748b); }
        .sra-page button:disabled { opacity:.62; cursor:wait; }
        @media(max-width:640px) {
          .sra-page { padding:12px !important; }
          .sra-page .sra-summary-grid { gap:9px; }
          .sra-page .sra-stat { padding:13px !important; }
          .sra-page .sra-request { padding:14px !important; }
          .sra-page .sra-review-box { padding:12px; }
          .sra-page .sra-actions button { flex:1 1 135px; }
          .sra-page .sra-refresh { width:100%; }
          .sra-page .sra-request-details { padding:12px !important; }
        }
        @media(max-width:360px) {
          .sra-page .sra-summary-grid { grid-template-columns:1fr; }
        }
        /* YC_FIX03D_APPROVAL_CORE_BEGIN */
        .sra-page { --sra-ink:#101a3a; --sra-muted:#596483; --sra-accent:#6254da; --sra-border:#dfe5f2; color:var(--sra-ink); font-family:var(--yc-ui,var(--body),inherit); width:100%; box-sizing:border-box; }
        /* YC_FIX03G10_APPROVALS_CLEANUP: restrained header and cards */
        .sra-page > header { position:relative; border:1px solid var(--sra-border); border-radius:18px; background:var(--surface,#fff); box-shadow:0 4px 16px rgba(31,48,93,.045); padding:clamp(18px,2.4vw,28px); margin-bottom:22px; }
        .sra-page .sra-title { color:var(--sra-ink); font-weight:800; letter-spacing:-.025em; }
        .sra-page .sra-title svg { color:var(--sra-accent); flex-shrink:0; }
        .sra-page .sra-muted,.sra-page .sra-person-meta { color:var(--sra-muted) !important; }
        .sra-page .card { border:1px solid var(--sra-border); border-radius:16px !important; box-shadow:0 3px 12px rgba(31,48,93,.045); background:var(--surface,#fff); }
        .sra-page .sra-stat { background:var(--surface,#fff); border-color:var(--sra-border); }
        .sra-page .sra-stat > svg { color:var(--sra-accent); }
        .sra-page .sra-request { border-color:var(--sra-border); overflow-wrap:anywhere; }
        .sra-page .sra-request-title,.sra-page .sra-person-name { color:var(--sra-ink); }
        .sra-page .sra-person { border-color:var(--sra-border); background:#f8f9ff; min-width:0; }
        .sra-page .sra-person-avatar { background:#eeecff; color:#5142ce; }
        .sra-page .sra-review-box,.sra-page .sra-request-details { border-color:var(--sra-border); background:#fcfcff; border-radius:15px; }
        .sra-page .sra-filter-tab { border-color:#d7dded; border-radius:11px; }
        .sra-page .sra-filter-tab.is-active { background:#f1efff; border-color:var(--sra-accent); color:#5142ce; }
        .sra-page .btn { border-radius:11px; min-height:42px; box-sizing:border-box; }
        .sra-page .sra-refresh,.sra-page .btn.btn-secondary:not(.sra-reject) { border-color:#d7dded; }
        .sra-page .sra-apply { background:var(--sra-accent) !important; border-color:var(--sra-accent) !important; }
        .sra-page :where(input,select,textarea) { box-sizing:border-box; min-width:0; border-radius:11px; }
        .sra-page :where(button,textarea):focus-visible { outline:3px solid rgba(98,84,218,.36); outline-offset:2px; }
        .sra-page .sra-request-head > div:first-child { min-width:0; }
        @media(max-width:760px) { .sra-page > header { padding:18px 16px; } .sra-page .card { box-shadow:0 3px 12px rgba(31,48,93,.045); } }
        @media(max-width:480px) { .sra-page { padding:12px max(10px,env(safe-area-inset-right)) 12px max(10px,env(safe-area-inset-left)) !important; } .sra-page > header { padding:16px 13px; border-radius:18px; } .sra-page .sra-title { font-size:clamp(19px,5.7vw,24px); } .sra-page .sra-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; } .sra-page .sra-stat { padding:12px !important; } .sra-page .sra-request { padding:13px !important; } .sra-page .sra-person { padding:10px; } .sra-page .sra-actions { display:grid; grid-template-columns:minmax(0,1fr); } .sra-page .sra-actions button { width:100%; min-width:0; } .sra-page .sra-filter-tab { padding:10px 12px; } }
        @media(max-width:360px) { .sra-page .sra-summary-grid { grid-template-columns:1fr; } }
        @media(prefers-reduced-motion:reduce) { .sra-page .btn { transition:none; } }
        @media print { .sra-page > header { background:#fff; border:0; box-shadow:none; } .sra-page .card { box-shadow:none; } }
        /* YC_FIX03D_APPROVAL_CORE_END */
        @media(prefers-reduced-motion:reduce) { .sra-page * { scroll-behavior:auto !important; } }
      `}</style>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        marginBottom: 22
      }}>
        <div>
          <h2 className="sra-title" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <ShieldCheck size={24} /> Sprint Planning Approvals
          </h2>
          <p className="sra-muted" style={{ color: 'var(--text-muted, #64748b)' }}>
            Review planning sheets and authorised day-wise changes.
          </p>
        </div>
        <button type="button" className="btn btn-secondary sra-refresh"
          onClick={load} disabled={loading} aria-label="Refresh approval requests">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <div className="sra-summary-grid" aria-label="Approval request summary">
        {[
          ['Visible Requests', items.length, ClipboardCheck],
          ['Awaiting My Action', actionable, Clock3]
        ].map(([label, value, Icon]) => (
          <div className="card sra-stat" key={label} style={{ padding: 18, borderRadius: 12 }}>
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

      <div className="sra-filter-bar" role="group" aria-label="Filter approval requests">
        {[
          ['all', 'All Requests'],
          ['monthly', 'Monthly'],
          ['weekly', 'Weekly'],
          ['daily_change', 'Day-Wise Changes']
        ].map(([value, label]) => (
          <button key={value} type="button"
            className={`sra-filter-tab ${filter === value ? 'is-active' : ''}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: 22 }} role="status">Loading approval requests...</div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={30} style={{ marginBottom: 12 }} />
          <h3 style={{margin:'3px 0 6px',fontSize:17}}>You're all caught up</h3>
          <p className="sra-muted" style={{margin:0}}>No requests match this view. Check another category or refresh to see new submissions.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {visible.map(item => {
            const id = getId(item);
            const detailKey = `${item.planning_type}:${id}`;
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
            const requester = requesterIdentity(employeeLookup, item);

            return (
              <article className="card sra-request" key={`${item.planning_type}-${id}`}
                style={{ padding: 20, borderRadius: 14 }}>
                <div className="sra-request-head">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={19} />
                      <strong>{kindLabel[item.planning_type] || 'Planning Request'}</strong>
                    </div>
                    <div className="sra-request-title">
                       {item.title || item.month ||
                         `${item.week_start || ''} — ${item.week_end || ''}`}
                     </div>
                     <div className="sra-person">
                       <span className="sra-person-avatar" aria-hidden="true">
                         {requester.name === 'Employee profile unavailable' ? '—' : requester.name.slice(0, 1).toUpperCase()}
                       </span>
                       <div>
                         <div className="sra-person-name">{requester.name}</div>
                         <div className="sra-person-meta">{requester.meta}</div>
                       </div>
                     </div>
                  </div>
                  <StatusTag value={item.status} />
                </div>

                <button type="button" className="btn btn-secondary"
                  style={{ marginTop: 14 }}
                  aria-expanded={Boolean(detailsOpen[detailKey])}
                  onClick={() => setDetailsOpen(previous => ({
                    ...previous, [detailKey]: !previous[detailKey]
                  }))}>
                  <Eye size={15} />
                  {detailsOpen[detailKey] ? 'Hide Details' : 'View Details'}
                </button>

                {detailsOpen[detailKey] && <RequestDetails item={item} />}

                {reviewActions.length === 0 && !canApply && item.status === 'pending_approval' && (
                  <p className="sra-quiet">
                    <AlertTriangle size={14} style={{ verticalAlign: 'middle' }} />
                    {' '}Monitoring only — no approval action assigned to this login.
                  </p>
                )}

                {reviewActions.map(action => {
                  const role = action === 'ro_review' ? 'ro' : 'tl';
                  const key = `${id}:${role}`;
                  return (
                    <div className="sra-review-box" key={action}>
                                             <strong style={{ fontSize: 15 }}>
                         {role === 'tl' ? 'Team Leader Decision' : 'Reporting Officer Decision'}
                       </strong>
                       <p className="sra-review-help">Review the work details before deciding. Add a reason if returning this request for revision.</p>
                       <label htmlFor={`sra-remarks-${id}-${role}`} style={{display:'block',fontSize:13,fontWeight:700,marginTop:12}}>Review remarks <span className="sra-muted" style={{fontWeight:400}}>(optional for approval)</span></label>
                       <textarea id={`sra-remarks-${id}-${role}`} className="form-control" rows={3}
                        aria-label={`${role === 'tl' ? 'Team Leader' : 'Reporting Officer'} review remarks`}
                        style={{ width: '100%', marginTop: 9, marginBottom: 10 }}
                                                 maxLength={1000}
                         placeholder="Write constructive feedback, or explain what needs to change…"
                        value={remarks[key] || ''}
                        onChange={event => setRemarks(previous => ({
                          ...previous, [key]: event.target.value
                        }))} />
                      <div className="sra-actions">
                        <button type="button" className="btn btn-primary sra-approve"
                           disabled={processing === id}
                           onClick={() => review(item, role, 'approved')}>
                                                     <CheckCircle2 size={16} /> {processing === id ? 'Processing…' : 'Approve Request'}
                        </button>
                        <button type="button" className="btn btn-secondary sra-reject"
                           disabled={processing === id}
                           onClick={() => review(item, role, 'rejected')}>
                                                     <XCircle size={16} /> Return for Revision
                        </button>
                      </div>
                    </div>
                  );
                })}

                {canApply && (
                  <button className="btn btn-primary sra-apply" type="button"
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

      {directoryWarning && <p className="sra-muted" role="status" style={{fontSize:12}}>Employee directory unavailable. Identity details will appear when directory access is restored.</p>}
      <p className="sra-muted" style={{ fontSize: 12, marginTop: 20 }}>
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
