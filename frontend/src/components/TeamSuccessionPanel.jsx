import { useEffect, useState } from 'react';
import { RefreshCw, Users, ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import './team-succession.css';

const labels = { active: 'Team Leader active', acting: 'Acting Team Leader', replacement_assigned: 'Replacement assigned', reassignment_required: 'Reassignment required' };
export default function TeamSuccessionPanel() {
  const [data, setData] = useState({ items: [], candidates: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [showActive, setShowActive] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { setData(await api('/employee-handover/succession')); }
    catch (e) { setError(e.message || 'Unable to load team responsibilities.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function appoint(team) {
    const replacement = data.candidates.find(c => c.id === selection[team.team_id]);
    if (!replacement || !window.confirm(`Assign ${replacement.name} to ${team.previous_leader.name}'s team? Pending Team Leader duties will move to this person.`)) return;
    setBusy(team.team_id); setError(''); setNotice('');
    try {
      await api('/employee-handover/succession/appoint', { method: 'POST', body: JSON.stringify({
        team_id: team.team_id, replacement_employee_id: replacement.id, version: team.version, confirmation: 'ASSIGN',
      }) });
      setNotice(`Team responsibilities assigned to ${replacement.name}.`); await load();
    } catch (e) { setError(e.message || 'Assignment could not be saved.'); }
    finally { setBusy(''); }
  }
  const teams = data.items.filter(t => showActive || t.status !== 'active');
  return <section className="yc-succession" aria-label="Team Leader succession">
    <header><div><h2><Users size={20} /> Team Leader succession</h2><p>Review vacant teams, temporary responsibilities and replacement appointments.</p></div><button type="button" onClick={load} disabled={loading || !!busy}><RefreshCw size={16} /> Refresh</button></header>
    <label className="yc-succession-toggle"><input type="checkbox" checked={showActive} onChange={e => setShowActive(e.target.checked)} /> Include active teams</label>
    {error && <p className="yc-succession-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading team responsibilities…</p> : !teams.length ? <p>No Team Leader vacancies require attention.</p> : <div className="yc-succession-grid">{teams.map(t => <article key={t.team_id}>
      <div className="yc-succession-heading"><h3>{t.previous_leader.name}'s team</h3><span data-status={t.status}>{labels[t.status]}</span></div>
      <dl><dt>Previous Team Leader</dt><dd>{t.previous_leader.name} · {t.previous_leader.employee_code}</dd><dt>Current responsibilities</dt><dd>{t.effective_leader?.name || 'Awaiting authorized reassignment'}</dd><dt>Reporting Officer</dt><dd>{t.reporting_officer?.name || 'Not mapped'}</dd><dt>Effective from</dt><dd>{t.effective_at ? new Date(t.effective_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Resolved from employee lifecycle'}</dd></dl>
      <details><summary>{t.members.length} mapped team members</summary><ul>{t.members.map(m => <li key={m.id}>{m.name} <small>{m.department}</small></li>)}</ul></details>
      {t.unresolved.map(message => <p key={message} className="yc-succession-error">{message}</p>)}
      {t.appointment_available && <div className="yc-succession-assignment"><label>Replacement Team Leader<select aria-label={`Replacement for ${t.previous_leader.name}'s team`} value={selection[t.team_id] || ''} onChange={e => setSelection(s => ({ ...s, [t.team_id]: e.target.value }))} disabled={!!busy}><option value="">Select an active Team Leader</option>{data.candidates.filter(c => c.id !== t.team_id && c.reporting_officer_id === t.reporting_officer?.id).map(c => <option key={c.id} value={c.id}>{c.name} · {c.department}</option>)}</select></label><button type="button" onClick={() => appoint(t)} disabled={!selection[t.team_id] || !!busy}>{busy === t.team_id ? 'Assigning…' : 'Assign replacement'}<ArrowRight size={16} /></button></div>}
      {!!t.history.length && <details><summary>Succession history</summary><ol>{t.history.map(h => <li key={h.id}>{labels[h.status] || h.status} · {new Date(h.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</li>)}</ol></details>}
    </article>)}</div>}
  </section>;
}
