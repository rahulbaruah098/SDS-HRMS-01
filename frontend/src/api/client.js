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


export function safeSessionPhotoValue(value = '') {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  /*
    Never keep large base64 images in localStorage/session/dashboard state.
    This prevents Team Leader dashboard crash after profile photo upload.
  */
  if (raw.startsWith('data:image') && raw.length > 5000) {
    return '';
  }

  /*
    Any very long non-http value is also unsafe.
    Real uploaded image paths should be short, for example:
    /uploads/profile_photos/employee.jpg
  */
  if (raw.length > 1000 && !raw.startsWith('http')) {
    return '';
  }

  return raw;
}

export function getProfilePhotoValue(record = {}) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  return firstNonEmpty(
    safeSessionPhotoValue(record.avatar),
    safeSessionPhotoValue(record.profile_photo),
    safeSessionPhotoValue(record.profile_picture),
    safeSessionPhotoValue(record.photo),
    safeSessionPhotoValue(record.image),
    safeSessionPhotoValue(record.picture),
    safeSessionPhotoValue(record.employee_avatar),
    safeSessionPhotoValue(record.employee_profile_photo),
    safeSessionPhotoValue(record.latest_progress_by_avatar),
    safeSessionPhotoValue(record.profile_photo_url),
    safeSessionPhotoValue(record.avatar_url),
    safeSessionPhotoValue(record.photo_url),
  );
}

export function withProfilePhotoAliases(record = {}) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const cloned = { ...record };
  const photo = getProfilePhotoValue(cloned);

  /*
    Remove unsafe photo fields from frontend state.
    This stops one bad base64 image from spreading into dashboard objects.
  */
  [
    'avatar',
    'profile_photo',
    'profile_picture',
    'photo',
    'image',
    'picture',
    'employee_avatar',
    'employee_profile_photo',
    'latest_progress_by_avatar',
    'profile_photo_url',
    'avatar_url',
    'photo_url',
  ].forEach((key) => {
    if (cloned[key] && !safeSessionPhotoValue(cloned[key])) {
      delete cloned[key];
    }
  });

  if (photo) {
    cloned.avatar = photo;
    cloned.profile_photo = photo;
    cloned.profile_picture = photo;
    cloned.photo = photo;
  } else {
    delete cloned.avatar;
    delete cloned.profile_photo;
    delete cloned.profile_picture;
    delete cloned.photo;
  }

  return cloned;
}

export function normalizeProfilePhotoUrl(value = '') {
  const raw = safeSessionPhotoValue(value);

  if (!raw) {
    return '';
  }

  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('blob:')
  ) {
    return raw;
  }

  /*
    Small data images are allowed only as a fallback.
    Large base64 images are already blocked by safeSessionPhotoValue().
  */
  if (raw.startsWith('data:image')) {
    return raw;
  }

  const apiBase = String(API_BASE).replace(/\/+$/, '');
  const apiRoot = String(API_BASE).replace(DEFAULT_API_PREFIX, '').replace(/\/+$/, '');

  /*
    New uploaded profile photos are served from:
    /api/v1/uploads/profile_photos/...
  */
  if (raw.startsWith('/api/v1/uploads/profile_photos/')) {
    return `${apiRoot}${raw}`;
  }

  /*
    Backward compatibility for photos already saved as:
    /uploads/profile_photos/...
    uploads/profile_photos/...
  */
  if (raw.startsWith('/uploads/profile_photos/')) {
    return `${apiBase}${raw}`;
  }

  if (raw.startsWith('uploads/profile_photos/')) {
    return `${apiBase}/${raw}`;
  }

  if (raw.startsWith('/')) {
    return `${apiRoot}${raw}`;
  }

  if (raw.startsWith('uploads/') || raw.startsWith('static/')) {
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

export function toNumber(value, fallback = 0) {
  const number = Number(value);

  if (Number.isFinite(number)) {
    return number;
  }

  return fallback;
}

export function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function clampNumber(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, toNumber(value, min)));
}

export function ratingBucket(rating = 0) {
  const value = toNumber(rating, 0);

  if (value >= 4.5) return 'Excellent';
  if (value >= 3.5) return 'Good';
  if (value >= 2.5) return 'Average';
  if (value > 0) return 'Needs Improvement';
  return 'Not Rated';
}

export function normalizePerformanceReview(review = {}) {
  if (!review || typeof review !== 'object') {
    return review;
  }

  const normalized = withProfilePhotoAliases({ ...review });
  const ratingValue = toNumber(
    normalized.rating_value ??
      normalized.rating ??
      normalized.score ??
      normalized.performance_score,
    0,
  );
  const ratingPercent = clampNumber(
    normalized.rating_percent ??
      normalized.rating_percentage ??
      normalized.graph_value ??
      (ratingValue ? (ratingValue / 5) * 100 : 0),
    0,
    100,
  );

  normalized.rating_value = ratingValue;
  normalized.rating = normalized.rating ?? ratingValue;
  normalized.score = normalized.score ?? ratingValue;
  normalized.rating_percent = ratingPercent;
  normalized.rating_percentage = ratingPercent;
  normalized.rating_bucket = normalized.rating_bucket || ratingBucket(ratingValue);
  normalized.rating_label = normalized.rating_label || normalized.rating_bucket;
  normalized.score_label = normalized.score_label || normalized.rating_bucket;
  normalized.graph_value = clampNumber(normalized.graph_value ?? ratingPercent, 0, 100);
  normalized.graph_label =
    normalized.graph_label ||
    normalized.employee_name ||
    normalized.target_employee_name ||
    normalized.name ||
    'Employee';
  normalized.graph_group =
    normalized.graph_group ||
    normalized.review_target_type ||
    normalized.period_type ||
    'performance';

  normalized.employee_name =
    normalized.employee_name ||
    normalized.target_employee_name ||
    normalized.name ||
    'Employee';
  normalized.name = normalized.name || normalized.employee_name;
  normalized.reviewer_name =
    normalized.reviewer_name ||
    normalized.reviewer_employee_name ||
    normalized.created_by_name ||
    '';

  normalized.period_type = normalized.period_type || normalized.review_frequency || 'weekly';
  normalized.review_frequency = normalized.review_frequency || normalized.period_type;
  normalized.review_date = normalized.review_date || normalized.date || normalized.created_at || '';
  normalized.week_label = normalized.week_label || normalized.cycle || '';
  normalized.month_label = normalized.month_label || normalized.month || '';
  normalized.year_label = normalized.year_label || normalized.year_key || normalized.year || '';

  return normalized;
}

