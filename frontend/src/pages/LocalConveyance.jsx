import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck, CheckCircle2, ChevronRight, Download, Edit3, FileText,
  Loader2, MapPin, ReceiptText, RefreshCcw, Search, Send, ShieldCheck,
  Wallet, XCircle, AlertCircle, Users, X, CalendarDays,
} from 'lucide-react';
import {
  actionLocalConveyanceBill, correctLocalConveyanceBill,
  downloadLocalConveyancePdf, generateLocalConveyanceBills,
  getLocalConveyanceBill, getLocalConveyanceSettings,
  listLocalConveyanceBills, updateLocalConveyanceSettings,
} from '../api/client';

// This page shares the colour, typography, spacing and card patterns of My Visit.
// All validation and payment permissions come from the backend capabilities object.
const statusName = {
  draft: 'Draft — Awaiting Submission',
  pending_verification: 'Legacy Draft — Awaiting Submission',
  pending_manager: 'Team Leader / Reporting Officer Pending',
  pending_accounts: 'Accounts Verification Pending',
  verified: 'Accounts Verified — Awaiting Payment',
  paid: 'Paid',
  rejected: 'Rejected — Correction Required',
  hr_verified: 'Legacy HR Verified',
  accounts_verified: 'Legacy Accounts Verified',
};
const modeName = {
  own_two_wheeler: 'Two Wheeler', own_four_wheeler: 'Four Wheeler',
  public_transport: 'Public Transport', mixed: 'Combined Monthly Claim',
};
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;
const inputStyle = { width: '100%', minHeight: 44, border: '1px solid #bcc9e2',
  borderRadius: 12, padding: '10px 12px', boxSizing: 'border-box', fontSize: 14,
  color: '#101a3a', background: '#fff', fontFamily: 'inherit' };
