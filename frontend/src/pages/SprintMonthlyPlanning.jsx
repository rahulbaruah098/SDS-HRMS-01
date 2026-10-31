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

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLastDate = month => {
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
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

function exportCsv(plan, rows) {
  const headers = ['Sl. No.', ...columns.map(c => c[1]), 'Weeks'];
  const data = rows.map((row, index) => [
    index + 1,
    ...columns.map(([key]) =>
      key === 'responsible_employee'
        ? plan.employee_id || ''
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

function SheetTable({ rows, onChange, onRemove, month, readOnly = false, employeeId = '', template = null }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const selected = rows.find(row => row.key === selectedKey);
  return (
    <>
    <div className="mws-scroll" role="region" aria-label="Monthly work plan table" tabIndex={0}>
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
                  onClick={() => setSelectedKey(selectedKey === row.key ? null : row.key)}>
                  {selectedKey === row.key ? 'Close' : 'Edit'}
                </button>}
              </td>
              {columns.map(([key]) => (
                <td key={key}>
                  {key === 'responsible_employee' ? (
                    <span className="mws-readonly">{employeeId || 'Current employee'}</span>
                  ) : readOnly ? (
                    <span className="mws-readonly">{row[key] || '?'}</span>
                  ) : key === 'priority' ? (
                    <select aria-label={`Priority row ${index + 1}`} value={row.priority}
                      onChange={e => onChange(row.key, key, e.target.value)}>
                      {['critical', 'high', 'medium', 'low'].map(priority => (
                        <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`${key} row ${index + 1}`}
                      type={key === 'start_date' || key === 'end_date' ? 'date' : key === 'weightage' || key === 'target_quantity' ? 'number' : 'text'}
                      min={key.includes('date') ? `${month}-01` : key === 'weightage' || key === 'target_quantity' ? '0' : undefined}
                      max={key.includes('date') ? monthLastDate(month) : key === 'weightage' ? '100' : undefined}
                      step={key === 'weightage' || key === 'target_quantity' ? '0.01' : undefined}
                      maxLength={key === 'activity' || key === 'deliverable' || key === 'dependencies' || key === 'remarks' ? 500 : key === 'kpi' ? 300 : 200}
                      value={row[key] ?? ''}
                      onChange={e => onChange(row.key, key, e.target.value)}
                      placeholder={key.replaceAll('_', ' ')}
                    />
                  )}
                </td>
              ))}
              <td>
                {readOnly ? (
                  <span className="mws-readonly">{(row.weeks || []).map(w => `W${w}`).join(', ') || '?'}</span>
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
    {/* STEP 44B.53D.1 - Historical custom fields */}
    {readOnly && template?.columns?.length > 0 && (
      <SprintMonthlySavedFields template={template} rows={rows} />
    )}
    {!readOnly && selected && (
      <section className="mws-editor">
        <div className="mws-section-head">
          <div>
            <h3 style={{margin:'0 0 5px'}}>Complete Activity Details</h3>
            <span className="mws-muted">Edit all fields without horizontal scrolling. Changes sync with the planning sheet.</span>
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
                  placeholder={label}
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
          if (column.required && missing) {
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
      `}</style>

      <div className="mws-head">
        <div>
          <div className="mws-eyebrow">YourComate ? Workforce Performance</div>
          <h1><CalendarDays size={25} style={{verticalAlign:'middle'}}/> Monthly Work Plan & Target Sheet</h1>
          <p className="mws-muted">Plan measurable objectives, deliverables, deadlines and weekly milestones for Team Leader approval.</p>
        </div>
        <button type="button" className="mws-button mws-no-print" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>

      <form className="mws-card" onSubmit={save}>
        <div className="mws-section-head">
          <div><h2 style={{margin:'0 0 5px',fontSize:19}}>
              {editingId ? 'Edit Monthly Work Plan' : 'New Monthly Work Plan'}
            </h2>
            <span className="mws-muted">Corporate planning sheet ? Draft</span></div>
          <span className="mws-status">
            {editingId ? editingStatus.toUpperCase() : 'DRAFT'}
          </span>
        </div>

        <div className="mws-meta">
          <div className="mws-field"><label htmlFor="mws-month">Planning Month</label>
            <input id="mws-month" type="month" value={month} required
              disabled={Boolean(editingId)} onChange={e => switchMonth(e.target.value)}/></div>
          <div className="mws-field" style={{gridColumn:'span 2'}}><label htmlFor="mws-title">Plan Title</label>
            <input id="mws-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}
              placeholder="Monthly Department Work Plan"/></div>
          <div className="mws-field"><label>Approval Authority</label><div className="mws-approval">Assigned Reporting Team Leader</div></div>
        </div>

        <div className="mws-section-head">
          <h3 style={{margin:0,fontSize:16}}><ClipboardList size={17} style={{verticalAlign:'middle'}}/> Monthly Objectives & Deliverables</h3>
          <span className="mws-muted">Scroll horizontally to complete all columns</span>
        </div>

        <SheetTable rows={rows} month={month} onChange={update}
          onRemove={key => setRows(old => old.filter(row => row.key !== key))}/>

        {monthlyTemplateLoading && (
          <p className="mws-muted">Loading department planning columns...</p>
        )}
        {monthlyTemplateError && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            {monthlyTemplateError}
          </p>
        )}
        <SprintMonthlyCustomFields
          template={activeMonthlyTemplate}
          rows={rows}
          onChange={updateCustomMonthlyField}
          disabled={saving || monthlyTemplateLoading}
        />

        <div className="mws-toolbar mws-no-print" style={{marginTop:12}}>
          <button type="button" className="mws-button" disabled={rows.length >= 100}
            onClick={() => setRows(old => [...old, makeRow(month)])}><Plus size={15}/> Add Activity Row</button>
          <span className="mws-muted">Weekly milestone selections prepare the monthly work breakdown.</span>
        </div>

        <div className="mws-stats">
          <div className="mws-stat">Planned activities<strong>{rows.length}</strong></div>
          <div className="mws-stat">Total weightage<strong>{totalWeight.toFixed(1)}%</strong></div>
          <div className="mws-stat">Remaining weightage<strong>{Math.max(0,100-totalWeight).toFixed(1)}%</strong></div>
        </div>

        <div className="mws-toolbar mws-no-print">
          <span className="mws-muted">Drafts are created on Save. Submission is a separate action below.</span>
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

      <section className="mws-card">
        <div className="mws-section-head">
          <h2 style={{fontSize:19,margin:0}}>My Monthly Planning Sheets</h2>
          <span className="mws-muted">Drafts, approvals and existing records</span>
        </div>
        {loading ? <p className="mws-muted">Loading monthly planning sheets?</p> :
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
                    <div className="mws-muted">{plan.month} ? {sheetRows.length} activities</div></div>
                  <span className="mws-status">{labels[status] || status}</span>
                </div>
                <div className="mws-toolbar mws-no-print" style={{justifyContent:'flex-start',marginTop:12}}>
                  <button type="button" className="mws-button"
                    onClick={() => setExpandedId(expanded ? '' : id)}>
                    <ChevronDown size={14}/>{expanded ? 'Hide Sheet' : 'View Sheet'}
                  </button>
                  <button type="button" className="mws-button" onClick={() => exportCsv(plan, sheetRows)}>
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
                  <SheetTable rows={sheetRows} month={plan.month} readOnly employeeId={plan.employee_id} template={plan.sprint_template_snapshot || null} />
                  <div className="mws-approval">
                    <strong>Approval History</strong>
                    {(plan.approval_history || []).length === 0
                      ? <p>No approval actions recorded.</p>
                      : (plan.approval_history || []).map((entry,index) => (
                        <p key={index}>{entry.action || 'Action'} ? {entry.at ? new Date(entry.at).toLocaleString() : 'Date unavailable'}
                          {entry.remarks ? ` ? ${entry.remarks}` : ''}</p>
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