export function normalizePerformanceReviewList(reviews = []) {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews.map((review) => normalizePerformanceReview(review)).filter(Boolean);
}

export function normalizePerformanceMember(member = {}) {
  if (!member || typeof member !== 'object') {
    return member;
  }

  const normalized = normalizePerson(member);
  const averageRating = toNumber(
    normalized.average_rating ?? normalized.rating_value ?? normalized.latest_rating,
    0,
  );
  const ratingPercent = clampNumber(
    normalized.rating_percentage ?? normalized.rating_percent ?? (averageRating ? (averageRating / 5) * 100 : 0),
    0,
    100,
  );

  normalized.average_rating = averageRating;
  normalized.rating_value = normalized.rating_value ?? averageRating;
  normalized.rating_percent = ratingPercent;
  normalized.rating_percentage = ratingPercent;
  normalized.rating_bucket = normalized.rating_bucket || ratingBucket(averageRating);
  normalized.rating_label = normalized.rating_label || normalized.rating_bucket;
  normalized.graph_value = clampNumber(normalized.graph_value ?? ratingPercent, 0, 100);
  normalized.graph_label =
    normalized.graph_label ||
    normalized.employee_name ||
    normalized.name ||
    'Employee';

  return normalized;
}

export function normalizePerformanceChart(chart = {}) {
  if (!chart || typeof chart !== 'object') {
    return {
      title: 'Performance',
      summary: {},
      members: [],
      items: [],
      rows: [],
      rating_distribution: [],
      recent_reviews: [],
    };
  }

  const normalized = { ...chart };

  normalized.members = Array.isArray(normalized.members)
    ? normalized.members.map((member) => normalizePerformanceMember(member))
    : [];
  normalized.items = Array.isArray(normalized.items)
    ? normalizePerformanceReviewList(normalized.items)
    : [];
  normalized.rows = Array.isArray(normalized.rows)
    ? normalizePerformanceReviewList(normalized.rows)
    : [];
  normalized.recent_reviews = Array.isArray(normalized.recent_reviews)
    ? normalizePerformanceReviewList(normalized.recent_reviews)
    : [];
  normalized.rating_distribution = Array.isArray(normalized.rating_distribution)
    ? normalized.rating_distribution
    : [];

  return normalized;
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

  normalized.my_reviews = normalizePerformanceReviewList(normalized.my_reviews || []);
  normalized.reviews_given = normalizePerformanceReviewList(normalized.reviews_given || []);

  normalized.my_performance_reviews = normalizePerformanceReviewList(
    normalized.my_performance_reviews || normalized.my_reviews || [],
  );
  normalized.reviews_given_by_me = normalizePerformanceReviewList(
    normalized.reviews_given_by_me || normalized.reviews_given || [],
  );

  normalized.my_performance_chart = normalizePerformanceChart(
    normalized.my_performance_chart || {},
  );
  normalized.team_performance_chart = normalizePerformanceChart(
    normalized.team_performance_chart || {},
  );
  normalized.reporting_performance_chart = normalizePerformanceChart(
    normalized.reporting_performance_chart || {},
  );
  normalized.weekly_performance_chart = normalizePerformanceChart(
    normalized.weekly_performance_chart || {},
  );
  normalized.monthly_performance_chart = normalizePerformanceChart(
    normalized.monthly_performance_chart || {},
  );
  normalized.yearly_performance_chart = normalizePerformanceChart(
    normalized.yearly_performance_chart || {},
  );
  normalized.team_member_weekly_graph = normalizePerformanceChart(
    normalized.team_member_weekly_graph || {},
  );
  normalized.reporting_team_leader_weekly_graph = normalizePerformanceChart(
    normalized.reporting_team_leader_weekly_graph || {},
  );
  normalized.performance_3d_graph = normalizePerformanceChart(
    normalized.performance_3d_graph || {},
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
      normalizePerformanceReview(
        normalizeLeaveApprovalRecord(normalizeProject(withProfilePhotoAliases(item))),
      ),
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
  const photo = safeSessionPhotoValue(photoValue);

  return {
    ...extra,
    avatar: photo,
    profile_photo: photo,
    profile_picture: photo,
    photo,
  };
}

function compactSessionUser(user = {}, employee = {}) {
  const photo = safeSessionPhotoValue(
    getProfilePhotoValue(user) ||
      getProfilePhotoValue(employee) ||
      user.profile_photo_url ||
      user.avatar_url ||
      user.photo_url ||
      employee.profile_photo_url ||
      employee.avatar_url ||
      employee.photo_url ||
      '',
  );

  return {
    id: user.id || user._id || '',
    _id: user._id || user.id || '',
    name: user.name || user.full_name || employee.employee_name || '',
    email: user.email || '',
    role: user.role || '',
    roles: Array.isArray(user.roles) ? user.roles : [],
    tenant_id: user.tenant_id || employee.tenant_id || '',
    employee_id: user.employee_id || employee.id || employee._id || '',
    employee_code: user.employee_code || employee.employee_code || '',
    department_id: user.department_id || employee.department_id || '',
    department_name: user.department_name || employee.department_name || '',
    designation_id: user.designation_id || employee.designation_id || '',
    designation_name: user.designation_name || employee.designation_name || '',
    avatar: photo,
    profile_photo: photo,
    profile_picture: photo,
    photo,
  };
}

function compactSessionEmployee(employee = {}) {
  const photo = safeSessionPhotoValue(
    getProfilePhotoValue(employee) ||
      employee.profile_photo_url ||
      employee.avatar_url ||
      employee.photo_url ||
      '',
  );

  return {
    id: employee.id || employee._id || '',
    _id: employee._id || employee.id || '',
    employee_name: employee.employee_name || employee.name || '',
    employee_code: employee.employee_code || '',
    email: employee.email || '',
    phone: employee.phone || '',
    tenant_id: employee.tenant_id || '',
    department_id: employee.department_id || '',
    department_name: employee.department_name || '',
    designation_id: employee.designation_id || '',
    designation_name: employee.designation_name || '',
    is_team_leader: Boolean(employee.is_team_leader),
    is_reporting_officer: Boolean(employee.is_reporting_officer),
    is_it_support_head: Boolean(employee.is_it_support_head),
    is_it_support_member: Boolean(employee.is_it_support_member),
    avatar: photo,
    profile_photo: photo,
    profile_picture: photo,
    photo,
  };
}

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Unable to save ${key} in localStorage`, error);
    localStorage.removeItem(key);
  }
}

export function setSession(data = {}) {
  const user = withProfilePhotoAliases(data.user || {});
  const employee = withProfilePhotoAliases(data.employee || {});

  if (data.token) {
    safeSetLocalStorage('sds_hrms_token', data.token);
  }

  safeSetLocalStorage(
    'sds_hrms_user',
    JSON.stringify(compactSessionUser(user, employee)),
  );

  safeSetLocalStorage(
    'sds_hrms_employee',
    JSON.stringify(compactSessionEmployee(employee)),
  );
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
/* Master Dropdown APIs                                                       */
/* -------------------------------------------------------------------------- */

export function normalizeMasterOption(item = {}, fallbackLabelKeys = []) {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const id = item.id || item._id || '';
  const labelKeys = [
    ...fallbackLabelKeys,
    'name',
    'title',
    'label',
    'department_name',
    'designation_name',
    'state_name',
    'code',
  ];

  let label = '';

  for (const key of labelKeys) {
    const value = String(item[key] || '').trim();

    if (value) {
      label = value;
      break;
    }
  }

  return {
    ...item,
    id,
    _id: item._id || id,
    value: item.value || id || label,
    label: item.label || label || 'Option',
    name: item.name || label || item.label || '',
  };
}

export function normalizeMasterOptionList(items = [], fallbackLabelKeys = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => normalizeMasterOption(item, fallbackLabelKeys))
    .filter(Boolean);
}

export function getDepartments(params = {}) {
  return listCollection('departments', {
    limit: 500,
    ...params,
  }).then((data = {}) => ({
    ...data,
    items: normalizeMasterOptionList(data.items || [], ['department_name']),
  }));
}

export function getDesignations(params = {}) {
  return listCollection('designations', {
    limit: 500,
    ...params,
  }).then((data = {}) => ({
    ...data,
    items: normalizeMasterOptionList(data.items || [], ['designation_name', 'title']),
  }));
}

export function getStates(params = {}) {
  return listCollection('states', {
    limit: 500,
    ...params,
  }).then((data = {}) => ({
    ...data,
    items: normalizeMasterOptionList(data.items || [], ['state_name']),
  }));
}

export async function getEmployeeFormOptions(params = {}) {
  const [departments, designations, states] = await Promise.all([
    getDepartments(params.departments || {}),
    getDesignations(params.designations || {}),
    getStates(params.states || {}),
  ]);

  return {
    departments: departments.items || [],
    designations: designations.items || [],
    states: states.items || [],
  };
}

/* -------------------------------------------------------------------------- */
/* Employee / Alumni APIs                                                     */
/* -------------------------------------------------------------------------- */

export const EMPLOYEE_CSV_COLUMNS = [
  ['employee_id', 'Employee ID'],
  ['emp_code', 'Employee Code'],
  ['name', 'Name'],
  ['employee_name', 'Employee Name'],
  ['email', 'Email'],
  ['official_email', 'Official Email'],
  ['phone', 'Phone'],
  ['mobile', 'Mobile'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['branch', 'Branch'],
  ['state', 'State'],
  ['role', 'Role'],
  ['employee_type', 'Employee Type'],
  ['job_type', 'Job Type'],
  ['joining_date', 'Joining Date'],
  ['date_of_joining', 'Date Of Joining'],
  ['status', 'Status'],
  ['employment_status', 'Employment Status'],
];

export const ALUMNI_CSV_COLUMNS = [
  ['employee_id', 'Employee ID'],
  ['emp_code', 'Employee Code'],
  ['name', 'Name'],
  ['employee_name', 'Employee Name'],
  ['email', 'Email'],
  ['official_email', 'Official Email'],
  ['phone', 'Phone'],
  ['mobile', 'Mobile'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['branch', 'Branch'],
  ['state', 'State'],
  ['joining_date', 'Joining Date'],
  ['date_of_joining', 'Date Of Joining'],
  ['last_working_date', 'Last Working Date'],
  ['resignation_date', 'Resignation Date'],
  ['resignation_reason', 'Resignation Reason'],
  ['exit_type', 'Exit Type'],
  ['status', 'Status'],
  ['employment_status', 'Employment Status'],
];

export function normalizeEmployee(employee = {}) {
  if (!employee || typeof employee !== 'object') {
    return employee;
  }

  const normalized = normalizePerson(withProfilePhotoAliases({ ...employee }));

  normalized.id = normalized.id || normalized._id || '';
  normalized._id = normalized._id || normalized.id || '';

  normalized.name =
    normalized.name ||
    normalized.employee_name ||
    normalized.full_name ||
    normalized.email ||
    'Employee';

  normalized.employee_name = normalized.employee_name || normalized.name;

  normalized.employee_id =
    normalized.employee_id ||
    normalized.employee_code ||
    normalized.emp_code ||
    normalized.code ||
    '';

  normalized.emp_code =
    normalized.emp_code ||
    normalized.employee_code ||
    normalized.employee_id ||
    normalized.code ||
    '';

  normalized.email = normalized.email || normalized.official_email || '';
  normalized.official_email = normalized.official_email || normalized.email || '';

  normalized.phone = normalized.phone || normalized.mobile || '';
  normalized.mobile = normalized.mobile || normalized.phone || '';

  normalized.department = normalized.department || normalized.department_name || '';
  normalized.designation = normalized.designation || normalized.designation_name || '';
  normalized.branch = normalized.branch || normalized.location || '';

  normalized.is_team_leader = toBoolean(normalized.is_team_leader);
  normalized.is_reporting_officer = toBoolean(normalized.is_reporting_officer);
  normalized.is_it_support_head = toBoolean(normalized.is_it_support_head);
  normalized.is_it_support_member = toBoolean(normalized.is_it_support_member);

  normalized.team_leader_id = normalized.team_leader_id || '';
  normalized.team_leader_name = normalized.team_leader_name || '';
  normalized.reporting_officer_id = normalized.reporting_officer_id || '';
  normalized.reporting_officer_name = normalized.reporting_officer_name || '';

  normalized.status = normalized.status || 'active';
  normalized.employment_status = normalized.employment_status || normalized.status || 'active';

  normalized.is_alumni = Boolean(
    normalized.is_alumni ||
      ['inactive', 'resigned', 'left', 'terminated', 'alumni', 'ex-employee', 'ex_employee'].includes(
        String(normalized.status || '').trim().toLowerCase(),
      ) ||
      ['inactive', 'resigned', 'left', 'terminated', 'alumni', 'ex-employee', 'ex_employee'].includes(
        String(normalized.employment_status || '').trim().toLowerCase(),
      ) ||
      Boolean(normalized.last_working_date),
  );

  normalized.status_label = normalized.is_alumni
    ? normalized.employment_status || normalized.status || 'Resigned'
    : normalized.employment_status || normalized.status || 'Active';

  return normalized;
}

export function normalizeEmployeeList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeEmployee(item)).filter(Boolean);
}

export function normalizeEmployeePayload(payload = {}) {
  const normalizedPayload = { ...payload };

  const name = firstNonEmpty(
    normalizedPayload.name,
    normalizedPayload.employee_name,
    normalizedPayload.full_name,
  );

  const email = firstNonEmpty(
    normalizedPayload.email,
    normalizedPayload.official_email,
  );

  if (name) {
    normalizedPayload.name = name;
    normalizedPayload.employee_name = name;
  }

  if (email) {
    normalizedPayload.email = email;
    normalizedPayload.official_email = normalizedPayload.official_email || email;
  }

  if (normalizedPayload.phone && !normalizedPayload.mobile) {
    normalizedPayload.mobile = normalizedPayload.phone;
  }

  if (normalizedPayload.mobile && !normalizedPayload.phone) {
    normalizedPayload.phone = normalizedPayload.mobile;
  }

  if (normalizedPayload.date_of_joining && !normalizedPayload.joining_date) {
    normalizedPayload.joining_date = normalizedPayload.date_of_joining;
  }

  if (normalizedPayload.joining_date && !normalizedPayload.date_of_joining) {
    normalizedPayload.date_of_joining = normalizedPayload.joining_date;
  }

  if (normalizedPayload.date_of_birth && !normalizedPayload.dob) {
    normalizedPayload.dob = normalizedPayload.date_of_birth;
  }

  if (normalizedPayload.dob && !normalizedPayload.date_of_birth) {
    normalizedPayload.date_of_birth = normalizedPayload.dob;
  }

  if ('is_team_leader' in normalizedPayload) {
    normalizedPayload.is_team_leader = toBoolean(normalizedPayload.is_team_leader) ? 'true' : 'false';
  }

  if ('is_reporting_officer' in normalizedPayload) {
    normalizedPayload.is_reporting_officer = toBoolean(normalizedPayload.is_reporting_officer) ? 'true' : 'false';
  }

  if ('team_leader_id' in normalizedPayload && !normalizedPayload.team_leader_id) {
    normalizedPayload.team_leader_name = '';
  }

  if ('reporting_officer_id' in normalizedPayload && !normalizedPayload.reporting_officer_id) {
    normalizedPayload.reporting_officer_name = '';
  }

  return normalizedPayload;
}

export function getEmployees(params = {}) {
  return listCollection('employees', params).then((data = {}) => ({
    ...data,
    items: normalizeEmployeeList(data.items || []),
  }));
}

export function getEmployeeDirectory(params = {}) {
  return api(`/employee-directory${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizePeopleList(data.items || []),
    filters: data.filters || {
      designations: [],
      states: [],
    },
  }));
}

