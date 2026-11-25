import { useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, CalendarRange, ListChecks, Flag, BarChart3, Download, CheckCheck, Plus, RefreshCw, ArrowRight, FileText, Pencil } from 'lucide-react';
import Projects from './Projects';
import { getProjects } from '../api/client';
import { planning, exportPlanning, localDate } from '../api/projectPlanning';
import ProjectPlanForm, { Field, Modal } from '../components/ProjectPlanForm';
import { TargetForm, MonthlyEditor, ReportForm, UnplannedForm, UnplannedDetails, UnplannedActions, UnplannedExecutionForm, UnplannedVisitForm, ApprovalCard, Performance, Badge, Empty, human, dateLabel } from '../components/ProjectPlanningPanels';
import './project-workspace.css';

const TABS = [['overview', 'Overview', BriefcaseBusiness], ['deliverables', 'Deliverables', Flag], ['monthly', 'Monthly planning', CalendarDays], ['weekly', 'Weekly view', CalendarRange], ['daily', 'Daily work', ListChecks], ['approvals', 'Approvals', CheckCheck], ['performance', 'Performance', BarChart3], ['reports', 'Reports', Download]];

function WorkCard({ task, onReport }) {
  return <article className="pw-work-card"><div className="pw-panel-head"><span className="pw-project-label">{task.project_name}</span><Badge value={task.status} /></div><h3>{task.output}</h3><p>{task.activity} · {task.task}</p><div className="pw-work-meta"><span>{task.quantity} {task.unit} planned</span><span>{task.actual_quantity} actual</span><span>{task.hours}h estimated</span></div>{task.note && <p className="pw-work-note">{task.note}</p>}{task.evidence && <a href={task.evidence} target="_blank" rel="noreferrer">View evidence ↗</a>}{onReport && <button className="pw-button pw-soft" onClick={onReport}><FileText size={16} />{task.reported ? 'Update report' : 'Report progress'}</button>}</article>;
}

