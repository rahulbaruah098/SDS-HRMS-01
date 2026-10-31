import SprintMonthlyInlineFields from '../components/SprintMonthlyInlineFields';
import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList, RefreshCw, Send, CheckCircle2, XCircle
} from 'lucide-react';
import {
  getMonthlyTeamCompilations,
  getMonthlyTeamCoverage,
  createMonthlyTeamCompilation,
  createApprovedMonthlyTeamRevision,
  reviseMonthlyTeamCompilation,
  submitMonthlyTeamCompilation,
  reviewMonthlyTeamCompilation,
} from '../api/sprintPlanning';
import { useCustomAlert } from '../components/CustomAlertProvider';

const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const displayStatus = value => ({
  approved: 'Approved',
  pending_approval: 'Pending Approval',
  rejected: 'Rejected',
  not_submitted: 'Not Submitted',
  draft: 'Draft',
})[value] || String(value || '').replaceAll('_', ' ');

export default function SprintMonthlyTeamCompilation({ month }) {
  const { notify, confirm: customConfirm } = useCustomAlert();
  const [items, setItems] = useState([]);
  const [canCompile, setCanCompile] = useState(false);
  const [coverage, setCoverage] = useState(null);
  const [missingIds, setMissingIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [remarks, setRemarks] = useState({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMonthlyTeamCompilations(
        validMonth(month) ? month : undefined
      );
      const allowed = Boolean(result?.can_compile);
      setItems(Array.isArray(result?.items) ? result.items : []);
      setCanCompile(allowed);

      if (allowed && validMonth(month)) {
        const latest = await getMonthlyTeamCoverage(month);
        setCoverage(latest);
        setMissingIds(previous => {
          const actual = new Set(latest?.missing_employee_ids || []);
          return previous.filter(id => actual.has(id));
        });
      } else {
        setCoverage(null);
        setMissingIds([]);
      }
    } catch (error) {
      notify({
        type: 'error',
        title: 'Unable to load team monthly planning',
        message: error?.message || 'Request failed.',
      });
      setCoverage(null);
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => { reload(); }, [reload]);

  const perform = async (action, success) => {
    setBusy(true);
    try {
      await action();
      notify({
        type: 'success',
        title: success,
        message: 'The monthly team planning record was updated.',
      });
      await reload();
    } catch (error) {
      notify({
        type: 'error',
        title: 'Team monthly plan action failed',
        message: error?.message || 'Request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmationComplete = Boolean(coverage) &&
    (coverage.not_submitted_count || 0) === missingIds.length;

  const monthCompilations = items.filter(
    item => item.month === month
  );
  const existingCompilation = monthCompilations.length > 0;
  const approvedCompilation = monthCompilations.some(
    item => item.status === 'approved'
  );

  const compile = async () => {
    if (!confirmationComplete || existingCompilation) return;
    const confirmed = await customConfirm(
      'Compile approved activities and record the confirmed missing employees?',
      { title: 'Compile Team Monthly Plan', confirmText: 'Compile Plan' }
    );
    if (confirmed) {
      await perform(
        () => createMonthlyTeamCompilation(month, missingIds),
        'Team monthly plan compiled'
      );
    }
  };

  const revise = async (item) => {
    if (!confirmationComplete) return;
    const id = String(item._id || item.id);
    const confirmed = await customConfirm(
      'Refresh the team plan with current approved activities and submitted statuses?',
      {
        title: item.status === 'rejected' ? 'Revise Team Plan' : 'Refresh Team Plan',
        confirmText: 'Update Compilation',
      }
    );
    if (confirmed) {
      await perform(
        () => reviseMonthlyTeamCompilation(id, missingIds),
        'Team plan updated'
      );
    }
  };

  const createNewRevision = async (item) => {
    if (!confirmationComplete) return;
    const id = String(item._id || item.id);
    if (items.some(other =>
      String(other.supersedes_compilation_id || '') === id
    )) {
      notify({
        type: 'warning',
        title: 'Revision already exists',
        message: 'Open the existing revision instead.',
      });
      return;
    }

    const confirmed = await customConfirm(
      'Create a separate draft using the latest approved individual plans? The original approved team plan will remain unchanged.',
      {
        title: 'Create New Team Plan Revision',
        confirmText: 'Create Revision',
      }
    );

    if (confirmed) {
      await perform(
        () => createApprovedMonthlyTeamRevision(id, missingIds),
        'New team plan revision created'
      );
    }
  };

  const submit = async (item) => {
    const confirmed = await customConfirm(
      'Submit this compiled team monthly plan to the assigned Reporting Officer?',
      { title: 'Submit Team Plan', confirmText: 'Submit' }
    );
    if (confirmed) {
      await perform(
        () => submitMonthlyTeamCompilation(item._id || item.id),
        'Team plan submitted'
      );
    }
  };

  const review = async (item, decision) => {
    const id = String(item._id || item.id);
    const note = String(remarks[id] || '').trim();
    if (decision === 'rejected' && note.length < 5) {
      notify({
        type: 'warning',
        title: 'Rejection remarks required',
        message: 'Please enter at least five characters.',
      });
      return;
    }
    const confirmed = await customConfirm(
      `${decision === 'approved' ? 'Approve' : 'Reject'} this compiled team plan?`,
      {
        title: 'Reporting Officer Review',
        confirmText: decision === 'approved' ? 'Approve' : 'Reject',
      }
    );
    if (confirmed) {
      await perform(
        () => reviewMonthlyTeamCompilation(id, decision, note),
        'Reporting Officer decision recorded'
      );
    }
  };

  if (!loading && !canCompile && items.length === 0) return null;

  return (
    <section className="mws-card">
      <div className="mws-section-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>
            <ClipboardList size={18} style={{ verticalAlign: 'middle' }}/>
            {' '}Compiled Team Monthly Sprint Plan
          </h2>
          <p className="mws-muted">
            Compile approved activities, confirm employees who have not submitted,
            and forward the team plan for Reporting Officer approval.
          </p>
        </div>
        <div className="mws-toolbar">
          <button type="button" className="mws-button"
            disabled={busy || loading} onClick={reload}>
            <RefreshCw size={14}/> Refresh
          </button>
          {canCompile && validMonth(month) && (
            <button type="button" className="mws-button mws-primary"
              disabled={
                busy || loading || !confirmationComplete ||
                existingCompilation
              }
              onClick={compile}>
              <ClipboardList size={14}/> Compile {month}
            </button>
          )}
        </div>
      </div>

      {canCompile && validMonth(month) && (
        <div className="mws-approval" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Team Monthly Submission Checklist</h3>
          {loading ? (
            <p className="mws-muted">Loading team submissions...</p>
          ) : coverage ? (
            <>
              <p className="mws-muted">
                {coverage.total_members || 0} members | {' '}{coverage.approved_count || 0} approved | {' '}{coverage.pending_count || 0} pending | {' '}{coverage.rejected_count || 0} rejected | {' '}{coverage.not_submitted_count || 0} not submitted
              </p>
              <div className="mws-scroll">
                <table className="mws-table" style={{ minWidth: 550 }}>
                  <thead>
                    <tr>
                      <th>Employee</th><th>Monthly Plan</th><th>Confirm Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(coverage.members || []).map(member => {
                      const isMissing = member.submission_status === 'not_submitted';
                      return (
                        <tr key={member.employee_id}>
                          <td>
                            {member.employee_name || member.employee_code || member.employee_id}
                            {member.employee_code && (
                              <div className="mws-muted">{member.employee_code}</div>
                            )}
                          </td>
                          <td>{displayStatus(member.submission_status)}</td>
                          <td>
                            {isMissing ? (
                              <label style={{
                                display: 'flex',
                                flexDirection: 'row',
                                flexWrap: 'nowrap',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                gap: 10,
                                width: '100%',
                                minWidth: 130,
                                whiteSpace: 'nowrap',
                                cursor: 'pointer'
                              }}>
                                <input type="checkbox"
                                  style={{
                                    width: 16,
                                    height: 16,
                                    flexShrink: 0,
                                    margin: 0
                                  }}
                                  disabled={busy}
                                  checked={missingIds.includes(member.employee_id)}
                                  onChange={event => setMissingIds(previous =>
                                    event.target.checked
                                      ? [...new Set([...previous, member.employee_id])]
                                      : previous.filter(id => id !== member.employee_id)
                                  )}
                                />
                                Not submitted
                              </label>
                            ) : (
                              <span className="mws-muted">?</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!confirmationComplete && (
                <p style={{ color: '#a15b10', marginTop: 12 }}>
                  Confirm each employee marked Not Submitted before compiling
                  or refreshing the team plan.
                </p>
              )}
              <p className="mws-muted" style={{ marginTop: 10 }}>
                Only approved activities are merged. Pending, rejected and
                missing plans remain separately visible in the submission record.
              </p>
            </>
          ) : (
            <p className="mws-muted">Unable to load team coverage. Click Refresh.</p>
          )}
        </div>
      )}

      {!loading && approvedCompilation && (
        <div className="mws-approval" style={{
          marginTop: 14,
          padding: 16,
          border: '1px solid #dce2f4',
          borderRadius: 10
        }}>
          <strong>Approved team compilation - locked</strong>
          <p className="mws-muted" style={{ marginTop: 8 }}>
            This compilation preserves the activities and submission
            statuses reviewed by the Reporting Officer at the time
            of approval. Later individual plan approvals do not
            automatically change the approved record.
          </p>
          <p className="mws-muted" style={{ marginTop: 6 }}>
            To include newly approved activities, a new compilation
            revision must be prepared and approved separately.
            The original approved version will be retained.
          </p>
        </div>
      )}

      {!loading && existingCompilation && !approvedCompilation && (
        <p className="mws-muted" style={{ marginTop: 12 }}>
          A team compilation already exists for this month.
          Continue using its available submission or revision actions.
        </p>
      )}

      {loading ? (
        <p className="mws-muted">Loading compiled monthly plans...</p>
      ) : items.length === 0 ? (
        <p className="mws-muted">No team compilation exists for the selected month.</p>
      ) : items.map(item => {
        const id = String(item._id || item.id);
        const expanded = expandedId === id;
        const canEdit = Boolean(item.can_submit) &&
          ['draft', 'rejected'].includes(item.status) &&
          validMonth(month) && confirmationComplete;
        const hasChildRevision = items.some(other =>
          String(other.supersedes_compilation_id || '') === id
        );
        const approvedVersions = items.filter(other =>
          other.month === item.month && other.status === 'approved' &&
          String(other.root_compilation_id ||
            other.supersedes_compilation_id || other._id || other.id) !== ''
        );
        const latestApprovedVersion = approvedVersions.reduce(
          (latest, candidate) =>
            !latest ||
            Number(candidate.revision_number || 1) >
              Number(latest.revision_number || 1)
              ? candidate : latest,
          null
        );
        const isLatestApproved = item.status === 'approved' &&
          String(latestApprovedVersion?._id ||
            latestApprovedVersion?.id || '') === id;
        const canCreateNewRevision =
          Boolean(item.can_create_revision) &&
          validMonth(month) && confirmationComplete &&
          !hasChildRevision;

        return (
          <article className="mws-history" key={id}>
            <div className="mws-section-head">
              <div>
                <strong>{item.title || 'Team Monthly Sprint Plan'}</strong>
                {item.status === 'approved' && (
                  <p className="mws-muted" style={{
                    marginTop: 5,
                    fontWeight: isLatestApproved ? 700 : 400,
                    color: isLatestApproved ? '#315c45' : '#64748b'
                  }}>
                    {isLatestApproved
                      ? 'Latest Approved Version'
                      : 'Previous Approved Version - retained for history'}
                  </p>
                )}
                {item.supersedes_compilation_id && (
                  <p className="mws-muted" style={{ marginTop: 5 }}>
                    Revision {item.revision_number || 2} |
                    {' '}Previous approved compilation retained
                  </p>
                )}
                <p className="mws-muted">
                  {item.team_size || 0} employees | {item.activity_count || 0} {(item.activity_count || 0) === 1
                  ? 'activity' : 'activities'}
                </p>
              </div>
              <span className="mws-status">
                  {item.status === 'pending_approval'
                    ? 'Pending Approval'
                    : item.status === 'approved'
                      ? (isLatestApproved ? 'Latest Approved' : 'Approved - History')
                      : item.status === 'rejected'
                        ? 'Rejected' : 'Draft'}
                </span>
            </div>

            <div className="mws-toolbar" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
              <button type="button" className="mws-button"
                onClick={() => setExpandedId(expanded ? '' : id)}>
                {expanded ? 'Hide' : 'View'} Compiled Sheet
              </button>
              {canCreateNewRevision && (
                <button type="button" className="mws-button mws-primary"
                  disabled={busy || loading} onClick={() => createNewRevision(item)}>
                  <ClipboardList size={14}/> Create New Revision
                </button>
              )}
              {item.can_create_revision && hasChildRevision && (
                <span className="mws-muted">
                  A newer revision already exists
                </span>
              )}
              {canEdit && (
                <button type="button" className="mws-button"
                  disabled={busy} onClick={() => revise(item)}>
                  <RefreshCw size={14}/>
                  {item.status === 'rejected' ? 'Revise Compilation' : 'Refresh Approved Plans'}
                </button>
              )}
              {item.can_submit && item.status === 'draft' && (
                <button type="button" className="mws-button mws-primary"
                  disabled={busy} onClick={() => submit(item)}>
                  <Send size={14}/> Submit to Reporting Officer
                </button>
              )}
            </div>

            {expanded && (
              <div style={{ marginTop: 14 }}>
                {Array.isArray(item.coverage_members) && (
                  <div style={{ marginBottom: 14 }}>
                    <strong>Team Submission Coverage</strong>
                    <p className="mws-muted">
                      {item.approved_count || 0} approved | {' '}{item.pending_count || 0} pending | {' '}{item.rejected_count || 0} rejected | {' '}{item.not_submitted_count || 0} not submitted
                    </p>
                    <div className="mws-scroll">
                      <table className="mws-table">
                        <thead><tr><th>Employee</th><th>Status</th></tr></thead>
                        <tbody>
                          {item.coverage_members.map(member => (
                            <tr key={member.employee_id}>
                              <td>{member.employee_name || member.employee_id}</td>
                              <td>{displayStatus(member.submission_status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="mws-scroll">
                  <table className="mws-table" style={{ minWidth: 850 }}>
                    <thead>
                      <tr>
                        <th>Employee</th><th>Monthly Plan</th>
                        <th>Objective / Activity</th><th>Deliverable</th>
                        <th>Target / KPI</th>
                        <th>Department Planning Fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(item.source_plans || []).flatMap(plan => {
                        const rows = plan.sheet_rows?.length
                          ? plan.sheet_rows
                          : (plan.goals || []).map(goal => ({ activity: goal }));
                        return rows.map((row, index) => (
                          <tr key={`${plan.employee_id}-${index}`}>
                            <td>{plan.employee_name || plan.employee_id}</td>
                            <td>{plan.title || 'Monthly Plan'}</td>
                            <td>{row.objective ? `${row.objective} ? ` : ''}{row.activity}</td>
                            <td>{row.deliverable || '?'}</td>
                            <td>{row.kpi || '?'}</td>
                            <td>
                              {/* STEP 44B.53D.3 - Per-plan custom values */}
                              <SprintMonthlyInlineFields
                                template={plan.sprint_template_snapshot || null}
                                row={row}
                              />
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mws-approval">
                  <strong>Approval History</strong>
                  {(item.approval_history || []).length === 0
                    ? <p>No actions yet.</p>
                    : item.approval_history.map((entry, index) => (
                        <p key={index}>
                          {entry.action} ? {entry.at
                            ? new Date(entry.at).toLocaleString()
                            : 'Date unavailable'}
                          {entry.remarks ? ` ? ${entry.remarks}` : ''}
                        </p>
                      ))}
                </div>
              </div>
            )}

            {item.can_review && (
              <div className="mws-approval">
                <strong>Reporting Officer Review</strong>
                <textarea
                  style={{
                    width: '100%', marginTop: 10, minHeight: 65,
                    padding: 10, border: '1px solid #dce2ef',
                    borderRadius: 8, boxSizing: 'border-box'
                  }}
                  value={remarks[id] || ''}
                  onChange={event => setRemarks(previous => ({
                    ...previous, [id]: event.target.value
                  }))}
                  placeholder="Approval remarks or reason for rejection"
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button type="button" disabled={busy}
                    className="mws-button mws-primary"
                    onClick={() => review(item, 'approved')}>
                    <CheckCircle2 size={14}/> Approve
                  </button>
                  <button type="button" disabled={busy}
                    className="mws-button"
                    onClick={() => review(item, 'rejected')}>
                    <XCircle size={14}/> Reject
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
