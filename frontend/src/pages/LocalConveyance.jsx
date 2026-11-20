import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck, Download, FileText, Loader2, ReceiptText, RefreshCcw,
  Search, ShieldCheck, CheckCircle2, XCircle,
} from 'lucide-react';
import {
  downloadLocalConveyancePdf, generateLocalConveyanceBills,
  getLocalConveyanceBill, getLocalConveyanceSettings,
  listLocalConveyanceBills, updateLocalConveyanceSettings,
  verifyLocalConveyanceBill,
} from '../api/client';

const statusName = {
  pending_verification: 'Generated / Pending Verification',
  hr_verified: 'HR Verified',
  accounts_verified: 'Accounts Verified',
  rejected: 'Rejected / Requires Correction',
};
const modeName = {
  own_two_wheeler: 'Own Two Wheeler', own_four_wheeler: 'Own Four Wheeler',
  public_transport: 'Public Transport',
};
const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roleSet = user => new Set([user.role, ...(Array.isArray(user.roles) ? user.roles : [])]
  .map(x => String(x || '').trim().toLowerCase().replaceAll('-', '_')));
const inputStyle = { width: '100%', border: '1px solid #cbd5e1', borderRadius: 10,
  padding: '10px 12px', boxSizing: 'border-box', fontSize: 14, color: '#172033', background: '#fff' };
const actionStyle = { border: 0, borderRadius: 10, background: '#315d9a', color: 'white',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '10px 15px', gap: 7, fontWeight: 650 };
function lcError(error) { return error?.message || 'Unable to complete Local Conveyance request'; }

