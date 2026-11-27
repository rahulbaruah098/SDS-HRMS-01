import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, CalendarDays, Send, Check, Clock, FileCheck2, ArrowUpRight, Download, ChevronDown, Pencil } from 'lucide-react';
import { Field, Modal } from './ProjectPlanForm';
import { localDate, planning, uid } from '../api/projectPlanning';

export const human = value => String(value || 'draft').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
export const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const Badge = ({ value }) => <span className={`pw-badge pw-status-${String(value || '').toLowerCase().replaceAll(' ', '_')}`}>{human(value)}</span>;
export const Empty = ({ title, children }) => <div className="pw-empty"><CalendarDays size={28} /><h3>{title}</h3><p>{children}</p></div>;

export function TargetForm({ options, projects, month, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ request_id: uid(), month, project_id: '', deliverable_id: '', employee_ids: [], output: '', unit: 'Count', quantity: 1, activity: '', due_date: '', expected_evidence: '', evidence_required: false, priority: 'Medium' }));
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [retryLocked, setRetryLocked] = useState(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const project = projects.find(p => p._id === form.project_id);
  const people = options.employees.filter(e => e.is_active !== false && [...(project?.assigned_employee_ids || []), ...(project?.collaborator_ids || []), project?.team_leader_id].includes(e.id));
  const activities = [...new Set(options.master.tasks.filter(t => t.function === project?.function).map(t => t.activity))];
  const selected = form.employee_ids.filter(id => people.some(p => p.id === id));
  const allSelected = people.length > 0 && selected.length === people.length;
  const filteredPeople = people.filter(p => `${p.name || ''} ${p.employee_code || ''} ${p.department || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const change = (key, value) => {
    if (key === 'project_id') setSearch('');
    setForm(f => ({ ...f, [key]: value, ...(key === 'project_id' ? { deliverable_id: '', employee_ids: [], activity: '', due_date: '' } : {}) }));
  };
  const toggleEmployee = (id, checked) => setForm(f => ({ ...f, employee_ids: checked ? [...new Set([...f.employee_ids, id])] : f.employee_ids.filter(v => v !== id) }));
  const close = event => { if (submitting.current) { event?.preventDefault(); return; } onClose(); };
  async function submit(e) {
    e.preventDefault();
    if (submitting.current) return;
    if (!selected.length) { setError('Select at least one responsible employee.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await planning('/targets', { ...form, employee_ids: selected }, 'POST');
      await onSaved(result.count ?? selected.length); onClose();
    } catch (err) {
      if (!err.status || err.status >= 500) {
        setRetryLocked(true);
        setError(`${err.message} Some targets may already have been saved. Retry this same assignment without changing its details.`);
      } else { setError(err.message); }
    }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={`Assign monthly work · ${month}`} onClose={close}><form onSubmit={submit} className="pw-form"><div className="pw-form-body">
    {error && <p role="alert" className="pw-notice pw-error">{error}</p>}
    <p className="pw-muted">Assign the same measurable target to one or more project members. Each employee receives their own target and plans it independently.</p>
    <fieldset className="pw-grid pw-target-fields" disabled={busy || retryLocked}>
      <Field label="Project"><select required value={form.project_id} onChange={e => change('project_id', e.target.value)}><option value="">Select configured project</option>{projects.filter(p => p.can_manage_project_team && p.planning_schema === 1 && p.status === 'active').map(p => <option value={p._id} key={p._id}>{p.name}</option>)}</select></Field>
      <Field label="Deliverable"><select required value={form.deliverable_id} onChange={e => change('deliverable_id', e.target.value)}><option value="">Select deliverable</option>{project?.deliverables?.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
      <div className="pw-field pw-target-employee-field"><span id="pw-target-employee-label">Responsible employees</span>
        <details className="pw-target-employee-select" key={form.project_id}>
          <summary aria-labelledby="pw-target-employee-label pw-target-employee-summary"><span id="pw-target-employee-summary">{selected.length === 1 ? people.find(p => p.id === selected[0])?.name : selected.length ? `${selected.length} employees selected` : 'Select project members'}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="pw-target-employee-menu">
            <input type="search" aria-label="Search responsible employees" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} disabled={!people.length} />
            <label className="pw-target-employee-all"><input type="checkbox" checked={allSelected} disabled={!people.length} onChange={e => change('employee_ids', e.target.checked ? people.map(p => p.id) : [])} /> Select all ({people.length})</label>
            <div className="pw-target-employee-list">
              {filteredPeople.map(p => <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => toggleEmployee(p.id, e.target.checked)} /><span>{p.name}{(p.employee_code || p.department) && <small>{[p.employee_code, p.department].filter(Boolean).join(' · ')}</small>}</span></label>)}
              {!filteredPeople.length && <p className="pw-muted">{people.length ? 'No matching employees.' : project ? 'No eligible project members.' : 'Choose a project first.'}</p>}
            </div>
            <div className="pw-target-employee-actions"><small aria-live="polite">{selected.length} of {people.length} selected</small><button type="button" className="pw-button pw-text" disabled={!selected.length} onClick={() => change('employee_ids', [])}>Clear</button></div>
          </div>
        </details>
      </div>
      <Field label="Standard activity"><select required value={form.activity} onChange={e => change('activity', e.target.value)}><option value="">Select activity</option>{activities.map(a => <option key={a}>{a}</option>)}</select></Field>
      <Field label="Monthly target / output" wide><textarea required value={form.output} onChange={e => change('output', e.target.value)} placeholder="Describe a measurable result" rows={2} /></Field>
      <Field label="Unit"><select value={form.unit} onChange={e => change('unit', e.target.value)}>{options.master.units.map(u => <option key={u}>{u}</option>)}</select></Field>
      <Field label="Target quantity per employee"><input type="number" required min="0.000001" step="any" value={form.quantity} onChange={e => change('quantity', e.target.value)} /></Field>
      <Field label="Target due date"><input type="date" required min={[`${month}-01`, project?.start_date || ''].sort().at(-1)} max={project?.deliverables?.find(d => d.id === form.deliverable_id)?.due_date || project?.due_date} value={form.due_date} onChange={e => change('due_date', e.target.value)} /></Field>
      <Field label="Priority"><select value={form.priority} onChange={e => change('priority', e.target.value)}>{options.master.priorities.map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field label="Expected evidence" wide><input value={form.expected_evidence} onChange={e => change('expected_evidence', e.target.value)} placeholder="Report, dataset, shared document or other result" /></Field>
      <label className="pw-check pw-wide"><input type="checkbox" checked={form.evidence_required} onChange={e => change('evidence_required', e.target.checked)} /> Require an evidence link for completed work</label>
      {selected.length > 0 && <p className="pw-target-assignment-summary pw-wide" aria-live="polite">{selected.length} {selected.length === 1 ? 'employee' : 'employees'} · {form.quantity || '0'} {form.unit} each. Separate monthly targets will be created.</p>}
    </fieldset>
  </div><footer><button type="button" className="pw-button" disabled={busy} onClick={close}>Cancel</button><button className="pw-button pw-primary" disabled={busy || !selected.length}>{busy ? 'Assigning…' : retryLocked ? 'Retry assignment' : selected.length > 1 ? `Assign to ${selected.length} employees` : 'Assign monthly target'}</button></footer></form></Modal>;
}

export function MonthlyEditor({ plan, targets, options, isOwn, onRefresh, onNotice }) {
  const [rows, setRows] = useState(plan.rows || []);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const readOnly = !isOwn || plan.status === 'submitted';
  const changeRows = next => { setRows(next); setDirty(true); };
  const change = (id, key, value) => changeRows(rows.map(r => r.id === id ? { ...r, [key]: value, ...(key === 'target_id' ? { task_code: '' } : {}) } : r));
  async function action(submit = false) {
    setBusy(true);
    try {
      let current = plan;
      if (dirty || !plan.version) current = (await planning('/monthly', { month: plan.month, version: plan.version, rows }, 'PUT')).item;
      if (submit) await planning('/monthly/submit', { month: plan.month, version: current.version }, 'POST');
      await onRefresh(); setDirty(false); onNotice(submit ? 'Monthly plan submitted for review.' : 'Draft saved. Published work remains active until a revision is approved.');
    } catch (e) { onNotice(e.message, true); } finally { setBusy(false); }
  }
  const dailyHours = rows.reduce((a, r) => ({ ...a, [r.date]: (a[r.date] || 0) + Number(r.hours || 0) }), {});
  const overloaded = Object.entries(dailyHours).filter(([day, hours]) => day && hours > 8);
  return <section className="pw-panel">
    <div className="pw-panel-head"><div><h2>Day-wise monthly plan</h2><p>Plan all your projects here. Weekly and daily views follow these dates automatically.</p></div><Badge value={plan.status} /></div>
    {plan.published_rows?.length > 0 && plan.status !== 'approved' && <p className="pw-notice">Your last approved plan remains active while this revision is prepared and reviewed.</p>}
    {plan.review_remarks && <p className="pw-notice"><strong>Reviewer:</strong> {plan.review_remarks}</p>}
    {overloaded.length > 0 && <p className="pw-notice pw-warning">Workload above 8 hours: {overloaded.map(([d, h]) => `${dateLabel(d)} (${h}h)`).join(', ')}. Check your available time.</p>}
    {!rows.length && <Empty title="Start with your assigned targets">Add a dated activity for each part of your monthly work. You can schedule several projects on the same day.</Empty>}
    <div className="pw-plan-rows">{rows.map((row, i) => {
      const target = targets.find(t => t._id === row.target_id);
      const tasks = options.master.tasks.filter(t => t.function === target?.function && t.activity === target?.activity);
      const frozen = Boolean(plan.reports?.[row.id]) || (plan.published_rows?.some(r => r.id === row.id) && row.date < localDate()) || Boolean(plan.sealed_dates?.[row.date]);
      const disabled = readOnly || frozen || busy;
      return <fieldset className="pw-plan-row" disabled={disabled} key={row.id}>
        <legend>Activity {i + 1} {frozen && <small>· Historical record</small>}</legend>
        <div className="pw-grid pw-grid-three">
          <Field label="Monthly target"><select required value={row.target_id} onChange={e => change(row.id, 'target_id', e.target.value)}><option value="">Select assigned target</option>{targets.map(t => <option key={t._id} value={t._id}>{t.project_name} · {t.output}</option>)}</select></Field>
          <Field label="Planned date"><input type="date" min={`${plan.month}-01`} max={target?.due_date} value={row.date} onChange={e => change(row.id, 'date', e.target.value)} /></Field>
          <Field label="Standard task"><select value={row.task_code} onChange={e => change(row.id, 'task_code', e.target.value)}><option value="">Select task</option>{tasks.map(t => <option value={t.code} key={t.code}>{t.task}</option>)}</select></Field>
          <Field label="Specific daily output"><input value={row.output} onChange={e => change(row.id, 'output', e.target.value)} placeholder="What will you deliver on this date?" /></Field>
          <Field label={`Planned quantity · ${target?.unit || 'unit'}`}><input type="number" min="0.000001" step="any" value={row.quantity} onChange={e => change(row.id, 'quantity', e.target.value)} /></Field>
          <Field label="Estimated hours"><input type="number" min="0" max="24" step="0.25" value={row.hours} onChange={e => change(row.id, 'hours', e.target.value)} /></Field>
        </div>
        {!readOnly && !frozen && <button type="button" className="pw-button pw-text" onClick={() => changeRows(rows.filter(r => r.id !== row.id))}><Trash2 size={14} /> Remove activity</button>}
      </fieldset>;
    })}</div>
    {isOwn && <div className="pw-actions"><button className="pw-button" disabled={readOnly || busy || !targets.length} onClick={() => changeRows([...rows, { id: uid(), target_id: '', date: '', task_code: '', output: '', quantity: 1, hours: 1 }])}><Plus size={16} /> Add dated activity</button>
      <span className="pw-spacer" />{dirty && <small>Unsaved changes</small>}<button className="pw-button" disabled={readOnly || busy || !rows.length} onClick={() => action(false)}>Save draft</button><button className="pw-button pw-primary" disabled={readOnly || busy || !rows.length || (!dirty && plan.status === 'approved')} onClick={() => action(true)}><Send size={16} />{busy ? 'Saving…' : 'Submit for approval'}</button></div>}
    <details className="pw-history"><summary>Approval & report history ({plan.events?.length || 0})</summary>{[...(plan.events || [])].reverse().map((e, i) => <p key={i}><strong>{human(e.action)}</strong> · {new Date(e.at).toLocaleString('en-IN')} {e.remarks || ''}</p>)}</details>
  </section>;
}

export function ReportForm({ task, plan, onClose, onSaved }) {
  const old = plan.reports?.[task.id] || {};
  const [form, setForm] = useState({ status: old.status || 'pending', note: old.note || '', actual_quantity: old.actual_quantity || 0, evidence: old.evidence || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (key, value) => setForm(f => ({ ...f, [key]: value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await planning('/daily-report', { ...form, month: task.date.slice(0, 7), task_id: task.id, version: plan.version }, 'POST'); await onSaved(); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title="Report daily work" onClose={onClose}><form className="pw-form" onSubmit={submit}><div className="pw-form-body">
    <span className="pw-eyebrow">{task.project_name} · {dateLabel(task.date)}</span><h3>{task.output}</h3>
    <p className="pw-muted">Reporting honestly is enough to satisfy checkout. Pending and Not Completed are valid statuses.</p>
    {error && <p className="pw-notice pw-error" role="alert">{error}</p>}
    <div className="pw-grid"><Field label="Work status"><select value={form.status} onChange={e => change('status', e.target.value)}><option value="completed">Completed</option><option value="pending">Pending</option><option value="not_completed">Not Completed</option></select></Field>
      <Field label={`Actual output · ${task.unit}`} hint="Output for this activity only, not a cumulative total."><input type="number" min="0" step="any" required value={form.actual_quantity} onChange={e => change('actual_quantity', e.target.value)} /></Field>
      <Field label={form.status === 'completed' ? 'Completion details' : form.status === 'pending' ? 'Current progress & reason pending' : 'Reason for non-completion'} wide><textarea rows={4} required value={form.note} onChange={e => change('note', e.target.value)} /></Field>
      <Field label={`Evidence link${task.evidence_required && form.status === 'completed' ? ' · required' : ' · optional'}`} hint={task.expected_evidence} wide><input type="url" required={task.evidence_required && form.status === 'completed'} value={form.evidence} onChange={e => change('evidence', e.target.value)} placeholder="https://…" /></Field>
    </div></div><footer><button type="button" className="pw-button" onClick={onClose}>Cancel</button><button className="pw-button pw-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit daily report'}</button></footer></form></Modal>;
}

export function UnplannedDetails({ item }) {
  const labels = { assigned_project: 'Assigned project work', other_project: 'Other project work', non_project: 'Non-project / Internal work' };
  const modes = { office: 'Office', field: 'Field Work', wfh: 'Work From Home' };
  return <div className="pw-unplanned-details">
    <div className="pw-work-meta"><span>{labels[item.work_type || 'assigned_project'] || human(item.work_type)}</span><span>{modes[item.work_mode || 'office'] || human(item.work_mode)}</span><span>{item.department}</span>{item.workflow_version === 3 && <span>{item.planned_quantity} {item.unit} planned</span>}{(item.workflow_version !== 3 || item.report?.status !== 'unreported') && <span>{item.report?.actual_quantity ?? 0} {item.unit || 'Count'} actual</span>}<span>{item.hours ?? 0}h estimated</span>{item.priority && <span>{item.priority} priority</span>}</div>
    <p className="pw-muted">{[item.function, item.activity, item.task].filter(Boolean).join(' · ')}</p>
    {item.work_mode === 'field' && <div className="pw-work-note"><strong>Fieldwork:</strong> {item.field_place}, {item.field_district}<p>{item.field_purpose}</p>{item.visit_id && <p>Linked My Visit: {item.visit_title || item.visit_id}</p>}</div>}
  </div>;
}

export function UnplannedForm({ options, onClose, onSaved, day, existing, onDate }) {
  const [form, setForm] = useState(() => {
    const initial = { request_id: uid(), date: day >= localDate() ? day : localDate(), work_type: 'assigned_project', project_id: '', deliverable_id: '', function: '', activity: '', task_code: '', work_mode: 'office', field_place: '', field_district: '', field_purpose: '', unit: 'Count', priority: 'Medium', output: '', reason: '', hours: 1, planned_quantity: 1 };
    if (existing) for (const key of Object.keys(initial)) if (key !== 'request_id' && existing[key] != null) initial[key] = existing[key];
    if (initial.date < localDate()) initial.date = localDate();
    return initial;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState('');
  const [reload, setReload] = useState(0);
  const project = context?.projects.find(p => p._id === form.project_id);
  const internal = form.work_type === 'non_project';
  const activeTasks = options.master.tasks.filter(t => t.status === 'Active');
  const activities = [...new Set(activeTasks.filter(t => t.function === form.function).map(t => t.activity))];
  const tasks = activeTasks.filter(t => t.function === form.function && t.activity === form.activity);
  const availableProjects = (context?.projects || []).filter(p => p.work_type === form.work_type);
  useEffect(() => {
    let alive = true;
    setContextError('');
    planning('/unplanned/options').then(r => { if (alive) setContext(r); }).catch(e => { if (alive) setContextError(e.message); });
    return () => { alive = false; };
  }, [reload]);
  function change(key, value) {
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === 'work_type') Object.assign(next, { project_id: '', deliverable_id: '', function: '', activity: '', task_code: '' });
      if (key === 'project_id') Object.assign(next, { deliverable_id: '', function: context?.projects.find(p => p._id === value)?.function || '', activity: '', task_code: '' });
      if (key === 'function') Object.assign(next, { activity: '', task_code: '' });
      if (key === 'activity') next.task_code = '';
      if (key === 'work_mode') Object.assign(next, { field_place: '', field_district: '', field_purpose: '' });
      return next;
    });
  }
  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await planning(existing ? `/unplanned/${existing._id}/revise` : '/unplanned', { ...form, ...(existing ? { version: existing.version } : {}) }, 'POST'); onDate?.(form.date); await onSaved(); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title={existing ? "Revise unplanned work request" : "Request unplanned work"} onClose={onClose}><form className="pw-form" onSubmit={submit}><div className="pw-form-body">
    <p className="pw-muted">Request authorization before starting work. Your mapped reviewer must approve it. Pending approval does not block checkout.</p>
    {error && <p role="alert" className="pw-notice pw-error">{error}</p>}
    {existing?.review_remarks && <p className="pw-notice"><strong>Reviewer:</strong> {existing.review_remarks}</p>}
    {contextError && <p role="alert" className="pw-notice pw-error">{contextError} <button type="button" className="pw-button" onClick={() => setReload(v => v + 1)}>Retry</button></p>}
    {!context && !contextError && <p role="status" className="pw-muted">Loading permitted projects and employee details…</p>}
    <div className="pw-grid">
      <Field label="Work type"><select value={form.work_type} onChange={e => change('work_type', e.target.value)}><option value="assigned_project">Assigned project work</option><option value="other_project">Other authorized project work</option><option value="non_project">Non-project / Internal work</option></select></Field>
      <Field label="Activity date"><input required type="date" min={[localDate(), project?.start_date || localDate()].sort().at(-1)} max={project?.due_date} value={form.date} onChange={e => change('date', e.target.value)} /></Field>
      {!internal && <><Field label="Project" hint={context && !availableProjects.length ? 'No configured projects of this type are in your authorized scope.' : undefined}><select required value={form.project_id} onChange={e => change('project_id', e.target.value)}><option value="">Select project</option>{availableProjects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
      <Field label="Deliverable · optional"><select value={form.deliverable_id} onChange={e => change('deliverable_id', e.target.value)}><option value="">No specific deliverable</option>{project?.deliverables?.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field></>}
      <Field label="Department" hint="Automatically retrieved from your employee profile."><input readOnly value={context?.department || options.current_employee?.department || ''} /></Field>
      <Field label="Work location type"><select value={form.work_mode} onChange={e => change('work_mode', e.target.value)}><option value="office">Office</option><option value="field">Field Work</option><option value="wfh">Work From Home</option></select></Field>
      <Field label="Function" hint={!internal ? 'Uses the selected project function.' : undefined}><select required disabled={!internal} value={form.function} onChange={e => change('function', e.target.value)}><option value="">Select function</option>{(internal ? options.master.functions : project?.function ? [project.function] : []).map(f => <option key={f}>{f}</option>)}</select></Field>
      <Field label="Standard activity"><select required value={form.activity} onChange={e => change('activity', e.target.value)}><option value="">Select activity</option>{activities.map(a => <option key={a}>{a}</option>)}</select></Field>
      <Field label="Standard task" wide><select required value={form.task_code} onChange={e => change('task_code', e.target.value)}><option value="">Select task</option>{tasks.map(t => <option key={t.code} value={t.code}>{t.task}</option>)}</select></Field>
      {form.work_mode === 'field' && <>
        <Field label="Place of visit"><input required maxLength={300} value={form.field_place} onChange={e => change('field_place', e.target.value)} /></Field>
        <Field label="District"><input required maxLength={200} value={form.field_district} onChange={e => change('field_district', e.target.value)} /></Field>
        <Field label="Purpose of field visit" wide><textarea required rows={2} maxLength={1000} value={form.field_purpose} onChange={e => change('field_purpose', e.target.value)} /></Field>
        <p className="pw-muted pw-wide">After approval, create or link My Visit from this request. This request alone does not create an attendance record or travel claim.</p></>}
      <Field label="Specific expected output" wide><input required value={form.output} onChange={e => change('output', e.target.value)} /></Field>
      <Field label="Justification for unplanned work" wide><textarea required rows={2} value={form.reason} onChange={e => change('reason', e.target.value)} /></Field>
      <Field label="Unit"><select value={form.unit} onChange={e => change('unit', e.target.value)}>{options.master.units.map(u => <option key={u}>{u}</option>)}</select></Field>
      <Field label="Planned quantity"><input required type="number" min="0.000001" step="any" value={form.planned_quantity} onChange={e => change('planned_quantity', e.target.value)} /></Field>
      <Field label="Estimated hours"><input type="number" required min="0" max="24" step="0.25" value={form.hours} onChange={e => change('hours', e.target.value)} /></Field>
      <Field label="Priority"><select value={form.priority} onChange={e => change('priority', e.target.value)}>{options.master.priorities.map(v => <option key={v}>{v}</option>)}</select></Field>
    </div></div><footer><button type="button" className="pw-button" onClick={onClose} disabled={busy}>Cancel</button><button className="pw-button pw-primary" disabled={busy || !context || !form.function || !form.task_code || (!internal && !project)}>{busy ? 'Submitting…' : existing ? 'Resubmit for approval' : 'Send for approval'}</button></footer></form></Modal>;
}

export function UnplannedExecutionForm({ item, onClose, onSaved }) {
  const [form, setForm] = useState({ status: ['completed', 'pending', 'not_completed'].includes(item.report?.status) ? item.report.status : 'pending', actual_quantity: item.report?.actual_quantity ?? 0, note: item.report?.note || '', evidence: item.report?.evidence || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = item.work_mode === 'field' ? ['started', 'reached', 'completed'].includes(item.visit_status) : Boolean(item.started_at);
  const mayComplete = started && (item.work_mode !== 'field' || item.visit_status === 'completed');
  const change = (k, value) => setForm(f => ({ ...f, [k]: value }));
  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await planning(`/unplanned/${item._id}/execute`, { version: item.version, action: 'report', ...form }, 'POST'); await onSaved(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="Report approved additional work" onClose={onClose}><form className="pw-form" onSubmit={submit}><div className="pw-form-body">
    <span className="pw-eyebrow">{item.project_name} · {dateLabel(item.date)}</span><h3>{item.output}</h3>
    <p className="pw-muted">Planned output: {item.planned_quantity} {item.unit}. Report actual work honestly. Pending and Not Completed are valid reports.</p>
    {!started && <p className="pw-notice">Work has not started. Only Pending / Not Completed with zero actual output can be reported.</p>}
    {item.work_mode === 'field' && !mayComplete && <p className="pw-notice">Complete the linked My Visit before marking fieldwork Completed.</p>}
    {error && <p className="pw-notice pw-error" role="alert">{error}</p>}
    <div className="pw-grid"><Field label="Work status"><select value={form.status} onChange={e => change('status', e.target.value)}>{['completed', 'pending', 'not_completed'].map(s => <option key={s} value={s} disabled={(s === 'completed' && !mayComplete) || (item.execution_status === 'completed' && s !== 'completed')}>{human(s)}</option>)}</select></Field>
      <Field label={`Actual output · ${item.unit}`}><input required type="number" min="0" step="any" max={started ? undefined : 0} value={form.actual_quantity} onChange={e => change('actual_quantity', e.target.value)} /></Field>
      <Field label="Progress / completion details / reason" wide><textarea required rows={4} value={form.note} onChange={e => change('note', e.target.value)} /></Field>
      <Field label="Evidence link · optional" wide><input type="url" value={form.evidence} onChange={e => change('evidence', e.target.value)} /></Field>
    </div></div><footer><button type="button" className="pw-button" disabled={busy} onClick={onClose}>Cancel</button><button className="pw-button pw-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit daily report'}</button></footer></form></Modal>;
}

export function UnplannedVisitForm({ item, onClose, onSaved, onOpenVisit }) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    planning(`/unplanned/${item._id}/visits`).then(r => { if (active) setVisits(r.items || []); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item._id, reload]);
  async function attach(action) {
    if (busy) return; setBusy(true); setError('');
    try { await planning(`/unplanned/${item._id}/visits`, { version: item.version, action, ...(action === 'link_visit' ? { visit_id: choice } : {}) }, 'POST'); await onSaved(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="Create or link approved field visit" onClose={onClose}><div className="pw-form"><div className="pw-form-body">
    <span className="pw-eyebrow">Approved · {dateLabel(item.date)}</span><h3>{item.output}</h3><p>{item.field_place}, {item.field_district}</p><p>{item.field_purpose}</p>
    <p className="pw-muted">Create a scheduled visit using these approved details, or link your own existing unstarted visit for this date. Start, reach and end the visit in My Visit. Travel reimbursement follows its separate approval workflow.</p>
    {error && <p role="alert" className="pw-notice pw-error">{error} <button type="button" className="pw-button pw-text" disabled={busy} onClick={() => setReload(n => n + 1)}>Retry list</button></p>}
    <Field label="Existing scheduled visit"><select disabled={loading || busy} value={choice} onChange={e => setChoice(e.target.value)}><option value="">{loading ? 'Loading visits…' : 'Select a visit'}</option>{visits.map(v => <option key={v._id} value={v._id}>{v.title}</option>)}</select></Field>
    {!loading && !visits.length && <p className="pw-muted">No eligible scheduled visits. Create a linked visit below.</p>}
    </div><footer><button type="button" className="pw-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pw-button" onClick={() => attach('link_visit')} disabled={busy || loading || !choice}>Link selected</button><button type="button" className="pw-button pw-primary" onClick={() => attach('create_visit')} disabled={busy}>{busy ? 'Saving…' : 'Create visit'}</button></footer></div></Modal>;
}

export function UnplannedActions({ item, onRevise, onVisit, onOpenVisit, onReport, onSaved, onNotice }) {
  const [busy, setBusy] = useState(false);
  if (item.workflow_version !== 3) return <p className="pw-muted">Historical submission · retrospective workflow</p>;
  if (item.approval_status === 'revision_required') return <button type="button" className="pw-button pw-soft" onClick={onRevise}><Pencil size={16} /> Revise & resubmit</button>;
  if (item.approval_status !== 'approved') return <p className="pw-muted">{item.approval_status === 'submitted' ? 'Awaiting approval — execution is locked.' : 'Not authorized to execute.'}</p>;
  const today = localDate();
  const field = item.work_mode === 'field';
  const linked = item.visit_id && item.visit_status && item.visit_status !== 'cancelled';
  async function start() {
    if (busy) return; setBusy(true);
    try { await planning(`/unplanned/${item._id}/execute`, { version: item.version, action: 'start' }, 'POST'); await onSaved(); onNotice('Approved work started.'); }
    catch (e) { onNotice(e.message, true); } finally { setBusy(false); }
  }
  return <div className="pw-actions">
    {field && !linked && item.date >= today && item.execution_status !== 'completed' && <button type="button" className="pw-button pw-primary" onClick={onVisit}>Create / link My Visit</button>}
    {field && linked && <button type="button" className="pw-button" onClick={onOpenVisit}>Open My Visit · {human(item.visit_status)}</button>}
    {!field && !item.started_at && item.date === today && item.execution_status !== 'completed' && <button type="button" className="pw-button pw-primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start work'}</button>}
    {item.date <= today && <button type="button" className="pw-button pw-soft" disabled={busy} onClick={onReport}><FileCheck2 size={16} />{item.report?.status === 'unreported' ? 'Report progress' : 'Update report'}</button>}
    {item.date > today && <span className="pw-muted">Execution opens on {dateLabel(item.date)}.</span>}
  </div>;
}

export function ApprovalCard({ item, kind, onSaved, onNotice }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(decision) {
    setBusy(true);
    try { await planning(`/${kind}/${item._id}/review`, { version: item.version, decision, remarks }, 'POST'); await onSaved(); onNotice('Review recorded.'); } catch (err) { onNotice(err.message, true); } finally { setBusy(false); }
  }
  return <article className="pw-approval"><div className="pw-panel-head"><div><span className="pw-eyebrow">{kind === 'monthly' ? 'MONTHLY PLAN' : 'UNPLANNED WORK'}</span><h3>{item.employee_name}</h3><p>{kind === 'monthly' ? item.month : `${item.project_name} · ${dateLabel(item.date)}`}</p></div><Badge value="submitted" /></div>
    {kind === 'monthly' ? <div className="pw-table-wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Output</th><th>Quantity</th><th>Hours</th></tr></thead><tbody>{item.rows.map(r => <tr key={r.id}><td>{dateLabel(r.date)}</td><td>{r.project_name}</td><td>{r.output}</td><td>{r.quantity} {r.unit}</td><td>{r.hours}</td></tr>)}</tbody></table></div> : <div><h4>{item.output}</h4><UnplannedDetails item={item} /><p><strong>Why unplanned:</strong> {item.reason}</p><p className="pw-muted">{item.workflow_version === 3 ? "Requested authorization before execution" : "Historical retrospective submission"}</p>{item.workflow_version !== 3 && <><p><strong>{human(item.report.status)}:</strong> {item.report.note}</p>{item.report.evidence && <a href={item.report.evidence} target="_blank" rel="noreferrer">View evidence <ArrowUpRight size={14} /></a>}</>}</div>}
    <Field label="Review remarks · required for rejection / revision"><textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} /></Field>
    <div className="pw-actions"><button className="pw-button" disabled={busy || !remarks.trim()} onClick={() => decide(kind === 'monthly' ? 'revision_required' : 'rejected')}>{kind === 'monthly' ? 'Request revision' : 'Reject'}</button>{kind === 'unplanned' && item.workflow_version === 3 && <button type="button" className="pw-button" disabled={busy || !remarks.trim()} onClick={() => decide('revision_required')}>Request revision</button>}<button className="pw-button pw-primary" disabled={busy} onClick={() => decide('approved')}><Check size={16} /> Approve</button></div>
  </article>;
}

export function Bars({ rows, onSelect, title }) {
  return <section className="pw-chart"><h3>{title}</h3>{rows.length ? rows.map((r, i) => <button type="button" disabled={!onSelect} className="pw-bar-item" key={r.id || i} onClick={() => onSelect?.(r.id)} aria-label={`${r.label}: ${r.completion_rate}% completion`}><span>{r.label}</span><div><i style={{ width: `${Math.min(100, r.completion_rate)}%` }} /></div><strong>{r.completion_rate}%</strong><small>{r.completed} / {r.assigned} tasks</small></button>) : <p className="pw-muted">No published activities for this period.</p>}</section>;
}

export function Performance({ data, onEmployee, onProject }) {
  const [review, setReview] = useState(null);
  const summary = data.summary;
  const trend = data.months;
  const points = trend.map((m, i) => `${40 + i * (500 / Math.max(1, trend.length - 1))},${130 - m.completion_rate}`).join(' ');
  return <div className="pw-performance">
    <div className="pw-kpis">{[['Assigned activities', summary.assigned, CalendarDays], ['Completed', summary.completed, FileCheck2], ['Pending', summary.pending, Clock], ['Overdue', summary.overdue, Clock], ['Not completed', summary.not_completed, Clock], ['Authorized additional work', summary.authorized_unplanned, Check]].map(([label, value, Icon]) => <article key={label}><Icon size={18} /><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="pw-score-row">{[['Planned completion', summary.completion_rate], ['Daily reporting', summary.reporting_rate], ['On-time completion', summary.on_time_rate]].map(([label, value]) => <article className="pw-score" key={label}><div className="pw-ring" style={{ '--progress': `${value * 3.6}deg` }}><strong>{value}%</strong></div><div><h3>{label}</h3><p>{label === 'Daily reporting' ? 'Reports submitted for due activities' : label === 'On-time completion' ? 'First completion reported by planned date' : `${summary.completed} of ${summary.assigned} planned activities`}</p></div></article>)}</div>
    <div className="pw-chart-grid"><Bars rows={data.projects} onSelect={onProject} title="Project execution" /><Bars rows={data.employees} onSelect={onEmployee} title="People in your reporting scope" />
      <Bars rows={data.weeks} title="Weekly execution" /><Bars rows={data.departments} title="Department execution" /></div>
    <section className="pw-chart"><h3>Monthly completion trend</h3>{trend.length ? <><svg role="img" aria-label="Monthly completion percentages" viewBox="0 0 580 180" className="pw-line-chart"><line x1="40" y1="130" x2="540" y2="130" className="pw-axis" /><text x="2" y="35">100%</text><text x="10" y="135">0%</text><polyline points={points} fill="none" className="pw-trend" />{trend.map((m, i) => <g key={m.id}><circle cx={40 + i * (500 / Math.max(1, trend.length - 1))} cy={130 - m.completion_rate} r="4"><title>{m.id}: {m.completion_rate}%</title></circle><text x={40 + i * (500 / Math.max(1, trend.length - 1))} y="160" textAnchor="middle">{m.id}</text></g>)}</svg><div className="pw-trend-values">{trend.map(t => <span key={t.id}>{t.label}: <strong>{t.completion_rate}%</strong></span>)}</div></> : <p>No monthly activity data yet.</p>}</section>
    {data.team_comparison.length > 0 && <><Bars rows={data.team_comparison} title="Team comparison · aggregate only" /><p className="pw-muted">Comparison uses the selected dates across all teams. Individual employee filters do not change these aggregates.</p></>}
    <section className="pw-panel"><div className="pw-panel-head"><div><h2>Monthly output achievement</h2><p>Actual quantity ÷ assigned quantity, calculated for each target and unit.</p></div></div><div className="pw-table-wrap"><table><thead><tr><th>Employee / project</th><th>Monthly target</th><th>Planned</th><th>Actual</th><th>Achievement</th><th>Review</th></tr></thead><tbody>{data.targets.map(t => <tr key={t._id}><td>{t.employee_name}<small>{t.project_name}</small></td><td>{t.output}</td><td>{t.quantity} {t.unit}</td><td>{t.actual_quantity} {t.unit}</td><td>{t.achievement_percent}%</td><td>{t.assessment || '—'}<small>{t.corrective_action}</small></td></tr>)}</tbody></table></div>{!data.targets.length && <p className="pw-muted">No monthly targets in this scope.</p>}</section>
    <section className="pw-panel"><h3>Contractual deliverables · {summary.deliverables_completed} / {summary.deliverables_total} completed</h3><div className="pw-deliverables">{data.deliverables.map(d => <article key={`${d.project_id}-${d.id}`}><div className="pw-deliverable-title"><small>{d.project_name}</small><h4>{d.title}</h4><p>{d.related_tasks.completed}/{d.related_tasks.assigned} related tasks completed</p></div><div className="pw-deliverable-time"><time>{dateLabel(d.due_date)}</time><Badge value={d.status} /></div></article>)}</div></section>
    <section className="pw-panel"><div className="pw-panel-head"><div><h2>Additional work</h2><p>Unplanned submissions remain separate from planned completion and monthly targets.</p></div></div>
      <div className="pw-kpis">{[['Assigned project', summary.unplanned_assigned_project], ['Other project', summary.unplanned_other_project], ['Non-project', summary.unplanned_non_project], ['Fieldwork', summary.unplanned_fieldwork], ['Pending review', summary.pending_unplanned], ['Rejected', summary.rejected_unplanned], ['Authorized (V3)', summary.authorized_unplanned], ['Completed (V3)', summary.completed_unplanned], ['In progress (V3)', summary.in_progress_unplanned], ['Not started (V3)', summary.not_started_unplanned], ['Reported pending (V3)', summary.work_pending_unplanned], ['Not completed (V3)', summary.not_completed_unplanned], ['Revision required', summary.revision_unplanned], ['Historical submissions', summary.historical_unplanned]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? 0}</strong></article>)}</div>
      {data.unplanned?.length ? <div className="pw-table-wrap"><table><thead><tr><th>Employee / date</th><th>Project / output</th><th>Classification and output</th><th>Approval / status</th></tr></thead><tbody>{data.unplanned.map(u => <tr key={u._id}><td>{u.employee_name}<small>{dateLabel(u.date)}</small></td><td>{u.project_name}<small>{u.output}</small></td><td><UnplannedDetails item={u} /></td><td><Badge value={u.approval_status} /><small>{u.historical ? "Historical · " : ""}{human(u.execution_status || u.report?.status)}</small></td></tr>)}</tbody></table></div> : <p className="pw-muted">No additional work in this scope.</p>}
    </section>
    <details className="pw-definitions"><summary>How these metrics are calculated</summary>{Object.entries(data.definitions).map(([key, value]) => <p key={key}><strong>{human(key)}:</strong> {value}</p>)}</details>
  </div>;
}
