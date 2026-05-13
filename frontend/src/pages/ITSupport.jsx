import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Headphones,
  Laptop,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Star,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';

import {
  assignItSupportTicket,
  createItSupportTicket,
  escalateItSupportTicket,
  getItSupportOptions,
  getItSupportProfile,
  getItSupportTickets,
  getMyItSupportTickets,
  reopenItSupportTicket,
  reviewItSupportTicket,
  updateItSupportTicketStatus,
} from '../api/client';

import {
  IT_SUPPORT_CATEGORY_OPTIONS,
  IT_SUPPORT_PRIORITY_OPTIONS,
  IT_SUPPORT_STATUS_OPTIONS,
} from '../data/modules';

const DEFAULT_ESCALATION_TYPES = [
  { value: 'software_application', label: 'Software / Application Problem' },
  { value: 'server_issue', label: 'Server Issue' },
  { value: 'database_issue', label: 'Database Issue' },
  { value: 'network_infrastructure', label: 'Network / Infrastructure Major Issue' },
  { value: 'security_issue', label: 'Security Issue' },
  { value: 'major_problem', label: 'Other Major Problem' },
];

const emptyTicketForm = {
  issue_category: 'login_password',
  priority: 'medium',
  subject: '',
  description: '',
};

const emptyAssignForm = {
  assigned_to_employee_id: '',
  note: '',
};

const emptyStatusForm = {
  status: 'in_progress',
  status_note: '',
  resolution_note: '',
};

const emptyReviewForm = {
  rating: 5,
  comment: '',
};

const emptyReopenForm = {
  reason: '',
};

const emptyEscalationForm = {
  escalation_type: 'software_application',
  escalation_reason: '',
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

  if (key === 'resolved' || key === 'closed') return 'success';
  if (key === 'waiting_for_user') return 'warning';
  if (key === 'assigned' || key === 'in_progress') return 'info';
  if (key === 'reopened') return 'danger';

  return 'muted';
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

  if (found) return found.label;

  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || '—';
}

function profileRows(profile = {}) {
  return [
    ['Employee Name', profile.name],
    ['Employee Code', profile.emp_code],
    ['Department', profile.department],
    ['Designation', profile.designation],
    ['Email', profile.email],
    ['Phone', profile.phone],
  ];
}

function ticketId(ticket = {}) {
  return ticket._id || ticket.id || '';
}

function uniqueTickets(tickets = []) {
  const map = new Map();

  tickets.forEach((ticket) => {
    const id = ticketId(ticket) || ticket.ticket_no || JSON.stringify(ticket);

    if (!map.has(id)) {
      map.set(id, ticket);
    }
  });

  return Array.from(map.values());
}

function isOwnerTicket(ticket = {}, profile = {}) {
  const profileEmployeeId = String(profile.employee_id || '');
  const profileUserId = String(profile.user_id || '');

  return (
    String(ticket.created_by_employee_id || ticket.raised_by_employee_id || '') === profileEmployeeId ||
    String(ticket.created_by_user_id || ticket.raised_by_user_id || '') === profileUserId
  );
}

function canReviewTicket(ticket = {}, profile = {}) {
  const status = String(ticket.status || '').toLowerCase();

  return (
    isOwnerTicket(ticket, profile) &&
    ['resolved', 'closed'].includes(status) &&
    !ticket.review_rating
  );
}

function canReopenTicket(ticket = {}, profile = {}, manageAccess = false) {
  const status = String(ticket.status || '').toLowerCase();

  return (
    ['resolved', 'closed'].includes(status) &&
    (manageAccess || isOwnerTicket(ticket, profile))
  );
}

function canUpdateWorkStatus(ticket = {}, profile = {}, manageAccess = false, workAccess = false, superAdminAccess = false) {
  if (manageAccess || superAdminAccess) return true;

  const profileEmployeeId = String(profile.employee_id || '');
  const profileUserId = String(profile.user_id || '');

  return (
    workAccess &&
    (
      String(ticket.assigned_to_employee_id || '') === profileEmployeeId ||
      String(ticket.assigned_to_user_id || '') === profileUserId
    )
  );
}

function StarRating({ value, onChange }) {
  return (
    <div className="rating-picker">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          className={Number(value) >= rating ? 'active' : ''}
          onClick={() => onChange(rating)}
          aria-label={`${rating} star`}
        >
          <Star size={20} />
        </button>
      ))}
    </div>
  );
}