export default function LocalConveyance({ user = {}, manage = false }) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rates, setRates] = useState(null);
  const roles = roleSet(user);
  const canHr = ['admin', 'hr', 'hr_admin', 'hr_manager'].some(r => roles.has(r));
  const canFinance = ['admin', 'finance', 'accounts_finance'].some(r => roles.has(r));

  const reload = useCallback(async () => {
    setError('');
    try {
      const data = await listLocalConveyanceBills(manage ? { scope: 'all', year, month } : { year, month });
      setBills(data.items || []);
    } catch (e) { setError(lcError(e)); }
  }, [manage, year, month]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { getLocalConveyanceSettings().then(setRates).catch(() => {}); }, []);

  async function generate() {
    setBusy('generate'); setMessage(''); setError('');
    try {
      const data = await generateLocalConveyanceBills(year, month);
      setMessage(data.message || 'Bills created');
      await reload();
    } catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  async function lookup(event) {
    event?.preventDefault?.();
    if (!reference.trim()) return;
    setBusy('search'); setSelected(null); setError('');
    try {
      const data = await getLocalConveyanceBill(reference.trim());
      setSelected(data.item);
    } catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  async function openBill(ref) {
    setBusy('open'); setError('');
    try {
      const data = await getLocalConveyanceBill(ref);
      setSelected(data.item); setReference(ref);
    } catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  async function verify(action) {
    if (!selected) return;
    setBusy(action); setError(''); setMessage('');
    try {
      const data = await verifyLocalConveyanceBill(selected.reference, action, remarks);
      setSelected(data.item); setRemarks(''); setMessage(data.message || 'Verification saved');
      await reload();
    } catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  async function pdf(ref) {
    setBusy(`pdf-${ref}`); setError('');
    try { await downloadLocalConveyancePdf(ref); }
    catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  async function saveRates(event) {
    event.preventDefault();
    setBusy('rates'); setError(''); setMessage('');
    try {
      const data = await updateLocalConveyanceSettings({
        two_wheeler_rate: rates.two_wheeler_rate,
        four_wheeler_rate: rates.four_wheeler_rate,
      });
      setRates(data); setMessage('Rates updated. Existing visit amounts remain unchanged.');
    } catch (e) { setError(lcError(e)); }
    finally { setBusy(''); }
  }
  return (
    <main className="lc-page" style={{ padding: 'clamp(15px, 3vw, 28px)', maxWidth: 1200, margin: '0 auto', color: '#172033' }}>
      <style>{`
        .lc-panel {border:1px solid #e1e7f0; background:#fff; box-shadow:0 5px 20px #152c4710; border-radius:16px; padding:clamp(12px,2vw,22px); margin-top:18px;}
        .lc-page label {font-size:13px;font-weight:650;display:grid;gap:6px;min-width:0;}
        .lc-table-wrap {max-width:100%;overflow-x:auto;margin-top:12px;}
        .lc-table {width:100%;border-collapse:collapse;min-width:680px;font-size:13px;}
        .lc-table td,.lc-table th {padding:10px;border-bottom:1px solid #e4e9f0;text-align:left;vertical-align:top;}
        .lc-table th {color:#566276;font-weight:700;background:#f5f7fb;}
        .lc-inline {display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;}
        .lc-page button:disabled {opacity:.55;cursor:not-allowed;}
        .lc-link {border:1px solid #b2c5e1;border-radius:8px;padding:8px;background:#fff;color:#234b83;cursor:pointer;}
        .lc-status {display:inline-block;padding:5px 10px;border-radius:100px;font-size:12px;font-weight:650;background:#edf3fc;color:#214c82;}
      `}</style>
      <div style={{display:'flex',gap:13,alignItems:'center'}}>
        {manage ? <ShieldCheck size={29} /> : <ReceiptText size={29} />}
        <div><h1 style={{fontSize:'clamp(22px, 3vw, 28px)',margin:0}}>{manage ? 'Local Conveyance Verification' : 'My Local Conveyance'}</h1>
          <p style={{margin:'6px 0 0',color:'#52627b'}}>{manage ? 'Search claims by reference number and verify against original visit records.' : 'Create monthly bills from your completed My Visit journeys. Generation is not submission, verification or payment.'}</p></div>
      </div>
      {error ? <div role="alert" style={{background:'#fff1f0',color:'#a12a21',padding:13,borderRadius:10,marginTop:15}}>{error}</div> : null}
      {message ? <div role="status" style={{background:'#edf9f0',color:'#215b37',padding:13,borderRadius:10,marginTop:15}}>{message}</div> : null}
      {!manage ? <section className="lc-panel">
        <h2 style={{marginTop:0,fontSize:18}}>Generate monthly LC bills</h2>
        <div className="lc-inline">
          <label>Month<select style={inputStyle} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({length:12},(_,i) => <option key={i} value={i+1}>{new Date(2026,i,1).toLocaleString('en-IN',{month:'long'})}</option>)}
          </select></label>
          <label>Year<input style={inputStyle} type="number" min="2020" max="2100" value={year} onChange={e => setYear(Number(e.target.value))} /></label>
          <button type="button" disabled={Boolean(busy)} style={actionStyle} onClick={generate}>{busy==='generate' ? <Loader2 size={16} /> : <FileText size={16} />} Generate / Check Bills</button>
          <button type="button" className="lc-link" onClick={reload}><RefreshCcw size={16} /></button>
        </div>
        <p style={{fontSize:12,color:'#64748b'}}>Only completed, valid journeys qualify. Existing bills keep their original amounts. Any newly eligible journeys can generate supplemental bills.</p>
      </section> : null}
      {manage ? <section className="lc-panel">
        <h2 style={{fontSize:18,marginTop:0}}>Search an LC reference</h2>
        <form className="lc-inline" onSubmit={lookup}>
          <label style={{flex:'1 1 250px'}}>Enter LC Bill Reference Number<input style={inputStyle} value={reference} onChange={e => setReference(e.target.value)} placeholder="LC/SDS/2026/11/000001" required /></label>
          <button type="submit" style={actionStyle} disabled={Boolean(busy)}><Search size={17}/> Search</button>
        </form>
      </section> : null}
      <section className="lc-panel">
        <h2 style={{fontSize:18,marginTop:0}}>{manage ? 'Bills in selected period' : 'My monthly bills'}</h2>
        {manage ? <div className="lc-inline"><label>Month<input style={inputStyle} type="number" min="1" max="12" value={month} onChange={e=>setMonth(Number(e.target.value))} /></label>
          <label>Year<input style={inputStyle} type="number" min="2020" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))} /></label><button className="lc-link" onClick={reload}>Refresh</button></div> : null}
        <div className="lc-table-wrap"><table className="lc-table"><thead><tr><th>Reference</th><th>Month</th><th>Type</th>{manage?<th>Employee</th>:null}<th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{bills.length ? bills.map(b => <tr key={b.reference}>
          <td>{b.reference}</td><td>{String(b.month).padStart(2,'0')}/{b.year}</td><td>{modeName[b.bill_type] || b.bill_type}</td>
          {manage ? <td>{b.employee_name}<div>{b.employee_code}</div></td> : null}
          <td><strong>{money(b.total)}</strong></td><td><span className="lc-status">{statusName[b.status] || b.status}</span></td>
          <td><div className="lc-inline"><button type="button" className="lc-link" onClick={()=>openBill(b.reference)}>Details</button><button type="button" className="lc-link" onClick={()=>pdf(b.reference)} disabled={Boolean(busy)}><Download size={14} /> PDF</button></div></td>
        </tr>) : <tr><td colSpan={manage?7:6}>No bills for this period.</td></tr>}</tbody></table></div>
      </section>
      {selected ? <section className="lc-panel">
        <div className="lc-inline" style={{justifyContent:'space-between'}}><h2 style={{fontSize:18,margin:0}}>Bill {selected.reference}</h2><button className="lc-link" onClick={()=>setSelected(null)}>Close</button></div>
        <div className="lc-inline" style={{marginTop:12,fontSize:13}}>
          <span><strong>Employee:</strong> {selected.employee_name} ({selected.employee_code})</span>
          <span><strong>Designation:</strong> {selected.designation}</span>
          <span><strong>Status:</strong> {statusName[selected.status] || selected.status}</span>
          <span><strong>Total:</strong> {money(selected.total)}</span>
        </div>
        <div className="lc-table-wrap"><table className="lc-table"><thead><tr><th>Date</th><th>Visit</th><th>From / To</th><th>Purpose / Project</th><th>KM & Rate / Fare</th><th>Claim</th></tr></thead><tbody>
          {(selected.lines || []).map(row => <tr key={row.visit_id}><td>{row.date}</td><td>{row.title}</td><td>{row.from_location} → {row.to_location}</td>
            <td>{row.purpose}<div>{row.project}</div></td>
            <td>{row.mode === 'public_transport' ? `${row.transport_other || row.transport_type}: ${money(row.fare)}` : `${row.start_km} → ${row.end_km}; ${row.distance_km} km × ${money(row.rate)}`}</td><td>{money(row.amount)}</td></tr>)}</tbody></table></div>
        <p><button type="button" style={actionStyle} onClick={()=>pdf(selected.reference)}><Download size={16}/> Download SDS LC Bill PDF</button></p>
        {manage && selected.status !== 'rejected' && selected.status !== 'accounts_verified' ? <div style={{borderTop:'1px solid #e2e8f0',paddingTop:15}}>
          <h3 style={{fontSize:17}}>Verification</h3>
          <label>Verification remarks / rejection reason<textarea rows={3} style={inputStyle} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Add verification remarks or reason for rejection"/></label>
          <div className="lc-inline" style={{marginTop:12}}>
            {canHr && !selected.hr_verification ? <button type="button" disabled={Boolean(busy)} style={actionStyle} onClick={()=>verify('hr_verify')}><BadgeCheck size={17}/> HR Verify</button> : null}
            {canFinance && selected.hr_verification ? <button type="button" disabled={Boolean(busy)} style={actionStyle} onClick={()=>verify('accounts_verify')}><CheckCircle2 size={17}/> Accounts Verify</button> : null}
            <button type="button" disabled={Boolean(busy)||!remarks.trim()} style={{...actionStyle,background:'#a53639'}} onClick={()=>verify('reject')}><XCircle size={17}/> Reject / Requires Correction</button>
          </div>
        </div> : null}
        {selected.verification_history?.length ? <div><h3 style={{fontSize:16}}>Verification audit trail</h3>
          {selected.verification_history.map((x,i)=><p key={i} style={{fontSize:13}}>{statusName[x.stage]||x.stage} · {x.by} · {x.at ? new Date(x.at).toLocaleString() : ''} · {x.remarks}</p>)}</div> : null}
      </section> : null}
      {manage && canHr && rates ? <section className="lc-panel"><h2 style={{fontSize:17,marginTop:0}}>Tenant LC rate settings</h2>
        <form onSubmit={saveRates} className="lc-inline">
          <label>Two Wheeler (₹/km)<input style={inputStyle} type="number" min="0.01" step="0.01" max="1000" value={rates.two_wheeler_rate ?? 4} onChange={e=>setRates(r=>({...r,two_wheeler_rate:e.target.value}))}/></label>
          <label>Four Wheeler (₹/km)<input style={inputStyle} type="number" min="0.01" step="0.01" max="1000" value={rates.four_wheeler_rate ?? 14} onChange={e=>setRates(r=>({...r,four_wheeler_rate:e.target.value}))}/></label>
          <button type="submit" style={actionStyle} disabled={Boolean(busy)}><ShieldCheck size={16}/> Save Future Rates</button>
        </form>
        <small>Existing finalised visits retain their original rate snapshot.</small>
      </section> : null}
    </main>
  );
}
