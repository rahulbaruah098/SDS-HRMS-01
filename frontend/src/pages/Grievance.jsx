import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  EyeOff,
  FileText,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  UserRound,
} from 'lucide-react';

import {
  createGrievance,
  getGrievanceOptions,
  getGrievanceProfile,
  getGrievances,
  getMyGrievances,
  updateGrievanceStatus,
} from '../api/client';

import {
  GRIEVANCE_PRIORITY_OPTIONS,
  GRIEVANCE_STATUS_OPTIONS,
  GRIEVANCE_TYPE_OPTIONS,
  HR_ROLES,
  hasAnyRole,
  effectiveRoleList,
} from '../data/modules';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const emptyForm = {
  grievance_type: 'workplace_issue',
  priority: 'medium',
  subject: '',
  description: '',
  is_anonymous: false,
};

const emptyStatusForm = {
  status: 'under_review',
  hr_remarks: '',
  resolution_note: '',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDate(value) {
  if (!value) return '—';

  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function statusClass(status = '') {
  const key = String(status || '').toLowerCase();

  if (key === 'resolved') return 'success';
  if (key === 'rejected') return 'danger';
  if (key === 'under_review') return 'warning';
  return 'info';
}

function priorityClass(priority = '') {
  const key = String(priority || '').toLowerCase();

  if (key === 'critical') return 'danger';
  if (key === 'high') return 'warning';
  if (key === 'medium') return 'info';
  return 'muted';
}

function optionLabel(options = [], value = '') {
  const found = options.find((item) => item.value === value);
  return found?.label || String(value || '').replaceAll('_', ' ') || '—';
}

function isHrUser(user = {}) {
  return hasAnyRole(effectiveRoleList(user), HR_ROLES);
}

function buildProfileRows(profile = {}) {
  return [
    ['Employee Name', profile.name],
    ['Employee Code', profile.emp_code],
    ['Department', profile.department],
    ['Designation', profile.designation],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Team Leader', profile.team_leader_name],
    ['Reporting Officer', profile.reporting_officer_name],
  ];
}

export default function Grievance({ user }) {
  const alerts = useCustomAlert();
  const canManage = useMemo(() => isHrUser(user), [user]);

  const [profile, setProfile] = useState({});
  const [options, setOptions] = useState({
    types: GRIEVANCE_TYPE_OPTIONS,
    priorities: GRIEVANCE_PRIORITY_OPTIONS,
    statuses: GRIEVANCE_STATUS_OPTIONS,
  });

  const [form, setForm] = useState(emptyForm);
  const [statusForm, setStatusForm] = useState(emptyStatusForm);
  const [selectedGrievance, setSelectedGrievance] = useState(null);

  const [myItems, setMyItems] = useState([]);
  const [manageItems, setManageItems] = useState([]);

  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    grievance_type: '',
    search: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const visibleItems = canManage ? manageItems : myItems;

  const stats = useMemo(() => {
    const rows = visibleItems || [];

    return {
      total: rows.length,
      pending: rows.filter((item) => item.status === 'pending').length,
      underReview: rows.filter((item) => item.status === 'under_review').length,
      resolved: rows.filter((item) => item.status === 'resolved').length,
      anonymous: rows.filter((item) => item.is_anonymous).length,
    };
  }, [visibleItems]);

  function updateForm(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function loadData() {
    setLoading(true);

    try {
      const [profileRes, optionsRes, myRes, manageRes] = await Promise.all([
        getGrievanceProfile(),
        getGrievanceOptions(),
        getMyGrievances(),
        canManage ? getGrievances(filters) : Promise.resolve({ grievances: [] }),
      ]);

      setProfile(profileRes.profile || {});
      setOptions({
        types: optionsRes.types?.length ? optionsRes.types : GRIEVANCE_TYPE_OPTIONS,
        priorities: optionsRes.priorities?.length
          ? optionsRes.priorities
          : GRIEVANCE_PRIORITY_OPTIONS,
        statuses: optionsRes.statuses?.length
          ? optionsRes.statuses
          : GRIEVANCE_STATUS_OPTIONS,
      });

      setMyItems(myRes.grievances || []);
      setManageItems(manageRes.grievances || []);
    } catch (err) {
      alerts.error(err.message || 'Unable to load grievance data.', 'Grievance Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadManageList() {
    if (!canManage) return;

    setLoading(true);

    try {
      const data = await getGrievances(filters);
      setManageItems(data.grievances || []);
    } catch (err) {
      alerts.error(err.message || 'Unable to load HR grievance list.', 'Grievance List Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!normalizeText(form.subject)) {
      alerts.warning('Subject is required.', 'Missing Subject');
      return;
    }

    if (!normalizeText(form.description)) {
      alerts.warning('Description is required.', 'Missing Description');
      return;
    }

    setSaving(true);

    try {
      await createGrievance({
        grievance_type: form.grievance_type,
        priority: form.priority,
        subject: normalizeText(form.subject),
        description: normalizeText(form.description),
        is_anonymous: Boolean(form.is_anonymous),
      });

      setForm(emptyForm);
      alerts.success('Grievance submitted successfully.', 'Grievance Submitted');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to submit grievance.', 'Submission Failed');
    } finally {
      setSaving(false);
    }
  }

  function openStatusPanel(item) {
    setSelectedGrievance(item);
    setStatusForm({
      status: item.status === 'pending' ? 'under_review' : item.status || 'under_review',
      hr_remarks: item.hr_remarks || '',
      resolution_note: item.resolution_note || '',
    });
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();

    if (!selectedGrievance?._id && !selectedGrievance?.id) {
      alerts.warning('Please select a grievance first.', 'No Grievance Selected');
      return;
    }

    setStatusSaving(true);

    try {
      await updateGrievanceStatus(selectedGrievance._id || selectedGrievance.id, statusForm);
      setSelectedGrievance(null);
      setStatusForm(emptyStatusForm);
      alerts.success('Grievance status updated successfully.', 'Status Updated');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to update grievance status.', 'Status Update Failed');
    } finally {
      setStatusSaving(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const profileRows = buildProfileRows(profile);

  return (
    <div className="grievance-page">
      <section className="grievance-hero">
        <div>
          <span className="eyebrow">Employee Support Desk</span>
          <h1>Grievance Management</h1>
          <p>
            Submit workplace grievances with proper tracking. Use anonymous mode
            when identity should be hidden from the HR review panel.
          </p>
        </div>

        <div className="grievance-hero-actions">
          <button type="button" className="ghost-btn" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      <section className="grievance-stats">
        <div className="mini-stat-card">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Pending</span>
          <strong>{stats.pending}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Under Review</span>
          <strong>{stats.underReview}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Resolved</span>
          <strong>{stats.resolved}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Anonymous</span>
          <strong>{stats.anonymous}</strong>
        </div>
      </section>

      <div className="grievance-grid">
        <section className="panel grievance-form-panel">
          <div className="section-heading">
            <div>
              <h2>Raise a Grievance</h2>
              <p>Your employee details are pre-filled automatically.</p>
            </div>
            <MessageSquare size={22} />
          </div>

          <div className="profile-prefill-card">
            <div className="profile-prefill-title">
              <UserRound size={18} />
              <span>Prefilled Employee Details</span>
            </div>

            <div className="profile-prefill-grid">
              {profileRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value || '—'}</strong>
                </div>
              ))}
            </div>
          </div>

          <form className="modern-form" onSubmit={handleSubmit}>
            <div className="form-row two">
              <label>
                <span>Grievance Type</span>
                <select
                  value={form.grievance_type}
                  onChange={(event) => updateForm('grievance_type', event.target.value)}
                >
                  {options.types.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Priority</span>
                <select
                  value={form.priority}
                  onChange={(event) => updateForm('priority', event.target.value)}
                >
                  {options.priorities.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>Subject</span>
              <input
                type="text"
                value={form.subject}
                onChange={(event) => updateForm('subject', event.target.value)}
                placeholder="Briefly describe the issue"
              />
            </label>

            <label>
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                placeholder="Write the full grievance details"
                rows={6}
              />
            </label>

            <label className="checkbox-card">
              <input
                type="checkbox"
                checked={form.is_anonymous}
                onChange={(event) => updateForm('is_anonymous', event.target.checked)}
              />
              <span>
                <strong>Submit anonymously</strong>
                <small>
                  HR will receive this grievance, but your identity will be hidden in
                  the review panel.
                </small>
              </span>
              <EyeOff size={18} />
            </label>

            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
              Submit Grievance
            </button>
          </form>
        </section>

        <section className="panel grievance-list-panel">
          <div className="section-heading">
            <div>
              <h2>{canManage ? 'HR Grievance Inbox' : 'My Grievances'}</h2>
              <p>
                {canManage
                  ? 'Review employee grievances and update their resolution status.'
                  : 'Track the status of grievances submitted by you.'}
              </p>
            </div>
            <FileText size={22} />
          </div>

          {canManage ? (
            <div className="filter-bar">
              <div className="filter-label">
                <Filter size={16} />
                <span>Filters</span>
              </div>

              <select
                value={filters.status}
                onChange={(event) => updateFilter('status', event.target.value)}
              >
                <option value="">All Status</option>
                {options.statuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.priority}
                onChange={(event) => updateFilter('priority', event.target.value)}
              >
                <option value="">All Priority</option>
                {options.priorities.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.grievance_type}
                onChange={(event) => updateFilter('grievance_type', event.target.value)}
              >
                <option value="">All Types</option>
                {options.types.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="Search..."
              />

              <button type="button" className="ghost-btn" onClick={loadManageList}>
                Apply
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading grievances...</p>
            </div>
          ) : visibleItems.length ? (
            <div className="ticket-list">
              {visibleItems.map((item) => (
                <article key={item._id || item.id || item.ticket_no} className="ticket-card">
                  <div className="ticket-topline">
                    <div>
                      <strong>{item.ticket_no || 'GRV'}</strong>
                      <span>{formatDate(item.created_at)}</span>
                    </div>

                    <div className="ticket-badges">
                      <span className={`pill ${statusClass(item.status)}`}>
                        {item.status_label || optionLabel(options.statuses, item.status)}
                      </span>
                      <span className={`pill ${priorityClass(item.priority)}`}>
                        {item.priority_label || optionLabel(options.priorities, item.priority)}
                      </span>
                    </div>
                  </div>

                  <h3>{item.subject}</h3>
                  <p>{item.description}</p>

                  <div className="ticket-meta-grid">
                    <div>
                      <span>Type</span>
                      <strong>
                        {item.grievance_type_label ||
                          optionLabel(options.types, item.grievance_type)}
                      </strong>
                    </div>

                    <div>
                      <span>Employee</span>
                      <strong>
                        {item.is_anonymous ? 'Anonymous Employee' : item.employee_name || '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Department</span>
                      <strong>
                        {item.is_anonymous ? 'Hidden' : item.department || item.employee_snapshot?.department || '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Remarks</span>
                      <strong>{item.hr_remarks || item.resolution_note || '—'}</strong>
                    </div>
                  </div>

                  {item.is_anonymous ? (
                    <div className="anonymous-note">
                      <ShieldAlert size={16} />
                      Identity hidden due to anonymous submission.
                    </div>
                  ) : null}

                  {canManage ? (
                    <div className="ticket-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => openStatusPanel(item)}
                      >
                        Update Status
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <MessageSquare size={30} />
              <p>No grievance records found.</p>
            </div>
          )}
        </section>
      </div>

      {canManage && selectedGrievance ? (
        <div className="drawer-backdrop" onClick={() => setSelectedGrievance(null)}>
          <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">HR Action</span>
                <h2>Update Grievance</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedGrievance(null)}
              >
                ×
              </button>
            </div>

            <div className="drawer-summary">
              <strong>{selectedGrievance.ticket_no}</strong>
              <h3>{selectedGrievance.subject}</h3>
              <p>{selectedGrievance.description}</p>
            </div>

            <form className="modern-form" onSubmit={handleStatusUpdate}>
              <label>
                <span>Status</span>
                <select
                  value={statusForm.status}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                >
                  {options.statuses.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>HR Remarks</span>
                <textarea
                  value={statusForm.hr_remarks}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      hr_remarks: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Internal or visible HR remarks"
                />
              </label>

              <label>
                <span>Resolution Note</span>
                <textarea
                  value={statusForm.resolution_note}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      resolution_note: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Final resolution note"
                />
              </label>

              <button type="submit" className="primary" disabled={statusSaving}>
                {statusSaving ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
                Save Update
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}