function TargetReview({ target, onClose, onSaved }) {
  const [assessment, setAssessment] = useState(target.assessment || '');
  const [corrective, setCorrective] = useState(target.corrective_action || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try { await planning(`/targets/${target._id}/review`, { version: target.version, assessment, corrective_action: corrective }, 'PATCH'); await onSaved(); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title="Monthly target review" onClose={onClose}><form onSubmit={save} className="pw-form"><div className="pw-form-body"><h3>{target.output}</h3><p>{target.employee_name} · {target.quantity} {target.unit}</p>{error && <p role="alert" className="pw-notice pw-error">{error}</p>}<Field label="Manager assessment"><textarea required rows={4} value={assessment} onChange={e => setAssessment(e.target.value)} /></Field><Field label="Carry-forward / corrective action"><textarea rows={3} value={corrective} onChange={e => setCorrective(e.target.value)} /></Field><p className="pw-muted">Carry-forward notes do not create tasks automatically. Assign next month's target with its actual dates.</p></div><footer><button type="button" className="pw-button" onClick={onClose}>Cancel</button><button className="pw-button pw-primary" disabled={busy}>Save review</button></footer></form></Modal>;
}

export default function ProjectWorkspace(props) {
  const [tab, setTab] = useState(() => { const requested = sessionStorage.getItem('yourcomate-project-tab'); sessionStorage.removeItem('yourcomate-project-tab'); return TABS.some(t => t[0] === requested) ? requested : 'overview'; });
  const [period, setPeriod] = useState(localDate().slice(0, 7));
  const [day, setDay] = useState(localDate());
  const [employee, setEmployee] = useState('');
  const [options, setOptions] = useState(null);
  const [projects, setProjects] = useState([]);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [filters, setFilters] = useState({ date_from: `${period.slice(0, 4)}-01-01`, date_to: localDate(), department: '', function: '', project_id: '', team_id: '', employee_id: '', status: '' });
  const [reportType, setReportType] = useState('employee');
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);
  const isOwn = employee === options?.current_employee?.id;
  const refresh = async () => { setRevision(v => v + 1); };
  const showNotice = (message, failed = false) => setNotice({ message, failed });
  useEffect(() => {
    let current = true;
    Promise.all([planning('/options'), getProjects({ limit: 500 })]).then(([o, p]) => {
      if (!current) return;
      setOptions(o); setProjects(p.items || []);
      setEmployee(value => value || o.current_employee?.id || o.employees[0]?.id || '');
      setError('');
    }).catch(e => current && setError(e.message)).finally(() => current && setInitialLoading(false));
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    if (!options || !employee) { setLoading(false); return; }
    const requestId = ++seq.current;
    setLoading(true); setError(''); setData({});
    const args = { month: period, employee_id: employee };
    let work;
    if (tab === 'monthly') work = Promise.all([planning('/targets', args), planning('/monthly', args)]).then(([t, p]) => ({ targets: t.items, plan: p.item }));
    else if (tab === 'weekly' || tab === 'daily') {
      const first = new Date(`${day}T12:00:00`);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const last = new Date(first); last.setDate(last.getDate() + 6);
      const format = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const extraMonths = [...new Set((tab === 'daily' ? [day] : [format(first), format(last)]).map(d => d.slice(0, 7)))];
      const unplannedRequest = Promise.all(extraMonths.map(month => planning('/unplanned', { month, employee_id: employee }))).then(results => ({ items: results.flatMap(r => r.items || []) }));
      work = Promise.all([planning('/schedule', { employee_id: employee, date_from: tab === 'daily' ? day : format(first), date_to: tab === 'daily' ? day : format(last) }), planning('/monthly', { month: day.slice(0, 7), employee_id: employee }), unplannedRequest, isOwn ? planning('/checkout-readiness', { date: day }) : Promise.resolve(null)]).then(([s, p, u, r]) => ({ days: s.days, plan: p.item, unplanned: u.items, readiness: r }));
    } else if (tab === 'approvals') work = planning('/approvals');
    else if (tab === 'performance' || tab === 'reports') work = planning('/performance', filters).then(performance => ({ performance }));
    else work = Promise.resolve({});
    work.then(result => { if (seq.current === requestId) setData(result); }).catch(e => { if (seq.current === requestId) setError(e.message); }).finally(() => { if (seq.current === requestId) setLoading(false); });
    return () => { seq.current++; };
  }, [tab, period, day, employee, options, revision, filters, isOwn]);

  async function download() {
    setExporting(true);
    try { await exportPlanning({ ...filters, report: reportType }); showNotice('Excel report downloaded.'); } catch (e) { showNotice(e.message, true); } finally { setExporting(false); }
  }
  function updateFilter(key, value) { setFilters(f => ({ ...f, [key]: value })); }
  const selectedProjects = projects.filter(p => !projectFilter || p._id === projectFilter);
  const approvalCount = (data.plans?.length || 0) + (data.unplanned?.filter(u => u.approval_status === 'submitted').length || 0);
  return <div className="pw-workspace">
    <header className="pw-hero"><div><span className="pw-eyebrow">WORK & PLANNING</span><h1>Projects<span>From plans to progress.</span></h1><p>Deliverables, monthly priorities and everyday work. One connected workspace.</p></div><div className="pw-actions"><button className="pw-button" onClick={refresh} aria-label="Refresh projects" disabled={initialLoading}><RefreshCw size={17} /></button>{options?.can_create && <button className="pw-button pw-primary" onClick={() => setModal({ type: 'project' })}><Plus size={17} /> New project</button>}</div></header>
    <nav className="pw-tabs" aria-label="Projects workspace">{TABS.map(([id, label, Icon]) => <button type="button" key={id} onClick={() => { setTab(id); setNotice(null); }} className={tab === id ? 'is-active' : ''} aria-current={tab === id ? 'page' : undefined}><Icon size={17} />{label}</button>)}</nav>
    {notice && <div role={notice.failed ? 'alert' : 'status'} className={`pw-notice ${notice.failed ? 'pw-error' : 'pw-success'}`}>{notice.message}<button className="pw-icon" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
    {error && <div role="alert" className="pw-notice pw-error">{error}<button className="pw-button" onClick={refresh}>Retry</button></div>}
    {!!options?.delegated_teams?.length && <div className="pw-notice" role="status">{options.delegated_teams.map(t => <p key={t.team_id}><strong>{t.status === 'acting' ? 'Acting Team Leader' : 'Replacement Team Leader'}</strong> · {t.previous_leader.name}'s team · {t.members.length} mapped members</p>)}</div>}
    {initialLoading ? <div className="pw-skeleton" aria-label="Loading projects"><i /><i /><i /></div> : options && <>
      {['monthly', 'weekly', 'daily'].includes(tab) && <div className="pw-toolbar"><Field label={tab === 'monthly' ? 'Planning month' : tab === 'weekly' ? 'Week containing' : 'Work date'}>{tab === 'monthly' ? <input type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} /> : <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} />}</Field>
        <Field label="Employee"><select value={employee} onChange={e => setEmployee(e.target.value)}>{options.employees.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === options.current_employee?.id ? ' · You' : ''}</option>)}</select></Field>
        <span className="pw-spacer" />{tab === 'monthly' && options.can_manage && <button className="pw-button pw-primary" onClick={() => setModal({ type: 'target' })}><Plus size={16} /> Assign monthly work</button>}{tab === 'daily' && isOwn && <button className="pw-button" onClick={() => setModal({ type: 'unplanned' })}><Plus size={16} /> Request unplanned work</button>}
      </div>}
      {['performance', 'reports'].includes(tab) && <section className="pw-filters"><div className="pw-panel-head"><div><h2>{tab === 'performance' ? 'Performance & delivery' : 'Excel reports'}</h2><p>{options.organisation_access ? 'Organisation-wide visibility within your company.' : 'Individual details are limited to your reporting scope.'}</p></div><Field label="Quick period"><select value="" onChange={e => { if (!e.target.value) return; const now = localDate(); setFilters(f => ({ ...f, date_from: e.target.value === 'year' ? `${now.slice(0, 4)}-01-01` : `${now.slice(0, 7)}-01`, date_to: now })); }}><option value="">Custom dates</option><option value="month">This month</option><option value="year">This year</option></select></Field></div>
        <div className="pw-grid pw-grid-four"><Field label="From"><input type="date" value={filters.date_from} onChange={e => e.target.value && updateFilter('date_from', e.target.value)} /></Field><Field label="To"><input type="date" value={filters.date_to} onChange={e => e.target.value && updateFilter('date_to', e.target.value)} /></Field>
          <Field label="Department"><select value={filters.department} onChange={e => updateFilter('department', e.target.value)}><option value="">All authorised departments</option>{options.departments.map(d => <option key={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Function"><select value={filters.function} onChange={e => updateFilter('function', e.target.value)}><option value="">All functions</option>{options.master.functions.map(f => <option key={f}>{f}</option>)}</select></Field>
          <Field label="Project"><select value={filters.project_id} onChange={e => updateFilter('project_id', e.target.value)}><option value="">All scoped projects</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
          <Field label="Team Leader"><select value={filters.team_id} onChange={e => updateFilter('team_id', e.target.value)}><option value="">All authorised teams</option>{(options.monitoring_team_leaders || options.team_leaders).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Employee"><select value={filters.employee_id} onChange={e => updateFilter('employee_id', e.target.value)}><option value="">All authorised employees</option>{options.employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Activity status"><select value={filters.status} onChange={e => updateFilter('status', e.target.value)}><option value="">All statuses</option>{['completed', 'pending', 'not_completed', 'unreported'].map(s => <option value={s} key={s}>{human(s)}</option>)}</select></Field>
        </div></section>}
      {loading && tab !== 'overview' && tab !== 'deliverables' ? <div className="pw-skeleton" aria-label="Loading workspace"><i /><i /><i /></div> : <>
        {tab === 'overview' && <div className="pw-legacy"><Projects {...props} key={revision} onCreateProject={() => setModal({ type: 'project' })} /></div>}
        {tab === 'deliverables' && <section className="pw-panel"><div className="pw-panel-head"><div><h2>Deliverables & timelines</h2><p>Contractual milestones stay linked to every month's work.</p></div><Field label="Project"><select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="">All scoped projects</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field></div>
          {!selectedProjects.length && <Empty title="No projects yet">Your assigned projects will appear here.</Empty>}
          {selectedProjects.map(p => <article className="pw-project-deliverables" key={p._id}><div className="pw-panel-head"><div><span className="pw-eyebrow">{p.project_code || 'EXISTING PROJECT'} · {p.department}</span><h3>{p.name}</h3><p>{p.function || 'Function not configured'} · {dateLabel(p.start_date)} – {dateLabel(p.due_date)}</p>{p.project_type === 'client' && <p>Client: {p.client_name}</p>}</div>{p.can_manage_project_team && <button className="pw-button" onClick={() => setModal({ type: 'project', project: p })}><Pencil size={15} />{p.planning_schema === 1 ? 'Edit details' : 'Configure planning'}</button>}</div>
            {!p.deliverables?.length ? <p className="pw-notice">Add dates, function and deliverables to begin monthly planning for this existing project.</p> : <div className="pw-deliverables">{p.deliverables.map(d => <article key={d.id}><div className="pw-deliverable-title"><span className="pw-eyebrow">DELIVERABLE</span><h4>{d.title}</h4><p>{d.notes}</p></div><div className="pw-deliverable-time"><span className="pw-eyebrow">CONTRACT TIMELINE</span><strong>{dateLabel(d.due_date)}</strong><Badge value={d.status} /></div></article>)}</div>}
          </article>)}</section>}
        {tab === 'monthly' && data.plan && <><section className="pw-panel"><div className="pw-panel-head"><div><h2>Assigned monthly targets</h2><p>{period} · {data.targets.length} targets across {new Set(data.targets.map(t => t.project_id)).size} projects</p></div></div><div className="pw-targets">{data.targets.map(t => <article key={t._id}><span className="pw-project-label">{t.project_name}</span><h3>{t.output}</h3><p>{t.quantity} {t.unit} · due {dateLabel(t.due_date)}</p><small>{t.function} → {t.activity}</small>{t.expected_evidence && <p className="pw-muted">Evidence: {t.expected_evidence}</p>}{projects.find(p => p._id === t.project_id)?.can_manage_project_team && <button className="pw-button pw-text" onClick={() => setModal({ type: 'target-review', target: t })}>Monthly review <ArrowRight size={14} /></button>}</article>)}</div>{!data.targets.length && <Empty title="No assignments for this month">The Team Leader assigns a monthly output before the employee plans dated activities.</Empty>}</section><MonthlyEditor key={`${data.plan._id}:${data.plan.version}`} plan={data.plan} targets={data.targets} options={options} isOwn={isOwn} onRefresh={refresh} onNotice={showNotice} /></>}
        {(tab === 'daily' || tab === 'weekly') && data.days && <>
          {tab === 'daily' && data.readiness && <div className={`pw-readiness ${data.readiness.checkout_allowed ? 'pw-ready' : ''}`}><div><strong>{data.readiness.checkout_allowed ? 'Daily reporting complete' : `${data.readiness.missing_tasks.length} activity report${data.readiness.missing_tasks.length === 1 ? '' : 's'} needed before checkout`}</strong><p>{data.readiness.exception || `${data.readiness.reported_count} of ${data.readiness.required_count} required activities reported. Pending and Not Completed also count as reported.`}</p></div><CheckCheck size={25} /></div>}
          <div className={tab === 'weekly' ? 'pw-week' : 'pw-day'}>{data.days.map(d => <section className="pw-day-section" key={d.date}><header><h2>{dateLabel(d.date)}</h2><span>{d.tasks.length} planned activities{data.unplanned.some(u => u.date === d.date && u.workflow_version === 3 && u.approval_status === "approved") ? ` · ${data.unplanned.filter(u => u.date === d.date && u.workflow_version === 3 && u.approval_status === "approved").length} approved additional` : ""}</span></header>{d.exception && <p className="pw-notice">{d.exception}</p>}{d.tasks.length ? d.tasks.map(t => <WorkCard key={t.id} task={t} onReport={tab === 'daily' && isOwn && day <= localDate() ? () => setModal({ type: 'report', task: t, plan: data.plan }) : undefined} />) : <p className="pw-day-empty">No scheduled planned activities.</p>}{tab === "weekly" && data.unplanned.filter(u => u.date === d.date && u.workflow_version === 3 && u.approval_status === "approved").map(u => <article className="pw-work-card" key={u._id}><span className="pw-eyebrow">APPROVED ADDITIONAL WORK</span><h3>{u.output}</h3><Badge value={u.execution_status} /><UnplannedDetails item={u} /></article>)}</section>)}</div>
          {tab === 'daily' && <section className="pw-panel"><h2>Unplanned work</h2>{data.unplanned.filter(u => u.date === day).map(u => <article className="pw-unplanned" key={u._id}><div className="pw-panel-head"><div><span className="pw-project-label">{u.project_name}</span><h3>{u.output}</h3></div><Badge value={u.approval_status} /></div><UnplannedDetails item={u} /><p>{u.reason}</p><p><strong>{human(u.execution_status || u.report.status)}:</strong> {u.report.note}</p>{u.review_remarks && <p>Reviewer: {u.review_remarks}</p>}{isOwn && <UnplannedActions key={`${u._id}:${u.version}`} item={u} onRevise={() => setModal({ type: 'unplanned', existing: u })} onVisit={() => setModal({ type: 'unplanned-visit', item: u })} onReport={() => setModal({ type: 'unplanned-execution', item: u })} onOpenVisit={() => props.setPage?.('my_visits')} onSaved={refresh} onNotice={showNotice} />}</article>)}{!data.unplanned.some(u => u.date === day) && <p className="pw-muted">No unplanned work submitted for this date.</p>}</section>}
        </>}
        {tab === 'approvals' && <section className="pw-approval-list"><div className="pw-panel-head"><div><h2>Pending your review</h2><p>Monthly plans and unplanned submissions from your mapped employees.</p></div><span className="pw-count">{approvalCount}</span></div>{data.plans?.map(item => <ApprovalCard kind="monthly" key={item._id} item={item} onSaved={refresh} onNotice={showNotice} />)}{data.unplanned?.map(item => <ApprovalCard kind="unplanned" key={item._id} item={item} onSaved={refresh} onNotice={showNotice} />)}{approvalCount === 0 && <Empty title="You're up to date">No submissions currently require your review.</Empty>}</section>}
        {tab === 'performance' && data.performance && <Performance data={data.performance} onEmployee={id => updateFilter('employee_id', id)} onProject={id => updateFilter('project_id', id)} />}
        {tab === 'reports' && data.performance && <section className="pw-panel pw-export"><div><Download size={30} /><h2>Export the selected scope</h2><p>Your Excel workbook includes summary metrics, daily activities, monthly output reviews, deliverables, unplanned work and metric definitions.</p><p><strong>{data.performance.summary.assigned}</strong> planned activities · <strong>{data.performance.employees.length}</strong> employees · {dateLabel(filters.date_from)} to {dateLabel(filters.date_to)}</p></div><div><Field label="Report type"><select value={reportType} onChange={e => setReportType(e.target.value)}><option value="employee">Employee-wise</option><option value="team">Team-wise</option><option value="project">Project-wise</option>{options.organisation_access && <option value="organisation">Organisation-wide</option>}</select></Field><button className="pw-button pw-primary" disabled={exporting} onClick={download}><Download size={17} />{exporting ? 'Preparing workbook…' : 'Download Excel'}</button></div></section>}
      </>}
      {modal?.type === 'project' && <ProjectPlanForm options={options} project={modal.project} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'target' && <TargetForm options={options} projects={projects} month={period} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'report' && <ReportForm task={modal.task} plan={modal.plan} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'unplanned' && <UnplannedForm options={options} day={day} existing={modal.existing} onDate={setDay} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'unplanned-execution' && <UnplannedExecutionForm item={modal.item} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'unplanned-visit' && <UnplannedVisitForm item={modal.item} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'target-review' && <TargetReview target={modal.target} onClose={() => setModal(null)} onSaved={refresh} />}
    </>}
  </div>;
}