export function getActiveEmployees(params = {}) {
  return getEmployees({
    ...params,
    employee_scope: params.employee_scope || 'active',
  });
}

export function getAlumniEmployees(params = {}) {
  return getEmployees({
    ...params,
    employee_scope: 'alumni',
  });
}

export function getAllEmployees(params = {}) {
  return getEmployees({
    ...params,
    employee_scope: 'all',
  });
}

export function getTeamLeaderOptions(params = {}) {
  return getEmployees({
    limit: 500,
    ...params,
    employee_scope: params.employee_scope || 'active',
    employee_picker: 'team_leader',
  });
}

export function getReportingOfficerOptions(params = {}) {
  return getEmployees({
    limit: 500,
    ...params,
    employee_scope: params.employee_scope || 'active',
    employee_picker: 'reporting_officer',
  });
}

export function createEmployee(payload = {}) {
  return createCollectionItem('employees', normalizeEmployeePayload(payload)).then((data = {}) => ({
    ...data,
    item: normalizeEmployee(data.item || {}),
  }));
}

export function createPastEmployee(payload = {}) {
  const normalizedPayload = normalizeEmployeePayload({
    ...payload,
    is_alumni: true,
    skip_login: true,
    status: payload.status || 'Resigned',
    employment_status: payload.employment_status || payload.status || 'Resigned',
  });

  return createEmployee(normalizedPayload);
}

