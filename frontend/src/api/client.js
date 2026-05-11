const DEFAULT_BACKEND_PORT = '5000';
const DEFAULT_API_PREFIX = '/api/v1';

function normalizeApiBase(base = '') {
  const value = String(base || '').trim();

  if (!value) {
    return '';
  }

  return value.replace(/\/+$/, '');
}

function buildRuntimeApiBase() {
  const envBase = normalizeApiBase(import.meta.env.VITE_API_BASE);

  if (envBase) {
    return envBase;
  }

  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}${DEFAULT_API_PREFIX}`;
  }

  const { protocol, hostname } = window.location;

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}${DEFAULT_API_PREFIX}`;
  }

  return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}${DEFAULT_API_PREFIX}`;
}

const API_BASE = buildRuntimeApiBase();

export function getToken() {
  return localStorage.getItem('sds_hrms_token');
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();

    if (normalized) {
      return normalized;
    }
  }

  return '';
}

export function getProfilePhotoValue(record = {}) {
  return firstNonEmpty(
    record.avatar,
    record.profile_photo,
    record.profile_picture,
    record.photo,
    record.image,
    record.picture,
    record.employee_avatar,
    record.employee_profile_photo,
    record.latest_progress_by_avatar,
  );
}

export function withProfilePhotoAliases(record = {}) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const cloned = { ...record };
  const photo = getProfilePhotoValue(cloned);

  if (photo) {
    cloned.avatar = photo;
    cloned.profile_photo = photo;
    cloned.profile_picture = photo;
    cloned.photo = photo;
  }

  return cloned;
}

export function normalizeProfilePhotoUrl(value = '') {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('data:') ||
    raw.startsWith('blob:')
  ) {
    return raw;
  }

  if (raw.startsWith('/')) {
    const apiRoot = String(API_BASE).replace(DEFAULT_API_PREFIX, '').replace(/\/+$/, '');
    return `${apiRoot}${raw}`;
  }

  if (raw.startsWith('uploads/') || raw.startsWith('static/')) {
    const apiRoot = String(API_BASE).replace(DEFAULT_API_PREFIX, '').replace(/\/+$/, '');
    return `${apiRoot}/${raw}`;
  }

  return raw;
}

export function getProfilePhotoUrl(record = {}) {
  return normalizeProfilePhotoUrl(getProfilePhotoValue(record));
}

export function getInitials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return 'U';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function normalizePerson(person = {}) {
  if (!person || typeof person !== 'object') {
    return person;
  }

  const normalized = withProfilePhotoAliases(person);
  const displayName =
    normalized.employee_name ||
    normalized.name ||
    normalized.display_name ||
    normalized.full_name ||
    normalized.email ||
    'Employee';

  normalized.employee_name = normalized.employee_name || displayName;
  normalized.name = normalized.name || displayName;
  normalized.display_name = normalized.display_name || displayName;
  normalized.initials = getInitials(displayName);
  normalized.photo_url = getProfilePhotoUrl(normalized);

  return normalized;
}

export function normalizePeopleList(people = []) {
  if (!Array.isArray(people)) {
    return [];
  }

  return people.map((person) => normalizePerson(person)).filter(Boolean);
}

export function normalizeApprovalHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map((item = {}) => ({
    ...item,
    action: item.action || item.status || item.decision || '',
    role: item.role || item.approver_role || item.approved_by_role || '',
    name:
      item.name ||
      item.approver_name ||
      item.approved_by_name ||
      item.rejected_by_name ||
      '',
    user_id:
      item.user_id ||
      item.approver_id ||
      item.approved_by_id ||
      item.rejected_by_id ||
      '',
    at:
      item.at ||
      item.approved_at ||
      item.rejected_at ||
      item.created_at ||
      item.updated_at ||
      '',
    note: item.note || item.reason || item.decision_note || '',
  }));
}

export function normalizeLeaveApprovalRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const normalized = withProfilePhotoAliases({ ...record });

  const status = String(normalized.status || '').toLowerCase();
  const stage = String(normalized.approval_stage || '').toLowerCase();

  let liveStatus =
    normalized.live_status ||
    normalized.status_text ||
    normalized.status_display ||
    normalized.approval_stage_label ||
    '';

  if (!liveStatus) {
    if (status === 'approved' || stage === 'approved') {
      liveStatus = 'Approved';
    } else if (status === 'rejected' || stage === 'rejected') {
      liveStatus = 'Rejected';
    } else if (stage === 'team_leader') {
      liveStatus = 'Pending with Team Leader';
    } else if (stage === 'reporting_officer') {
      liveStatus = normalized.approved_by_team_leader
        ? 'Approved by Team Leader, Pending with Reporting Officer'
        : 'Pending with Reporting Officer';
    } else if (stage === 'hr') {
      liveStatus = 'Pending with HR';
    } else {
      liveStatus = normalized.status || 'Pending';
    }
  }

  normalized.live_status = liveStatus;
  normalized.status_text = normalized.status_text || liveStatus;
  normalized.status_display = normalized.status_display || liveStatus;
  normalized.approval_stage_label = normalized.approval_stage_label || liveStatus;

  normalized.approval_history = normalizeApprovalHistory(normalized.approval_history || []);

  normalized.employee_name =
    normalized.employee_name ||
    normalized.name ||
    normalized.employee?.name ||
    normalized.employee?.employee_name ||
    'Employee';

  normalized.leave_type_label =
    normalized.leave_type_label ||
    (String(normalized.leave_type || '').toUpperCase() === 'CL'
      ? 'Casual Leave'
      : String(normalized.leave_type || '').toUpperCase() === 'EL'
        ? 'Earned Leave'
        : normalized.leave_type || 'Leave');

  normalized.upto_date = normalized.upto_date || normalized.to_date || '';
  normalized.to_date = normalized.to_date || normalized.upto_date || '';

  normalized.approved_by_team_leader =
    normalized.approved_by_team_leader ||
    Boolean(normalized.approved_by_team_leader_id || normalized.team_leader_approved_at);

  normalized.approved_by_reporting_officer =
    normalized.approved_by_reporting_officer ||
    Boolean(
      normalized.approved_by_reporting_officer_id ||
      normalized.reporting_officer_approved_at,
    );

  normalized.hr_notified = Boolean(normalized.hr_notified || normalized.hr_notified_at);

  return normalized;
}

export function normalizeLeaveApprovalList(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((record) => normalizeLeaveApprovalRecord(record));
}

export function normalizeProjectTeamTree(tree = {}) {
  if (!tree || typeof tree !== 'object') {
    return {
      reporting_officer: {},
      team_leader: {},
      assigned_members: [],
      collaborators: [],
      doing_people: [],
      latest_progress_person: {},
      all_people: [],
      tree_levels: [],
      connection_label: 'Reporting Officer → Team Leader → Team Members → Collaborators',
    };
  }

  const normalized = {
    ...tree,
    reporting_officer: normalizePerson(tree.reporting_officer || {}),
    team_leader: normalizePerson(tree.team_leader || {}),
    assigned_members: normalizePeopleList(tree.assigned_members || []),
    collaborators: normalizePeopleList(tree.collaborators || []),
    doing_people: normalizePeopleList(tree.doing_people || []),
    latest_progress_person: normalizePerson(tree.latest_progress_person || {}),
    all_people: normalizePeopleList(tree.all_people || []),
    tree_levels: Array.isArray(tree.tree_levels)
      ? tree.tree_levels.map((level) => ({
          ...level,
          people: normalizePeopleList(level.people || []),
        }))
      : [],
    connection_label:
      tree.connection_label ||
      'Reporting Officer → Team Leader → Team Members → Collaborators',
  };

  if (!normalized.all_people.length) {
    normalized.all_people = normalizePeopleList([
      normalized.reporting_officer,
      normalized.team_leader,
      ...normalized.assigned_members,
      ...normalized.collaborators,
      normalized.latest_progress_person,
    ]);
  }

  return normalized;
}

export function normalizeTeamHierarchyTree(tree = {}) {
  if (!tree || typeof tree !== 'object') {
    return {
      self: {},
      reporting_officer: {},
      team_leader: {},
      team_members: [],
      reporting_members: [],
      team_leaders_under_reporting: [],
      all_people: [],
      tree_levels: [],
      connection_label: 'Reporting Officer → Team Leader → Team Members',
    };
  }

  const normalized = {
    ...tree,
    self: normalizePerson(tree.self || {}),
    reporting_officer: normalizePerson(tree.reporting_officer || {}),
    team_leader: normalizePerson(tree.team_leader || {}),
    team_members: normalizePeopleList(tree.team_members || []),
    reporting_members: normalizePeopleList(tree.reporting_members || []),
    team_leaders_under_reporting: normalizePeopleList(tree.team_leaders_under_reporting || []),
    all_people: normalizePeopleList(tree.all_people || []),
    tree_levels: Array.isArray(tree.tree_levels)
      ? tree.tree_levels.map((level) => ({
          ...level,
          people: normalizePeopleList(level.people || []),
        }))
      : [],
    connection_label:
      tree.connection_label ||
      'Reporting Officer → Team Leader → Team Members',
  };

  if (!normalized.all_people.length) {
    normalized.all_people = normalizePeopleList([
      normalized.reporting_officer,
      normalized.team_leader,
      normalized.self,
      ...normalized.team_members,
      ...normalized.reporting_members,
    ]);
  }

  return normalized;
}

export function normalizeProject(project = {}) {
  if (!project || typeof project !== 'object') {
    return project;
  }

  const normalized = { ...project };

  normalized.reporting_officer = normalizePerson(normalized.reporting_officer || {});
  normalized.team_leader = normalizePerson(normalized.team_leader || {});
  normalized.assigned_members = normalizePeopleList(normalized.assigned_members || []);
  normalized.collaborators = normalizePeopleList(normalized.collaborators || []);
  normalized.doing_people = normalizePeopleList(normalized.doing_people || []);
  normalized.latest_progress_person = normalizePerson(normalized.latest_progress_person || {});
  normalized.project_team_tree = normalizeProjectTeamTree(normalized.project_team_tree || {});

  if (!normalized.doing_people.length) {
    normalized.doing_people = normalizePeopleList(normalized.project_team_tree.doing_people || []);
  }

  normalized.doing_people_names = Array.isArray(normalized.doing_people_names)
    ? normalized.doing_people_names
    : normalized.doing_people
        .map((person) => person.employee_name || person.name)
        .filter(Boolean);

  normalized.doing_person_name =
    normalized.doing_person_name ||
    normalized.doing_people_names[0] ||
    normalized.assigned_to_name ||
    '';

  normalized.team_leader_name =
    normalized.team_leader_name ||
    normalized.team_leader?.employee_name ||
    normalized.team_leader?.name ||
    '';

  normalized.reporting_officer_name =
    normalized.reporting_officer_name ||
    normalized.reporting_officer?.employee_name ||
    normalized.reporting_officer?.name ||
    '';

  return normalized;
}

export function normalizeProjectList(projects = []) {
  if (!Array.isArray(projects)) {
    return [];
  }

  return projects.map((project) => normalizeProject(project));
}

export function normalizeDashboardPayload(data = {}) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const normalized = { ...data };

  normalized.user = withProfilePhotoAliases(normalized.user || {});
  normalized.employee = withProfilePhotoAliases(normalized.employee || {});
  normalized.employee_summary = withProfilePhotoAliases(normalized.employee_summary || {});
  normalized.dashboard_display = withProfilePhotoAliases(normalized.dashboard_display || {});

  normalized.team_members = normalizePeopleList(normalized.team_members || []);
  normalized.reporting_members = normalizePeopleList(normalized.reporting_members || []);
  normalized.team_hierarchy_tree = normalizeTeamHierarchyTree(normalized.team_hierarchy_tree || {});

  normalized.projects = normalizeProjectList(normalized.projects || []);
  normalized.active_projects = normalizeProjectList(normalized.active_projects || []);
  normalized.completed_projects = normalizeProjectList(normalized.completed_projects || []);
  normalized.team_leader_projects = normalizeProjectList(normalized.team_leader_projects || []);
  normalized.reporting_projects = normalizeProjectList(normalized.reporting_projects || []);

  normalized.my_pending_leave_approvals = normalizeLeaveApprovalList(
    normalized.my_pending_leave_approvals || [],
  );
  normalized.pending_leave_approvals = normalizeLeaveApprovalList(
    normalized.pending_leave_approvals || [],
  );

  if (normalized.pending && typeof normalized.pending === 'object') {
    normalized.pending = {
      ...normalized.pending,
      leave_requests: normalizeLeaveApprovalList(normalized.pending.leave_requests || []),
    };
  }

  if (normalized.application_status && typeof normalized.application_status === 'object') {
    normalized.application_status = {
      ...normalized.application_status,
      leave_requests: normalizeLeaveApprovalList(
        normalized.application_status.leave_requests || [],
      ),
    };
  }

  if (normalized.project_dashboard && typeof normalized.project_dashboard === 'object') {
    normalized.project_dashboard = {
      ...normalized.project_dashboard,
      my_projects: normalizeProjectList(normalized.project_dashboard.my_projects || []),
      active_projects: normalizeProjectList(normalized.project_dashboard.active_projects || []),
      completed_projects: normalizeProjectList(normalized.project_dashboard.completed_projects || []),
      team_leader_projects: normalizeProjectList(normalized.project_dashboard.team_leader_projects || []),
      reporting_projects: normalizeProjectList(normalized.project_dashboard.reporting_projects || []),
    };
  }

  if (normalized.project_analytics && typeof normalized.project_analytics === 'object') {
    normalized.project_analytics = {
      ...normalized.project_analytics,
      projects: normalizeProjectList(normalized.project_analytics.projects || []),
      active_projects: normalizeProjectList(normalized.project_analytics.active_projects || []),
      on_hold_projects: normalizeProjectList(normalized.project_analytics.on_hold_projects || []),
      completed_projects: normalizeProjectList(normalized.project_analytics.completed_projects || []),
      project_wise_performance: normalizeProjectList(
        normalized.project_analytics.project_wise_performance || [],
      ),
      project_performance: normalizeProjectList(
        normalized.project_analytics.project_performance || [],
      ),
      top_project_performance: normalizeProjectList(
        normalized.project_analytics.top_project_performance || [],
      ),
    };
  }

  normalized.project_wise_performance = normalizeProjectList(
    normalized.project_wise_performance || [],
  );
  normalized.top_project_performance = normalizeProjectList(
    normalized.top_project_performance || [],
  );

  return normalized;
}

export function normalizeApiPayload(data = {}) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const normalized = { ...data };

  if (normalized.user) {
    normalized.user = withProfilePhotoAliases(normalized.user);
  }

  if (normalized.employee) {
    normalized.employee = withProfilePhotoAliases(normalized.employee);
  }

  if (normalized.employee_summary) {
    normalized.employee_summary = withProfilePhotoAliases(normalized.employee_summary);
  }

  if (normalized.item) {
    normalized.item = normalizeLeaveApprovalRecord(
      normalizeProject(withProfilePhotoAliases(normalized.item)),
    );
  }

  if (normalized.project) {
    normalized.project = normalizeProject(normalized.project);
  }

  if (Array.isArray(normalized.items)) {
    normalized.items = normalized.items.map((item) =>
      normalizeLeaveApprovalRecord(normalizeProject(withProfilePhotoAliases(item))),
    );
  }

  if (Array.isArray(normalized.leave_requests)) {
    normalized.leave_requests = normalizeLeaveApprovalList(normalized.leave_requests);
  }

  if (Array.isArray(normalized.pending_leave_approvals)) {
    normalized.pending_leave_approvals = normalizeLeaveApprovalList(
      normalized.pending_leave_approvals,
    );
  }

  if (Array.isArray(normalized.my_pending_leave_approvals)) {
    normalized.my_pending_leave_approvals = normalizeLeaveApprovalList(
      normalized.my_pending_leave_approvals,
    );
  }

  if (
    normalized.project_dashboard ||
    normalized.project_analytics ||
    normalized.team_hierarchy_tree ||
    normalized.employee_summary ||
    normalized.dashboard_display ||
    normalized.pending ||
    normalized.application_status
  ) {
    return normalizeDashboardPayload(normalized);
  }

  return normalized;
}

export function buildProfilePhotoPayload(photoValue, extra = {}) {
  const photo = String(photoValue || '').trim();

  return {
    ...extra,
    avatar: photo,
    profile_photo: photo,
    profile_picture: photo,
    photo,
  };
}

export function setSession(data = {}) {
  const user = withProfilePhotoAliases(data.user || {});
  const employee = withProfilePhotoAliases(data.employee || {});

  if (data.token) {
    localStorage.setItem('sds_hrms_token', data.token);
  }

  localStorage.setItem('sds_hrms_user', JSON.stringify(user));
  localStorage.setItem('sds_hrms_employee', JSON.stringify(employee));
}

export function clearSession() {
  localStorage.removeItem('sds_hrms_token');
  localStorage.removeItem('sds_hrms_user');
  localStorage.removeItem('sds_hrms_employee');
}

export function currentUser() {
  try {
    return withProfilePhotoAliases(JSON.parse(localStorage.getItem('sds_hrms_user') || '{}'));
  } catch {
    return {};
  }
}

export function currentEmployee() {
  try {
    return withProfilePhotoAliases(JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}'));
  } catch {
    return {};
  }
}

function buildUrl(path = '') {
  const cleanBase = String(API_BASE).replace(/\/+$/, '');
  const cleanPath = String(path).startsWith('/') ? path : `/${path}`;

  return `${cleanBase}${cleanPath}`;
}

export function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          query.append(key, item);
        }
      });
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();

  return queryString ? `?${queryString}` : '';
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 204) {
    return {};
  }

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  try {
    const text = await response.text();
    return text ? { message: text } : {};
  } catch {
    return {};
  }
}

function getConnectionErrorMessage() {
  return [
    'Unable to connect to backend server.',
    `Frontend is trying: ${API_BASE}`,
    'Check that Flask is running on port 5000 and backend CORS allows this frontend origin.',
  ].join(' ');
}

export async function api(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const timeoutMs = options.timeoutMs || 30000;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;

    response = await fetch(buildUrl(path), {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Backend request timed out. Tried: ${API_BASE}`);
    }

    throw new Error(getConnectionErrorMessage());
  } finally {
    clearTimeout(timeout);
  }

  const data = normalizeApiPayload(await parseResponse(response));

  if (response.status === 401) {
    clearSession();
    throw new Error(data.message || 'Session expired. Please login again.');
  }

  if (response.status === 403) {
    throw new Error(data.message || 'You do not have permission to perform this action.');
  }

  if (!response.ok) {
    throw new Error(data.message || `API Error ${response.status}`);
  }

  return data;
}

