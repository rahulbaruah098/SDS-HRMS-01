import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ClipboardList, Plus, Trash2, RefreshCw,
  Send, CheckCircle2, Printer, Download, FileText, ChevronDown
} from 'lucide-react';
import {
  createMonthlyPlan, getMonthlyPlans, submitMonthlyPlan, updateMonthlyPlan
} from '../api/sprintPlanning';
import { getMySprintTemplate } from '../api/sprintPlanning';
import SprintMonthlyCustomFields from '../components/SprintMonthlyCustomFields';
import SprintMonthlySavedFields from '../components/SprintMonthlySavedFields';
import { useCustomAlert } from '../components/CustomAlertProvider';
import SprintMonthlyTeamCompilation from './SprintMonthlyTeamCompilation';
import SprintMonthlyApprovalQueue from './SprintMonthlyApprovalQueue';
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
const employeeName = (people, id) => {
  const person = people.get(String(id || '').trim());
  return person?.name || person?.employee_name || 'Employee profile unavailable';
};
const employeeMeta = (people, id) => {
  const person = people.get(String(id || '').trim());
  return [person?.employee_code || person?.employee_id, person?.department || person?.department_name]
    .filter(Boolean).join(' · ') || (person ? 'Employee' : 'Identity unavailable');
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLastDate = month => {
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// Display only: retain the YYYY-MM values used by forms, requests and saved plans.
const displayMonth = value => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) return String(value || '');
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
};

const makeRow = month => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  objective: '', activity: '', deliverable: '', kpi: '',
  target_quantity: '', unit: '', priority: 'medium',
  start_date: `${month}-01`, end_date: monthLastDate(month),
  dependencies: '', weightage: '', remarks: '', weeks: []
});

const labels = {
  draft: 'Draft', submitted: 'Awaiting Approval',
  pending_approval: 'Awaiting Approval', approved: 'Approved',
  rejected: 'Returned / Rejected'
};

const columns = [
  ['objective', 'Objective / KRA', 190],
  ['activity', 'Planned Activity', 245],
  ['deliverable', 'Expected Deliverable', 225],
  ['kpi', 'KPI / Success Criteria', 210],
  ['target_quantity', 'Target Quantity', 120],
  ['unit', 'Unit', 110],
  ['priority', 'Priority', 120],
  ['start_date', 'Start Date', 150],
  ['end_date', 'Target Completion', 155],
  ['responsible_employee', 'Responsible Employee', 175],
  ['dependencies', 'Dependencies / Support', 210],
  ['weightage', 'Weightage (%)', 120],
  ['remarks', 'Remarks', 200]
];

const extract = response => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data?.items)) return response.data.items;
  return [];
};

const csvEscape = value => {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
};

