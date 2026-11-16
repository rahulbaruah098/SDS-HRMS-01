import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, FolderKanban, History, Info, Loader2, RefreshCw, ShieldCheck, UserRoundCheck, Users, AlertTriangle, ChevronRight } from 'lucide-react';
import { api, getActiveEmployees, getAlumniEmployees } from '../api/client';
import './employee-handover.css';

const AVAILABLE = new Set(['primary_assignment', 'assigned_membership', 'collaborator_membership']);
const getId = e => String(e?._id || e?.id || '');
const display = e => e?.name || e?.employee_name || e?.full_name || e?.employee_code || getId(e);
const errorText = error => error?.message || 'An unexpected error occurred.';
const keyFor = item => `${item.record_id}:${item.kind}`;
const REVIEW_GUIDANCE = {
  team_leader: 'Review reporting teams under Employee Management before assigning a new Team Leader.',
  reporting_officer: 'Update Reporting Officer relationships through the authorized employee workflow.',
  sprint: 'Keep existing sprint ownership and approvals. Assign new work in Sprint Planning.',
  approval: 'Pending approvals must be reassigned in their original approval workflow.',
};
const CATEGORY_LABEL = { eligible: 'Eligible', manual_review: 'Manual review', excluded: 'Excluded' };

export default function EmployeeHandover({ setPage }) {
  const [active, setActive] = useState([]);
  const [alumni, setAlumni] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [departingId, setDepartingId] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPartial, setHistoryPartial] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [advanced, setAdvanced] = useState(null);
  const [advancedSelected, setAdvancedSelected] = useState([]);
  const [approvalSelected, setApprovalSelected] = useState([]);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [advancedError, setAdvancedError] = useState('');
  const [advancedResult, setAdvancedResult] = useState(null);
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewedKeys, setReviewedKeys] = useState([]);
  const advancedKey = item => `${item.kind}:${item.record_id}`;
  const loadAdvanced = async (source, target) => {
    setAdvancedBusy(true); setAdvancedError(''); setAdvanced(null); setAdvancedSelected([]); setApprovalSelected([]);
    try {
      const result = await api('/employee-handover/advanced/preview', {
        method:'POST', body:JSON.stringify({departing_employee_id: source, replacement_employee_id:target})
      });
      setAdvanced(result);
    } catch (e) { setAdvancedError(errorText(e)); }
    finally { setAdvancedBusy(false); }
  };
  const executeAdvanced = async () => {
    if (advanced?.is_partial || !advancedSelected.length) return;
    if (!window.confirm(`Confirm ${advancedSelected.length} active leadership assignment change(s)? This updates current relationships and writes audit history.`)) return;
    setAdvancedBusy(true); setAdvancedError('');
    try {
      const result = await api('/employee-handover/advanced/execute', {method:'POST', body:JSON.stringify({
        departing_employee_id:departingId, replacement_employee_id:replacementId,
        confirmation:'TRANSFER', items:(advanced?.items || []).filter(i => advancedSelected.includes(advancedKey(i)))
          .map(i=>({kind:i.kind,record_id:i.record_id}))
      })});
      setAdvancedResult(result); setAdvancedSelected([]);
      await loadAdvanced(departingId,replacementId); await loadHistory(historyFilter);
    } catch(e) {setAdvancedError(errorText(e));} finally {setAdvancedBusy(false);}
  };
  const transferApprovals = async () => {
    if (advanced?.is_partial || !approvalSelected.length || advancedBusy) return;
    if (!window.confirm(`Reassign ${approvalSelected.length} pending approval(s) to the replacement? Original sprint ownership and past decisions are preserved.`)) return;
    setAdvancedBusy(true); setAdvancedError('');
    try {
      const data = await api('/employee-handover/advanced/approval-reassign', {method:'POST', body:JSON.stringify({
        departing_employee_id:departingId, replacement_employee_id:replacementId,
        confirmation:'TRANSFER', items:(advanced?.items || []).filter(i=>approvalSelected.includes(advancedKey(i)))
          .map(i=>({kind:i.kind,record_id:i.record_id}))
      })});
      setAdvancedResult(data); setApprovalSelected([]);
      await loadAdvanced(departingId,replacementId); await loadHistory(historyFilter);
    } catch(e) {setAdvancedError(errorText(e));} finally {setAdvancedBusy(false);}
  };
  const recordReview = async item => {
    const key=advancedKey(item);
    const note=String(reviewNotes[key] || '').trim();
    if (note.length<5) {setAdvancedError('Enter a review note of at least five characters.');return;}
    if (!window.confirm('Record that you reviewed this sprint item? This does NOT reassign or approve the sprint.'))return;
    setAdvancedBusy(true);setAdvancedError('');
    try {
      await api('/employee-handover/advanced/review',{method:'POST',body:JSON.stringify({
        departing_employee_id:departingId,replacement_employee_id:replacementId,
        kind:item.kind,record_id:item.record_id,note,confirmation:'REVIEWED'
      })});
      setReviewedKeys(old=>[...old,key]);
    } catch(e){setAdvancedError(errorText(e));}finally{setAdvancedBusy(false);}
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([getActiveEmployees({ limit: 500 }), getAlumniEmployees({ limit: 500 })])
      .then(([a, b]) => { if (mounted) { setActive(a.items || []); setAlumni(b.items || []); } })
      .catch(e => { if (mounted) setError(errorText(e)); })
      .finally(() => { if (mounted) setLoadingEmployees(false); });
    return () => { mounted = false; };
  }, []);

  const loadHistory = async (filter = historyFilter) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const query = filter === 'selected' && departingId ? `?departing_employee_id=${encodeURIComponent(departingId)}` : '';
      const data = await api(`/employee-handover/history${query}`);
      setHistoryItems(Array.isArray(data.items) ? data.items : []);
      setHistoryPartial(Boolean(data.is_partial));
    } catch (e) { setHistoryError(errorText(e)); }
    finally { setHistoryLoading(false); }
  };
  useEffect(() => { loadHistory('all'); }, []);
  const departingOptions = useMemo(() => {
    const map = new Map();
    [...alumni, ...active.filter(e => ['resigned', 'left', 'terminated', 'retired'].includes(String(e.employment_status || e.status || '').toLowerCase()) || e.notice_status)]
      .forEach(e => map.set(getId(e), e));
    return [...map.values()].filter(e => getId(e));
  }, [active, alumni]);
  const candidates = useMemo(() => (preview?.items || []).filter(x => x.category === 'project' && x.classification === 'eligible' && AVAILABLE.has(x.kind)), [preview]);
  const allItems = preview?.items || [];
  const noItems = preview && allItems.length === 0 && !preview.is_partial;
  const departingName = display(departingOptions.find(e => getId(e) === departingId) || { employee_name: 'This employee' });
  const replacementName = display(active.find(e => getId(e) === replacementId) || { employee_name: 'the selected replacement' });
  const clear = () => { setAdvanced(null); setAdvancedSelected([]); setApprovalSelected([]); setAdvancedResult(null); setAdvancedError(''); setReviewedKeys([]); setPreview(null); setSelected([]); setResults(null); setConfirm(''); setNotice(''); setError(''); };

  const refresh = async () => {
    clear();
    if (!departingId || !replacementId) { setError('Select both employees to generate a preview.'); return; }
    setPending(true);
    try {
      const data = await api('/employee-handover/preview', { method: 'POST', body: JSON.stringify({ departing_employee_id: departingId, replacement_employee_id: replacementId }) });
      setPreview(data);
      await loadAdvanced(departingId, replacementId);
      setNotice('Preview ready. No responsibilities have been transferred.');
    } catch (e) { setError(errorText(e)); }
    finally { setPending(false); }
  };
  const transfer = async () => {
    if (confirm !== 'TRANSFER') { setError('Type TRANSFER to confirm.'); return; }
    if (!selected.length) return;
    if (!window.confirm(`Transfer ${selected.length} selected responsibility item(s)? This changes live project assignments.`)) return;
    setPending(true); setError(''); setNotice('');
    try {
      const items = candidates.filter(x => selected.includes(keyFor(x))).map(x => ({ record_id: x.record_id, kind: x.kind }));
      const response = await api('/employee-handover/execute', { method: 'POST', body: JSON.stringify({ departing_employee_id: departingId, replacement_employee_id: replacementId, confirmation: 'TRANSFER', items }) });
      setResults(response); setPreview(null); setSelected([]); setConfirm('');
      setNotice(`Transfer processed: ${response.transferred || 0} of ${response.requested || items.length} responsibility items. Review the report before retrying.`);
      loadHistory(historyFilter);
    } catch (e) { setError(errorText(e)); }
    finally { setPending(false); }
  };
  const toggle = item => { const id = keyFor(item); setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]); };
  const selectAll = () => setSelected(candidates.map(keyFor));

  return <main className="yc-handover">
    <header className="yc-handover-header">
      <div className="yc-handover-title-wrap">
        <div className="yc-handover-breadcrumb">Employee Management <ChevronRight size={13} aria-hidden="true" /> <span>Work handover</span></div>
        <h1>Employee replacement &amp; work handover</h1>
        <p>Review ongoing responsibilities, identify pending work, and safely transfer eligible project assignments. Historical employee records remain unchanged.</p>
      </div>
      <button type="button" className="yc-handover-button yc-handover-outline yc-handover-back" onClick={() => setPage('employees')}><ArrowLeft size={17} aria-hidden="true" /> Back to Employees</button>
    </header>

    <div className="yc-handover-steps" aria-label="Handover process">
      <div className="yc-handover-step"><span className="yc-handover-step-icon"><Users size={19} /></span><span><strong>01 · Select</strong><small>Choose employees</small></span></div>
      <ChevronRight className="yc-handover-step-chevron" size={18} aria-hidden="true" />
      <div className="yc-handover-step"><span className="yc-handover-step-icon"><FolderKanban size={19} /></span><span><strong>02 · Review</strong><small>Check responsibilities</small></span></div>
      <ChevronRight className="yc-handover-step-chevron" size={18} aria-hidden="true" />
      <div className="yc-handover-step"><span className="yc-handover-step-icon"><ShieldCheck size={19} /></span><span><strong>03 · Confirm</strong><small>Transfer eligible work</small></span></div>
    </div>

    <section className="yc-handover-panel" aria-labelledby="yc-select-title">
      <div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><Users size={19} /></span><div><h2 id="yc-select-title">Choose employees</h2><p>Select the departing employee and the person taking over their responsibilities.</p></div></div>
      <div className="yc-handover-controls">
        <label className="yc-handover-field"><span>Departing employee</span><select value={departingId} disabled={pending || loadingEmployees} onChange={e => { setDepartingId(e.target.value); clear(); }}><option value="">Select a departing employee</option>{departingOptions.map(e => <option key={getId(e)} value={getId(e)}>{display(e)}</option>)}</select></label>
        <label className="yc-handover-field"><span>Replacement employee</span><select value={replacementId} disabled={pending || loadingEmployees} onChange={e => { setReplacementId(e.target.value); clear(); }}><option value="">Select an active employee</option>{active.filter(e => getId(e) !== departingId).map(e => <option key={getId(e)} value={getId(e)}>{display(e)}</option>)}</select></label>
      </div>
      <div className="yc-handover-panel-footer"><span className="yc-handover-helper"><ShieldCheck size={16} aria-hidden="true" /> Previewing never changes employee records.</span><button className="yc-handover-button yc-handover-primary" type="button" disabled={pending || loadingEmployees || !departingId || !replacementId} onClick={refresh}>{pending ? <Loader2 size={17} className="yc-handover-spin" /> : <RefreshCw size={17} />} {pending ? 'Generating preview…' : preview ? 'Refresh preview' : 'Generate handover preview'}</button></div>
    </section>

    {error && <div role="alert" className="yc-handover-message yc-handover-error"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>}
    {notice && <div role="status" className="yc-handover-message yc-handover-success"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span></div>}

    {preview && <>
      <div className="yc-handover-stats" aria-label="Preview summary">
        {['eligible', 'manual_review', 'excluded'].map((k, i) => <div key={k} className={`yc-handover-stat yc-handover-stat-${i}`}><span>{CATEGORY_LABEL[k]}</span><strong>{preview.summary?.[k] ?? 0}</strong><small>{i === 0 ? 'Available for review' : i === 1 ? 'Requires separate action' : 'Not transferable'}</small></div>)}
      </div>
      {preview.is_partial && <div role="alert" className="yc-handover-message yc-handover-warning"><AlertTriangle size={19} /><span>Some collections exceeded preview limits. These are partial results; do not treat this as a complete handover.</span></div>}

      <section className="yc-handover-panel" aria-labelledby="yc-review-title">
        <div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><ClipboardCheck size={19} /></span><div><h2 id="yc-review-title">Review responsibilities</h2><p>Only eligible project assignments can be selected. Team Leader, Reporting Officer, Sprint Planning and pending approval responsibilities stay in their original modules for authorized review.</p></div></div>
        {noItems ? <div className="yc-handover-empty"><div className="yc-handover-empty-icon"><CheckCircle2 size={27} aria-hidden="true" /></div><h3>No pending responsibilities found</h3><p>There are no currently identified project or workflow responsibilities to transfer for <strong>{departingName}</strong>.</p><p>If you already reassigned projects to <strong>{replacementName}</strong>, this is expected. The preview shows current outstanding work, not past transfers.</p><div className="yc-handover-empty-note"><History size={17} aria-hidden="true" /><span>Scroll to Transfer history below to see handovers recorded here. Older Project Management reassignments may be stored separately.</span></div></div> : <>
          {!!candidates.length && <div className="yc-handover-item-toolbar"><span>{selected.length} of {candidates.length} eligible items selected</span><button type="button" className="yc-handover-text-button" disabled={pending || preview.is_partial} onClick={selected.length === candidates.length ? () => setSelected([]) : selectAll}>{selected.length === candidates.length ? 'Clear selection' : 'Select all eligible'}</button></div>}
          <div className="yc-handover-items">{allItems.map((item, index) => { const eligible = candidates.includes(item); return <label key={`${keyFor(item)}:${index}`} className={`yc-handover-item ${eligible ? 'yc-handover-item-eligible' : ''}`}><input type="checkbox" aria-label={`Select ${item.title || item.kind || 'responsibility'}`} disabled={!eligible || pending || preview.is_partial} checked={selected.includes(keyFor(item))} onChange={() => toggle(item)} /><div className="yc-handover-item-content"><div className="yc-handover-item-heading"><strong>{item.title || `${item.category || 'Responsibility'} · ${item.record_id || ''}`}</strong><span className={`yc-handover-pill yc-${item.classification}`}>{CATEGORY_LABEL[item.classification] || String(item.classification || 'Review').replaceAll('_', ' ')}</span></div><p>{String(item.kind || '').replaceAll('_', ' ')}{item.reason ? ` · ${item.reason}` : ''}</p>{item.classification === 'manual_review' && <p className="yc-handover-review-hint">{/team_leader|team leader/i.test(item.kind || '') ? REVIEW_GUIDANCE.team_leader : /reporting_officer|reporting officer/i.test(item.kind || '') ? REVIEW_GUIDANCE.reporting_officer : /sprint|weekly|monthly/i.test(`${item.kind || ''} ${item.category || ''}`) ? REVIEW_GUIDANCE.sprint : /approval|approver/i.test(`${item.kind || ''} ${item.category || ''}`) ? REVIEW_GUIDANCE.approval : 'Open the original module to review this responsibility. Historical records will not be rewritten.'}</p>}</div></label>; })}</div>
        </>}
      </section>
      {candidates.length > 0 && !preview.is_partial && <section className="yc-handover-panel yc-handover-confirm" aria-labelledby="yc-confirm-title"><div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><ShieldCheck size={19} /></span><div><h2 id="yc-confirm-title">Confirm selected transfer</h2><p>{selected.length} item(s) selected. Each assignment will be rechecked before execution; changes cannot be undone automatically.</p></div></div><div className="yc-handover-confirm-grid"><label className="yc-handover-field"><span>Type TRANSFER to confirm</span><input type="text" value={confirm} disabled={pending || selected.length === 0} onChange={e => setConfirm(e.target.value)} autoComplete="off" placeholder="TRANSFER" /></label><button type="button" className="yc-handover-button yc-handover-danger" disabled={pending || confirm !== 'TRANSFER' || selected.length === 0} onClick={transfer}>{pending ? <Loader2 size={17} className="yc-handover-spin" /> : <ArrowRight size={17} />} Confirm selected handover</button></div><p className="yc-handover-guard"><Info size={15} /> Only approved project responsibilities will be changed. Personal and historical data are not transferred.</p></section>}
    </>}

    {advancedError && <div role="alert" className="yc-handover-message yc-handover-error">{advancedError}</div>}
    {advancedBusy && <p className="yc-handover-history-muted" role="status">Checking additional handover responsibilities…</p>}
    {advanced && <section className="yc-handover-panel" aria-labelledby="yc-advanced-title">
      <div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><ShieldCheck size={19}/></span><div>
        <h2 id="yc-advanced-title">Leadership and sprint handover</h2>
        <p>Review active Team Leader, Reporting Officer and Sprint Planning responsibilities. Verified leadership assignments and pinned pending approvals can be reassigned here. Sprint ownership and completed decisions remain unchanged.</p>
      </div></div>
      {advanced.is_partial && <p role="alert" className="yc-handover-message yc-handover-warning">Results are incomplete because the company has too many records. Transfers here are disabled until fully reviewed.</p>}
      {advancedResult && <p className="yc-handover-message yc-handover-success">Processed {advancedResult.transferred || 0} of {advancedResult.requested || 0} leadership changes. Review transfer history for completed changes.</p>}
      {!advanced.items?.length ? <p className="yc-handover-history-muted">No additional active reporting or sprint responsibilities found.</p> : <>
        <div className="yc-handover-advanced-list">{advanced.items.map(item => {
          const key=advancedKey(item), eligible=item.classification==='eligible';
          const sprint=item.category==='sprint';
          const approval=item.category==='pending_approval';
          return <article className="yc-handover-advanced-item" key={key}>
            <div className="yc-handover-advanced-heading"><strong>{item.title || 'Responsibility'}</strong>
              <span className={`yc-handover-pill yc-${item.classification}`}>{eligible?'Can transfer':sprint?'Sprint review':approval?'Approval review':'Manual review'}</span>
            </div>
            <p className="yc-handover-advanced-kind">{String(item.kind).replaceAll('_',' ')} · {item.reason}</p>
            {eligible && !approval && <label className="yc-handover-advanced-check"><input type="checkbox" disabled={advancedBusy || advanced.is_partial}
              checked={advancedSelected.includes(key)} onChange={e=>setAdvancedSelected(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/>
              Include in confirmed leadership transfer</label>}
            {approval && eligible && <label className="yc-handover-advanced-check"><input type="checkbox" disabled={advancedBusy || advanced.is_partial}
              checked={approvalSelected.includes(key)} onChange={e=>setApprovalSelected(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/>
              Reassign this pending approval only (not sprint ownership)</label>}
            {sprint && <div className="yc-handover-review-control"><label className="yc-handover-field"><span>Review notes (required)</span>
              <textarea value={reviewNotes[key] || ''} onChange={e=>setReviewNotes(old=>({...old,[key]:e.target.value}))}
                maxLength={500} rows={2} placeholder="What did HR review, and what remains to be done in Sprint Planning?"/></label>
              <button type="button" className="yc-handover-button yc-handover-outline" disabled={advancedBusy || reviewedKeys.includes(key)} onClick={()=>recordReview(item)}>
                {reviewedKeys.includes(key)?'Review recorded':'Record review only'}</button>
              <small>A review note does not change the sprint owner, author or approver. Complete the actual action in Sprint Planning.</small></div>}
          </article>;
        })}</div>
        {approvalSelected.length>0 && !advanced.is_partial && <div className="yc-handover-advanced-footer">
          <span>{approvalSelected.length} pending approval(s) selected — original plans stay with their owners</span>
          <button type="button" className="yc-handover-button yc-handover-danger" disabled={advancedBusy} onClick={transferApprovals}>Confirm pending approval reassignment</button>
        </div>}
        {advancedSelected.length>0 && !advanced.is_partial && <div className="yc-handover-advanced-footer">
          <span>{advancedSelected.length} verified leadership relationship(s) selected</span>
          <button type="button" className="yc-handover-button yc-handover-danger" disabled={advancedBusy} onClick={executeAdvanced}>
            Confirm leadership handover</button></div>}
      </>}
    </section>}

    {results && <section className="yc-handover-panel" aria-labelledby="yc-report-title"><div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><UserRoundCheck size={19} /></span><div><h2 id="yc-report-title">Handover result</h2><p>Transferred {results.transferred || 0} of {results.requested || 0} requested items. Review each item before trying again.</p></div></div>{(results.results || []).map((r, i) => <div key={i} className="yc-handover-report"><strong>{String(r.kind || 'Responsibility').replaceAll('_', ' ')} · {r.status || 'unknown'}</strong><span>{r.reason || r.record_id}</span></div>)}<button type="button" className="yc-handover-button yc-handover-outline yc-handover-report-refresh" onClick={refresh}><RefreshCw size={16} /> Generate fresh preview</button></section>}
    <section className="yc-handover-panel" aria-labelledby="yc-history-title">
      <div className="yc-handover-history-head">
        <div className="yc-handover-panel-title"><span className="yc-handover-section-icon"><History size={19} /></span><div><h2 id="yc-history-title">Transfer history</h2><p>Successful handovers recorded by YourComate. Earlier manual project reassignments may be stored separately.</p></div></div>
        <div className="yc-handover-history-actions">
          <select aria-label="Filter transfer history" value={historyFilter} onChange={e => { const next = e.target.value; setHistoryFilter(next); loadHistory(next); }}>
            <option value="all">All handovers</option>
            <option value="selected" disabled={!departingId}>Selected departing employee</option>
          </select>
          <button type="button" className="yc-handover-button yc-handover-outline" disabled={historyLoading} onClick={() => loadHistory(historyFilter)}><RefreshCw size={16} className={historyLoading ? 'yc-handover-spin' : ''} /> Refresh</button>
        </div>
      </div>
      {historyError && <p role="alert" className="yc-handover-message yc-handover-error">{historyError}</p>}
      {historyLoading ? <p className="yc-handover-history-muted">Loading transfer history…</p> : historyItems.length ? <div className="yc-handover-history-list">
        {historyItems.map(item => <article className="yc-handover-history-row" key={item.id}>
          <div className="yc-handover-history-row-main"><strong>{item.project_name || 'Project'}</strong><span className="yc-handover-pill yc-eligible">Transferred</span></div>
          <p><strong>{item.departing_employee_name || item.departing_employee_id}</strong> <ArrowRight size={14} aria-hidden="true" /> <strong>{item.replacement_employee_name || item.replacement_employee_id}</strong></p>
          <div className="yc-handover-history-meta"><span>{String(item.kind || 'Assignment').replaceAll('_', ' ')}</span><span>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Date unavailable'}</span><span title={item.performed_by_id ? `Audit user ID: ${item.performed_by_id}` : ''}>Authorized by: {item.performed_by_name || (item.performed_by_id ? 'User name unavailable' : 'Not recorded')}</span></div>
        </article>)}
      </div> : !historyError && <div className="yc-handover-empty"><div className="yc-handover-empty-icon"><History size={24} /></div><h3>No recorded handover transfers</h3><p>Transfers completed through this Handover feature will appear here. Projects reassigned earlier through Project Management are not automatically included.</p></div>}
      {historyPartial && <p className="yc-handover-history-muted">Showing the latest 100 recorded transfers. This is not the complete history.</p>}
    </section>
  </main>;
}
