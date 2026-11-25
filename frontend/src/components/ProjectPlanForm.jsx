import { useEffect, useRef, useState } from 'react';
import { Plus, X, Trash2, Users, FolderKanban, Flag } from 'lucide-react';
import { planning, projectSave, uid } from '../api/projectPlanning';

export function Field({ label, children, hint, wide = false }) {
  return <label className={`pw-field ${wide ? 'pw-wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Modal({ title, onClose, children, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    dialog.current.showModal();
    return () => { dialog.current?.close(); before?.focus?.(); };
  }, []);
  return <dialog ref={dialog} className={`pw-modal ${wide ? 'pw-modal-wide' : ''}`} onCancel={onClose} aria-label={title}>
    <header><h2>{title}</h2><button type="button" className="pw-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
    {children}
  </dialog>;
}

export function Members({ label, people, value, onChange, disabled }) {
  const [search, setSearch] = useState('');
  return <fieldset className="pw-members" disabled={disabled}>
    <legend>{label} <span>{value.length} selected</span></legend>
    <input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
    <div>{people.filter(p => `${p.name} ${p.employee_code} ${p.department}`.toLowerCase().includes(search.toLowerCase())).map(p => <label key={p.id}>
      <input type="checkbox" checked={value.includes(p.id)} onChange={e => onChange(e.target.checked ? [...value, p.id] : value.filter(id => id !== p.id))} />
      <span>{p.name}<small>{p.employee_code} · {p.department}</small></span>
    </label>)}{!people.length && <p>No mapped employees available. Select a team or ask HR to check the reporting hierarchy.</p>}</div>
  </fieldset>;
}

export default function ProjectPlanForm({ options, project, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', project_type: 'in_house', client_name: '', start_date: '', due_date: '', department: '', function: '', team_leader_id: '', primary_assignee_id: '', assigned_employee_ids: [], collaborator_ids: [], description: '', deliverables: [{ id: uid(), title: '', due_date: '', status: 'Not Started', notes: '' }], ...project });
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  useEffect(() => {
    let current = true;
    setMembers([]);
    if (!form.team_leader_id) {
      setMemberLoading(false);
      return;
    }
    setMemberLoading(true);
    planning('/options', { team_leader_id: form.team_leader_id }).then(r => {
      if (current) {
        const eligible = r.eligible_members || [];
        setMembers(eligible);
        const ids = new Set(eligible.map(p => p.id));
        setForm(f => ({ ...f,
          primary_assignee_id: ids.has(f.primary_assignee_id) ? f.primary_assignee_id : '',
          assigned_employee_ids: f.assigned_employee_ids.filter(id => ids.has(id)),
          collaborator_ids: f.collaborator_ids.filter(id => ids.has(id)),
        }));
      }
    }).catch(e => current && setError(e.message)).finally(() => current && setMemberLoading(false));
    return () => { current = false; };
  }, [form.team_leader_id, form.department]);
  const change = (key, value) => setForm(f => ({ ...f, [key]: value,
    ...(key === 'team_leader_id' ? {
      department: options.team_leaders.find(p => p.id === value)?.department || '',
      reporting_officer_id: options.team_leaders.find(p => p.id === value)?.reporting_officer_id || ''
    } : {}),
  }));
  const deliverable = (id, key, value) => setForm(f => ({ ...f, deliverables: f.deliverables.map(d => d.id === id ? { ...d, [key]: value } : d) }));
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await projectSave({ ...form, assigned_employee_ids: [...new Set([form.primary_assignee_id, ...form.assigned_employee_ids])], planning_version: form.planning_version || 0 }, project?._id);
      await onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title={project ? 'Project details & deliverables' : 'Create a project'} onClose={onClose} wide>
    <form onSubmit={save} className="pw-form">
      <div className="pw-form-body">
        {error && <div className="pw-notice pw-error" role="alert">{error}</div>}
        <h3><FolderKanban size={18} /> Project information</h3>
        <div className="pw-grid">
          <Field label="Project name"><input required maxLength={200} value={form.name} onChange={e => change('name', e.target.value)} /></Field>
          <Field label="Project type"><select value={form.project_type || ''} required onChange={e => change('project_type', e.target.value)}><option value="">Select type</option><option value="client">Client Project</option><option value="in_house">In-House Project</option></select></Field>
          {form.project_type === 'client' && <Field label="Client name"><input required value={form.client_name || ''} onChange={e => change('client_name', e.target.value)} /></Field>}
          <Field label="Start date" hint={form.project_type === 'client' ? 'Use the date agreed in the client MOU.' : 'Set the internal project period.'}><input type="date" required value={form.start_date} onChange={e => change('start_date', e.target.value)} /></Field>
          <Field label="End date"><input type="date" required min={form.start_date} value={form.due_date} onChange={e => change('due_date', e.target.value)} /></Field>
          <Field label="Department" hint="Automatically assigned from the Project Team Leader."><input readOnly value={form.department || ''} placeholder="Select Team Leader first" aria-readonly="true" /></Field>
          <Field label="Function" hint="Standard classifications from the planning workbook."><select required value={form.function || ''} onChange={e => change('function', e.target.value)}><option value="">Select function</option>{options.master.functions.map(f => <option key={f}>{f}</option>)}</select></Field>
          <Field label="Description" wide><textarea value={form.description} onChange={e => change('description', e.target.value)} rows={2} /></Field>
        </div>
        <h3><Users size={18} /> Team assignment</h3>
        <div className="pw-grid">
          <Field label="Project Team Leader"><select required value={form.team_leader_id} onChange={e => change('team_leader_id', e.target.value)}><option value="">Select Team Leader</option>{options.team_leaders.filter(p => p.department).map(p => <option value={p.id} key={p.id}>{p.name} · {p.department}</option>)}</select></Field>
          <Field label="Primary responsible employee"><select required disabled={memberLoading} value={form.primary_assignee_id} onChange={e => change('primary_assignee_id', e.target.value)}><option value="">{memberLoading ? 'Loading mapped team…' : 'Select responsible employee'}</option>{members.map(p => <option value={p.id} key={p.id}>{p.name} · {p.department}</option>)}</select></Field>
          <Members label="Supporting members" people={members} value={form.assigned_employee_ids} onChange={v => change('assigned_employee_ids', v)} disabled={memberLoading} />
          <Members label="Collaborators" people={members} value={form.collaborator_ids} onChange={v => change('collaborator_ids', v)} disabled={memberLoading} />
        </div>
        <h3><Flag size={18} /> Project deliverables</h3>
        <p className="pw-muted">Record each contractual milestone and its deadline. These link to your monthly targets.</p>
        {(form.deliverables || []).map((d, i) => <div className="pw-deliverable-edit" key={d.id}>
          <div className="pw-deliverable-title"><span className="pw-eyebrow">DELIVERABLE {i + 1}</span><Field label="Deliverable / milestone"><input required value={d.title} onChange={e => deliverable(d.id, 'title', e.target.value)} /></Field><Field label="Notes"><textarea rows={2} value={d.notes} onChange={e => deliverable(d.id, 'notes', e.target.value)} /></Field></div>
          <div className="pw-deliverable-time"><span className="pw-eyebrow">TIMELINE</span><Field label="Contract due date"><input required type="date" min={form.start_date} max={form.due_date} value={d.due_date} onChange={e => deliverable(d.id, 'due_date', e.target.value)} /></Field><Field label="Deliverable status"><select value={d.status} onChange={e => deliverable(d.id, 'status', e.target.value)}>{options.master.deliverable_statuses.map(s => <option key={s}>{s}</option>)}</select></Field></div>
          <button type="button" className="pw-icon" aria-label={`Remove deliverable ${i + 1}`} disabled={form.deliverables.length === 1} onClick={() => change('deliverables', form.deliverables.filter(v => v.id !== d.id))}><Trash2 size={16} /></button>
        </div>)}
        <button type="button" className="pw-button pw-soft" onClick={() => change('deliverables', [...(form.deliverables || []), { id: uid(), title: '', due_date: '', status: 'Not Started', notes: '' }])}><Plus size={16} /> Add deliverable</button>
      </div>
      <footer><button type="button" className="pw-button" onClick={onClose} disabled={busy}>Cancel</button><button className="pw-button pw-primary" disabled={busy || memberLoading}>{busy ? 'Saving project…' : project ? 'Save changes' : 'Create project'}</button></footer>
    </form>
  </Modal>;
}