export function updateEmployee(employeeId, payload = {}) {
  return updateCollectionItem('employees', employeeId, normalizeEmployeePayload(payload)).then((data = {}) => ({
    ...data,
    item: normalizeEmployee(data.item || {}),
  }));
}

export function markEmployeeAsResigned(employeeId, payload = {}) {
  const normalizedPayload = normalizeEmployeePayload({
    ...payload,
    is_alumni: true,
    status: payload.status || 'Resigned',
    employment_status: payload.employment_status || payload.status || 'Resigned',
    last_working_date:
      payload.last_working_date ||
      payload.resignation_date ||
      new Date().toISOString().slice(0, 10),
  });

  return updateEmployee(employeeId, normalizedPayload);
}

export function restoreEmployeeFromAlumni(employeeId, payload = {}) {
  const normalizedPayload = normalizeEmployeePayload({
    ...payload,
    is_alumni: false,
    status: payload.status || 'active',
    employment_status: payload.employment_status || payload.status || 'active',
    last_working_date: '',
    resignation_date: '',
    resignation_reason: '',
    exit_type: '',
  });

  return updateEmployee(employeeId, normalizedPayload);
}

export function employeeMatchesSearch(employee = {}, searchText = '') {
  const query = String(searchText || '').trim().toLowerCase();

  if (!query) {
    return true;
  }

  const searchableValues = [
    employee.name,
    employee.employee_name,
    employee.full_name,
    employee.email,
    employee.official_email,
    employee.phone,
    employee.mobile,
    employee.employee_id,
    employee.emp_code,
    employee.employee_code,
    employee.department,
    employee.department_name,
    employee.designation,
    employee.designation_name,
    employee.branch,
    employee.state,
    employee.role,
    employee.employee_type,
    employee.job_type,
    employee.status,
    employee.employment_status,
    employee.resignation_reason,
    employee.exit_type,
    employee.last_working_date,
  ];

  return searchableValues
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(query));
}