export function getApiBase() {
  return API_BASE;
}

export function getApiUrl(path = '') {
  return buildUrl(path);
}

export function checkBackendHealth() {
  return api('/health', {
    method: 'GET',
    timeoutMs: 10000,
  });
}

export async function refreshCurrentSession() {
  const data = await api('/auth/me');

  setSession({
    token: getToken(),
    user: data.user || {},
    employee: data.employee || {},
  });

  return data;
}

/* -------------------------------------------------------------------------- */
/* Generic CRUD APIs                                                          */
/* -------------------------------------------------------------------------- */

export function listCollection(collection, params = {}) {
  return api(`/${collection}${buildQuery(params)}`);
}

export function createCollectionItem(collection, payload = {}) {
  return api(`/${collection}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCollectionItem(collection, itemId, payload = {}) {
  return api(`/${collection}/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCollectionItem(collection, itemId) {
  return api(`/${collection}/${itemId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard APIs                                                             */
/* -------------------------------------------------------------------------- */

export function getSuperAdminDashboard() {
  return api('/dashboard/superadmin');
}

export function getAdminDashboard() {
  return api('/dashboard/admin');
}

export function getEmployeeDashboard() {
  return api('/dashboard/employee');
}

export function getDashboardByRole(role = 'employee') {
  const normalizedRole = String(role || '').trim().toLowerCase();

  if (normalizedRole === 'super_admin' || normalizedRole === 'superadmin') {
    return getSuperAdminDashboard();
  }

  if (
    normalizedRole === 'admin' ||
    normalizedRole === 'hr' ||
    normalizedRole === 'hr_admin' ||
    normalizedRole === 'hr_manager'
  ) {
    return getAdminDashboard();
  }

  return getEmployeeDashboard();
}

/* -------------------------------------------------------------------------- */
/* Application Status APIs                                                    */
/* -------------------------------------------------------------------------- */

export function getApplicationStatus() {
  return api('/application_status');
}

/* -------------------------------------------------------------------------- */
/* Team Approval APIs                                                         */
/* -------------------------------------------------------------------------- */

export function getTeamApprovals(params = {}) {
  return api(`/team_approvals${buildQuery(params)}`);
}

export function decideTeamLeaveApproval(requestId, payload = {}) {
  return api(`/team_approvals/leave_requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function approveTeamLeaveRequest(requestId, reason = '') {
  return decideTeamLeaveApproval(requestId, {
    status: 'approved',
    reason,
  });
}

export function rejectTeamLeaveRequest(requestId, reason = '') {
  return decideTeamLeaveApproval(requestId, {
    status: 'rejected',
    reason,
  });
}

/* -------------------------------------------------------------------------- */
/* Project APIs                                                               */
/* -------------------------------------------------------------------------- */

export function getProjects(params = {}) {
  return api(`/projects${buildQuery(params)}`);
}

export function getProjectOptions(params = {}) {
  return api(`/projects/options${buildQuery(params)}`);
}

export function getActiveProjects(params = {}) {
  return api(`/projects${buildQuery({ ...params, status: 'active' })}`);
}

export function getOnHoldProjects(params = {}) {
  return api(`/projects${buildQuery({ ...params, status: 'on_hold' })}`);
}

export function getCompletedProjects(params = {}) {
  return api(`/projects${buildQuery({ ...params, status: 'completed' })}`);
}

export function getProject(projectId) {
  return api(`/projects/${projectId}`);
}

export function createProject(payload = {}) {
  return api('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProject(projectId, payload = {}) {
  return api(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateProjectStatus(projectId, status) {
  return api(`/projects/${projectId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function assignProject(projectId, payload = {}) {
  return api(`/projects/${projectId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function assignProjectToSelf(projectId, extraPayload = {}) {
  return assignProject(projectId, {
    ...extraPayload,
    assign_to_self: true,
  });
}

export function addProjectCollaborators(projectId, collaboratorIds = []) {
  return api(`/projects/${projectId}/collaborators`, {
    method: 'PATCH',
    body: JSON.stringify({ collaborator_ids: collaboratorIds }),
  });
}

export function updateProjectCollaborators(projectId, payload = {}) {
  return api(`/projects/${projectId}/collaborators`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getProjectProgress(projectId, params = {}) {
  return api(`/projects/${projectId}/progress${buildQuery(params)}`);
}

export function addProjectProgress(projectId, payload = {}) {
  return api(`/projects/${projectId}/progress`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMyProjectProgress(params = {}) {
  return api(`/projects/my-progress${buildQuery(params)}`);
}

export function getProjectAnalytics(params = {}) {
  return api(`/projects/analytics${buildQuery(params)}`);
}

export function getDepartmentProjectAnalytics(params = {}) {
  return getProjectAnalytics({
    ...params,
    view: params.view || 'department',
  });
}

export function getProjectWiseAnalytics(params = {}) {
  return getProjectAnalytics({
    ...params,
    view: params.view || 'project',
  });
}

export function getTeamLeaderProjectAnalytics(params = {}) {
  return getProjectAnalytics({
    ...params,
    view: params.view || 'team_leader',
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance APIs                                                            */
/* -------------------------------------------------------------------------- */

export function getAttendanceStatus() {
  return api('/attendance/status');
}

export function getMyAttendance() {
  return api('/attendance/my');
}

export function getAttendanceReport(params = {}) {
  return api(`/attendance/report${buildQuery(params)}`);
}

export function checkInAttendance(payload = {}) {
  return api('/attendance/check-in', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function checkOutAttendance(payload = {}) {
  return api('/attendance/check-out', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function verifyAttendance(attendanceId) {
  return api(`/attendance/${attendanceId}/verify`, {
    method: 'PATCH',
    body: JSON.stringify({ verified: true }),
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance Mode Request APIs: WFH / Field                                  */
/* -------------------------------------------------------------------------- */

export function createAttendanceModeRequest(payload = {}) {
  return api('/attendance/mode-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMyAttendanceModeRequests() {
  return api('/attendance/my-mode-requests');
}

export function getAttendanceModeRequests(params = {}) {
  return api(`/attendance/mode-requests${buildQuery(params)}`);
}

export function decideAttendanceModeRequest(requestId, payload = {}) {
  return api(`/attendance/mode-requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Holiday Calendar APIs                                                      */
/* -------------------------------------------------------------------------- */

export function getHolidayCalendar(params = {}) {
  return api(`/attendance/holidays${buildQuery(params)}`);
}

export function createHoliday(payload = {}) {
  return api('/attendance/holidays', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateHoliday(holidayId, payload = {}) {
  return api(`/attendance/holidays/${holidayId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteHoliday(holidayId) {
  return api(`/attendance/holidays/${holidayId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Comp-Off APIs                                                              */
/* -------------------------------------------------------------------------- */

export function getMyCompOffs() {
  return api('/attendance/compoffs');
}

export function claimCompOff(compoffId, payload = {}) {
  return api(`/attendance/compoffs/${compoffId}/claim`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Leave Management APIs                                                      */
/* -------------------------------------------------------------------------- */

export function getLeaveBalances(params = {}) {
  return api(`/leave_balances${buildQuery(params)}`);
}

export function createLeaveBalances(payload = {}) {
  return api('/leave_balances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function setLeaveBalance(employeeId, payload = {}) {
  return api(`/leave_balances/${employeeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function saveCombinedLeaveBalance(employeeId, payload = {}) {
  const normalizedPayload = {
    ...payload,
    employee_id: payload.employee_id || employeeId,
    status: payload.status || 'active',
  };

  if (!employeeId && !normalizedPayload.employee_id) {
    throw new Error('employee_id is required to save leave balance.');
  }

  const targetEmployeeId = employeeId || normalizedPayload.employee_id;

  return setLeaveBalance(targetEmployeeId, normalizedPayload);
}

export function getLeaveOptions(params = {}) {
  return api(`/leave_requests/options${buildQuery(params)}`);
}

export function applyLeaveRequest(payload = {}) {
  const normalizedPayload = { ...payload };

  if (normalizedPayload.upto_date && !normalizedPayload.to_date) {
    normalizedPayload.to_date = normalizedPayload.upto_date;
  }

  if (normalizedPayload.to_date && !normalizedPayload.upto_date) {
    normalizedPayload.upto_date = normalizedPayload.to_date;
  }

  return api('/leave_requests/apply', {
    method: 'POST',
    body: JSON.stringify(normalizedPayload),
  });
}

export function decideLeaveRequest(requestId, payload = {}) {
  return api(`/leave_requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function approveLeaveRequest(requestId, reason = '') {
  return decideLeaveRequest(requestId, {
    status: 'approved',
    reason,
  });
}

export function rejectLeaveRequest(requestId, reason = '') {
  return decideLeaveRequest(requestId, {
    status: 'rejected',
    reason,
  });
}

export function getLeaveRequests(params = {}) {
  return listCollection('leave_requests', params);
}

export function getLeaveRecords(params = {}) {
  return api(`/reports/leave-records${buildQuery(params)}`);
}

export function getHolidayRecords(params = {}) {
  return listCollection('holiday_calendar', params);
}

export function getAttendanceLogs(params = {}) {
  return listCollection('attendance_logs', params);
}

export function getCompOffCredits(params = {}) {
  return listCollection('compoff_credits', params);
}

/* -------------------------------------------------------------------------- */
/* Performance Review APIs                                                    */
/* -------------------------------------------------------------------------- */

export function submitPerformanceReview(payload = {}) {
  return api('/performance/reviews', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createPerformanceReview(payload = {}) {
  return submitPerformanceReview(payload);
}

export function getPerformanceReviews(params = {}) {
  return listCollection('performance_reviews', params);
}

export function getMyPerformanceReviews(params = {}) {
  return getPerformanceReviews({
    ...params,
    scope: params.scope || 'mine',
  });
}

export function getReviewsGivenByMe(params = {}) {
  return getPerformanceReviews({
    ...params,
    scope: params.scope || 'given_by_me',
  });
}

/* -------------------------------------------------------------------------- */
/* Notification APIs                                                          */
/* -------------------------------------------------------------------------- */

export function getNotifications(params = {}) {
  return api(`/notifications${buildQuery(params)}`);
}

export function getUnreadNotifications(limit = 20) {
  return getNotifications({
    unread: true,
    limit,
  });
}

export function markNotificationRead(notificationId) {
  return api(`/notifications/${notificationId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

export function markAllNotificationsRead() {
  return api('/notifications/read_all', {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

/* -------------------------------------------------------------------------- */
/* Reports APIs                                                               */
/* -------------------------------------------------------------------------- */

export function getReportsSummary(params = {}) {
  return api(`/reports/summary${buildQuery(params)}`);
}

export function getAttendanceReports(params = {}) {
  return api(`/reports/attendance${buildQuery(params)}`);
}

export function getAttendanceModeReports(params = {}) {
  return api(`/reports/attendance-mode-requests${buildQuery(params)}`);
}

export function getHolidayReports(params = {}) {
  return api(`/reports/holidays${buildQuery(params)}`);
}

export function getCompOffReports(params = {}) {
  return api(`/reports/compoffs${buildQuery(params)}`);
}

export function getLeaveBalanceReports(params = {}) {
  return api(`/reports/leave-balances${buildQuery(params)}`);
}

export function getLeaveRequestReports(params = {}) {
  return api(`/reports/leave-requests${buildQuery(params)}`);
}

export function getLeaveApprovalReports(params = {}) {
  return api(`/reports/leave-approvals${buildQuery(params)}`);
}

export function getLeaveDeductionReports(params = {}) {
  return api(`/reports/leave-deductions${buildQuery(params)}`);
}

export function getLeaveRecordReports(params = {}) {
  return api(`/reports/leave-records${buildQuery(params)}`);
}

export function getAuditReports(params = {}) {
  return api(`/reports/audit${buildQuery(params)}`);
}

/* -------------------------------------------------------------------------- */
/* Super Admin APIs                                                           */
/* -------------------------------------------------------------------------- */

export function getCompanies(params = {}) {
  return api(`/superadmin/companies${buildQuery(params)}`);
}

export function createCompany(payload = {}) {
  return api('/superadmin/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCompany(tenantId, payload = {}) {
  return api(`/superadmin/companies/${tenantId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getUsers(params = {}) {
  return api(`/superadmin/users${buildQuery(params)}`);
}

export function createUser(payload = {}) {
  return api('/superadmin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateUser(userId, payload = {}) {
  return api(`/superadmin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function resetUserPassword(userId, payload = {}) {
  return api(`/superadmin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Profile Photo Helpers                                                      */
/* -------------------------------------------------------------------------- */

export function updateUserProfilePhoto(userId, photoValue, extra = {}) {
  return updateUser(userId, buildProfilePhotoPayload(photoValue, extra));
}

export function updateEmployeeProfilePhoto(employeeId, photoValue, extra = {}) {
  return updateCollectionItem(
    'employees',
    employeeId,
    buildProfilePhotoPayload(photoValue, extra),
  );
}

export function updateMyEmployeeProfilePhoto(employeeId, photoValue, extra = {}) {
  return updateEmployeeProfilePhoto(employeeId, photoValue, extra);
}

/* -------------------------------------------------------------------------- */
/* Password Request APIs                                                      */
/* -------------------------------------------------------------------------- */

export function createPasswordRequest(payload = {}) {
  return api('/password-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getPasswordRequests(params = {}) {
  return api(`/password-requests${buildQuery(params)}`);
}

export function approvePasswordRequest(requestId) {
  return api(`/password-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function rejectPasswordRequest(requestId, reason = '') {
  return api(`/password-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function decidePasswordRequest(requestId, payload = {}) {
  const status = String(payload.status || payload.decision || '').toLowerCase();

  if (status === 'approved' || status === 'approve') {
    return approvePasswordRequest(requestId);
  }

  if (status === 'rejected' || status === 'reject') {
    return rejectPasswordRequest(
      requestId,
      payload.reason || payload.note || payload.decision_reason || '',
    );
  }

  throw new Error('Password request status must be approved or rejected');
}

/* -------------------------------------------------------------------------- */
/* Location Helpers                                                           */
/* -------------------------------------------------------------------------- */

export function hasLocationInPayload(payload = {}) {
  return (
    payload.latitude !== undefined &&
    payload.latitude !== null &&
    payload.latitude !== '' &&
    payload.longitude !== undefined &&
    payload.longitude !== null &&
    payload.longitude !== ''
  );
}

export function getCurrentLocation(options = {}) {
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
    ...options,
  };

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is not supported in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          address: '',
        });
      },
      (error) => {
        let message = 'Unable to fetch current location.';

        if (error.code === 1) {
          message = 'Location permission denied. Please allow location access.';
        }

        if (error.code === 2) {
          message = 'Location unavailable. Please check GPS or network.';
        }

        if (error.code === 3) {
          message = 'Location request timed out. Please try again.';
        }

        reject(new Error(message));
      },
      geoOptions,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance Payload Helpers                                                 */
/* -------------------------------------------------------------------------- */

export async function buildAttendancePayload(extraPayload = {}) {
  if (hasLocationInPayload(extraPayload)) {
    return extraPayload;
  }

  const location = await getCurrentLocation();

  return {
    ...extraPayload,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    address: location.address || '',
  };
}

export async function submitCheckIn(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkInAttendance(attendancePayload);
}

export async function submitCheckOut(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkOutAttendance(attendancePayload);
}