const roleSet = (user) => new Set([user.role, ...(Array.isArray(user.roles) ? user.roles : [])]
  .map((value) => String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')));
const enabledFlag = (value) => value === true || value === 1 || ['true', 'yes', '1'].includes(String(value || '').toLowerCase());
const errorText = (error) => error?.message || 'Unable to complete the Local Conveyance request.';
const tone = (status) => ({ paid: 'paid', verified: 'approved', rejected: 'rejected',
  pending_accounts: 'pending', pending_manager: 'pending', draft: 'draft' })[status] || 'draft';
function StatusPill({ status, direct = false }) {
  const label = direct && status === 'pending_accounts' ? 'Accounts Manager Verification Pending' : (statusName[status] || status);
  return <span className={`lc-status lc-status--${tone(status)}`}>{label}</span>;
}
function Steps({ bill }) {
  const direct = bill.approval?.type === 'direct_accounts_manager';
  const history = bill.verification_history || [];
  const submitted = history.some((item) => item.stage === 'submitted') ||
    ['pending_manager', 'pending_accounts', 'verified', 'paid'].includes(bill.status);
  const phases = [
    { label: 'Employee Submission', completed: submitted, detail: 'Monthly bill submitted for approval' },
    { label: direct ? 'TL / RO Review — Not Required' : bill.approval?.type === 'team_leader' ? 'Team Leader Validation' :
      bill.approval?.type === 'reporting_officer' ? 'Reporting Officer Validation' : 'TL / RO Validation',
    completed: Boolean(bill.manager_validation), skipped: direct,
    detail: direct ? 'Skipped for an eligible senior employee without a reporting line' : 'Assigned reviewer checks the claim' },
    { label: direct ? 'Accounts Manager Verification' : 'Accounts Verification', completed: Boolean(bill.accounts_verification),
      detail: direct ? 'Finance / Accounts Manager reviews the claim' : 'Accounts checks the approved claim' },
    { label: 'Payment Confirmation', completed: bill.status === 'paid',
      detail: 'Accounts Manager confirms actual payment' },
  ];
  return <div className="lc-progress" aria-label="Local Conveyance approval progress">
    {phases.map((phase, index) => <div className="lc-step" key={phase.label}>
      <span className={`lc-step__icon ${phase.completed ? 'is-done' : ''}`}>
        {phase.completed ? <CheckCircle2 size={19}/> : <span>{index + 1}</span>}
      </span>
      <div className="lc-step__copy"><strong>{phase.label}</strong>
        <small>{phase.skipped ? phase.detail : phase.completed ? 'Completed' : phase.detail}</small></div>
    </div>)}
    {bill.status === 'rejected' ? <div className="lc-alert lc-alert--error" role="alert">
      <AlertCircle size={19}/><div><strong>Rejected by {bill.rejected_stage === 'pending_manager'
        ? (bill.approval?.name || 'your manager') : 'Accounts'}</strong>
        <p>{bill.rejection_reason || 'Review comments and correct your claim.'}</p>
        <small>The employee can correct and resubmit this rejected claim.</small></div>
    </div> : null}
    {bill.status === 'paid' ? <div className="lc-alert lc-alert--success" role="status">
      <CheckCircle2 size={20}/><span>Paid {bill.paid_at ? new Date(bill.paid_at).toLocaleDateString('en-IN') : ''}
        {bill.payment_reference ? ` · ${bill.payment_reference}` : ''}</span>
    </div> : null}
  </div>;
}

export default function LocalConveyance({ user = {}, manage = false, setPage: navigatePage }) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rates, setRates] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const closeButtonRef = useRef(null);
  const modalRef = useRef(null);
  const busyRef = useRef('');
  busyRef.current = busy;
  const roles = roleSet(user);
  const canHr = ['admin', 'hr', 'hr_admin', 'hr_manager'].some((role) => roles.has(role));
  const canReview = [...roles].some((role) => [
    'accounts', 'accountant', 'accounts_finance', 'finance', 'accounts_manager', 'finance_manager',
    'hr', 'admin', 'hr_admin', 'hr_manager', 'team_leader', 'reporting_officer', 'ro', 'manager',
  ].includes(role)) || [user?.is_team_leader, user?.is_reporting_officer,
    user?.employee?.is_team_leader, user?.employee?.is_reporting_officer].some(enabledFlag);
  const stats = useMemo(() => ({
    total: bills.length,
    pending: bills.filter((bill) => ['pending_manager', 'pending_accounts'].includes(bill.status)).length,
    verified: bills.filter((bill) => bill.status === 'verified').length,
    paid: bills.filter((bill) => bill.status === 'paid').length,
  }), [bills]);

  // Keep details on top of the app, preserve the previous keyboard focus and
  // prevent background scrolling. Escape/Tab work on desktop and mobile keyboards.
  useEffect(() => {
    if (!selected) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) {
          setSelected(null);
          setEditing(false);
          setRemarks('');
        }
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const candidates = [...modalRef.current.querySelectorAll(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
      )].filter((node) => node.getClientRects().length > 0);
      if (!candidates.length) { event.preventDefault(); return; }
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, [selected?.reference]);

  function closeDetails() {
    if (busyRef.current) return;
    setSelected(null);
    setEditing(false);
    setRemarks('');
  }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLocalConveyanceBills(manage ? { scope: 'all', year, month } : { year, month });
      setBills(data.items || []);
      setError('');
    } catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  }, [manage, year, month]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { getLocalConveyanceSettings().then(setRates).catch(() => {}); }, []);

  async function generate() {
    setBusy('generate'); setError(''); setMessage('');
    try {
      const data = await generateLocalConveyanceBills(year, month);
      setMessage(data.message || 'Monthly claim is ready for review. Submit it when the details are correct.');
      await reload();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function openBill(ref) {
    setBusy('open'); setSelected(null); setEditing(false); setError('');
    setRemarks('');
    try {
      const data = await getLocalConveyanceBill(ref);
      setSelected(data.item); setReference(ref);
      setDraftLines((data.item?.lines || []).map((line) => ({ ...line })));
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function lookup(event) {
    event.preventDefault();
    if (reference.trim()) await openBill(reference.trim());
  }
  async function act(action) {
    if (!selected || busy) return;
    if (action === 'reject' && !remarks.trim()) return;
    setBusy(action); setError(''); setMessage('');
    try {
      const data = await actionLocalConveyanceBill(selected.reference, action, action === 'mark_paid' ? '' : remarks);
      setSelected(data.item); setEditing(false); setRemarks('');
      setMessage(action === 'mark_paid' ? 'Payment confirmation recorded. The claim now shows Paid.' :
        action === 'accounts_verify' ? 'Claim verified by Accounts. Payment confirmation is still required.' :
        action === 'manager_validate' ? 'Validated and forwarded to Accounts.' :
        action === 'submit' ? (data.item?.approval?.type === 'direct_accounts_manager'
          ? 'Submitted directly to Finance / Accounts Manager for verification.'
          : 'Submitted to your mapped Team Leader / Reporting Officer.') : 'Claim status updated.');
      await reload();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function saveCorrection() {
    if (!selected || busy) return;
    setBusy('correction'); setError(''); setMessage('');
    try {
      const data = await correctLocalConveyanceBill(selected.reference, draftLines);
      setSelected(data.item); setDraftLines((data.item?.lines || []).map((line) => ({ ...line })));
      setEditing(false); setMessage('Corrections saved. Submit the claim again for validation.');
      await reload();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function pdf(ref) {
    setBusy(`pdf-${ref}`); setError('');
    try { await downloadLocalConveyancePdf(ref); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function saveRates(event) {
    event.preventDefault(); setBusy('rates'); setError(''); setMessage('');
    try {
      const data = await updateLocalConveyanceSettings(rates);
      setRates(data); setMessage('Future LC rates saved. Existing finalised journeys retain their original rates.');
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  const canCorrect = !manage && selected?.capabilities?.can_correct;
  function editRow(index, key, value) {
    setDraftLines((old) => old.map((line, position) => position === index ? { ...line, [key]: value } : line));
  }
  function quickActions(bill) {
    return <div className="lc-actions">
      <button type="button" className="lc-btn lc-btn--outline" disabled={Boolean(busy)}
        onClick={() => openBill(bill.reference)}><FileText size={16}/> Details & Progress</button>
      {manage && bill.status === 'verified' ? <button type="button" className="lc-btn lc-btn--pay"
        disabled={Boolean(busy)} onClick={() => openBill(bill.reference)}>
        <Wallet size={16}/> Payment details</button> : null}
      <button type="button" className="lc-btn lc-btn--outline" disabled={Boolean(busy)}
        onClick={() => pdf(bill.reference)}><Download size={16}/> PDF</button>
    </div>;
  }
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });

  return <>
  <main className="lc-page">
    <style>{`
      .lc-page{--lc-ink:#101a3a;--lc-muted:#5d6d8d;--lc-line:rgba(16,26,58,.13);--lc-blue:#4d77dd;--lc-teal:#2eb2b9;color:var(--lc-ink);min-width:0;width:100%;display:grid;gap:clamp(15px,2vw,24px);padding:0 0 22px;font-size:14px}
      .lc-page,.lc-page *{box-sizing:border-box}.lc-page section,.lc-page article,.lc-page form,.lc-page label{min-width:0;max-width:100%}
      .lc-hero{border:1px solid rgba(154,164,205,.58);border-radius:clamp(24px,3vw,38px);background:linear-gradient(90deg,#d3f4fb 0%,#f7fcfb 34%,#fffdf8 52%,#fbf8fa 68%,#f0edfb 100%);box-shadow:0 20px 42px rgba(70,92,140,.10);padding:clamp(22px,3vw,38px);display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,260px);align-items:center;gap:22px;overflow:hidden}
      .lc-eyebrow{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:100px;background:linear-gradient(135deg,#4d77dd,#2eb2b9);color:white;font-size:10px;text-transform:uppercase;font-weight:900;letter-spacing:.1em}
      .lc-hero h1{font-family:var(--yc-display,Georgia,'Times New Roman',serif);font-size:clamp(34px,4.5vw,64px);line-height:1.04;letter-spacing:-.045em;color:#101a3a;margin:14px 0}
      .lc-hero h1 em{color:#4d77dd;font-weight:500}.lc-hero p{color:var(--lc-muted);line-height:1.65;margin:0;max-width:720px}
      .lc-hero__actions{display:grid;gap:10px;align-content:center}
      .lc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 14px;border-radius:13px;border:1px solid transparent;background:linear-gradient(135deg,#4d77dd,#2eb2b9);color:white;font:inherit;font-size:13px;font-weight:800;cursor:pointer;text-align:center;transition:transform .15s ease,box-shadow .15s ease;max-width:100%}
      .lc-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 18px rgba(77,119,221,.15)}.lc-btn:disabled{opacity:.55;cursor:not-allowed}
      .lc-btn--outline{background:white;border-color:rgba(77,119,221,.25);color:#405fb5}.lc-btn--danger{background:#fff1f2;color:#a2344d;border-color:#f2c6cf}.lc-btn--pay{background:linear-gradient(135deg,#138459,#2eb2b9)}
      .lc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.lc-stat{border:1px solid rgba(171,181,211,.66);border-radius:21px;background:#edf6ff;box-shadow:0 12px 26px rgba(34,38,110,.06);padding:18px;min-width:0}
      .lc-stat:nth-child(2){background:#eaf8f4}.lc-stat:nth-child(3){background:#fff4d5}.lc-stat:nth-child(4){background:#f1efff}
      .lc-stat small{display:block;color:#5d6785;font-size:10px;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.lc-stat strong{display:block;color:#101a3a;font:700 clamp(28px,3vw,40px) Georgia,serif;margin-top:10px}
      .lc-panel{background:white;border:1px solid rgba(171,181,211,.7);box-shadow:0 18px 36px rgba(34,38,110,.08);border-radius:clamp(20px,2.2vw,30px);padding:clamp(16px,2vw,24px);min-width:0}
      .lc-panel__title{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px}.lc-panel h2{font:700 clamp(20px,2vw,27px) var(--yc-display,Georgia,serif);margin:0;color:#101a3a}.lc-panel h3{font:700 18px var(--yc-display,Georgia,serif);margin:0 0 12px;color:#101a3a}
      .lc-muted{color:var(--lc-muted);font-size:12px;line-height:1.55}.lc-page label{display:grid;gap:7px;font-size:13px;font-weight:750;color:#263453}
      .lc-inline{display:flex;align-items:flex-end;gap:11px;flex-wrap:wrap}.lc-inline>label{flex:0 1 auto}.lc-inline>.lc-btn{flex:0 1 auto}.lc-grow{flex:1 1 220px!important}
      .lc-alert{display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border-radius:14px;font-size:13px;line-height:1.55}.lc-alert svg{flex:none}.lc-alert p{margin:4px 0}.lc-alert--error{background:#fff2ed;border:1px solid #f8d5ca;color:#9e2b24}.lc-alert--success{background:#eaf8f0;border:1px solid #c2e8d1;color:#176a36}
      .lc-status{display:inline-flex;max-width:100%;align-items:center;padding:6px 11px;border-radius:100px;font-size:11px;line-height:1.45;font-weight:800;background:#edf3fc;color:#214c82;white-space:normal}
      .lc-status--pending{background:#fff5db;color:#8e5b0b}.lc-status--approved{background:#e8f5ff;color:#24578b}.lc-status--paid{background:#dff7e9;color:#166c40}.lc-status--rejected{background:#fff0f1;color:#ae3340}
      .lc-table-wrap{width:100%;max-width:100%;overflow-x:auto;border:1px solid #e5eaf2;border-radius:16px}.lc-table{width:100%;border-collapse:collapse;min-width:740px;font-size:13px}
      .lc-table th,.lc-table td{padding:13px 12px;border-bottom:1px solid #edf0f6;text-align:left;vertical-align:middle;overflow-wrap:anywhere}.lc-table th{background:#f5f7fb;color:#566276;font-weight:850;white-space:nowrap}.lc-table tr:last-child td{border-bottom:0}
      .lc-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.lc-actions .lc-btn{min-height:40px;padding:8px 12px}
      .lc-mobile-list{display:none}.lc-claim-card{display:grid;gap:12px;padding:16px;border:1px solid #dfe6f2;border-radius:17px;background:white;box-shadow:0 9px 20px rgba(32,55,110,.06)}
      .lc-claim-head{display:flex;align-items:start;justify-content:space-between;flex-wrap:wrap;gap:9px}.lc-claim-ref{overflow-wrap:anywhere;color:#40599a;font-weight:800;font-size:12px}.lc-claim-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;font-size:12px;color:#5d6d8d}.lc-claim-meta strong{display:block;color:#101a3a;margin-top:3px}
      .lc-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:20px 0}.lc-step{display:flex;align-items:flex-start;gap:8px;min-width:0}.lc-step__icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:50%;background:#eef0fa;color:#8d93af;font-size:12px;font-weight:900}.lc-step__icon.is-done{background:#e6f8eb;color:#12854c}.lc-step__copy strong,.lc-step__copy small{display:block}.lc-step__copy strong{font-size:12px}.lc-step__copy small{font-size:11px;color:#63718d;margin-top:4px;line-height:1.4}.lc-progress .lc-alert{grid-column:1/-1}
      .lc-editgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,195px),1fr));gap:12px;margin:14px 0}.lc-editrow{padding:16px;border-radius:16px;border:1px solid #dce4ef;margin-bottom:12px}
      .lc-divider{border:0;border-top:1px solid #e2e8f0;margin:23px 0}.lc-detail-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
      .lc-settings{margin-top:0}.lc-settings small{display:block;margin-top:10px;color:#64748b}
      .lc-modal-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:clamp(10px,3vw,30px);background:rgba(12,22,50,.66);backdrop-filter:blur(5px);overflow:hidden}
      .lc-modal-dialog{width:min(1180px,100%);max-width:100%;max-height:calc(100dvh - 24px);background:#fff;color:#101a3a;display:flex;flex-direction:column;border-radius:25px;overflow:hidden;box-shadow:0 30px 95px rgba(5,20,65,.32);border:1px solid #dae4f5;min-width:0;font-size:14px}
      .lc-modal-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:17px clamp(16px,2vw,26px);border-bottom:1px solid #e3eaf5;background:#fff;flex:none}
      .lc-modal-header h2{font:700 clamp(21px,2vw,27px) var(--yc-display,Georgia,serif);margin:0 0 4px}
      .lc-modal-header .lc-btn{min-width:105px}
      .lc-modal-body{padding:clamp(16px,2.3vw,27px);min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
      .lc-modal-body h3{font:700 18px var(--yc-display,Georgia,serif);margin:18px 0 12px}
      .lc-modal-body label{display:grid;gap:7px;font-size:13px;font-weight:750;color:#263453}
      .lc-payment-single-action{display:flex;align-items:center;margin:16px 0;gap:10px}.lc-payment-single-action .lc-btn{min-width:170px}
      .lc-modal-payment{display:grid;gap:12px;padding:clamp(14px,2vw,22px);border:1px solid #acd9bf;border-radius:18px;background:linear-gradient(120deg,#effaf3,#f6fffc);margin:18px 0}
      .lc-modal-payment h3{margin:0;display:flex;align-items:center;gap:9px;color:#17603f}
      .lc-modal-payment .lc-btn{justify-self:start;min-width:175px}
      .lc-modal-payment p{margin:0;color:#3d6655;line-height:1.6}
      .lc-modal-payment--notice{background:#f1f6ff;border-color:#d3e1f7}
      .lc-modal-payment--notice h3{color:#2b538b}
      .lc-modal-payment--notice p{color:#536987}
      .lc-modal-dialog .lc-actions{margin-top:12px}
      .lc-modal-dialog .lc-claim-meta strong{overflow-wrap:anywhere}
      .lc-modal-dialog .lc-mobile-list{max-width:100%}
      .lc-modal-dialog .lc-editgrid input,.lc-modal-dialog textarea{max-width:100%}
      .lc-modal-body .lc-divider{margin:19px 0}

      @media(max-width:1050px){.lc-hero{grid-template-columns:1fr}.lc-hero__actions{grid-template-columns:repeat(2,minmax(0,1fr))}.lc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.lc-progress{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.lc-page{gap:14px}.lc-hero{padding:20px;border-radius:24px}.lc-hero h1{font-size:clamp(31px,8vw,44px)}.lc-hero__actions{grid-template-columns:1fr}.lc-stats{gap:8px}.lc-stat{padding:13px;border-radius:16px}.lc-stat strong{font-size:27px}.lc-panel{padding:15px;border-radius:20px}.lc-table-wrap.lc-claims-desktop,.lc-table-wrap.lc-details-desktop{display:none}.lc-mobile-list{display:grid;gap:11px}.lc-inline>label,.lc-inline>.lc-btn{flex:1 1 100%;width:100%}.lc-progress{grid-template-columns:1fr;gap:15px}.lc-step{padding-left:2px}.lc-actions{width:100%}.lc-actions .lc-btn{flex:1 1 125px}.lc-btn{min-height:46px}.lc-claim-meta{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.lc-modal-overlay{padding:0;align-items:stretch}.lc-modal-dialog{width:100%;height:100dvh;max-height:100dvh;border-radius:0;border:0}.lc-modal-header{padding:14px 16px;gap:10px}.lc-modal-header .lc-btn{min-width:42px}.lc-modal-body{padding:14px 16px 38px;scrollbar-gutter:auto}.lc-modal-body .lc-mobile-list{display:grid;gap:11px}.lc-modal-body .lc-table-wrap.lc-details-desktop{display:none}.lc-modal-body .lc-progress{grid-template-columns:1fr;gap:14px}.lc-modal-body .lc-actions .lc-btn{flex:1 1 100%}.lc-modal-payment .lc-btn,.lc-payment-single-action .lc-btn{width:100%}.lc-modal-dialog .lc-claim-meta{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:385px){.lc-modal-dialog .lc-claim-meta{grid-template-columns:1fr}}
      @media(max-width:385px){.lc-stats{grid-template-columns:1fr 1fr}.lc-stat small{font-size:9px}.lc-claim-meta{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.lc-btn{transition:none!important}}
    `}</style>

    <header className="lc-hero">
      <div>
        <span className="lc-eyebrow">{manage ? <ShieldCheck size={14}/> : <ReceiptText size={14}/>} Local Conveyance Workspace</span>
        <h1>{manage ? <>Review. Verify. <em>Pay.</em></> : <>Your journeys. <em>Your claims.</em></>}</h1>
        <p>{manage ? 'Validate employee monthly bills, verify claims in Accounts and confirm payment after funds are disbursed.' :
          'Convert completed My Visit journeys into monthly SDS bills, submit them for validation and track every approval and payment.'}</p>
      </div>
      <nav className="lc-hero__actions" aria-label="Conveyance navigation">
        <button type="button" className="lc-btn lc-btn--outline" onClick={() => navigatePage?.('my_visits')}>
          <MapPin size={17}/> My Visit <ChevronRight size={16}/>
        </button>
        {manage ? <button type="button" className="lc-btn lc-btn--outline" onClick={() => navigatePage?.('my_local_conveyance')}>
          <ReceiptText size={17}/> My Monthly Claims <ChevronRight size={16}/></button> : null}
        {!manage && canReview ? <button type="button" className="lc-btn lc-btn--outline" onClick={() => navigatePage?.('lc_verification')}>
          <Users size={17}/> LC Approvals & Payments <ChevronRight size={16}/></button> : null}
      </nav>
    </header>

    <section className="lc-stats" aria-label="Monthly claim summary">
      <article className="lc-stat"><small>Claims in view</small><strong>{stats.total}</strong></article>
      <article className="lc-stat"><small>Under review</small><strong>{stats.pending}</strong></article>
      <article className="lc-stat"><small>Awaiting payment</small><strong>{stats.verified}</strong></article>
      <article className="lc-stat"><small>Paid claims</small><strong>{stats.paid}</strong></article>
    </section>

    {error ? <div className="lc-alert lc-alert--error" role="alert"><AlertCircle size={19}/><span>{error}</span></div> : null}
    {message ? <div className="lc-alert lc-alert--success" role="status"><CheckCircle2 size={19}/><span>{message}</span></div> : null}

    <section className="lc-panel">
      <div className="lc-panel__title">
        <div><h2>{manage ? 'Find a claim' : 'Generate monthly LC bill'}</h2>
          <p className="lc-muted">{manage ? 'Search by reference or review claims within the selected month. Verified claims are ready for the Accounts Manager to record payment.' :
            'Only completed, eligible journeys are included. Generating a claim does not submit it.'}</p></div>
        <CalendarDays size={24} color="#4d77dd"/>
      </div>
      {manage ? <form className="lc-inline" onSubmit={lookup}>
        <label className="lc-grow">LC bill reference
          <input style={inputStyle} value={reference} onChange={(event) => setReference(event.target.value)}
            placeholder="LC/SDS/2026/11/000001" required aria-label="Local Conveyance bill reference"/>
        </label>
        <button type="submit" className="lc-btn" disabled={Boolean(busy)}><Search size={17}/> Search Bill</button>
      </form> : null}
      <div className="lc-inline" style={{marginTop:manage?18:0}}>
        <label>Month
          <select style={inputStyle} value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({length:12},(_,index)=><option key={index} value={index+1}>
              {new Date(2026,index,1).toLocaleString('en-IN',{month:'long'})}</option>)}
          </select>
        </label>
        <label>Year
          <input style={inputStyle} type="number" min="2020" max="2100" value={year}
            onChange={(event) => setYear(Number(event.target.value))}/>
        </label>
        {!manage ? <button type="button" className="lc-btn" disabled={Boolean(busy)} onClick={generate}>
          {busy === 'generate' ? <Loader2 size={17}/> : <FileText size={17}/>} Generate / Check Bill
        </button> : null}
        <button type="button" className="lc-btn lc-btn--outline" disabled={Boolean(busy)||loading} onClick={reload}>
          <RefreshCcw size={17}/> Refresh</button>
      </div>
      {!manage ? <p className="lc-muted">Vehicle and public-transport journeys appear in their respective official SDS PDF sections. Submit only after reviewing all journey details.</p> : null}
    </section>

    <section className="lc-panel" aria-label={manage?'Assigned LC claims':'My monthly LC claims'}>
      <div className="lc-panel__title">
        <div><h2>{manage ? 'Validation & Accounts queue' : 'My monthly claims'}</h2>
          <p className="lc-muted">{monthName} {year} · {bills.length} claim{bills.length===1?'':'s'} {manage?'in your permitted review scope':''}</p>
        </div>
        {loading ? <Loader2 size={21} className="mv-spin" aria-label="Loading claims"/> : <FileText size={23} color="#4d77dd"/>}
      </div>
      {bills.length ? <>
        <div className="lc-table-wrap lc-claims-desktop"><table className="lc-table">
          <thead><tr><th>Reference</th><th>Month</th><th>Bill Type</th>{manage?<th>Employee</th>:null}
            <th>Amount</th><th>Approval Progress</th><th>Actions</th></tr></thead>
          <tbody>{bills.map((bill)=><tr key={bill.reference}>
            <td><strong>{bill.reference}</strong></td><td>{String(bill.month).padStart(2,'0')}/{bill.year}</td>
            <td>{modeName[bill.bill_type] || bill.bill_type}</td>
            {manage?<td>{bill.employee_name}<div className="lc-muted">{bill.employee_code}</div></td>:null}
            <td><strong>{money(bill.total)}</strong></td>
            <td><StatusPill status={bill.status} direct={bill.approval?.type === 'direct_accounts_manager'}/>{bill.status==='rejected'?<p className="lc-muted">{bill.rejection_reason}</p>:null}</td>
            <td>{quickActions(bill)}</td>
          </tr>)}</tbody></table></div>
        <div className="lc-mobile-list">{bills.map((bill)=><article className="lc-claim-card" key={bill.reference}>
          <div className="lc-claim-head"><div><span className="lc-claim-ref">{bill.reference}</span>
            <div className="lc-muted">{String(bill.month).padStart(2,'0')}/{bill.year} · {modeName[bill.bill_type] || bill.bill_type}</div></div>
            <strong>{money(bill.total)}</strong></div>
          {manage ? <div className="lc-muted"><Users size={13} style={{verticalAlign:'middle'}}/> {bill.employee_name} · {bill.employee_code}</div> : null}
          <StatusPill status={bill.status} direct={bill.approval?.type === 'direct_accounts_manager'}/>
          {bill.status==='rejected'?<p className="lc-muted" style={{color:'#a2344d',margin:0}}>{bill.rejection_reason}</p>:null}
          {quickActions(bill)}
        </article>)}</div>
      </> : <div style={{padding:'22px 0',display:'flex',alignItems:'center',gap:12,color:'#5d6d8d'}}>
        <FileText size={27}/><span>{loading ? 'Loading your claims…' :
          manage ? 'No claims for your review scope and selected period.' : 'No bills for this period. Complete My Visit and then generate a monthly bill.'}</span>
      </div>}
    </section>

    {manage && canHr && rates ? <section className="lc-panel lc-settings">
      <div className="lc-panel__title"><h2>Tenant LC Rate Settings</h2><ShieldCheck size={23} color="#4d77dd"/></div>
      <form className="lc-inline" onSubmit={saveRates}>
        <label>Two Wheeler (₹/km)<input type="number" min="0.01" step="0.01" max="1000" style={inputStyle}
          value={rates.two_wheeler_rate??4} onChange={(event)=>setRates((old)=>({...old,two_wheeler_rate:event.target.value}))}/></label>
        <label>Four Wheeler (₹/km)<input type="number" min="0.01" step="0.01" max="1000" style={inputStyle}
          value={rates.four_wheeler_rate??14} onChange={(event)=>setRates((old)=>({...old,four_wheeler_rate:event.target.value}))}/></label>
        <button className="lc-btn" type="submit" disabled={Boolean(busy)}><ShieldCheck size={16}/> Save Future Rates</button>
      </form><small>Existing finalised visits retain their recorded rates.</small>
    </section>:null}
  </main>
    {selected ? createPortal(<div className="lc-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeDetails();
    }}>
      <div className="lc-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-modal-title"
        aria-describedby="lc-modal-desc" ref={modalRef}>
        <div className="lc-modal-header">
          <div><h2 id="lc-modal-title">Bill details &amp; progress</h2>
            <div className="lc-claim-ref" id="lc-modal-desc">{selected.reference}</div></div>
          <button ref={closeButtonRef} className="lc-btn lc-btn--outline" type="button"
            disabled={Boolean(busy)} onClick={closeDetails} aria-label="Close bill details"><X size={17}/> Close</button>
        </div>
        <div className="lc-modal-body" id="lc-claim-detail">
          {error ? <div className="lc-alert lc-alert--error" role="alert"><AlertCircle size={19}/><span>{error}</span></div> : null}
          {message ? <div className="lc-alert lc-alert--success" role="status"><CheckCircle2 size={19}/><span>{message}</span></div> : null}
      <div className="lc-claim-meta" style={{marginTop:18}}>
        <div>Employee<strong>{selected.employee_name} ({selected.employee_code})</strong></div>
        <div>Designation<strong>{selected.designation || '—'}</strong></div>
        <div>Total Claim<strong>{money(selected.total)}</strong></div>
        <div>Status<strong><StatusPill status={selected.status} direct={selected.approval?.type === 'direct_accounts_manager'}/></strong></div>
      </div>
      {selected.status === 'verified' ? (
        manage ? (selected.capabilities?.can_mark_paid ?
          <div className="lc-payment-single-action">
            <button type="button" className="lc-btn lc-btn--pay"
              title="Record payment already made to the employee"
              disabled={Boolean(busy)} onClick={()=>act('mark_paid')}>
              {busy === 'mark_paid' ? <Loader2 size={17} className="spin"/> : <CheckCircle2 size={17}/>}
              {busy === 'mark_paid' ? 'Updating…' : 'Mark as Paid'}
            </button>
          </div> :
          <section className="lc-modal-payment lc-modal-payment--notice">
            <h3><ShieldCheck size={20}/> Awaiting Accounts Manager</h3>
            <p>Accounts has verified this claim. Only an authorised Accounts Manager may mark it Paid after the money has been disbursed.</p>
          </section>) :
        <section className="lc-modal-payment lc-modal-payment--notice">
          <h3><Wallet size={20}/> Awaiting payment</h3>
          <p>Your claim has been verified by Accounts. An authorised Accounts Manager will mark it Paid after the funds are disbursed. Employees cannot mark their own claims paid.</p>
        </section>
      ) : null}
      <Steps bill={selected}/>
      <h3>Included journeys</h3>
      <div className="lc-table-wrap lc-details-desktop"><table className="lc-table"><thead><tr><th>Date</th><th>Visit</th><th>From / To</th><th>Purpose / Project</th><th>Kilometres / Fare</th><th>Amount</th></tr></thead><tbody>
        {(selected.lines||[]).map((row)=><tr key={row.visit_id}><td>{row.date}</td><td>{row.title}</td>
          <td>{row.from_location} → {row.to_location}</td><td>{row.purpose}<div className="lc-muted">{row.project}</div></td>
          <td>{row.mode === 'public_transport' ? `${row.transport_other||row.transport_type}: ${money(row.fare)}` :
            `${row.vehicle_number||''} · ${row.start_km} → ${row.end_km}; ${row.distance_km} km × ${money(row.rate)}`}</td>
          <td><strong>{money(row.amount)}</strong></td></tr>)}
      </tbody></table></div>
      <div className="lc-mobile-list" aria-label="Included journeys mobile view">
        {(selected.lines||[]).map((row)=><article key={row.visit_id} className="lc-claim-card">
          <div className="lc-claim-head"><strong>{row.title||'Field Visit'}</strong><strong>{money(row.amount)}</strong></div>
          <div className="lc-muted">{row.date} · {row.project||'No project'}</div>
          <div><strong>Route:</strong> {row.from_location} → {row.to_location}</div>
          <div><strong>Purpose:</strong> {row.purpose}</div>
          <div className="lc-muted">{row.mode==='public_transport' ?
            `${row.transport_other||row.transport_type}: ${money(row.fare)}` :
            `${row.vehicle_number||''} · ${row.start_km} → ${row.end_km} · ${row.distance_km} km × ${money(row.rate)}`}</div>
        </article>)}
      </div>
      <div className="lc-actions" style={{marginTop:16}}><button type="button" className="lc-btn lc-btn--outline" disabled={Boolean(busy)} onClick={()=>pdf(selected.reference)}><Download size={16}/> Download Official SDS PDF</button></div>

      {!manage && selected.capabilities?.can_submit && !editing ? <div className="lc-actions" style={{marginTop:16}}>
        {canCorrect ? <button type="button" className="lc-btn lc-btn--outline" onClick={()=>{setDraftLines((selected.lines||[]).map((row)=>({...row})));setEditing(true);}}><Edit3 size={16}/> Edit Rejected Claim</button> : null}
        <button type="button" className="lc-btn" disabled={Boolean(busy)} onClick={()=>act('submit')}><Send size={16}/> Submit for Validation</button>
      </div> : null}
      {canCorrect && editing ? <div style={{marginTop:22}}><hr className="lc-divider"/>
        <h3>Correct rejected claim</h3><p className="lc-muted">You can correct route details, purpose, project, remarks, ending KM or fare. Start KM, rate, vehicle and original visit remain unchanged for audit.</p>
        {draftLines.map((row,index)=><article key={row.visit_id} className="lc-editrow">
          <strong>{row.date} — {row.title}</strong><div className="lc-editgrid">
            {[['from_location','From'],['to_location','To'],['purpose','Purpose'],['project','Project'],['remarks','Remarks']].map(([key,label])=><label key={key}>{label}
              <input style={inputStyle} value={row[key]??''} onChange={(event)=>editRow(index,key,event.target.value)}/></label>)}
            {row.mode==='public_transport'?<label>Fare (₹)<input style={inputStyle} type="number" min="0" step="0.01" value={row.fare??''} onChange={(event)=>editRow(index,'fare',event.target.value)}/></label>:
              <label>Ending KM (start {row.start_km})<input style={inputStyle} type="number" min={row.start_km} step="0.01" value={row.end_km??''} onChange={(event)=>editRow(index,'end_km',event.target.value)}/></label>}
          </div></article>)}
        <div className="lc-actions"><button type="button" className="lc-btn" disabled={Boolean(busy)} onClick={saveCorrection}><BadgeCheck size={16}/> Save Corrections</button>
          <button type="button" className="lc-btn lc-btn--outline" onClick={()=>setEditing(false)}>Cancel</button></div>
      </div>:null}

      {manage && selected.capabilities?.can_manager_validate ? <div><hr className="lc-divider"/><h3>Team Leader / Reporting Officer Review</h3>
        <label>Validation remarks / rejection reason<textarea style={inputStyle} rows={3} value={remarks} onChange={(event)=>setRemarks(event.target.value)}/></label>
        <div className="lc-actions" style={{marginTop:12}}>
          <button type="button" className="lc-btn" disabled={Boolean(busy)} onClick={()=>act('manager_validate')}><CheckCircle2 size={16}/> Validate & Send to Accounts</button>
          <button type="button" className="lc-btn lc-btn--danger" disabled={Boolean(busy)||!remarks.trim()} onClick={()=>act('reject')}><XCircle size={16}/> Reject With Comment</button>
        </div></div> : null}
      {manage && selected.capabilities?.can_accounts_verify ? <div><hr className="lc-divider"/><h3>Accounts Verification</h3>
        <p className="lc-muted">{selected.approval?.type === 'direct_accounts_manager'
          ? 'Direct senior-management claim: TL/RO review was not required. Finance / Accounts Manager verifies the expenses; payment is recorded separately.'
          : 'Confirm that the monthly expenses and manager validation are correct. This verification does not mean payment.'}</p>
        <label>Verification remarks / rejection reason<textarea style={inputStyle} rows={3} value={remarks} onChange={(event)=>setRemarks(event.target.value)}/></label>
        <div className="lc-actions" style={{marginTop:12}}>
          <button type="button" className="lc-btn" disabled={Boolean(busy)} onClick={()=>act('accounts_verify')}><BadgeCheck size={16}/> Verify Claim</button>
          <button type="button" className="lc-btn lc-btn--danger" disabled={Boolean(busy)||!remarks.trim()} onClick={()=>act('reject')}><XCircle size={16}/> Reject With Comment</button>
        </div></div> : null}
      {selected.verification_history?.length ? <div><hr className="lc-divider"/><h3>Validation & Revision History</h3>
        <div style={{display:'grid',gap:8}}>{selected.verification_history.map((entry,index)=><div key={index}
          style={{background:'#f6f8fc',borderRadius:12,padding:'11px 13px',fontSize:12,lineHeight:1.6}}>
          <strong>{String(entry.stage||'').replaceAll('_',' ')}</strong> · {entry.at?new Date(entry.at).toLocaleString('en-IN'):''}
          <div className="lc-muted">By: {entry.by||'—'}{entry.remarks?` · ${entry.remarks}`:''}</div>
        </div>)}</div></div>:null}
        </div>
      </div>
    </div>, document.body) : null}

  </>;
}