export default function ITSupport() {
  const [profile, setProfile] = useState({});
  const [permissions, setPermissions] = useState({
    can_manage: false,
    can_manage_normal: false,
    can_view_escalated: false,
    can_escalate: false,
    is_super_admin: false,
    is_it_head: false,
    is_it_member: false,
  });

  const [options, setOptions] = useState({
    categories: IT_SUPPORT_CATEGORY_OPTIONS,
    priorities: IT_SUPPORT_PRIORITY_OPTIONS,
    statuses: IT_SUPPORT_STATUS_OPTIONS,
    escalation_types: DEFAULT_ESCALATION_TYPES,
    it_team: [],
    it_heads: [],
    team_slots: {
      expected_total: 4,
      current_total: 0,
      heads: 0,
      members: 0,
      empty_slots: 4,
    },
  });

  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [statusForm, setStatusForm] = useState(emptyStatusForm);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);
  const [reopenForm, setReopenForm] = useState(emptyReopenForm);
  const [escalationForm, setEscalationForm] = useState(emptyEscalationForm);

  const [myTickets, setMyTickets] = useState([]);
  const [teamTickets, setTeamTickets] = useState([]);

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [panelMode, setPanelMode] = useState('');

  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    issue_category: '',
    assigned_to: '',
    search: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelSaving, setPanelSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const manageAccess = Boolean(permissions.can_manage_normal || permissions.can_manage);
  const workAccess = Boolean(permissions.is_it_member || permissions.is_it_head);
  const superAdminEscalatedAccess = Boolean(permissions.can_view_escalated || permissions.is_super_admin);
  const canSeeDesk = manageAccess || workAccess || superAdminEscalatedAccess;
  const canEscalate = Boolean(permissions.can_escalate && manageAccess);

  const myTicketRows = myTickets || [];
  const deskTicketRows = teamTickets || [];
  const allStatRows = useMemo(
    () => uniqueTickets([...myTicketRows, ...deskTicketRows]),
    [myTicketRows, deskTicketRows],
  );

  const stats = useMemo(() => {
    const rows = allStatRows || [];

    return {
      total: rows.length,
      open: rows.filter((item) => item.status === 'open' || item.status === 'reopened').length,
      assigned: rows.filter((item) => item.status === 'assigned').length,
      inProgress: rows.filter((item) => item.status === 'in_progress').length,
      resolved: rows.filter((item) => item.status === 'resolved' || item.status === 'closed').length,
      unassigned: rows.filter((item) => !item.assigned_to_employee_id).length,
      escalated: rows.filter((item) => item.is_escalated).length,
      pendingReview: myTicketRows.filter((item) => canReviewTicket(item, profile)).length,
    };
  }, [allStatRows, myTicketRows, profile]);

  function updateTicketForm(key, value) {
    setTicketForm((prev) => ({
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

  function applyPermissionData(data = {}) {
    setPermissions((prev) => ({
      ...prev,
      can_manage: Boolean(data.can_manage ?? prev.can_manage),
      can_manage_normal: Boolean(data.can_manage_normal ?? data.can_manage ?? prev.can_manage_normal),
      can_view_escalated: Boolean(data.can_view_escalated ?? prev.can_view_escalated),
      can_escalate: Boolean(data.can_escalate ?? prev.can_escalate),
      is_super_admin: Boolean(data.is_super_admin ?? prev.is_super_admin),
      is_it_head: Boolean(data.is_it_head ?? prev.is_it_head),
      is_it_member: Boolean(data.is_it_member ?? prev.is_it_member),
    }));
  }

  function openPanel(mode, ticket) {
    setPanelMode(mode);
    setSelectedTicket(ticket);

    if (mode === 'assign') {
      setAssignForm({
        assigned_to_employee_id: ticket.assigned_to_employee_id || '',
        note: '',
      });
    }

    if (mode === 'status') {
      setStatusForm({
        status:
          ticket.status === 'open' || ticket.status === 'assigned'
            ? 'in_progress'
            : ticket.status || 'in_progress',
        status_note: ticket.last_status_note || ticket.superadmin_status_note || '',
        resolution_note: ticket.resolution_note || '',
      });
    }

    if (mode === 'review') {
      setReviewForm(emptyReviewForm);
    }

    if (mode === 'reopen') {
      setReopenForm(emptyReopenForm);
    }

    if (mode === 'escalate') {
      setEscalationForm({
        escalation_type: ticket.escalation_type || 'software_application',
        escalation_reason: ticket.escalation_reason || '',
      });
    }
  }

  function closePanel() {
    setPanelMode('');
    setSelectedTicket(null);
    setAssignForm(emptyAssignForm);
    setStatusForm(emptyStatusForm);
    setReviewForm(emptyReviewForm);
    setReopenForm(emptyReopenForm);
    setEscalationForm(emptyEscalationForm);
  }

  async function loadData() {
    setLoading(true);
    setError('');

    try {
      const [profileRes, optionsRes, myRes] = await Promise.all([
        getItSupportProfile(),
        getItSupportOptions(),
        getMyItSupportTickets(),
      ]);

      setProfile(profileRes.profile || {});
      applyPermissionData(profileRes);
      applyPermissionData(optionsRes);

      const nextPermissions = {
        can_manage: Boolean(optionsRes.can_manage ?? profileRes.can_manage),
        can_manage_normal: Boolean(optionsRes.can_manage_normal ?? optionsRes.can_manage ?? profileRes.can_manage_normal ?? profileRes.can_manage),
        can_view_escalated: Boolean(optionsRes.can_view_escalated ?? profileRes.can_view_escalated),
        can_escalate: Boolean(optionsRes.can_escalate ?? profileRes.can_escalate),
        is_super_admin: Boolean(optionsRes.is_super_admin ?? profileRes.is_super_admin),
        is_it_head: Boolean(optionsRes.is_it_head ?? profileRes.is_it_head),
        is_it_member: Boolean(optionsRes.is_it_member ?? profileRes.is_it_member),
      };

      setOptions({
        categories: optionsRes.categories?.length
          ? optionsRes.categories
          : IT_SUPPORT_CATEGORY_OPTIONS,
        priorities: optionsRes.priorities?.length
          ? optionsRes.priorities
          : IT_SUPPORT_PRIORITY_OPTIONS,
        statuses: optionsRes.statuses?.length
          ? optionsRes.statuses
          : IT_SUPPORT_STATUS_OPTIONS,
        escalation_types: optionsRes.escalation_types?.length
          ? optionsRes.escalation_types
          : DEFAULT_ESCALATION_TYPES,
        it_team: optionsRes.it_team || [],
        it_heads: optionsRes.it_heads || [],
        team_slots: optionsRes.team_slots || {
          expected_total: 4,
          current_total: 0,
          heads: 0,
          members: 0,
          empty_slots: 4,
        },
      });

      const shouldLoadDesk =
        nextPermissions.can_manage_normal ||
        nextPermissions.can_manage ||
        nextPermissions.is_it_member ||
        nextPermissions.is_it_head ||
        nextPermissions.can_view_escalated ||
        nextPermissions.is_super_admin;

      let teamRes = { tickets: [] };

      if (shouldLoadDesk) {
        teamRes = await getItSupportTickets(filters);
        applyPermissionData(teamRes);
      }

      setMyTickets(myRes.tickets || []);
      setTeamTickets(teamRes.tickets || []);
    } catch (err) {
      setError(err.message || 'Unable to load IT support data.');
    } finally {
      setLoading(false);
    }
  }

  async function loadTeamTickets() {
    if (!canSeeDesk) return;

    setLoading(true);
    setError('');

    try {
      const data = await getItSupportTickets(filters);
      setTeamTickets(data.tickets || []);
      applyPermissionData(data);

      setOptions((prev) => ({
        ...prev,
        it_team: data.it_team || prev.it_team,
        it_heads: data.it_heads || prev.it_heads,
        team_slots: data.team_slots || prev.team_slots,
      }));
    } catch (err) {
      setError(err.message || 'Unable to load IT support tickets.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTicket(event) {
    event.preventDefault();

    setError('');
    setSuccess('');

    if (!normalizeText(ticketForm.subject)) {
      setError('Subject is required.');
      return;
    }

    if (!normalizeText(ticketForm.description)) {
      setError('Description is required.');
      return;
    }

    setSaving(true);

    try {
      await createItSupportTicket({
        issue_category: ticketForm.issue_category,
        priority: ticketForm.priority,
        subject: normalizeText(ticketForm.subject),
        description: normalizeText(ticketForm.description),
      });

      setTicketForm(emptyTicketForm);
      setSuccess('IT support ticket submitted successfully to the IT Department.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to submit IT support ticket.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!assignForm.assigned_to_employee_id) {
      setError('Please select an IT Department member.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await assignItSupportTicket(ticketId(selectedTicket), assignForm);
      setSuccess('IT support ticket assigned successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to assign ticket.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (statusForm.status === 'resolved' && !normalizeText(statusForm.resolution_note || statusForm.status_note)) {
      setError('Resolution note is required before marking ticket as resolved.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateItSupportTicketStatus(ticketId(selectedTicket), statusForm);
      setSuccess(
        statusForm.status === 'resolved'
          ? 'Ticket marked as resolved. The requester can now give a review from My IT Tickets.'
          : 'IT support ticket status updated successfully.',
      );
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update ticket status.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleEscalate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!normalizeText(escalationForm.escalation_reason)) {
      setError('Escalation reason is required.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await escalateItSupportTicket(ticketId(selectedTicket), {
        escalation_type: escalationForm.escalation_type,
        escalation_reason: normalizeText(escalationForm.escalation_reason),
      });

      setSuccess('IT support ticket escalated to Super Admin successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to escalate ticket.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReview(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await reviewItSupportTicket(ticketId(selectedTicket), reviewForm);
      setSuccess('Review submitted successfully. The IT support ticket is now closed.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to submit review.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReopen(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!normalizeText(reopenForm.reason)) {
      setError('Reopen reason is required.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await reopenItSupportTicket(ticketId(selectedTicket), reopenForm);
      setSuccess('IT support ticket reopened successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to reopen ticket.');
    } finally {
      setPanelSaving(false);
    }
  }

  function renderTicketCard(ticket, section = 'my') {
    const isDeskSection = section === 'desk';
    const ticketCanUpdate = canUpdateWorkStatus(
      ticket,
      profile,
      manageAccess,
      workAccess,
      superAdminEscalatedAccess,
    );
    const ticketCanReview = canReviewTicket(ticket, profile);
    const ticketCanReopen = canReopenTicket(ticket, profile, manageAccess);
    const ticketCanEscalate = isDeskSection && canEscalate && !ticket.is_escalated;
    const showAssign = isDeskSection && manageAccess;
    const showUpdate = isDeskSection && ticketCanUpdate;
    const isReviewPending = ticketCanReview;

    return (
      <article
        key={`${section}-${ticketId(ticket) || ticket.ticket_no}`}
        className={`ticket-card it-ticket-card ${isReviewPending ? 'review-pending-ticket' : ''}`}
      >
        <div className="ticket-topline">
          <div>
            <strong>{ticket.ticket_no || 'ITS'}</strong>
            <span>{formatDate(ticket.created_at)}</span>
          </div>

          <div className="ticket-badges">
            {ticket.is_escalated ? (
              <span className="pill danger">
                Escalated
              </span>
            ) : null}

            {isReviewPending ? (
              <span className="pill warning">
                Review Pending
              </span>
            ) : null}

            <span className={`pill ${statusClass(ticket.status)}`}>
              {ticket.status_label || optionLabel(options.statuses, ticket.status)}
            </span>

            <span className={`pill ${priorityClass(ticket.priority)}`}>
              {ticket.priority_label || optionLabel(options.priorities, ticket.priority)}
            </span>
          </div>
        </div>

        <h3>{ticket.subject}</h3>
        <p>{ticket.description}</p>

        <div className="ticket-meta-grid">
          <div>
            <span>Category</span>
            <strong>
              {ticket.issue_category_label ||
                optionLabel(options.categories, ticket.issue_category)}
            </strong>
          </div>

          <div>
            <span>Raised By</span>
            <strong>{ticket.raised_by_name || '—'}</strong>
          </div>

          <div>
            <span>Assigned Person</span>
            <strong>
              {ticket.assigned_to_name || 'IT Team slot available'}
            </strong>
          </div>

          <div>
            <span>Resolution</span>
            <strong>{ticket.resolution_note || ticket.last_status_note || '—'}</strong>
          </div>
        </div>

        {ticket.is_escalated ? (
          <div className="anonymous-note">
            <ShieldAlert size={16} />
            Escalated to Super Admin
            {ticket.escalation_type_label ? ` — ${ticket.escalation_type_label}` : ''}
            {ticket.escalation_reason ? `: ${ticket.escalation_reason}` : ''}
          </div>
        ) : null}

        {!ticket.assigned_to_name ? (
          <div className="anonymous-note">
            <Wrench size={16} />
            No IT member assigned yet. IT Department Team Leader can assign this ticket.
          </div>
        ) : null}

        {ticket.review_rating ? (
          <div className="review-note">
            <Star size={16} />
            Employee Review: {ticket.review_rating}/5
            {ticket.review_comment ? ` — ${ticket.review_comment}` : ''}
          </div>
        ) : null}

        {isReviewPending ? (
          <div className="review-note">
            <Star size={16} />
            This ticket is resolved. Please give your review to close the support request.
          </div>
        ) : null}

        <div className="ticket-actions">
          {showAssign ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => openPanel('assign', ticket)}
            >
              <UserCheck size={15} />
              {ticket.assigned_to_name ? 'Reassign' : 'Assign'}
            </button>
          ) : null}

          {showUpdate ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => openPanel('status', ticket)}
            >
              <ClipboardCheck size={15} />
              Update Status
            </button>
          ) : null}

          {ticketCanEscalate ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => openPanel('escalate', ticket)}
            >
              <ShieldAlert size={15} />
              Escalate to Super Admin
            </button>
          ) : null}

          {ticketCanReview ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => openPanel('review', ticket)}
            >
              <Star size={15} />
              Give Review
            </button>
          ) : null}

          {ticketCanReopen ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => openPanel('reopen', ticket)}
            >
              <RotateCcw size={15} />
              Reopen
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = profileRows(profile);

  return (
    <div className="it-support-page">
      <section className="grievance-hero it-hero">
        <div>
          <span className="eyebrow">Technology Helpdesk</span>
          <h1>IT Support</h1>
          <p>
            Raise IT issues to your tenant IT Department. IT Department Team
            Leader can assign tickets to IT members and escalate major software
            or server problems to Super Admin.
          </p>
        </div>

        <div className="grievance-hero-actions">
          <button type="button" className="ghost-btn" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <div className="alert-card danger">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="alert-card success">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      ) : null}

      <section className="grievance-stats">
        <div className="mini-stat-card">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Open</span>
          <strong>{stats.open}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Assigned</span>
          <strong>{stats.assigned}</strong>
        </div>
        <div className="mini-stat-card">
          <span>In Progress</span>
          <strong>{stats.inProgress}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Resolved</span>
          <strong>{stats.resolved}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Review Pending</span>
          <strong>{stats.pendingReview}</strong>
        </div>
      </section>

      <div className="grievance-grid it-support-grid">
        <section className="panel grievance-form-panel">
          <div className="section-heading">
            <div>
              <h2>Raise IT Support Ticket</h2>
              <p>Your employee details are pre-filled automatically.</p>
            </div>
            <Laptop size={22} />
          </div>

          <div className="profile-prefill-card">
            <div className="profile-prefill-title">
              <UserCheck size={18} />
              <span>Prefilled Employee Details</span>
            </div>

            <div className="profile-prefill-grid">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value || '—'}</strong>
                </div>
              ))}
            </div>
          </div>

          <form className="modern-form" onSubmit={handleCreateTicket}>
            <div className="form-row two">
              <label>
                <span>Issue Category</span>
                <select
                  value={ticketForm.issue_category}
                  onChange={(event) => updateTicketForm('issue_category', event.target.value)}
                >
                  {options.categories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Priority</span>
                <select
                  value={ticketForm.priority}
                  onChange={(event) => updateTicketForm('priority', event.target.value)}
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
                value={ticketForm.subject}
                onChange={(event) => updateTicketForm('subject', event.target.value)}
                placeholder="Example: Laptop not connecting to Wi-Fi"
              />
            </label>

            <label>
              <span>Description</span>
              <textarea
                rows={6}
                value={ticketForm.description}
                onChange={(event) => updateTicketForm('description', event.target.value)}
                placeholder="Explain the problem clearly"
              />
            </label>

            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
              Submit IT Ticket
            </button>
          </form>
        </section>

        <section className="panel grievance-list-panel">
          <div className="section-heading">
            <div>
              <h2>My IT Tickets</h2>
              <p>
                Track tickets raised by you. After IT marks the issue as resolved,
                use Give Review to close the ticket.
              </p>
            </div>
            <Headphones size={22} />
          </div>

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading your IT tickets...</p>
            </div>
          ) : myTicketRows.length ? (
            <div className="ticket-list">
              {myTicketRows.map((ticket) => renderTicketCard(ticket, 'my'))}
            </div>
          ) : (
            <div className="empty-state">
              <Headphones size={30} />
              <p>No IT support tickets raised by you.</p>
            </div>
          )}
        </section>
      </div>

      {canSeeDesk ? (
        <section className="panel grievance-list-panel">
          <div className="section-heading">
            <div>
              <h2>
                {superAdminEscalatedAccess
                  ? 'Escalated IT Support'
                  : 'IT Department Support Desk'}
              </h2>
              <p>
                {superAdminEscalatedAccess
                  ? 'Only tickets escalated by tenant IT Department Team Leaders are shown here.'
                  : manageAccess
                    ? 'Assign, reassign, monitor and escalate tenant IT support tickets.'
                    : 'View IT Department tickets and update tickets assigned to you.'}
              </p>
            </div>
            <Headphones size={22} />
          </div>

          <div className="it-team-strip">
            <div>
              <Users size={18} />
              <span>{superAdminEscalatedAccess ? 'Escalation Desk' : 'IT Department Team'}</span>
            </div>
            <strong>
              {superAdminEscalatedAccess
                ? stats.escalated
                : `${options.team_slots?.current_total || 0}/${options.team_slots?.expected_total || 4}`}
            </strong>
            <small>
              {superAdminEscalatedAccess
                ? 'Super Admin receives only escalated software/server/major issue tickets.'
                : options.team_slots?.empty_slots > 0
                  ? `${options.team_slots.empty_slots} empty IT team slot available`
                  : 'All IT team slots filled'}
            </small>
          </div>

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
              value={filters.issue_category}
              onChange={(event) => updateFilter('issue_category', event.target.value)}
            >
              <option value="">All Categories</option>
              {options.categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            {manageAccess ? (
              <select
                value={filters.assigned_to}
                onChange={(event) => updateFilter('assigned_to', event.target.value)}
              >
                <option value="">All Assignments</option>
                <option value="unassigned">Unassigned</option>
                {options.it_team.map((member) => (
                  <option key={member.id || member._id} value={member.id || member._id}>
                    {member.employee_name || member.name}
                  </option>
                ))}
              </select>
            ) : null}

            <input
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Search ticket..."
            />

            <button type="button" className="ghost-btn" onClick={loadTeamTickets}>
              Apply
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading IT support desk...</p>
            </div>
          ) : deskTicketRows.length ? (
            <div className="ticket-list">
              {deskTicketRows.map((ticket) => renderTicketCard(ticket, 'desk'))}
            </div>
          ) : (
            <div className="empty-state">
              <Headphones size={30} />
              <p>No IT support desk tickets found.</p>
            </div>
          )}
        </section>
      ) : null}

      {selectedTicket ? (
        <div className="drawer-backdrop" onClick={closePanel}>
          <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">IT Support Action</span>
                <h2>
                  {panelMode === 'assign'
                    ? 'Assign Ticket'
                    : panelMode === 'status'
                      ? 'Update Status'
                      : panelMode === 'review'
                        ? 'Give Review'
                        : panelMode === 'escalate'
                          ? 'Escalate to Super Admin'
                          : 'Reopen Ticket'}
                </h2>
              </div>
              <button type="button" className="icon-btn" onClick={closePanel}>
                ×
              </button>
            </div>

            <div className="drawer-summary">
              <strong>{selectedTicket.ticket_no}</strong>
              <h3>{selectedTicket.subject}</h3>
              <p>{selectedTicket.description}</p>
            </div>

            {panelMode === 'assign' ? (
              <form className="modern-form" onSubmit={handleAssign}>
                <label>
                  <span>Assign To IT Department Member</span>
                  <select
                    value={assignForm.assigned_to_employee_id}
                    onChange={(event) =>
                      setAssignForm((prev) => ({
                        ...prev,
                        assigned_to_employee_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select IT Department Member</option>
                    <option value="self">Assign to Myself</option>
                    {options.it_team.map((member) => (
                      <option key={member.id || member._id} value={member.id || member._id}>
                        {member.label || member.employee_name || member.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Assignment Note</span>
                  <textarea
                    rows={4}
                    value={assignForm.note}
                    onChange={(event) =>
                      setAssignForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Optional note for assigned IT Department member"
                  />
                </label>

                <button type="submit" className="primary" disabled={panelSaving}>
                  {panelSaving ? <Loader2 className="spin" size={17} /> : <UserCheck size={17} />}
                  Save Assignment
                </button>
              </form>
            ) : null}

            {panelMode === 'status' ? (
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
                    {options.statuses
                      .filter((item) => {
                        if (manageAccess || superAdminEscalatedAccess) return true;
                        return ['in_progress', 'waiting_for_user', 'resolved'].includes(item.value);
                      })
                      .map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  <span>Status Note</span>
                  <textarea
                    rows={4}
                    value={statusForm.status_note}
                    onChange={(event) =>
                      setStatusForm((prev) => ({
                        ...prev,
                        status_note: event.target.value,
                      }))
                    }
                    placeholder="Progress update or note"
                  />
                </label>

                <label>
                  <span>Resolution Note</span>
                  <textarea
                    rows={4}
                    value={statusForm.resolution_note}
                    onChange={(event) =>
                      setStatusForm((prev) => ({
                        ...prev,
                        resolution_note: event.target.value,
                      }))
                    }
                    placeholder="Required when marking as resolved"
                  />
                </label>

                <button type="submit" className="primary" disabled={panelSaving}>
                  {panelSaving ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
                  Save Status
                </button>
              </form>
            ) : null}

            {panelMode === 'escalate' ? (
              <form className="modern-form" onSubmit={handleEscalate}>
                <label>
                  <span>Escalation Type</span>
                  <select
                    value={escalationForm.escalation_type}
                    onChange={(event) =>
                      setEscalationForm((prev) => ({
                        ...prev,
                        escalation_type: event.target.value,
                      }))
                    }
                  >
                    {options.escalation_types.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Escalation Reason</span>
                  <textarea
                    rows={5}
                    value={escalationForm.escalation_reason}
                    onChange={(event) =>
                      setEscalationForm((prev) => ({
                        ...prev,
                        escalation_reason: event.target.value,
                      }))
                    }
                    placeholder="Explain why Super Admin support is required. Example: server issue, major software bug, database problem."
                  />
                </label>

                <button type="submit" className="primary" disabled={panelSaving}>
                  {panelSaving ? <Loader2 className="spin" size={17} /> : <ShieldAlert size={17} />}
                  Escalate to Super Admin
                </button>
              </form>
            ) : null}

            {panelMode === 'review' ? (
              <form className="modern-form" onSubmit={handleReview}>
                <label>
                  <span>Rating</span>
                  <StarRating
                    value={reviewForm.rating}
                    onChange={(rating) =>
                      setReviewForm((prev) => ({
                        ...prev,
                        rating,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Review Comment</span>
                  <textarea
                    rows={5}
                    value={reviewForm.comment}
                    onChange={(event) =>
                      setReviewForm((prev) => ({
                        ...prev,
                        comment: event.target.value,
                      }))
                    }
                    placeholder="Share your feedback about the IT support resolution"
                  />
                </label>

                <button type="submit" className="primary" disabled={panelSaving}>
                  {panelSaving ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
                  Submit Review
                </button>
              </form>
            ) : null}

            {panelMode === 'reopen' ? (
              <form className="modern-form" onSubmit={handleReopen}>
                <label>
                  <span>Reopen Reason</span>
                  <textarea
                    rows={5}
                    value={reopenForm.reason}
                    onChange={(event) =>
                      setReopenForm((prev) => ({
                        ...prev,
                        reason: event.target.value,
                      }))
                    }
                    placeholder="Explain why this ticket needs to be reopened"
                  />
                </label>

                <button type="submit" className="primary" disabled={panelSaving}>
                  {panelSaving ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
                  Reopen Ticket
                </button>
              </form>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}