function exportCsv(plan, rows, people = new Map()) {
  const headers = ['Sl. No.', ...columns.map(c => c[1]), 'Weeks'];
  const data = rows.map((row, index) => [
    index + 1,
    ...columns.map(([key]) =>
      key === 'responsible_employee'
        ? (employeeName(people, row.responsible_employee || plan.employee_id) !== 'Employee profile unavailable'
          ? employeeName(people, row.responsible_employee || plan.employee_id)
          : row.responsible_employee || plan.employee_id || '')
        : row[key] ?? ''
    ),
    (row.weeks || []).join(', ')
  ]);
  const csv = '\ufeff' + [
    headers.map(csvEscape).join(','),
    ...data.map(row => row.map(csvEscape).join(','))
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Monthly-Work-Plan-${plan.month || 'sheet'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function SheetTable({ rows, onChange, onRemove, month, readOnly = false, employeeId = '', template = null, employeeLabel = 'Current employee' }) {
  const [selectedKey, setSelectedKey] = useState(() => readOnly ? null : rows[0]?.key || null);
  useEffect(() => {
    if (!readOnly && selectedKey !== null && rows.length && !rows.some(row => row.key === selectedKey)) {
      setSelectedKey(rows[0].key);
    }
  }, [readOnly, rows, selectedKey]);
  const selected = rows.find(row => row.key === selectedKey);
  return (
    <>
    {!readOnly && <div className="mws-summary-hint">Activity overview · Use <strong>Edit</strong> beside any row to enter or change its details in the clearly labeled form below. Scroll horizontally to review every column.</div>}
    <div className="mws-scroll mws-sheet-scroll" role="region" aria-label="Monthly work plan table" tabIndex={0}>
      <table className="mws-table">
        <thead><tr>
          <th className="mws-sticky">Sl. No.</th>
          {columns.map(([key, label, width]) => (
            <th key={key} style={{ minWidth: width }}>{label}</th>
          ))}
          <th style={{ minWidth: 175 }}>Weekly Milestones</th>
          {!readOnly && <th>Action</th>}
        </tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key || index}>
              <td className="mws-sticky mws-number">
                {String(index + 1).padStart(2, '0')}
                {!readOnly && <button type="button" className="mws-row-edit"
                  aria-pressed={selectedKey === row.key}
                  onClick={() => setSelectedKey(row.key)}>
                  {selectedKey === row.key ? 'Editing' : 'Edit'}
                </button>}
              </td>
              {columns.map(([key]) => (
                <td key={key}>
                  {key === 'responsible_employee' ? (
                    <span className="mws-readonly">{employeeLabel || 'Current employee'}</span>
                  ) : (
                    <span className="mws-readonly">{key === 'priority'
                      ? (row[key] || 'medium').replace(/^./, letter => letter.toUpperCase())
                      : (row[key] === '' || row[key] == null ? '—' : String(row[key]))}</span>
                  )}
                </td>
              ))}
              <td>
                {readOnly ? (
                  <span className="mws-readonly">{(row.weeks || []).map(w => `W${w}`).join(', ') || '—'}</span>
                ) : (
                  <div className="mws-weeks">
                    {[1, 2, 3, 4, 5].map(w => (
                      <label key={w}><input type="checkbox" checked={(row.weeks || []).includes(w)}
                        onChange={() => onChange(row.key, 'weeks',
                          (row.weeks || []).includes(w)
                            ? row.weeks.filter(v => v !== w)
                            : [...(row.weeks || []), w].sort()
                        )} />W{w}</label>
                    ))}
                  </div>
                )}
              </td>
              {!readOnly && <td><button type="button" className="mws-delete"
                aria-label={`Remove row ${index + 1}`} disabled={rows.length === 1}
                onClick={() => onRemove(row.key)}><Trash2 size={15}/></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mws-mobile-cards" aria-label="Monthly activities, mobile view">
      {rows.map((row, index) => (
        <article className="mws-mobile-activity" key={row.key || row.row_id || index}>
          <div className="mws-mobile-activity-head">
            <div className="mws-mobile-activity-title">
              <span className="mws-row-index">Activity {String(index + 1).padStart(2, '0')}</span>
              <strong>{row.activity || 'New activity'}</strong>
              <span className="mws-muted">{row.objective || 'Objective not entered'}</span>
            </div>
            <span className="mws-status">{row.priority || 'medium'}</span>
          </div>
          <dl className="mws-mobile-facts">
            <div><dt>Deliverable</dt><dd>{row.deliverable || 'Not entered'}</dd></div>
            <div><dt>Target date</dt><dd>{row.end_date || 'Not set'}</dd></div>
            <div><dt>Weekly milestones</dt><dd>{(row.weeks || []).map(w => `W${w}`).join(', ') || 'Not set'}</dd></div>
            <div><dt>Weightage</dt><dd>{row.weightage === '' || row.weightage == null ? 'Not set' : `${row.weightage}%`}</dd></div>
          </dl>
          {!readOnly && (
            <div className="mws-mobile-actions">
              <button type="button" className="mws-button mws-primary"
                aria-expanded={selectedKey === row.key}
                onClick={() => setSelectedKey(row.key)}>
                {selectedKey === row.key ? 'Editing Activity' : 'Edit Activity Details'}
              </button>
              <button type="button" className="mws-delete" disabled={rows.length === 1}
                aria-label={`Remove activity ${index + 1}`} onClick={() => onRemove(row.key)}>
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
    {/* STEP 44B.53D.1 - Historical custom fields */}
    {readOnly && template?.columns?.length > 0 && (
      <SprintMonthlySavedFields template={template} rows={rows} />
    )}
    {!readOnly && selected && (
      <section className="mws-editor">
        <div className="mws-section-head">
          <div>
                         <h3 style={{margin:'0 0 5px'}}>Edit Activity Details</h3>
            <span className="mws-row-index">{selected.activity || 'New activity'}</span>
                         <span className="mws-muted">Complete each labeled field below. The activity summary above updates automatically as you type.</span>
          </div>
          <button type="button" className="mws-button"
            onClick={() => setSelectedKey(null)}>Close Editor</button>
        </div>
        <div className="mws-editor-grid">
          {columns.filter(([key]) => key !== 'responsible_employee').map(([key, label]) => (
            <div className="mws-field" key={key}>
              <label htmlFor={`mws-edit-${key}`}>{label}</label>
              {key === 'priority' ? (
                <select id={`mws-edit-${key}`} value={selected.priority}
                  onChange={e => onChange(selected.key, key, e.target.value)}>
                  {['critical','high','medium','low'].map(item =>
                    <option value={item} key={item}>{item[0].toUpperCase() + item.slice(1)}</option>
                  )}
                </select>
              ) : (
                <input id={`mws-edit-${key}`}
                  type={key.includes('date') ? 'date' :
                    key === 'weightage' || key === 'target_quantity' ? 'number' : 'text'}
                  min={key.includes('date') ? `${month}-01` :
                    key === 'weightage' || key === 'target_quantity' ? '0' : undefined}
                  max={key.includes('date') ? monthLastDate(month) :
                    key === 'weightage' ? '100' : undefined}
                  step={key === 'weightage' || key === 'target_quantity' ? '0.01' : undefined}
                  value={selected[key] ?? ''}
                  onChange={e => onChange(selected.key, key, e.target.value)}
                                     placeholder={key === 'objective' ? 'e.g. Improve IT response times' : key === 'activity' ? 'What will you do?' : key === 'kpi' ? 'How will success be measured?' : label}
                />
              )}
            </div>
          ))}
        </div>
        <div style={{marginTop:15}}>
          <strong style={{fontSize:13}}>Weekly Milestones</strong>
          <div className="mws-editor-weeks">
            {[1,2,3,4,5].map(week => (
              <label key={week}>
                <input type="checkbox"
                  checked={(selected.weeks || []).includes(week)}
                  onChange={() => onChange(selected.key, 'weeks',
                    (selected.weeks || []).includes(week)
                      ? selected.weeks.filter(w => w !== week)
                      : [...(selected.weeks || []),week].sort()
                  )}
                />
                Week {week}
              </label>
            ))}
          </div>
        </div>
        <p className="mws-muted">Changes are reflected immediately in the table. Save the Monthly Sheet to store your plan.</p>
      </section>
    )}
    </>
  );
}

export default function SprintMonthlyPlanning() {
  const { notify, confirm: customConfirm } = useCustomAlert();
  const [month, setMonth] = useState(currentMonth);
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState(() => [makeRow(currentMonth())]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingId, setSubmittingId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [editingId, setEditingId] = useState('');
  // STEP 44B.53C.6 - Department template state
  const [latestMonthlyTemplate, setLatestMonthlyTemplate] = useState(null);
  const [activeMonthlyTemplate, setActiveMonthlyTemplate] = useState(null);
  const [monthlyTemplateLoading, setMonthlyTemplateLoading] = useState(true);
     const [monthlyTemplateError, setMonthlyTemplateError] = useState('');
   const [employeeLookup, setEmployeeLookup] = useState(() => new Map());
   const [directoryWarning, setDirectoryWarning] = useState(false);

  const [editingStatus, setEditingStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(extract(await getMonthlyPlans()));
    } catch (error) {
      notify({ type: 'error', title: 'Unable to load monthly plans', message: error?.message || 'Request failed' });
    } finally {
      setLoading(false);
    }
  }, [notify]);

     useEffect(() => { load(); }, [load]);

   useEffect(() => {
     let active = true;
     (async () => {
       try {
         const response = await getEmployeeDirectory({limit: 500});
         if (active) {
           setEmployeeLookup(employeeById(directoryItems(response)));
           setDirectoryWarning(false);
         }
       } catch {
         if (active) setDirectoryWarning(true);
       }
     })();
     return () => { active = false; };
   }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setMonthlyTemplateLoading(true);
        setMonthlyTemplateError('');
        const response = await getMySprintTemplate('monthly');
        if (!active) return;
        const assigned = response?.sprint_enabled === true &&
          response?.template_configured === true
          ? response.template : null;
        setLatestMonthlyTemplate(assigned);
        if (!editingId) setActiveMonthlyTemplate(assigned);
      } catch (error) {
        if (!active) return;
        setMonthlyTemplateError(
          error?.message || 'Unable to verify the monthly department template.',
        );
      } finally {
        if (active) setMonthlyTemplateLoading(false);
      }
    })();
    return () => { active = false; };
    // A saved plan's template is restored separately when editing.
  }, []);

  const updateCustomMonthlyField = (rowKey, columnKey, value) => {
    setRows(previous => previous.map(row =>
      row.key === rowKey
        ? {
            ...row,
            custom_values: {
              ...(row.custom_values || {}),
              [columnKey]: value,
            },
          }
        : row
    ));
  };


  const update = (key, field, value) => {
    setRows(old => old.map(row => row.key === key ? { ...row, [field]: value } : row));
  };

  const editSavedPlan = plan => {
    const id = String(plan._id || plan.id || '');
    const status = String(plan.status || 'draft').toLowerCase();

    if (!['draft', 'rejected'].includes(status)) return;

    const savedRows = Array.isArray(plan.sheet_rows) && plan.sheet_rows.length
      ? plan.sheet_rows
      : (plan.goals || []).map(goal => ({
          activity: typeof goal === 'string' ? goal : String(goal?.activity || ''),
          objective: '',
          deliverable: '',
          kpi: '',
        }));

    const restored = savedRows.map(row => ({
      ...makeRow(plan.month),
      ...row,
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));

    setActiveMonthlyTemplate(plan.sprint_template_snapshot || null);
    setEditingId(id);
    setEditingStatus(status);
    setMonth(plan.month);
    setTitle(plan.title || '');
    setRows(restored.length ? restored : [makeRow(plan.month)]);

    notify({
      type: 'success',
      title: 'Plan loaded for editing',
      message: 'Update the sheet and select Save Monthly Sheet.',
    });

    document.querySelector('.mws-page')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const cancelEditing = () => {
    setActiveMonthlyTemplate(latestMonthlyTemplate);

    setEditingId('');
    setEditingStatus('');
    setTitle('');
    setRows([makeRow(month)]);
  };

  const totalWeight = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.weightage) || 0), 0),
    [rows]
  );

  const switchMonth = value => {
    setMonth(value);
    setRows(current => current.map(row => ({
      ...row,
      start_date: `${value}-01`,
      end_date: monthLastDate(value)
    })));
  };

  const save = async event => {
    event.preventDefault();
    if (!title.trim() || !month) {
      notify({ type: 'warning', title: 'Missing details', message: 'Enter a title and planning month.' });
      return;
    }
    if (rows.length === 0 || rows.length > 100) {
      notify({ type: 'warning', title: 'Invalid number of rows', message: 'Include between 1 and 100 activities.' });
      return;
    }
    if (totalWeight > 100) {
      notify({ type: 'warning', title: 'Invalid weightage', message: 'Combined weightage cannot exceed 100%.' });
      return;
    }
    for (const [index, row] of rows.entries()) {
      if (!row.objective.trim() || !row.activity.trim() || !row.deliverable.trim() || !row.kpi.trim()) {
        notify({ type: 'warning', title: 'Incomplete activity', message: `Complete the objective, activity, deliverable and KPI in row ${index + 1}.` });
        return;
      }
      if (!row.start_date || !row.end_date || row.start_date > row.end_date ||
          !row.start_date.startsWith(month) || !row.end_date.startsWith(month)) {
        notify({ type: 'warning', title: 'Invalid dates', message: `Check the dates in row ${index + 1}.` });
        return;
      }
    }
    if (monthlyTemplateLoading || monthlyTemplateError) {
      notify({
        type: 'error',
        title: 'Template verification required',
        message: monthlyTemplateError || 'Department template is still loading.',
      });
      return;
    }

    if (activeMonthlyTemplate?.columns?.length) {
      for (const [index, row] of rows.entries()) {
        for (const column of activeMonthlyTemplate.columns) {
          const value = row.custom_values?.[column.key];
          const missing = value === undefined || value === null ||
            (typeof value === 'string' && !value.trim());
          // STEP 44B.53G.8F.24
          // Required file uploads happen after draft creation.
          if (column.required && missing && column.type !== 'file') {
            notify({
              type: 'warning',
              title: 'Incomplete department planning fields',
              message: `Row ${index + 1}: ${column.label} is required.`,
            });
            return;
          }
        }
      }
    }

    setSaving(true);
    try {
      const payload = {
        month, title: title.trim(),
        goals: rows.map(row => row.activity.trim()),
        sheet_rows: rows.map(({ key, ...fields }) => ({
          ...fields,
          ...(activeMonthlyTemplate?.columns?.length
            ? { custom_values: fields.custom_values || {} }
            : {}),
        }))
      };

      if (editingId) {
        await updateMonthlyPlan(editingId, payload);
      } else {
        await createMonthlyPlan(payload);
      }
      notify({
        type: 'success',
        title: editingId ? 'Monthly sheet updated' : 'Monthly sheet saved',
        message: editingId
          ? 'Your changes were saved. Submit the plan for approval.'
          : 'Your draft has been created. Submit it for approval.',
      });
      setEditingId('');
      setEditingStatus('');
      setTitle('');
      setRows([makeRow(month)]);
      await load();
    } catch (error) {
      notify({ type: 'error', title: 'Unable to save monthly sheet', message: error?.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const submit = async plan => {
    const id = String(plan._id || plan.id || '');
    const yes = await customConfirm(
      'Submit this monthly work plan to your Reporting Team Leader for approval?',
      { title: 'Submit Monthly Work Plan', confirmText: 'Submit Plan' }
    );
    if (!yes) return;
    setSubmittingId(id);
    try {
      await submitMonthlyPlan(id);
      notify({ type: 'success', title: 'Plan submitted', message: 'Sent to your Reporting Team Leader.' });
      await load();
    } catch (error) {
      notify({ type: 'error', title: 'Submission failed', message: error?.message || 'Request failed.' });
    } finally {
      setSubmittingId('');
    }
  };

  return (
    <div className="mws-page">
      <style>{`
        .mws-page { max-width:100%;padding:clamp(12px,2vw,25px);color:var(--text,#202846); }
        .mws-head,.mws-toolbar,.mws-section-head { display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap; }
        .mws-eyebrow { color:#6253cc;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase; }
        .mws-head h1 { margin:5px 0;font-size:clamp(21px,2.6vw,30px); }
        .mws-muted { font-size:12px;color:#78849d;line-height:1.6; }
        .mws-card { margin-top:17px;padding:clamp(14px,2vw,25px);border:1px solid #e0e5f3;border-radius:17px;background:linear-gradient(140deg,#fff,#fafaff);box-shadow:0 8px 30px #2727680a; }
        .mws-meta { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:17px 0; }
        .mws-field { min-width:0; }
        .mws-field label { display:block;margin-bottom:7px;color:#64748b;font-size:12px;font-weight:700; }
        .mws-field input,.mws-table input,.mws-table select { box-sizing:border-box;width:100%;min-width:90px;border:1px solid #dce2ef;border-radius:8px;padding:10px;background:#fff;color:#24314d;font:inherit;font-size:12px; }
        .mws-field input:focus,.mws-table input:focus,.mws-table select:focus { outline:2px solid #9a91ec;outline-offset:1px; }
        .mws-scroll { width:100%;overflow:auto;border:1px solid #dfe4f1;border-radius:12px;margin-top:15px; }
        .mws-table { border-collapse:separate;border-spacing:0;min-width:1950px;width:100%;font-size:12px; }
        .mws-table th { position:sticky;top:0;background:#eeeefe;color:#37336a;text-align:left;padding:12px;white-space:nowrap;border-bottom:1px solid #d7daf0;z-index:2; }
        .mws-table td { border-bottom:1px solid #edf0f7;padding:9px;vertical-align:middle; }
        .mws-table tbody tr:nth-child(even) { background:#fafbff; }
        .mws-table tbody tr:hover { background:#f4f3ff; }
        .mws-table .mws-sticky { position:sticky;left:0;z-index:3;min-width:55px;background:#f5f5ff; }
        .mws-number { text-align:center;font-weight:800;color:#5549bd; }
        .mws-table th:nth-child(1),.mws-table td:nth-child(1) {left:0;min-width:68px;max-width:68px;z-index:4;}
        .mws-table th:nth-child(2),.mws-table td:nth-child(2) {
          position:sticky;left:68px;min-width:190px;background:#f8f8ff;z-index:3;
        }
        .mws-table th:nth-child(3),.mws-table td:nth-child(3) {
          position:sticky;left:258px;min-width:245px;background:#f8f8ff;z-index:3;
        }
        .mws-table th:nth-child(2),.mws-table th:nth-child(3) {
          background:#eeeefe;z-index:5;
        }
        .mws-row-edit {display:block;margin:6px auto 0;padding:4px 7px;
          border:1px solid #cdc7fa;background:#fff;color:#5142ce;
          font-size:10px;font-weight:800;border-radius:6px;cursor:pointer;}
        .mws-editor {margin-top:16px;padding:19px;border:1px solid #dcd9fb;
          background:#fafaff;border-radius:13px;}
        .mws-editor-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
          gap:14px;margin-top:18px;}
        .mws-editor-grid select {width:100%;padding:10px;border:1px solid #dce2ef;
          border-radius:8px;background:#fff;color:#24314d;}
        .mws-editor-weeks {display:flex;flex-wrap:wrap;gap:15px;margin-top:12px;}
        .mws-editor-weeks label {display:flex;align-items:center;gap:6px;font-size:13px;}
        @media(max-width:900px) {.mws-editor-grid {grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media(max-width:560px) {.mws-editor-grid {grid-template-columns:1fr;}}
        @media print {.mws-editor,.mws-row-edit {display:none!important;}}
        .mws-readonly { display:block;min-width:100px;white-space:normal;overflow-wrap:anywhere; }
        .mws-weeks { display:flex;gap:5px;flex-wrap:wrap; }
        .mws-weeks label { display:flex;align-items:center;gap:3px;white-space:nowrap;font-size:11px; }
        .mws-weeks input { width:auto;min-width:0; }
        .mws-button { border:1px solid #dce2f1;background:#fff;color:#313c61;border-radius:9px;padding:10px 13px;display:inline-flex;align-items:center;gap:7px;cursor:pointer;font:inherit;font-size:12px;font-weight:750; }
        .mws-primary { background:#5142ce;color:#fff;border-color:#5142ce; }
        .mws-button:disabled,.mws-delete:disabled { opacity:.5;cursor:not-allowed; }
        .mws-delete { border:1px solid #fee2e2;background:#fff5f5;color:#b91c1c;border-radius:8px;padding:9px;cursor:pointer; }
        .mws-stats { display:flex;gap:10px;flex-wrap:wrap;margin:15px 0; }
        .mws-stat { background:#f3f3ff;border:1px solid #e5e4ff;border-radius:10px;padding:10px 15px;font-size:12px; }
        .mws-stat strong { display:block;font-size:20px;color:#4940b0;margin-top:4px; }
        .mws-history { padding:15px;border:1px solid #e2e5f1;border-radius:12px;margin-top:12px; }
        .mws-status { border-radius:20px;padding:5px 10px;background:#f2f0ff;color:#4b3fc1;font-size:11px;font-weight:800; }
        .mws-approval { padding:10px 13px;background:#f8f9ff;border-radius:9px;margin-top:12px;font-size:12px;color:#53617b; }
        @media(max-width:850px) { .mws-meta {grid-template-columns:repeat(2,minmax(0,1fr));} }
        @media(max-width:480px) { .mws-meta {grid-template-columns:1fr;} }
        @media print {
          .mws-no-print {display:none!important;}
          .mws-page {padding:0;}
          .mws-card {box-shadow:none;border:0;}
          .mws-scroll {overflow:visible;border:0;}
          .mws-table {min-width:0;font-size:8px;}
          .mws-table th,.mws-table td {padding:4px;}
          @page {size:A3 landscape;margin:12mm;}
        }
        /* Responsive refinements: reuse shared HRMS theme tokens without changing form logic. */
        .mws-page {
          --mws-accent: var(--primary, var(--primary-color, #5142ce));
          --mws-surface: var(--surface, var(--card-bg, #ffffff));
          --mws-surface-soft: var(--surface-secondary, #f8fafc);
          --mws-border: var(--border, #e2e8f0);
          --mws-text: var(--text, #202846);
          --mws-muted: var(--text-muted, #64748b);
          width:100%;min-width:0;box-sizing:border-box;
          color:var(--mws-text);
        }
        .mws-page * { box-sizing:border-box; }
        .mws-card,.mws-history,.mws-mobile-activity,.mws-editor {
          background:var(--mws-surface);border-color:var(--mws-border);
          color:var(--mws-text);
        }
        .mws-card { box-shadow:0 4px 20px rgba(15,23,42,.045); }
        .mws-head h1 { display:flex;align-items:center;gap:10px;line-height:1.25; }
        .mws-muted,.mws-field label { color:var(--mws-muted); }
        .mws-eyebrow { color:var(--mws-accent); }
        .mws-title-field { grid-column:span 2; }
        .mws-button { justify-content:center;min-height:42px;white-space:normal;text-align:center; }
        .mws-primary { background:var(--mws-accent);border-color:var(--mws-accent);color:#fff; }
        .mws-button:focus-visible,.mws-delete:focus-visible,.mws-row-edit:focus-visible {
          outline:3px solid var(--mws-accent);outline-offset:3px;
        }
        .mws-field input,.mws-editor-grid select,.mws-table input,.mws-table select {
          background:var(--mws-surface);color:var(--mws-text);border-color:var(--mws-border);
          min-height:42px;font-size:14px;
        }
        .mws-stat { background:var(--mws-surface-soft);border-color:var(--mws-border);flex:1 1 155px; }
        .mws-stat strong { color:var(--mws-accent); }
        .mws-status { background:var(--mws-surface-soft);color:var(--mws-accent);border:1px solid var(--mws-border); }
        .mws-approval { background:var(--mws-surface-soft);color:var(--mws-text); }
        .mws-scroll { max-width:100%;overscroll-behavior-x:contain; }
        .mws-mobile-cards,.mws-mobile-hint { display:none; }
        .mws-row-index { display:block;font-size:12px;font-weight:750;color:var(--mws-accent); }
        .mws-file-help { margin:14px 0 6px;padding:11px 13px;background:var(--mws-surface-soft);border:1px solid var(--mws-border);border-radius:10px; }
        .mws-history { overflow-wrap:anywhere; }
        .mws-history .mws-section-head > div { min-width:0; }
        @media (max-width:760px) {
          .mws-page { padding:12px 8px; }
          .mws-head { align-items:flex-start; }
          .mws-head h1 { font-size:clamp(20px,5vw,26px); }
          .mws-card { padding:16px 12px;border-radius:14px; }
          .mws-title-field { grid-column:auto; }
          .mws-meta { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .mws-editor-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .mws-desktop-hint,.mws-scroll { display:none; }
          .mws-mobile-hint,.mws-mobile-cards { display:block; }
          .mws-mobile-cards { margin-top:14px; }
          .mws-mobile-activity { border:1px solid var(--mws-border);border-radius:13px;padding:14px;margin-bottom:10px; }
          .mws-mobile-activity-head { display:flex;justify-content:space-between;gap:10px;align-items:flex-start; }
          .mws-mobile-activity-title { display:flex;flex-direction:column;gap:5px;min-width:0;overflow-wrap:anywhere; }
          .mws-mobile-activity-title strong { font-size:14px;line-height:1.45; }
          .mws-mobile-facts { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0; }
          .mws-mobile-facts > div { min-width:0; }
          .mws-mobile-facts dt { color:var(--mws-muted);font-size:11px;font-weight:650; }
          .mws-mobile-facts dd { margin:4px 0 0;font-size:13px;overflow-wrap:anywhere; }
          .mws-mobile-actions { display:flex;gap:8px;align-items:center; }
          .mws-mobile-actions .mws-button { flex:1; }
          .mws-mobile-actions .mws-delete { min-height:42px;min-width:42px;display:grid;place-items:center; }
          .mws-editor { padding:14px; }
          .mws-toolbar { align-items:stretch; }
          .mws-history .mws-toolbar { gap:8px; }
        }
        @media (max-width:480px) {
          .mws-page { padding:10px 4px; }
          .mws-meta,.mws-editor-grid { grid-template-columns:1fr; }
          .mws-title-field { grid-column:auto; }
          .mws-field input,.mws-editor-grid select { width:100%;min-width:0; }
          .mws-stats { display:grid;grid-template-columns:repeat(2,minmax(0,1fr)); }
          .mws-stat { min-width:0;padding:12px; }
          .mws-stat strong { font-size:18px; }
          .mws-toolbar > div { width:100%; }
          .mws-toolbar > div .mws-button { flex:1 1 130px; }
          .mws-section-head { align-items:flex-start; }
          .mws-mobile-facts { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .mws-editor-weeks { gap:12px; }
        }
                /* Cleaner desktop planning experience: a readable summary plus one focused editor. */
        .mws-page { --mws-accent:var(--primary,#5142ce); }
        .mws-card { border-radius:20px; box-shadow:0 10px 30px rgba(20,30,60,.04); }
        .mws-head { align-items:flex-start; padding-bottom:9px; }
        .mws-eyebrow { font-size:11px; letter-spacing:.14em; }
        .mws-meta { margin:22px 0; }
        .mws-field input,.mws-editor-grid select { border-radius:11px; padding:11px 13px; }
        .mws-field label { font-size:13px; letter-spacing:.005em; }
        .mws-scroll { border-radius:13px; border:1px solid var(--mws-border); }
        .mws-table { min-width:1950px; }
        .mws-table td { padding:13px 12px; line-height:1.5; }
        .mws-table th { font-size:12px; padding:14px 12px; }
        /* Keep the monthly sheet header readable while horizontally scrolling.
           The two old sticky data columns overlapped headers when scrolling. */
        .mws-sheet-scroll .mws-table th { position:static; top:auto; }
        .mws-sheet-scroll .mws-table th:first-child,
        .mws-sheet-scroll .mws-table td:first-child {
          position:sticky; left:0; min-width:86px; max-width:86px; width:86px; box-sizing:border-box;
          background:#f5f5ff; z-index:3;
          box-shadow:2px 0 0 #e0e5f3;
        }
        .mws-sheet-scroll .mws-table th:nth-child(2),
        .mws-sheet-scroll .mws-table td:nth-child(2),
        .mws-sheet-scroll .mws-table th:nth-child(3),
        .mws-sheet-scroll .mws-table td:nth-child(3) {
          position:static; left:auto;
        }
        .mws-sheet-scroll .mws-table th:first-child { background:#eeeefe; z-index:4; }
        @media print {
          .mws-sheet-scroll .mws-table th:first-child,
          .mws-sheet-scroll .mws-table td:first-child { position:static; box-shadow:none; }
        }
        /* Keep the active Edit control on one line inside the 86px sticky column. */
        .mws-sheet-scroll .mws-row-edit {
          display:block; box-sizing:border-box; width:100%; min-width:0;
          max-width:100%; padding:6px 4px; margin:6px auto 0;
          white-space:nowrap; overflow-wrap:normal;
          font-size:11px; line-height:1.25; text-align:center;
          border-radius:8px;
        }
        .mws-readonly { font-size:12px; }
        .mws-editor { background:var(--mws-surface-soft); border:1px solid var(--mws-border); border-radius:17px; padding:22px; }
        .mws-editor-grid { gap:18px; }
        .mws-editor-grid .mws-field { background:var(--mws-surface); padding:12px; border:1px solid var(--mws-border); border-radius:12px; }
        .mws-editor-grid .mws-field label { margin:0 0 10px; color:var(--mws-text); font-weight:750; }
        .mws-editor-grid .mws-field input,.mws-editor-grid .mws-field select { width:100%; }
        .mws-editor-weeks label { border:1px solid var(--mws-border); background:var(--mws-surface); padding:9px 12px; border-radius:10px; cursor:pointer; }
        .mws-stats { gap:12px; }
        .mws-stat { padding:17px 20px; border-radius:13px; }
        .mws-stat strong { margin-top:8px; font-size:23px; }
        .mws-button { border-radius:10px; font-size:13px; font-weight:750; padding:11px 16px; transition:transform .12s ease,box-shadow .12s ease; }
        .mws-button:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 12px rgba(25,35,70,.09); }
        .mws-primary { box-shadow:0 3px 10px rgba(82,66,206,.15); }
        .mws-history { padding:20px; border-radius:15px; margin-top:14px; }
        .mws-history .mws-section-head strong { font-size:15px; }
        .mws-history .mws-toolbar { margin-top:16px!important; }
        .mws-status { padding:7px 12px; }
        .mws-approval { padding:16px; border:1px solid var(--mws-border); border-radius:12px; line-height:1.7; }
        .mws-guidance { background:var(--mws-surface-soft); border:1px solid var(--mws-border); padding:12px 15px; border-radius:12px; font-size:13px; }
        .mws-summary-hint { background:var(--mws-surface-soft); border:1px solid var(--mws-border); border-radius:10px; padding:11px 13px; margin-top:12px; font-size:12px; color:var(--mws-muted); }
        @media(max-width:760px) { .mws-editor-grid .mws-field { padding:10px; } }
        @media(prefers-reduced-motion:reduce) { .mws-button { transition:none; } .mws-button:hover:not(:disabled) {transform:none;} }
        @media print {
           .mws-mobile-cards,.mws-mobile-hint,.mws-file-help { display:none!important; }
          .mws-scroll { display:block!important; }
          .mws-table { display:table; }
          .mws-card,.mws-history { background:#fff; }
        }
      `}</style>

      <div className="mws-head">
        <div>
          <div className="mws-eyebrow">YourComate · Workforce Performance</div>
          <h1><CalendarDays size={25} style={{verticalAlign:'middle'}}/> Monthly Work Plan & Target Sheet</h1>
          <p className="mws-muted">Set clear monthly priorities, track measurable results and submit your plan to your assigned reviewer.</p>
        </div>
        <button type="button" className="mws-button mws-no-print" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>

      <form className="mws-card" onSubmit={save}>
        <div className="mws-section-head">
          <div><h2 style={{margin:'0 0 5px',fontSize:19}}>
              {editingId ? 'Edit Monthly Work Plan' : 'New Monthly Work Plan'}
            </h2>
            <span className="mws-muted">Build your plan, save a draft, then submit when ready.</span></div>
          <span className="mws-status">
            {editingId ? editingStatus.toUpperCase() : 'DRAFT'}
          </span>
        </div>

        <div className="mws-meta">
          <div className="mws-field"><label htmlFor="mws-month">Planning Month</label>
            <input id="mws-month" type="month" value={month} required
              disabled={Boolean(editingId)} onChange={e => switchMonth(e.target.value)}/></div>
          <div className="mws-field mws-title-field"><label htmlFor="mws-title">Plan Title</label>
            <input id="mws-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}
              placeholder="Monthly Department Work Plan"/></div>
          <div className="mws-field"><label>Approval Authority</label><div className="mws-approval">Your assigned Team Leader or Reporting Officer</div></div>
        </div>

        <div className="mws-section-head">
          <h3 style={{margin:0,fontSize:16}}><ClipboardList size={17} style={{verticalAlign:'middle'}}/> Monthly Objectives & Deliverables</h3>
          <span className="mws-muted mws-desktop-hint">Review activities in the table and use Edit to complete each field below</span>
          <span className="mws-muted mws-mobile-hint">Tap Edit Activity Details on a card to complete all fields</span>
        </div>

                 <SheetTable rows={rows} month={month} onChange={update}
           employeeLabel="Current employee"
           onRemove={key => setRows(old => old.filter(row => row.key !== key))}/>

        {monthlyTemplateLoading && (
          <p className="mws-muted">Loading department planning columns...</p>
        )}
        {monthlyTemplateError && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            {monthlyTemplateError}
          </p>
        )}
        <p className="mws-muted mws-file-help">
                     Attachments (when configured for your department): save the draft first, open Edit Sheet, upload the required files, and then submit for approval.
        </p>
        <SprintMonthlyCustomFields
          template={activeMonthlyTemplate}
          rows={rows}
          planId={editingId}
          onChange={updateCustomMonthlyField}
          disabled={saving || monthlyTemplateLoading}
        />

        <div className="mws-toolbar mws-no-print" style={{marginTop:12}}>
          <button type="button" className="mws-button" disabled={rows.length >= 100}
            onClick={() => setRows(old => [...old, makeRow(month)])}><Plus size={15}/> Add Activity Row</button>
                     <span className="mws-muted">Add one row per measurable activity. Choose its milestone weeks using the editor.</span>
        </div>

        <div className="mws-stats">
          <div className="mws-stat">Planned activities<strong>{rows.length}</strong></div>
          <div className="mws-stat">Total weightage<strong>{totalWeight.toFixed(1)}%</strong></div>
          <div className="mws-stat">Remaining weightage<strong>{Math.max(0,100-totalWeight).toFixed(1)}%</strong></div>
        </div>

        <div className="mws-toolbar mws-no-print">
                     <span className="mws-muted mws-guidance">Saving creates a draft only. Use Submit for Approval on the saved plan when everything is ready.</span>
          <div style={{display:'flex',gap:9,flexWrap:'wrap'}}>
            <button type="button" className="mws-button" onClick={() => window.print()}><Printer size={15}/> Print</button>
            {editingId && (
              <button type="button" className="mws-button"
                onClick={cancelEditing}>Cancel Editing</button>
            )}
            <button type="submit" className="mws-button mws-primary" disabled={saving}>
              <FileText size={15}/>{saving ? 'Saving?' : editingId ? 'Save Changes' : 'Save Monthly Sheet'}
            </button>
          </div>
        </div>
      </form>

      <SprintMonthlyApprovalQueue month={month} />
      <SprintMonthlyTeamCompilation month={month} />

             {directoryWarning && <p className="mws-muted" role="status">Employee directory is unavailable. Employee names will appear when access is restored.</p>}
       <section className="mws-card">
                 <div className="mws-section-head">
           <h2 style={{fontSize:19,margin:0}}>My Monthly Planning Sheets</h2>
          <span className="mws-muted">Drafts, approvals and existing records</span>
        </div>
        {loading ? <p className="mws-muted" role="status">Loading monthly planning sheets…</p> :
          plans.length === 0 ? <p className="mws-muted">No monthly plans have been created yet.</p> :
          plans.map(plan => {
            const id = String(plan._id || plan.id || '');
            const status = String(plan.status || 'draft').toLowerCase();
            const expanded = expandedId === id;
            const sheetRows = (Array.isArray(plan.sheet_rows) && plan.sheet_rows.length)
              ? plan.sheet_rows
              : (plan.goals || []).map(goal => ({
                  activity: typeof goal === 'string' ? goal : String(goal?.activity || ''),
                  objective: '', deliverable: '', kpi: '', weeks: []
                }));
            return (
              <article key={id} className="mws-history">
                <div className="mws-section-head">
                  <div><strong>{plan.title || 'Monthly Plan'}</strong>
                    <div className="mws-muted">{displayMonth(plan.month)} · {sheetRows.length} {sheetRows.length === 1 ? 'activity' : 'activities'}</div></div>
                  <span className="mws-status">{labels[status] || status}</span>
                </div>
                <div className="mws-toolbar mws-no-print" style={{justifyContent:'flex-start',marginTop:12}}>
                  <button type="button" className="mws-button"
                    onClick={() => setExpandedId(expanded ? '' : id)}>
                    <ChevronDown size={14}/>{expanded ? 'Hide Sheet' : 'View Sheet'}
                  </button>
                  <button type="button" className="mws-button" onClick={() => exportCsv(plan, sheetRows, employeeLookup)}>
                    <Download size={14}/> Export CSV
                  </button>
                  {['draft', 'rejected'].includes(status) && (
                    <button type="button" className="mws-button"
                      onClick={() => editSavedPlan(plan)}>
                      <FileText size={14}/> Edit Sheet
                    </button>
                  )}
                  {['draft', 'rejected'].includes(status) && (
                    <button type="button" className="mws-button mws-primary" disabled={submittingId === id}
                      onClick={() => submit(plan)}><Send size={14}/>
                      {submittingId === id ? 'Submitting?' : 'Submit for Approval'}
                    </button>
                  )}
                </div>
                {expanded && <div style={{marginTop:15}}>
                  <SheetTable rows={sheetRows} month={plan.month} readOnly employeeId={plan.employee_id}
                    employeeLabel={employeeName(employeeLookup, plan.employee_id) === 'Employee profile unavailable'
                      ? 'Employee profile unavailable'
                      : [employeeName(employeeLookup, plan.employee_id), employeeMeta(employeeLookup, plan.employee_id)].filter(Boolean).join(' · ')}
                    template={plan.sprint_template_snapshot || null} />
                  <div className="mws-approval">
                    <strong>Approval History</strong>
                    {(plan.approval_history || []).length === 0
                      ? <p>No approval actions recorded.</p>
                      : (plan.approval_history || []).map((entry,index) => (
                        <p key={index}>{entry.action || 'Action'} · {entry.at ? new Date(entry.at).toLocaleString() : 'Date unavailable'}
                          {entry.remarks ? ` · ${entry.remarks}` : ''}</p>
                      ))}
                  </div>
                </div>}
              </article>
            );
          })}
      </section>
    </div>
  );
}