export function filterEmployees(items = [], filters = {}) {
  const searchText = filters.q || filters.search || '';
  const department = String(filters.department || '').trim().toLowerCase();
  const designation = String(filters.designation || '').trim().toLowerCase();
  const branch = String(filters.branch || '').trim().toLowerCase();
  const employmentStatus = String(filters.employment_status || filters.status || '').trim().toLowerCase();

  return normalizeEmployeeList(items).filter((employee) => {
    if (!employeeMatchesSearch(employee, searchText)) {
      return false;
    }

    if (department && String(employee.department || '').trim().toLowerCase() !== department) {
      return false;
    }

    if (designation && String(employee.designation || '').trim().toLowerCase() !== designation) {
      return false;
    }

    if (branch && String(employee.branch || '').trim().toLowerCase() !== branch) {
      return false;
    }

    if (
      employmentStatus &&
      String(employee.employment_status || employee.status || '').trim().toLowerCase() !== employmentStatus
    ) {
      return false;
    }

    return true;
  });
}

function csvEscape(value) {
  const text = String(value ?? '');

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function downloadCsv(filename = 'data.csv', rows = [], columns = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = Array.isArray(columns) && columns.length
    ? columns
    : Object.keys(safeRows[0] || {}).map((key) => [key, key]);

  const header = safeColumns.map(([, label]) => csvEscape(label)).join(',');
  const body = safeRows
    .map((row) =>
      safeColumns
        .map(([key]) => csvEscape(row?.[key] ?? ''))
        .join(','),
    )
    .join('\n');

  const csv = [header, body].filter(Boolean).join('\n');
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}

export function downloadEmployeeCsv(rows = [], filename = 'active-employees.csv') {
  return downloadCsv(filename, normalizeEmployeeList(rows), EMPLOYEE_CSV_COLUMNS);
}

export function downloadAlumniCsv(rows = [], filename = 'alumni-employees.csv') {
  return downloadCsv(filename, normalizeEmployeeList(rows), ALUMNI_CSV_COLUMNS);
}

/* -------------------------------------------------------------------------- */
/* Policy APIs                                                                */
/* -------------------------------------------------------------------------- */

export function normalizePolicy(policy = {}) {
  if (!policy || typeof policy !== 'object') {
    return policy;
  }

  const file = policy.file || {};

  const normalized = {
    ...policy,
    id: policy.id || policy._id,
    document_id: policy.document_id || policy.documentId || '',
    title: policy.title || policy.policy_title || '',
    summary: policy.summary || policy.policy_summary || '',
    status: policy.status || 'active',

    file_original_name:
      file.original_name ||
      policy.file_original_name ||
      policy.original_name ||
      '',

    file_stored_name:
      file.stored_name ||
      policy.file_stored_name ||
      policy.stored_name ||
      '',

    file_extension:
      file.extension ||
      policy.file_extension ||
      '',

    file_size_bytes:
      file.size_bytes ||
      policy.file_size_bytes ||
      0,

    file_path:
      file.relative_path ||
      policy.file_path ||
      '',
  };

  normalized.download_url = normalized.id
    ? getApiUrl(`/policies/${normalized.id}/download`)
    : '';

  return normalized;
}

export function normalizePolicyList(policies = []) {
  if (!Array.isArray(policies)) {
    return [];
  }

  return policies.map((policy) => normalizePolicy(policy)).filter(Boolean);
}

export function getPolicies(params = {}) {
  return api(`/policies${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizePolicyList(data.items || data.policies || []),
    policies: normalizePolicyList(data.policies || data.items || []),
  }));
}

export function getPolicy(policyId) {
  return api(`/policies/${policyId}`).then((data = {}) => ({
    ...data,
    item: normalizePolicy(data.item || data.policy || {}),
    policy: normalizePolicy(data.policy || data.item || {}),
  }));
}

export function uploadPolicy(payload = {}) {
  const formData = new FormData();

  formData.append('document_id', payload.document_id || '');
  formData.append('title', payload.title || '');
  formData.append('summary', payload.summary || '');

  if (payload.file) {
    formData.append('file', payload.file);
  }

  return api('/policies', {
    method: 'POST',
    body: formData,
  }).then((data = {}) => ({
    ...data,
    item: normalizePolicy(data.item || data.policy || {}),
    policy: normalizePolicy(data.policy || data.item || {}),
  }));
}

export async function downloadPolicy(policyId, filename = '') {
  const token = getToken();

  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(`/policies/${policyId}/download`), {
    method: 'GET',
    headers,
  });

  if (response.status === 401) {
    clearSession();
    throw new Error('Session expired. Please login again.');
  }

  if (response.status === 403) {
    throw new Error('You do not have permission to download this policy.');
  }

  if (!response.ok) {
    let message = 'Unable to download policy file.';

    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `policy-${policyId}`;
  document.body.appendChild(link);
  link.click();

  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}

/* -------------------------------------------------------------------------- */
/* Celebrations APIs                                                          */
/* -------------------------------------------------------------------------- */

export function normalizeCelebration(item = {}) {
  if (!item || typeof item !== 'object') {
    return item;
  }

  return {
    ...item,
    id: item.id || item._id || '',
    tenant_id: item.tenant_id || '',
    tenant_name: item.tenant_name || '',
    event_type: item.event_type || '',
    date_key: item.date_key || '',
    scheduled_time: item.scheduled_time || '10:00',

    employee_id: item.employee_id || '',
    employee_user_id: item.employee_user_id || '',
    employee_name: item.employee_name || 'Employee',
    employee_code: item.employee_code || '',
    department: item.department || '',
    designation: item.designation || '',

    date_of_birth: item.date_of_birth || '',
    joining_date: item.joining_date || '',
    year_count: Number(item.year_count || 0),

    title: item.title || '',
    message: item.message || '',
    highlight_name: item.highlight_name || item.tenant_name || '',
    animation_type: item.animation_type || '',

    status: item.status || 'active',
    is_active: item.is_active !== false,
    notification_sent: Boolean(item.notification_sent),
    notification_sent_at: item.notification_sent_at || '',
  };
}

export function normalizeCelebrationList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeCelebration(item)).filter(Boolean);
}

export function getTodayCelebrations() {
  return api('/celebrations/today').then((data = {}) => ({
    ...data,
    items: normalizeCelebrationList(data.items || []),
    released: Boolean(data.released),
    date_key: data.date_key || '',
    release_time: data.release_time || '10:00',
  }));
}

export function getMyCelebrations() {
  return api('/celebrations/my').then((data = {}) => ({
    ...data,
    items: normalizeCelebrationList(data.items || []),
    date_key: data.date_key || '',
  }));
}

export function runTodayCelebrations(payload = {}) {
  return api('/celebrations/run-today', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    items: normalizeCelebrationList(data.items || []),
  }));
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

export function normalizePerformancePayload(payload = {}) {
  const normalizedPayload = { ...payload };

  if (normalizedPayload.employee_id && !normalizedPayload.target_employee_id) {
    normalizedPayload.target_employee_id = normalizedPayload.employee_id;
  }

  if (normalizedPayload.target_employee_id && !normalizedPayload.employee_id) {
    normalizedPayload.employee_id = normalizedPayload.target_employee_id;
  }

  normalizedPayload.period_type = normalizedPayload.period_type || 'weekly';
  normalizedPayload.review_frequency = normalizedPayload.review_frequency || normalizedPayload.period_type;

  return normalizedPayload;
}

export function submitPerformanceReview(payload = {}) {
  return api('/performance/reviews', {
    method: 'POST',
    body: JSON.stringify(normalizePerformancePayload(payload)),
  });
}

export function submitWeeklyPerformanceReview(payload = {}) {
  return submitPerformanceReview({
    ...payload,
    period_type: 'weekly',
    review_frequency: 'weekly',
  });
}

export function createPerformanceReview(payload = {}) {
  return submitPerformanceReview(payload);
}

export async function getPerformanceDashboard(params = {}) {
  const data = await getEmployeeDashboard();
  const normalized = normalizeDashboardPayload(data || {});

  if (!params || !Object.keys(params).length) {
    return normalized;
  }

  return {
    ...normalized,
    params,
  };
}

export function getPerformanceReviews(params = {}) {
  return listCollection('performance_reviews', params).then((data = {}) => ({
    ...data,
    items: normalizePerformanceReviewList(data.items || []),
  }));
}

export function getPerformanceReviewsByPeriod(periodType = 'weekly', params = {}) {
  return getPerformanceReviews({
    ...params,
    period_type: periodType,
  });
}

export function getWeeklyPerformanceReviews(params = {}) {
  return getPerformanceReviewsByPeriod('weekly', params);
}

export function getMonthlyPerformanceReviews(params = {}) {
  return getPerformanceReviewsByPeriod('monthly', params);
}

export function getYearlyPerformanceReviews(params = {}) {
  return getPerformanceReviewsByPeriod('yearly', params);
}

export function getMyPerformanceReviews(params = {}) {
  return getPerformanceReviews({
    ...params,
    scope: params.scope || 'mine',
  });
}

export function getMyReceivedPerformanceReviews(params = {}) {
  return getMyPerformanceReviews(params);
}

export function getReviewsGivenByMe(params = {}) {
  return getPerformanceReviews({
    ...params,
    scope: params.scope || 'given_by_me',
  });
}

export function getPerformanceReviewsGiven(params = {}) {
  return getReviewsGivenByMe(params);
}

export function getEmployeePerformanceReviews(employeeId, params = {}) {
  return getPerformanceReviews({
    ...params,
    employee_id: employeeId,
  });
}

export function getReviewerPerformanceReviews(reviewerEmployeeId, params = {}) {
  return getPerformanceReviews({
    ...params,
    reviewer_employee_id: reviewerEmployeeId,
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

export function normalizeSuperAdminTenant(tenant = {}) {
  if (!tenant || typeof tenant !== 'object') {
    return tenant;
  }

  const tenantId =
    tenant.tenant_id ||
    tenant.code ||
    tenant.slug ||
    tenant.value ||
    '';

  const name =
    tenant.name ||
    tenant.company_name ||
    tenant.title ||
    tenant.label ||
    tenantId ||
    'Tenant';

  return {
    ...tenant,
    id: tenant.id || tenant._id || tenantId,
    _id: tenant._id || tenant.id || '',
    tenant_id: tenantId,
    value: tenant.value || tenantId,
    label: tenant.label || `${name}${tenantId ? ` (${tenantId})` : ''}`,
    name,
    company_name: tenant.company_name || name,
    status: tenant.status || 'active',
    is_active: tenant.is_active !== false,
  };
}

export function normalizeSuperAdminTenantList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeSuperAdminTenant(item)).filter(Boolean);
}

export function normalizeSuperAdminTenantUser(user = {}) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  const employee = user.employee || user.employee_profile || {};

  const normalized = withProfilePhotoAliases({
    ...user,
    employee: withProfilePhotoAliases(employee),
  });

  normalized.id = normalized.id || normalized._id || '';
  normalized._id = normalized._id || normalized.id || '';

  normalized.name =
    normalized.employee_name ||
    normalized.name ||
    normalized.full_name ||
    normalized.employee?.employee_name ||
    normalized.employee?.name ||
    normalized.email ||
    'User';

  normalized.employee_name =
    normalized.employee_name ||
    normalized.employee?.employee_name ||
    normalized.employee?.name ||
    normalized.name;

  normalized.email =
    normalized.email ||
    normalized.username ||
    normalized.employee?.email ||
    normalized.employee?.official_email ||
    '';

  normalized.username = normalized.username || normalized.email;

  normalized.employee_code =
    normalized.employee_code ||
    normalized.emp_code ||
    normalized.employee?.employee_code ||
    normalized.employee?.emp_code ||
    '';

  normalized.emp_code = normalized.emp_code || normalized.employee_code;

  normalized.department =
    normalized.department ||
    normalized.department_name ||
    normalized.employee?.department ||
    normalized.employee?.department_name ||
    '';

  normalized.department_name =
    normalized.department_name ||
    normalized.department ||
    normalized.employee?.department_name ||
    normalized.employee?.department ||
    '';

  normalized.designation =
    normalized.designation ||
    normalized.designation_name ||
    normalized.employee?.designation ||
    normalized.employee?.designation_name ||
    '';

  normalized.designation_name =
    normalized.designation_name ||
    normalized.designation ||
    normalized.employee?.designation_name ||
    normalized.employee?.designation ||
    '';

  normalized.role =
    normalized.role ||
    (Array.isArray(normalized.roles) && normalized.roles.length
      ? normalized.roles[0]
      : 'employee');

  normalized.roles = Array.isArray(normalized.roles)
    ? normalized.roles
    : normalized.role
      ? [normalized.role]
      : ['employee'];

  normalized.is_active =
    normalized.is_active !== false &&
    normalized.is_disabled !== true &&
    String(normalized.status || '').toLowerCase() !== 'disabled' &&
    String(normalized.status || '').toLowerCase() !== 'inactive';

  normalized.is_disabled = !normalized.is_active;

  normalized.status_label = normalized.is_active ? 'Active' : 'Disabled';

  return normalized;
}

export function normalizeSuperAdminTenantUserList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeSuperAdminTenantUser(item)).filter(Boolean);
}

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

export function getSuperAdminTenants(params = {}) {
  return api(`/superadmin/tenants${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeSuperAdminTenantList(data.items || data.tenants || []),
    tenants: normalizeSuperAdminTenantList(data.tenants || data.items || []),
  }));
}

