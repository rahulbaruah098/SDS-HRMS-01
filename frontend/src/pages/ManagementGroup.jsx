import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock,
  FileText,
  Loader2,
  Mail,
  MapPin,
  PenLine,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

import {
  assignManagementGroupMinutesWriter,
  createManagementGroupMeeting,
  deleteManagementGroupMeeting,
  getManagementGroup,
  getManagementGroupEmployeeOptions,
  getManagementGroupMeetings,
  updateManagementGroupMembers,
  updateManagementGroupMinutes,
} from '../api/client';

import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const EMPTY_MEETING_FORM = {
  topic: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  mode: 'Offline',
  location: '',
  agenda: '',
  assigned_minutes_user_id: '',
};

const EMPTY_MINUTES_FORM = {
  minutes: '',
  decisions: '',
  action_items: '',
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return 'Not set';

  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return '';

  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function initials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return 'MG';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function memberSearchText(member = {}) {
  return [
    member.name,
    member.employee_name,
    member.email,
    member.phone,
    member.department,
    member.designation,
    member.employee_code,
  ]
    .join(' ')
    .toLowerCase();
}

function uniqueValues(items = [], key) {
  return [
    ...new Set(
      items
        .map((item) => String(item?.[key] || '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function StatusPill({ value }) {
  const text = String(value || 'scheduled').replaceAll('_', ' ');

  return (
    <span className={`mg-pill mg-pill-${String(value || '').toLowerCase()}`}>
      {text}
    </span>
  );
}

export default function ManagementGroup({ user }) {
  const alerts = useCustomAlert();
  const [loading, setLoading] = useState(true);
  const [savingMembers, setSavingMembers] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [deletingMeetingId, setDeletingMeetingId] = useState('');

  const [group, setGroup] = useState({});
  const [members, setMembers] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [permissions, setPermissions] = useState({});

  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [selectedGroupAdminUserIds, setSelectedGroupAdminUserIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberDepartment, setMemberDepartment] = useState('');

  const [meetingForm, setMeetingForm] = useState({
    ...EMPTY_MEETING_FORM,
    meeting_date: todayDate(),
  });

  const [filters, setFilters] = useState({
    topic: '',
    from_date: '',
    to_date: '',
  });

  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [minutesForm, setMinutesForm] = useState(EMPTY_MINUTES_FORM);


  const canManage = Boolean(permissions.can_manage);
  const canViewPrivate = Boolean(permissions.can_view_private);

  const loggedInUserId = String(user?._id || user?.id || '');

  const memberUserIds = useMemo(
    () => new Set(members.map((member) => String(member.user_id || '')).filter(Boolean)),
    [members],
  );

  const isCurrentUserMember = useMemo(() => {
    if (permissions.is_member) return true;
    return loggedInUserId && memberUserIds.has(loggedInUserId);
  }, [permissions.is_member, loggedInUserId, memberUserIds]);

  const visibleEmployeeOptions = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();

    return employeeOptions.filter((employee) => {
      if (query && !memberSearchText(employee).includes(query)) {
        return false;
      }

      if (
        memberDepartment &&
        String(employee.department || '').trim().toLowerCase() !== memberDepartment.toLowerCase()
      ) {
        return false;
      }

      return true;
    });
  }, [employeeOptions, memberSearch, memberDepartment]);

  const departmentOptions = useMemo(
    () => uniqueValues(employeeOptions, 'department'),
    [employeeOptions],
  );

  const selectedMembersForWriter = useMemo(() => {
    const selectedSet = new Set(selectedMemberIds.map(String));

    return employeeOptions.filter((employee) =>
      selectedSet.has(String(employee.employee_id || employee._id || employee.id || '')),
    );
  }, [employeeOptions, selectedMemberIds]);

  const meetingStats = useMemo(() => {
    const total = meetings.length;
    const completed = meetings.filter((item) => item.minutes_status === 'completed').length;
    const pending = meetings.filter((item) => item.minutes_status !== 'completed').length;

    return { total, completed, pending };
  }, [meetings]);

  async function loadGroup({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await getManagementGroup();

      setGroup(data.group || {});
      setMembers(data.members || []);
      setPermissions(data.permissions || {});

      const memberIds = (data.members || [])
        .map((member) => String(member.employee_id || member._id || member.id || ''))
        .filter(Boolean);

      const adminUserIds = (data.members || [])
        .filter((member) => member.is_group_admin)
        .map((member) => String(member.user_id || ''))
        .filter(Boolean);

      setSelectedMemberIds(memberIds);
      setSelectedGroupAdminUserIds(adminUserIds);

      if (data.permissions?.can_manage) {
        const optionsData = await getManagementGroupEmployeeOptions();
        setEmployeeOptions(optionsData.items || optionsData.employees || []);
      } else {
        setEmployeeOptions(data.members || []);
      }

      if (data.permissions?.can_view_private) {
        await loadMeetings();
      } else {
        setMeetings([]);
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to load Management Group.', 'Management Group Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadMeetings(nextFilters = filters) {
    try {
      const data = await getManagementGroupMeetings(nextFilters);
      setMeetings(data.items || data.meetings || []);
    } catch (ex) {
      alerts.error(ex.message || 'Unable to load Management Group meetings.', 'Meetings Load Failed');
    }
  }

  useEffect(() => {
    loadGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMember(employee) {
    const employeeId = String(employee.employee_id || employee._id || employee.id || '');
    const userId = String(employee.user_id || '');

    if (!employeeId) return;

    setSelectedMemberIds((current) => {
      if (current.includes(employeeId)) {
        setSelectedGroupAdminUserIds((admins) =>
          admins.filter((adminId) => adminId !== userId),
        );

        return current.filter((id) => id !== employeeId);
      }

      return [...current, employeeId];
    });
  }

  function toggleGroupAdmin(employee) {
    const employeeId = String(employee.employee_id || employee._id || employee.id || '');
    const userId = String(employee.user_id || '');

    if (!employeeId || !userId) return;

    if (!selectedMemberIds.includes(employeeId)) {
      setSelectedMemberIds((current) => [...current, employeeId]);
    }

    setSelectedGroupAdminUserIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }

      return [...current, userId];
    });
  }

  async function handleSaveMembers(event) {
    event.preventDefault();

    if (!selectedMemberIds.length) {
      alerts.warning('Select at least one Management Group member.', 'Members Required');
      return;
    }

    setSavingMembers(true);

    try {
      const data = await updateManagementGroupMembers({
        name: group.name || 'Management Group',
        description: group.description || '',
        member_employee_ids: selectedMemberIds,
        group_admin_user_ids: selectedGroupAdminUserIds,
      });

      setGroup(data.group || {});
      setMembers(data.members || []);
      alerts.success(data.message || 'Management Group members updated successfully.', 'Members Updated');

      await loadGroup({ silent: true });
    } catch (ex) {
      alerts.error(ex.message || 'Unable to update Management Group members.', 'Members Update Failed');
    } finally {
      setSavingMembers(false);
    }
  }

  function updateMeetingField(field, value) {
    setMeetingForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleCreateMeeting(event) {
    event.preventDefault();

    if (!meetingForm.topic.trim()) {
      alerts.warning('Meeting topic is required.', 'Meeting Topic Required');
      return;
    }

    if (!meetingForm.meeting_date) {
      alerts.warning('Meeting date is required.', 'Meeting Date Required');
      return;
    }

    setSavingMeeting(true);

    try {
      const data = await createManagementGroupMeeting(meetingForm);

      alerts.success(data.message || 'Management Group meeting scheduled successfully.', 'Meeting Scheduled');
      setMeetingForm({
        ...EMPTY_MEETING_FORM,
        meeting_date: todayDate(),
      });

      await loadMeetings();
    } catch (ex) {
      alerts.error(ex.message || 'Unable to schedule Management Group meeting.', 'Meeting Schedule Failed');
    } finally {
      setSavingMeeting(false);
    }
  }

  function openMinutesEditor(meeting) {
    setSelectedMeeting(meeting);
    setMinutesForm({
      minutes: meeting.minutes || '',
      decisions: meeting.decisions || '',
      action_items: meeting.action_items || '',
    });
  }

  function closeMinutesEditor() {
    setSelectedMeeting(null);
    setMinutesForm(EMPTY_MINUTES_FORM);
  }

  function canEditMinutes(meeting) {
    if (canManage) return true;

    return (
      loggedInUserId &&
      String(meeting.assigned_minutes_user_id || '') === loggedInUserId
    );
  }

  async function handleSaveMinutes(event) {
    event.preventDefault();

    if (!selectedMeeting?._id && !selectedMeeting?.id) {
      alerts.warning('Please select a meeting first.', 'Meeting Required');
      return;
    }

    if (!minutesForm.minutes.trim()) {
      alerts.warning('Meeting minutes are required.', 'Minutes Required');
      return;
    }

    const meetingId = selectedMeeting._id || selectedMeeting.id;

    setSavingMinutes(true);

    try {
      const data = await updateManagementGroupMinutes(meetingId, minutesForm);

      alerts.success(data.message || 'Meeting minutes saved successfully.', 'Minutes Saved');
      setSelectedMeeting(data.meeting || null);
      await loadMeetings();
    } catch (ex) {
      alerts.error(ex.message || 'Unable to save meeting minutes.', 'Minutes Save Failed');
    } finally {
      setSavingMinutes(false);
    }
  }

  async function handleAssignWriter(meetingId, userId) {
    if (!meetingId || !userId) return;


    try {
      const data = await assignManagementGroupMinutesWriter(meetingId, {
        assigned_minutes_user_id: userId,
      });

      alerts.success(data.message || 'Minutes writer assigned successfully.', 'Minutes Writer Assigned');
      await loadMeetings();

      if (selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId)) {
        setSelectedMeeting(data.meeting || selectedMeeting);
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to assign minutes writer.', 'Writer Assignment Failed');
    }
  }

  async function handleDeleteMeeting(meeting) {
    const meetingId = meeting._id || meeting.id;

    if (!meetingId) return;

    const confirmed = await alerts.confirm(
      `Delete meeting "${meeting.topic}"? This will hide it from Management Group history.`,
      'Delete Meeting?',
    );

    if (!confirmed) return;

    setDeletingMeetingId(meetingId);

    try {
      const data = await deleteManagementGroupMeeting(meetingId);

      alerts.success(data.message || 'Meeting deleted successfully.', 'Meeting Deleted');
      await loadMeetings();

      if (selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId)) {
        closeMinutesEditor();
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to delete meeting.', 'Meeting Delete Failed');
    } finally {
      setDeletingMeetingId('');
    }
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();
    await loadMeetings(filters);
  }

  function clearFilters() {
    const next = {
      topic: '',
      from_date: '',
      to_date: '',
    };

    setFilters(next);
    loadMeetings(next);
  }

  if (loading) {
    return (
      <section className="mg-page">
        <div className="mg-loading-card">
          <Loader2 className="mg-spin" size={26} />
          <div>
            <h2>Loading Management Group</h2>
            <p>Preparing members, access rules and meeting history.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mg-page">
      <div className="mg-hero">
        <div>
          <span className="mg-eyebrow">Tenant Management</span>
          <h1>Management Group</h1>
          <p>
            Control group membership, schedule meetings, assign minutes writers
            and maintain searchable meeting minutes history.
          </p>
        </div>

        <div className="mg-hero-card">
          <div className="mg-hero-icon">
            <Users size={28} />
          </div>
          <div>
            <strong>{members.length}</strong>
            <span>Members</span>
          </div>
        </div>
      </div>

      {!canViewPrivate && (
        <div className="mg-restricted-note">
          <ShieldCheck size={20} />
          <div>
            <strong>View-only access</strong>
            <p>
              You are not a Management Group member. You can view the Management Group
              members only. Meetings and minutes are visible only to group members.
            </p>
          </div>
        </div>
      )}

      <div className="mg-stat-grid">
        <div className="mg-stat-card">
          <Users size={22} />
          <div>
            <span>Total Members</span>
            <strong>{members.length}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <CalendarDays size={22} />
          <div>
            <span>Total Meetings</span>
            <strong>{canViewPrivate ? meetingStats.total : '--'}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <FileText size={22} />
          <div>
            <span>Minutes Completed</span>
            <strong>{canViewPrivate ? meetingStats.completed : '--'}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <Clock size={22} />
          <div>
            <span>Minutes Pending</span>
            <strong>{canViewPrivate ? meetingStats.pending : '--'}</strong>
          </div>
        </div>
      </div>

      <div className="mg-grid">
        <div className="mg-panel mg-members-panel">
          <div className="mg-panel-head">
            <div>
              <h2>Management Group Members</h2>
              <p>
                {canManage
                  ? 'Tenant admin can select members and assign group admins.'
                  : 'Visible Management Group member directory.'}
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                className="mg-primary-btn"
                onClick={handleSaveMembers}
                disabled={savingMembers}
              >
                {savingMembers ? <Loader2 className="mg-spin" size={16} /> : <Save size={16} />}
                Save Members
              </button>
            )}
          </div>

          {canManage && (
            <form className="mg-member-toolbar" onSubmit={handleSaveMembers}>
              <label className="mg-search-box">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search employee by name, code, email, department..."
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                />
              </label>

              <select
                value={memberDepartment}
                onChange={(event) => setMemberDepartment(event.target.value)}
              >
                <option value="">All Departments</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </form>
          )}

          <div className="mg-member-list">
            {(canManage ? visibleEmployeeOptions : members).map((member) => {
              const employeeId = String(member.employee_id || member._id || member.id || '');
              const userId = String(member.user_id || '');
              const selected = selectedMemberIds.includes(employeeId);
              const isAdmin = selectedGroupAdminUserIds.includes(userId) || member.is_group_admin;

              return (
                <div
                  key={`${employeeId}-${userId}`}
                  className={`mg-member-card ${selected || !canManage ? 'mg-member-active' : ''}`}
                >
                  <div className="mg-avatar">
                    {member.avatar || member.photo_url ? (
                      <img src={member.avatar || member.photo_url} alt={member.name} />
                    ) : (
                      <span>{initials(member.name)}</span>
                    )}
                  </div>

                  <div className="mg-member-info">
                    <div className="mg-member-title">
                      <strong>{member.name || member.employee_name}</strong>
                      {isAdmin ? (
                        <span className="mg-admin-badge">
                          <ShieldCheck size={13} />
                          Group Admin
                        </span>
                      ) : null}
                    </div>

                    <p>
                      {member.designation || 'Employee'}
                      {member.department ? ` · ${member.department}` : ''}
                    </p>

                    <div className="mg-member-meta">
                      {member.email ? (
                        <span>
                          <Mail size={13} />
                          {member.email}
                        </span>
                      ) : null}
                      {member.employee_code ? <span>{member.employee_code}</span> : null}
                    </div>
                  </div>

                  {canManage && (
                    <div className="mg-member-actions">
                      <label className="mg-check-row">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMember(member)}
                        />
                        <span>Member</span>
                      </label>

                      <label className="mg-check-row">
                        <input
                          type="checkbox"
                          checked={isAdmin}
                          disabled={!userId}
                          onChange={() => toggleGroupAdmin(member)}
                        />
                        <span>Admin</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}

            {!(canManage ? visibleEmployeeOptions : members).length && (
              <div className="mg-empty">
                <Users size={26} />
                <strong>No members found</strong>
                <p>
                  {canManage
                    ? 'Adjust search/filter or add active employees first.'
                    : 'Management Group members are not configured yet.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {canViewPrivate && (
          <div className="mg-panel">
            <div className="mg-panel-head">
              <div>
                <h2>Meeting Control</h2>
                <p>
                  {canManage
                    ? 'Schedule meetings and notify only Management Group members.'
                    : isCurrentUserMember
                      ? 'View assigned meetings and update minutes when assigned.'
                      : 'Meeting access is restricted.'}
                </p>
              </div>
            </div>

            {canManage && (
              <form className="mg-form" onSubmit={handleCreateMeeting}>
                <div className="mg-form-grid">
                  <label>
                    <span>Meeting Topic *</span>
                    <input
                      value={meetingForm.topic}
                      onChange={(event) => updateMeetingField('topic', event.target.value)}
                      placeholder="Example: Monthly Management Review"
                    />
                  </label>

                  <label>
                    <span>Meeting Date *</span>
                    <input
                      type="date"
                      value={meetingForm.meeting_date}
                      onChange={(event) => updateMeetingField('meeting_date', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Start Time</span>
                    <input
                      type="time"
                      value={meetingForm.start_time}
                      onChange={(event) => updateMeetingField('start_time', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>End Time</span>
                    <input
                      type="time"
                      value={meetingForm.end_time}
                      onChange={(event) => updateMeetingField('end_time', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Mode</span>
                    <select
                      value={meetingForm.mode}
                      onChange={(event) => updateMeetingField('mode', event.target.value)}
                    >
                      <option value="Offline">Offline</option>
                      <option value="Online">Online</option>
                      <option value="Hybrid">Hybrid</option>
                    </select>
                  </label>

                  <label>
                    <span>Location / Meeting Link</span>
                    <input
                      value={meetingForm.location}
                      onChange={(event) => updateMeetingField('location', event.target.value)}
                      placeholder="Conference room / Google Meet / Zoom link"
                    />
                  </label>

                  <label className="mg-span-2">
                    <span>Assign Minutes Writer</span>
                    <select
                      value={meetingForm.assigned_minutes_user_id}
                      onChange={(event) =>
                        updateMeetingField('assigned_minutes_user_id', event.target.value)
                      }
                    >
                      <option value="">Select Management Group member</option>
                      {selectedMembersForWriter
                        .filter((member) => member.user_id)
                        .map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.name || member.employee_name}
                            {member.designation ? ` — ${member.designation}` : ''}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="mg-span-2">
                    <span>Agenda</span>
                    <textarea
                      rows={4}
                      value={meetingForm.agenda}
                      onChange={(event) => updateMeetingField('agenda', event.target.value)}
                      placeholder="Add agenda points for the Management Group meeting..."
                    />
                  </label>
                </div>

                <div className="mg-form-actions">
                  <button type="submit" className="mg-primary-btn" disabled={savingMeeting}>
                    {savingMeeting ? <Loader2 className="mg-spin" size={16} /> : <Plus size={16} />}
                    Schedule Meeting
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {canViewPrivate && (
        <div className="mg-panel mg-history-panel">
          <div className="mg-panel-head">
            <div>
              <h2>Meeting Minutes Book</h2>
              <p>Search previous meetings by date range and topic/minutes text.</p>
            </div>
          </div>

          <form className="mg-filter-bar" onSubmit={handleFilterSubmit}>
            <label className="mg-search-box">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search topic, agenda or minutes..."
                value={filters.topic}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    topic: event.target.value,
                  }))
                }
              />
            </label>

            <input
              type="date"
              value={filters.from_date}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from_date: event.target.value,
                }))
              }
            />

            <input
              type="date"
              value={filters.to_date}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to_date: event.target.value,
                }))
              }
            />

            <button type="submit" className="mg-secondary-btn">
              Filter
            </button>

            <button type="button" className="mg-ghost-btn" onClick={clearFilters}>
              Clear
            </button>
          </form>

          <div className="mg-meeting-layout">
            <div className="mg-meeting-list">
              {meetings.map((meeting) => {
                const meetingId = meeting._id || meeting.id;
                const active = selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId);

                return (
                  <article
                    key={meetingId}
                    className={`mg-meeting-card ${active ? 'mg-meeting-active' : ''}`}
                  >
                    <div className="mg-meeting-top">
                      <div>
                        <h3>{meeting.topic}</h3>
                        <div className="mg-meeting-meta">
                          <span>
                            <CalendarDays size={14} />
                            {formatDate(meeting.meeting_date)}
                          </span>
                          {meeting.start_time ? (
                            <span>
                              <Clock size={14} />
                              {meeting.start_time}
                              {meeting.end_time ? ` - ${meeting.end_time}` : ''}
                            </span>
                          ) : null}
                          {meeting.location ? (
                            <span>
                              <MapPin size={14} />
                              {meeting.location}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <StatusPill value={meeting.minutes_status} />
                    </div>

                    {meeting.agenda ? <p className="mg-meeting-agenda">{meeting.agenda}</p> : null}

                    <div className="mg-meeting-footer">
                      <span>
                        Minutes Writer:{' '}
                        <strong>{meeting.assigned_minutes_user_name || 'Not assigned'}</strong>
                      </span>

                      <div className="mg-card-actions">
                        <button
                          type="button"
                          className="mg-secondary-btn"
                          onClick={() => openMinutesEditor(meeting)}
                        >
                          <PenLine size={15} />
                          {meeting.minutes ? 'View / Edit' : 'Minutes'}
                        </button>

                        {canManage && (
                          <button
                            type="button"
                            className="mg-danger-btn"
                            onClick={() => handleDeleteMeeting(meeting)}
                            disabled={deletingMeetingId === meetingId}
                          >
                            {deletingMeetingId === meetingId ? (
                              <Loader2 className="mg-spin" size={15} />
                            ) : (
                              <Trash2 size={15} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <div className="mg-inline-assign">
                        <UserCheck size={15} />
                        <select
                          value={meeting.assigned_minutes_user_id || ''}
                          onChange={(event) => handleAssignWriter(meetingId, event.target.value)}
                        >
                          <option value="">Assign minutes writer</option>
                          {members
                            .filter((member) => member.user_id)
                            .map((member) => (
                              <option key={member.user_id} value={member.user_id}>
                                {member.name || member.employee_name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </article>
                );
              })}

              {!meetings.length && (
                <div className="mg-empty">
                  <FileText size={28} />
                  <strong>No meetings found</strong>
                  <p>Schedule a meeting or adjust filters to view previous minutes.</p>
                </div>
              )}
            </div>

            <div className="mg-minutes-panel">
              {selectedMeeting ? (
                <form onSubmit={handleSaveMinutes}>
                  <div className="mg-minutes-head">
                    <div>
                      <span>Minutes Editor</span>
                      <h3>{selectedMeeting.topic}</h3>
                      <p>
                        {formatDate(selectedMeeting.meeting_date)}
                        {selectedMeeting.assigned_minutes_user_name
                          ? ` · Assigned to ${selectedMeeting.assigned_minutes_user_name}`
                          : ''}
                      </p>
                    </div>
                    <button type="button" className="mg-icon-btn" onClick={closeMinutesEditor}>
                      <X size={18} />
                    </button>
                  </div>

                  {!canEditMinutes(selectedMeeting) && (
                    <div className="mg-restricted-note mg-compact-note">
                      <ShieldCheck size={18} />
                      <p>
                        Only tenant admin or assigned minutes writer can update this meeting minutes.
                      </p>
                    </div>
                  )}

                  <label>
                    <span>Meeting Minutes *</span>
                    <textarea
                      rows={8}
                      value={minutesForm.minutes}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          minutes: event.target.value,
                        }))
                      }
                      placeholder="Write complete meeting discussion, proceedings and important notes..."
                    />
                  </label>

                  <label>
                    <span>Key Decisions</span>
                    <textarea
                      rows={4}
                      value={minutesForm.decisions}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          decisions: event.target.value,
                        }))
                      }
                      placeholder="Decision 1, Decision 2..."
                    />
                  </label>

                  <label>
                    <span>Action Items</span>
                    <textarea
                      rows={4}
                      value={minutesForm.action_items}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          action_items: event.target.value,
                        }))
                      }
                      placeholder="Owner, task, deadline..."
                    />
                  </label>

                  {selectedMeeting.minutes_updated_by_name || selectedMeeting.minutes_updated_at ? (
                    <p className="mg-update-note">
                      Last updated by {selectedMeeting.minutes_updated_by_name || 'User'}
                      {selectedMeeting.minutes_updated_at
                        ? ` on ${formatDateTime(selectedMeeting.minutes_updated_at)}`
                        : ''}
                    </p>
                  ) : null}

                  {canEditMinutes(selectedMeeting) && (
                    <div className="mg-form-actions">
                      <button type="submit" className="mg-primary-btn" disabled={savingMinutes}>
                        {savingMinutes ? <Loader2 className="mg-spin" size={16} /> : <Save size={16} />}
                        Save Minutes
                      </button>
                    </div>
                  )}
                </form>
              ) : (
                <div className="mg-empty mg-sticky-empty">
                  <PenLine size={30} />
                  <strong>Select a meeting</strong>
                  <p>
                    Open a meeting from the left panel to view or update its minutes,
                    decisions and action items.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}