export function getSuperAdminTenantUsers(params = {}) {
  return api(`/superadmin/tenant-users${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeSuperAdminTenantUserList(data.items || data.users || []),
    users: normalizeSuperAdminTenantUserList(data.users || data.items || []),
  }));
}

export function createSuperAdminTenantEmployee(payload = {}) {
  return api('/superadmin/tenant-employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    item: normalizeSuperAdminTenantUser(data.item || data.user || {}),
    user: normalizeSuperAdminTenantUser(data.user || data.item || {}),
    employee: normalizeEmployee(data.employee || {}),
  }));
}

export function changeSuperAdminTenantUserPassword(userId, payload = {}) {
  return api(`/superadmin/tenant-users/${userId}/password`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateSuperAdminTenantUserStatus(userId, payload = {}) {
  return api(`/superadmin/tenant-users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteSuperAdminTenantUser(userId) {
  return api(`/superadmin/tenant-users/${userId}`, {
    method: 'DELETE',
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

export function uploadEmployeeProfilePhoto(employeeId, file) {
  if (!employeeId) {
    return Promise.reject(new Error('Employee ID is required to upload profile photo.'));
  }

  if (!file) {
    return Promise.reject(new Error('Photo file is required.'));
  }

  const formData = new FormData();

  formData.append('employee_id', employeeId);
  formData.append('photo', file);

  return api('/profile-photos/upload', {
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  });
}

/* -------------------------------------------------------------------------- */
/* Grievance APIs                                                             */
/* -------------------------------------------------------------------------- */

export function normalizeGrievance(grievance = {}) {
  if (!grievance || typeof grievance !== 'object') {
    return grievance;
  }

  const normalized = withProfilePhotoAliases({ ...grievance });
  const snapshot = normalized.employee_snapshot || {};

  normalized.ticket_no =
    normalized.ticket_no ||
    normalized.grievance_no ||
    normalized.reference_no ||
    '';

  normalized.grievance_type =
    normalized.grievance_type ||
    normalized.type ||
    '';

  normalized.grievance_type_label =
    normalized.grievance_type_label ||
    normalized.type_label ||
    String(normalized.grievance_type || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.priority = normalized.priority || 'medium';

  normalized.priority_label =
    normalized.priority_label ||
    String(normalized.priority || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.status = normalized.status || 'pending';

  normalized.status_label =
    normalized.status_label ||
    String(normalized.status || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.employee_name =
    normalized.employee_name ||
    snapshot.name ||
    'Employee';

  normalized.employee_code =
    normalized.employee_code ||
    snapshot.emp_code ||
    snapshot.employee_code ||
    '';

  normalized.department =
    normalized.department ||
    snapshot.department ||
    normalized.employee_department ||
    '';

  normalized.designation =
    normalized.designation ||
    snapshot.designation ||
    normalized.employee_designation ||
    '';

  normalized.is_anonymous = Boolean(
    normalized.is_anonymous ||
      normalized.anonymous ||
      String(normalized.employee_name || '').toLowerCase().includes('anonymous'),
  );

  normalized.display_employee_name = normalized.is_anonymous
    ? 'Anonymous Employee'
    : normalized.employee_name;

  normalized.display_employee_code = normalized.is_anonymous
    ? ''
    : normalized.employee_code;

  normalized.can_show_identity = !normalized.is_anonymous;

  return normalized;
}

export function normalizeGrievanceList(grievances = []) {
  if (!Array.isArray(grievances)) {
    return [];
  }

  return grievances.map((grievance) => normalizeGrievance(grievance)).filter(Boolean);
}

export function getGrievanceOptions() {
  return api('/grievances/options');
}

export function getGrievanceProfile() {
  return api('/grievances/profile');
}

export function createGrievance(payload = {}) {
  return api('/grievances', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    grievance: normalizeGrievance(data.grievance || {}),
  }));
}

export function getMyGrievances(params = {}) {
  return api(`/grievances/my${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    grievances: normalizeGrievanceList(data.grievances || data.items || []),
  }));
}

export function getGrievances(params = {}) {
  return api(`/grievances${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    grievances: normalizeGrievanceList(data.grievances || data.items || []),
  }));
}

export function getGrievanceDetail(grievanceId) {
  return api(`/grievances/${grievanceId}`).then((data = {}) => ({
    ...data,
    grievance: normalizeGrievance(data.grievance || {}),
  }));
}

export function updateGrievanceStatus(grievanceId, payload = {}) {
  return api(`/grievances/${grievanceId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    grievance: normalizeGrievance(data.grievance || {}),
  }));
}

/* -------------------------------------------------------------------------- */
/* IT Support APIs                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeItSupportTicket(ticket = {}) {
  if (!ticket || typeof ticket !== 'object') {
    return ticket;
  }

  const normalized = withProfilePhotoAliases({ ...ticket });
  const snapshot = normalized.employee_snapshot || {};

  normalized.ticket_no =
    normalized.ticket_no ||
    normalized.support_no ||
    normalized.reference_no ||
    '';

  normalized.issue_category =
    normalized.issue_category ||
    normalized.category ||
    '';

  normalized.issue_category_label =
    normalized.issue_category_label ||
    normalized.category_label ||
    String(normalized.issue_category || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.priority = normalized.priority || 'medium';

  normalized.priority_label =
    normalized.priority_label ||
    String(normalized.priority || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.status = normalized.status || 'open';

  normalized.status_label =
    normalized.status_label ||
    String(normalized.status || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.raised_by_name =
    normalized.raised_by_name ||
    snapshot.name ||
    normalized.created_by_name ||
    'Employee';

  normalized.raised_by_code =
    normalized.raised_by_code ||
    snapshot.emp_code ||
    snapshot.employee_code ||
    '';

  normalized.assigned_to_name = normalized.assigned_to_name || '';

  normalized.assignment_label =
    normalized.assignment_label ||
    normalized.assigned_to_name ||
    'Not assigned yet';

  normalized.assignment_status =
    normalized.assignment_status ||
    (normalized.assigned_to_name ? 'assigned' : 'empty_slot');

  normalized.review_rating = toNumber(
    normalized.review_rating ?? normalized.review?.rating,
    0,
  );

  normalized.review_comment =
    normalized.review_comment ||
    normalized.review?.comment ||
    '';

  normalized.is_escalated = Boolean(
    normalized.is_escalated ||
      normalized.escalated ||
      normalized.escalated_to === 'super_admin',
  );

  normalized.escalated_to = normalized.escalated_to || '';

  normalized.escalation_type = normalized.escalation_type || '';

  normalized.escalation_type_label =
    normalized.escalation_type_label ||
    String(normalized.escalation_type || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  normalized.escalation_reason = normalized.escalation_reason || '';

  normalized.escalated_by_name = normalized.escalated_by_name || '';

  normalized.escalated_at = normalized.escalated_at || '';

  normalized.superadmin_status_note = normalized.superadmin_status_note || '';

  normalized.escalation_label = normalized.is_escalated
    ? 'Escalated to Super Admin'
    : '';

  normalized.can_review = ['resolved', 'closed'].includes(
    String(normalized.status || '').toLowerCase(),
  );

  return normalized;
}

export function normalizeItSupportTicketList(tickets = []) {
  if (!Array.isArray(tickets)) {
    return [];
  }

  return tickets.map((ticket) => normalizeItSupportTicket(ticket)).filter(Boolean);
}

export function normalizeItSupportTeam(members = []) {
  return normalizePeopleList(members || []).map((member = {}) => ({
    ...member,
    label:
      member.label ||
      `${member.employee_name || member.name || 'IT Member'} (${member.designation || member.department || 'IT Department'})`,
    is_it_department: Boolean(member.is_it_department),
    is_it_head: Boolean(member.is_it_head || member.is_it_support_head),
    is_it_member: Boolean(member.is_it_member || member.is_it_support_member),
  }));
}

export function normalizeItSupportOptions(data = {}) {
  return {
    ...data,
    categories: data.categories || [],
    priorities: data.priorities || [],
    statuses: data.statuses || [],
    escalation_types: data.escalation_types || [],
    it_team: normalizeItSupportTeam(data.it_team || []),
    it_heads: normalizeItSupportTeam(data.it_heads || []),

    can_manage: Boolean(data.can_manage),
    can_manage_normal: Boolean(data.can_manage_normal ?? data.can_manage),
    can_view_escalated: Boolean(data.can_view_escalated),
    can_escalate: Boolean(data.can_escalate),
    is_super_admin: Boolean(data.is_super_admin),
    is_it_head: Boolean(data.is_it_head),
    is_it_member: Boolean(data.is_it_member),

    team_slots: data.team_slots || {
      expected_total: 4,
      current_total: 0,
      heads: 0,
      members: 0,
      empty_slots: 4,
    },
  };
}

export function getItSupportOptions() {
  return api('/it-support/options').then((data = {}) =>
    normalizeItSupportOptions(data),
  );
}

export function getItSupportProfile() {
  return api('/it-support/profile').then((data = {}) => ({
    ...data,
    can_manage: Boolean(data.can_manage),
    can_manage_normal: Boolean(data.can_manage_normal ?? data.can_manage),
    can_view_escalated: Boolean(data.can_view_escalated),
    can_escalate: Boolean(data.can_escalate),
    is_super_admin: Boolean(data.is_super_admin),
    is_it_head: Boolean(data.is_it_head),
    is_it_member: Boolean(data.is_it_member),
  }));
}

export function createItSupportTicket(payload = {}) {
  return api('/it-support', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function getMyItSupportTickets(params = {}) {
  return api(`/it-support/my${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    tickets: normalizeItSupportTicketList(data.tickets || data.items || []),
  }));
}

export function getItSupportTickets(params = {}) {
  return api(`/it-support${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    tickets: normalizeItSupportTicketList(data.tickets || data.items || []),
    it_team: normalizeItSupportTeam(data.it_team || []),
    it_heads: normalizeItSupportTeam(data.it_heads || []),

    can_manage: Boolean(data.can_manage),
    can_manage_normal: Boolean(data.can_manage_normal ?? data.can_manage),
    can_view_escalated: Boolean(data.can_view_escalated),
    can_escalate: Boolean(data.can_escalate),
    is_super_admin: Boolean(data.is_super_admin),
    is_it_head: Boolean(data.is_it_head),
    is_it_member: Boolean(data.is_it_member),

    team_slots: data.team_slots || {
      expected_total: 4,
      current_total: 0,
      heads: 0,
      members: 0,
      empty_slots: 4,
    },
  }));
}

export function getItSupportTicketDetail(ticketId) {
  return api(`/it-support/${ticketId}`).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function assignItSupportTicket(ticketId, payload = {}) {
  return api(`/it-support/${ticketId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function assignItSupportTicketToSelf(ticketId, note = '') {
  return assignItSupportTicket(ticketId, {
    assigned_to_employee_id: 'self',
    note,
  });
}

export function updateItSupportTicketStatus(ticketId, payload = {}) {
  return api(`/it-support/${ticketId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function escalateItSupportTicket(ticketId, payload = {}) {
  return api(`/it-support/${ticketId}/escalate`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function reviewItSupportTicket(ticketId, payload = {}) {
  return api(`/it-support/${ticketId}/review`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
}

export function reopenItSupportTicket(ticketId, payload = {}) {
  return api(`/it-support/${ticketId}/reopen`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    ticket: normalizeItSupportTicket(data.ticket || {}),
  }));
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