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

export function getRefreshToken() {
  return localStorage.getItem('sds_hrms_refresh_token');
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


function normalizeAllowedModules(value, fallback = ['all']) {
  if (Array.isArray(value)) {
    const modules = value
      .map((item) => String(item || '').trim().replaceAll('-', '_'))
      .filter(Boolean);

    return modules.length ? modules : fallback;
  }

  if (typeof value === 'string' && value.trim()) {
    const modules = value
      .split(',')
      .map((item) => item.trim().replaceAll('-', '_'))
      .filter(Boolean);

    return modules.length ? modules : fallback;
  }

  return fallback;
}

function normalizeStatusValue(value = '') {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_');
}

function isTrialDemoContext(tenant = {}, subscription = {}) {
  const planType = normalizeStatusValue(
    subscription.plan_type ||
      tenant.plan_type ||
      subscription.subscription_type ||
      tenant.subscription_type,
  );

  const trialStatus = normalizeStatusValue(
    subscription.trial_status ||
      tenant.trial_status ||
      subscription.subscription_status ||
      tenant.subscription_status ||
      subscription.status ||
      tenant.status,
  );

  return (
    planType === 'demo' ||
    planType === 'trial' ||
    trialStatus === 'demo' ||
    trialStatus === 'trial' ||
    trialStatus === 'active_trial'
  );
}

function isBlockedTrialContext(tenant = {}, subscription = {}) {
  const statuses = [
    subscription.status,
    subscription.subscription_status,
    subscription.trial_status,
    tenant.status,
    tenant.subscription_status,
    tenant.trial_status,
  ].map(normalizeStatusValue);

  return statuses.some((status) =>
    ['expired', 'suspended', 'blocked', 'inactive'].includes(status),
  );
}

function enrichTrialSaasContext(rawTenant = {}, rawSubscription = {}) {
  const tenant = { ...(rawTenant || {}) };
  const subscription = { ...(rawSubscription || {}) };

  if (!isTrialDemoContext(tenant, subscription)) {
    return { tenant, subscription };
  }

  const blocked = isBlockedTrialContext(tenant, subscription);
  const durationDays =
    subscription.demo_duration_days ||
    tenant.demo_duration_days ||
    subscription.trial_days ||
    tenant.trial_days ||
    15;

  const allowedModules = normalizeAllowedModules(
    subscription.allowed_modules ||
      subscription.demo_allowed_modules ||
      tenant.allowed_modules ||
      tenant.demo_allowed_modules ||
      ['all'],
    ['all'],
  );

  const hasFullAccess =
    subscription.demo_has_full_access === true ||
    tenant.demo_has_full_access === true ||
    allowedModules.includes('all') ||
    allowedModules.includes('*');

  const requiresPayment =
    subscription.requires_payment === true ||
    tenant.requires_payment === true ||
    blocked;

  subscription.plan_type = subscription.plan_type || tenant.plan_type || 'demo';
  subscription.demo_duration_days = durationDays;
  subscription.demo_has_full_access = hasFullAccess;
  subscription.allowed_modules = allowedModules;
  subscription.requires_payment = requiresPayment;

  tenant.plan_type = tenant.plan_type || subscription.plan_type || 'demo';
  tenant.demo_duration_days = tenant.demo_duration_days || durationDays;
  tenant.demo_has_full_access = tenant.demo_has_full_access === true || hasFullAccess;
  tenant.allowed_modules = normalizeAllowedModules(
    tenant.allowed_modules || allowedModules,
    allowedModules,
  );
  tenant.requires_payment = tenant.requires_payment === true || requiresPayment;

  return { tenant, subscription };
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

export function getProfileCoverValue(record = {}) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  return firstNonEmpty(
    safeSessionPhotoValue(record.cover_image),
    safeSessionPhotoValue(record.cover_photo),
    safeSessionPhotoValue(record.profile_cover),
    safeSessionPhotoValue(record.profile_cover_image),
    safeSessionPhotoValue(record.banner_image),
    safeSessionPhotoValue(record.banner_photo),
    safeSessionPhotoValue(record.employee_cover_image),
    safeSessionPhotoValue(record.employee_cover_photo),
    safeSessionPhotoValue(record.cover_url),
    safeSessionPhotoValue(record.profile_cover_url),
    safeSessionPhotoValue(record.banner_url),
  );
}

export function withProfilePhotoAliases(record = {}) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const cloned = { ...record };
  const photo = getProfilePhotoValue(cloned);
  const cover = getProfileCoverValue(cloned);

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

  [
    'cover_image',
    'cover_photo',
    'profile_cover',
    'profile_cover_image',
    'banner_image',
    'banner_photo',
    'employee_cover_image',
    'employee_cover_photo',
    'cover_url',
    'profile_cover_url',
    'banner_url',
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

  if (cover) {
    cloned.cover_image = cover;
    cloned.cover_photo = cover;
    cloned.profile_cover = cover;
    cloned.profile_cover_image = cover;
    cloned.banner_image = cover;
    cloned.banner_photo = cover;
    cloned.cover_url = cover;
  } else {
    delete cloned.cover_image;
    delete cloned.cover_photo;
    delete cloned.profile_cover;
    delete cloned.profile_cover_image;
    delete cloned.banner_image;
    delete cloned.banner_photo;
    delete cloned.cover_url;
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
    New uploaded profile photos/covers are served from:
    /api/v1/uploads/profile_photos/...
    /api/v1/uploads/profile_covers/...
  */
  if (
    raw.startsWith('/api/v1/uploads/profile_photos/') ||
    raw.startsWith('/api/v1/uploads/profile_covers/')
  ) {
    return `${apiRoot}${raw}`;
  }

  /*
    Backward compatibility:
    /uploads/profile_photos/...
    /uploads/profile_covers/...
  */
  if (
    raw.startsWith('/uploads/profile_photos/') ||
    raw.startsWith('/uploads/profile_covers/')
  ) {
    return `${apiBase}${raw}`;
  }

  if (
    raw.startsWith('uploads/profile_photos/') ||
    raw.startsWith('uploads/profile_covers/')
  ) {
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

export function normalizeProfileCoverUrl(value = '') {
  return normalizeProfilePhotoUrl(value);
}

export function getProfileCoverUrl(record = {}) {
  return normalizeProfileCoverUrl(getProfileCoverValue(record));
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
  normalized.cover_url = getProfileCoverUrl(normalized);

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
    const hasTeamLeaderRoot = Boolean(
      normalized.team_leader?._id ||
      normalized.team_leader?.employee_id ||
      normalized.team_leader?.user_id ||
      normalized.team_leader?.email
    );

    normalized.all_people = normalizePeopleList([
      normalized.reporting_officer,
      normalized.team_leader,
      normalized.self,
      ...normalized.team_members,
      ...(hasTeamLeaderRoot ? [] : normalized.reporting_members),
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

export function buildProfileCoverPayload(coverValue, extra = {}) {
  const cover = safeSessionPhotoValue(coverValue);

  return {
    ...extra,
    cover_image: cover,
    cover_photo: cover,
    profile_cover: cover,
    profile_cover_image: cover,
    banner_image: cover,
    banner_photo: cover,
    employee_cover_image: cover,
    employee_cover_photo: cover,
    cover_url: cover,
    profile_cover_url: cover,
    banner_url: cover,
  };
}

export function safeSessionPhotoValue(value = '') {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  /*
    Never keep large base64 images in localStorage/session/dashboard state.
    This prevents dashboard crash after profile photo upload.
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

function compactSessionUser(user = {}, employee = {}, saas = {}) {
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

  const cover = safeSessionPhotoValue(
    getProfileCoverValue(user) ||
      getProfileCoverValue(employee) ||
      user.cover_url ||
      user.profile_cover_url ||
      user.banner_url ||
      employee.cover_url ||
      employee.profile_cover_url ||
      employee.banner_url ||
      '',
  );
  const saasContext = enrichTrialSaasContext(
    saas.tenant || user.tenant || {},
    saas.subscription || user.subscription || {},
  );
  const tenant = saasContext.tenant;
  const subscription = saasContext.subscription;

  const tenantId =
    user.tenant_id ||
    employee.tenant_id ||
    saas.tenant_id ||
    tenant._id ||
    tenant.id ||
    '';

  const companyId =
    user.company_id ||
    employee.company_id ||
    saas.company_id ||
    tenant.company_id ||
    tenant._id ||
    tenant.id ||
    tenantId ||
    '';

  const tenantCode =
    user.tenant_code ||
    employee.tenant_code ||
    saas.tenant_code ||
    tenant.tenant_code ||
    tenant.code ||
    '';

  const companyName =
    user.company_name ||
    employee.company_name ||
    saas.company_name ||
    tenant.company_name ||
    tenant.name ||
    '';
  return {
    id: user.id || user._id || '',
    _id: user._id || user.id || '',
    name:
      user.name ||
      user.full_name ||
      user.display_name ||
      employee.employee_name ||
      employee.name ||
      employee.full_name ||
      '',
    full_name: user.full_name || user.name || employee.full_name || employee.employee_name || '',
    display_name:
      user.display_name ||
      user.name ||
      user.full_name ||
      employee.employee_name ||
      employee.name ||
      '',
    employee_name: employee.employee_name || employee.name || user.name || user.full_name || '',
    email: user.email || employee.email || employee.official_email || '',
    gender: user.gender || user.sex || employee.gender || employee.sex || employee.employee_gender || '',
    sex: user.sex || user.gender || employee.sex || employee.gender || employee.employee_gender || '',
    role: user.role || '',
    roles: Array.isArray(user.roles) ? user.roles : [],
    tenant_id: tenantId,
    company_id: companyId,
    tenant_code: tenantCode,
    company_name: companyName,
    tenant,
    subscription,
    is_platform_superadmin: Boolean(
      saas.is_platform_superadmin ||
        user.is_platform_superadmin ||
        user.role === 'super_admin' ||
        (Array.isArray(user.roles) && user.roles.includes('super_admin')),
    ),
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
    cover_image: cover,
    cover_photo: cover,
    profile_cover: cover,
    profile_cover_image: cover,
    banner_image: cover,
    banner_photo: cover,
    cover_url: cover,
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

  const cover = safeSessionPhotoValue(
    getProfileCoverValue(employee) ||
      employee.cover_url ||
      employee.profile_cover_url ||
      employee.banner_url ||
      '',
  );

  return {
    id: employee.id || employee._id || '',
    _id: employee._id || employee.id || '',
    employee_name:
      employee.employee_name ||
      employee.name ||
      employee.full_name ||
      employee.display_name ||
      '',
    name:
      employee.name ||
      employee.employee_name ||
      employee.full_name ||
      employee.display_name ||
      '',
    full_name:
      employee.full_name ||
      employee.employee_name ||
      employee.name ||
      employee.display_name ||
      '',
    display_name:
      employee.display_name ||
      employee.employee_name ||
      employee.name ||
      employee.full_name ||
      '',
    employee_code: employee.employee_code || employee.emp_code || employee.code || '',
    email: employee.email || employee.official_email || employee.work_email || '',
    phone: employee.phone || employee.mobile || employee.contact || employee.contact_number || '',
    gender: employee.gender || employee.sex || employee.employee_gender || '',
    sex: employee.sex || employee.gender || employee.employee_gender || '',
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
    cover_image: cover,
    cover_photo: cover,
    profile_cover: cover,
    profile_cover_image: cover,
    banner_image: cover,
    banner_photo: cover,
    cover_url: cover,
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

  const accessToken =
    data.access_token ||
    data.token ||
    '';

  const refreshToken =
    data.refresh_token ||
    '';

  if (accessToken) {
    safeSetLocalStorage(
      'sds_hrms_token',
      accessToken,
    );
  }

  if (refreshToken) {
    safeSetLocalStorage(
      'sds_hrms_refresh_token',
      refreshToken,
    );
  }

  safeSetLocalStorage(
    'sds_hrms_user',
    JSON.stringify(
      compactSessionUser(user, employee, {
        tenant: data.tenant || {},
        subscription: data.subscription || {},
        is_platform_superadmin: data.is_platform_superadmin,
      }),
    ),
  );

  safeSetLocalStorage(
    'sds_hrms_employee',
    JSON.stringify(compactSessionEmployee(employee)),
  );
}

export function clearSession() {
  localStorage.removeItem('sds_hrms_token');
  localStorage.removeItem('sds_hrms_refresh_token');
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

const SAAS_EXPIRED_ERROR_CODES = new Set([
  'tenant_expired',
  'subscription_expired',
  'trial_expired',
  'demo_expired',
  'payment_required',
  'requires_payment',
]);

const SAAS_BILLING_ERROR_CODES = new Set([
  'module_not_in_demo_plan',
  'employee_limit_reached',
  'tenant_suspended',
]);

function normalizeErrorCode(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}


function currentSaasUserRoles() {
  const user = currentUser();
  const values = [
    user.role,
    ...(Array.isArray(user.roles) ? user.roles : []),
  ];

  return new Set(values.map(normalizeErrorCode).filter(Boolean));
}

function isCurrentUserLifetimeTenant() {
  const user = currentUser();
  const tenant = user.tenant || {};
  const subscription = user.subscription || {};

  const tenantCode = normalizeErrorCode(
    user.tenant_code || tenant.tenant_code || tenant.code,
  );

  const planType = normalizeErrorCode(
    subscription.plan_type || tenant.plan_type,
  );

  const subscriptionStatus = normalizeErrorCode(
    subscription.subscription_status ||
      subscription.status ||
      tenant.subscription_status ||
      tenant.status,
  );

  return Boolean(
    tenantCode === 'sds' ||
      planType === 'lifetime' ||
      subscriptionStatus === 'lifetime' ||
      tenant.has_lifetime_access === true ||
      subscription.has_lifetime_access === true
  );
}

function canCurrentUserOpenClientBilling() {
  const roles = currentSaasUserRoles();
  const user = currentUser();

  return Boolean(
    roles.has('admin') &&
      !roles.has('super_admin') &&
      user.is_platform_superadmin !== true &&
      !isCurrentUserLifetimeTenant()
  );
}

function isBillingApiPath(path = '') {
  const value = String(path || '').toLowerCase();

  return (
    value.includes('/billing') ||
    value.includes('/auth/login') ||
    value.includes('/auth/me') ||
    value.includes('/demo-requests') ||
    value.includes('/trial-requests')
  );
}

function redirectForSaasRestriction(path = '', data = {}, status = 0) {
  if (typeof window === 'undefined') {
    return;
  }

  if (isBillingApiPath(path)) {
    return;
  }

  const code = normalizeErrorCode(data.code || data.error_code || data.reason);
  const currentPath = String(window.location.pathname || '').toLowerCase();

  const expiredPaths = new Set([
    '/hrms/subscription-expired',
    '/hrms/trial-expired',
    '/hrms/demo-expired',
  ]);

  if (SAAS_EXPIRED_ERROR_CODES.has(code) || status === 402) {
    if (!expiredPaths.has(currentPath)) {
      window.location.assign('/hrms/subscription-expired');
    }

    return;
  }

  if (SAAS_BILLING_ERROR_CODES.has(code)) {
    if (canCurrentUserOpenClientBilling()) {
      if (currentPath !== '/hrms/billing') {
        window.location.assign('/hrms/billing');
      }

      return;
    }

    if (
      code === 'tenant_suspended' &&
      !expiredPaths.has(currentPath)
    ) {
      window.location.assign('/hrms/subscription-expired');
    }
  }
}

function buildApiError(data = {}, status = 0, fallbackMessage = 'Request failed.') {
  const error = new Error(data.message || fallbackMessage);

  error.status = status;
  error.code = data.code || data.error_code || '';
  error.meta = data.meta || {};
  error.payload = data;

  return error;
}


function createAiProviderError(response, data = {}, fallbackMessage = 'AI request failed.') {
  const provider = String(
    data?.provider ||
      data?.chat_provider ||
      data?.stt_provider ||
      data?.tts_provider ||
      data?.service ||
      'AI provider'
  ).trim();

  const message =
    data?.message ||
    data?.error ||
    data?.details ||
    fallbackMessage ||
    `AI request failed with API Error ${response?.status || ''}`;

  const error = new Error(message);

  error.status = response?.status || 500;
  error.provider = provider;
  error.quota_exceeded = Boolean(data?.quota_exceeded || response?.status === 429);
  error.retry_after_seconds = Number(
    data?.retry_after_seconds ||
      data?.retry_after ||
      response?.headers?.get?.('Retry-After') ||
      90
  );

  return error;
}


const SAYA_LEGACY_VOICE_COMPLETION_SUFFIX =
  '\n\nBecause this is a voice conversation, respond naturally, professionally, and completely. ' +
  'Be concise where appropriate, but do not omit required information or stop mid-sentence.';

function normalizeSayaResponseMode(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === 'voice'
    ? 'voice'
    : 'text';
}

function normalizeSayaRequestMessage(message, responseMode = 'text') {
  let cleanMessage = String(message || '').trim();

  // File 6 temporarily appends this sentence so older backends can detect a
  // voice conversation. File 7 now sends response_mode explicitly, so remove
  // only that exact compatibility suffix before the user's request reaches Saya.
  if (
    responseMode === 'voice' &&
    cleanMessage.endsWith(SAYA_LEGACY_VOICE_COMPLETION_SUFFIX)
  ) {
    cleanMessage = cleanMessage
      .slice(0, -SAYA_LEGACY_VOICE_COMPLETION_SUFFIX.length)
      .trim();
  }

  return cleanMessage;
}

function resolveSayaChatTimeoutMs(options = {}) {
  const requested = Number(options?.timeoutMs);
  const safeRequested = Number.isFinite(requested) && requested > 0
    ? requested
    : 75000;

  // The backend may legitimately perform provider fallback plus automatic
  // continuation. Do not let a short browser timeout cut off a healthy answer.
  return Math.min(Math.max(safeRequested, 75000), 120000);
}

function resolveSayaSttTimeoutMs(options = {}) {
  const requested = Number(options?.timeoutMs);
  const safeRequested = Number.isFinite(requested) && requested > 0
    ? requested
    : 45000;

  return Math.min(Math.max(safeRequested, 40000), 60000);
}

function resolveSayaTtsTimeoutMs(options = {}) {
  const requested = Number(options?.timeoutMs);
  const safeRequested = Number.isFinite(requested) && requested > 0
    ? requested
    : 60000;

  return Math.min(Math.max(safeRequested, 55000), 90000);
}


function isAiAttendanceCommand(message = '') {
  const text = String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!text) {
    return false;
  }

  const checkInPhrases = [
    'check in',
    'checkin',
    'punch in',
    'clock in',
    'mark attendance',
    'mark my attendance',
    'start attendance',
    'office in',
  ];

  const checkOutPhrases = [
    'check out',
    'checkout',
    'punch out',
    'clock out',
    'mark checkout',
    'end attendance',
    'office out',
  ];

  return [...checkInPhrases, ...checkOutPhrases].some((phrase) =>
    text.includes(phrase)
  );
}

function getBrowserAttendanceLocation(options = {}) {
  const shouldSkip =
    options?.skipLocation === true ||
    typeof window === 'undefined' ||
    !navigator?.geolocation;

  if (shouldSkip) {
    return Promise.resolve({
      available: false,
      skipped: true,
      reason: 'geolocation_not_available',
    });
  }

  const timeoutMs = Number(options.locationTimeoutMs || 10000);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = position?.coords || {};

        resolve({
          available: true,
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          altitude: coords.altitude,
          altitude_accuracy: coords.altitudeAccuracy,
          heading: coords.heading,
          speed: coords.speed,
          captured_at: new Date().toISOString(),
          source: 'browser_geolocation',
        });
      },
      (error) => {
        resolve({
          available: false,
          permission_denied: error?.code === 1,
          position_unavailable: error?.code === 2,
          timeout: error?.code === 3,
          code: error?.code,
          message:
            error?.message ||
            'Location permission is required for AI attendance check-in/check-out.',
          source: 'browser_geolocation',
        });
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 15000,
      }
    );
  });
}

let refreshPromise = null;

function isAuthRefreshPath(path = '') {
  return String(path || '')
    .toLowerCase()
    .includes('/auth/refresh');
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    throw new Error('Refresh token is missing.');
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(
        buildUrl('/auth/refresh'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            refresh_token: refreshToken,
          }),
        },
      );

      const data = normalizeApiPayload(
        await parseResponse(response),
      );

      if (!response.ok) {
        throw buildApiError(
          data,
          response.status,
          'Session expired. Please login again.',
        );
      }

      const newAccessToken =
        data.access_token ||
        data.token ||
        '';

      const newRefreshToken =
        data.refresh_token ||
        '';

      if (!newAccessToken || !newRefreshToken) {
        throw new Error(
          'Invalid refresh response.',
        );
      }

      safeSetLocalStorage(
        'sds_hrms_token',
        newAccessToken,
      );

      safeSetLocalStorage(
        'sds_hrms_refresh_token',
        newRefreshToken,
      );

      return newAccessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function api(
  path,
  options = {},
  authRetry = false,
) {
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
  const refreshToken = getRefreshToken();

  if (
    !authRetry &&
    refreshToken &&
    !isAuthRefreshPath(path)
  ) {
    try {
      await refreshAccessToken();

      return api(
        path,
        options,
        true,
      );
    } catch (refreshError) {
      clearSession();
      throw refreshError;
    }
  }

  clearSession();

  throw buildApiError(
    data,
    response.status,
    'Session expired. Please login again.',
  );
}

  if (response.status === 402) {
    redirectForSaasRestriction(path, data, response.status);

    throw buildApiError(
      data,
      response.status,
      'Your trial/subscription has expired. Please upgrade to continue.',
    );
  }

  if (response.status === 403) {
    redirectForSaasRestriction(path, data, response.status);

    throw buildApiError(
      data,
      response.status,
      'You do not have permission to perform this action.',
    );
  }

  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `API Error ${response.status}`,
    );
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
  const saasContext = enrichTrialSaasContext(data.tenant || {}, data.subscription || {});

  setSession({
    token: getToken(),
    user: data.user || {},
    employee: data.employee || {},
    tenant: saasContext.tenant,
    subscription: saasContext.subscription,
    is_platform_superadmin: data.is_platform_superadmin,
  });

  return {
    ...data,
    tenant: saasContext.tenant,
    subscription: saasContext.subscription,
  };
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
/* Recruitment APIs                                                           */
/* -------------------------------------------------------------------------- */

const RECRUITMENT_API_PREFIX = '/recruitment';

function recruitmentId(value, fieldName = 'ID') {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return encodeURIComponent(normalized);
}

function recruitmentJson(path, method = 'GET', payload) {
  const options = { method };

  if (payload !== undefined) {
    options.body = JSON.stringify(payload || {});
  }

  return api(`${RECRUITMENT_API_PREFIX}${path}`, options);
}

function recruitmentFormData(payload = {}, file = null, fileField = 'file') {
  const formData = new FormData();

  formData.append('payload', JSON.stringify(payload || {}));

  if (file) {
    formData.append(fileField, file, file.name || `${fileField}.bin`);
  }

  return formData;
}

async function downloadRecruitmentFile(path, fallbackFilename) {
  const token = getToken();
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(buildUrl(`${RECRUITMENT_API_PREFIX}${path}`), {
      method: 'GET',
      headers,
    });
  } catch {
    throw new Error(getConnectionErrorMessage());
  }

if (response.status === 401) {
  try {
    await refreshAccessToken();

    return downloadRecruitmentFile(
      path,
      fallbackFilename,
    );
  } catch (refreshError) {
    clearSession();
    throw refreshError;
  }
}

  if (response.status === 403) {
    throw new Error(
      'You do not have permission to download this recruitment file.',
    );
  }

  if (!response.ok) {
    const data = normalizeApiPayload(await parseResponse(response));
    throw buildApiError(
      data,
      response.status,
      'Unable to download the recruitment file.',
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(
    /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
  );
  const filename = decodeURIComponent(
    filenameMatch?.[1] || filenameMatch?.[2] || fallbackFilename,
  );
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

export function getRecruitmentDashboard() {
  return recruitmentJson('/dashboard');
}

export function getRecruitmentSettings() {
  return recruitmentJson('/settings');
}

export function updateRecruitmentSettings(payload = {}) {
  return recruitmentJson('/settings', 'PATCH', payload);
}

export function getRecruitmentHiringRequests(params = {}) {
  return recruitmentJson(`/hiring-requests${buildQuery(params)}`);
}

export function createRecruitmentHiringRequest(payload = {}) {
  return recruitmentJson('/hiring-requests', 'POST', payload);
}

export function getRecruitmentHiringRequest(requestId) {
  return recruitmentJson(
    `/hiring-requests/${recruitmentId(requestId, 'Hiring request ID')}`,
  );
}

export function submitRecruitmentHiringRequest(requestId) {
  return recruitmentJson(
    `/hiring-requests/${recruitmentId(
      requestId,
      'Hiring request ID',
    )}/submit`,
    'POST',
    {},
  );
}

export function decideRecruitmentHiringRequest(requestId, payload = {}) {
  return recruitmentJson(
    `/hiring-requests/${recruitmentId(
      requestId,
      'Hiring request ID',
    )}/decision`,
    'POST',
    payload,
  );
}

export function getRecruitmentJobOpenings(params = {}) {
  return recruitmentJson(`/job-openings${buildQuery(params)}`);
}

export function createRecruitmentJobOpening(payload = {}) {
  return recruitmentJson('/job-openings', 'POST', payload);
}

export function changeRecruitmentJobOpeningStatus(jobId, payload = {}) {
  return recruitmentJson(
    `/job-openings/${recruitmentId(jobId, 'Job opening ID')}/status`,
    'POST',
    payload,
  );
}

export function parseRecruitmentResume(file) {
  if (!file) {
    throw new Error('Resume file is required.');
  }

  const formData = new FormData();
  formData.append('resume', file, file.name || 'resume');

  return api(`${RECRUITMENT_API_PREFIX}/resumes/parse`, {
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  });
}

export function getRecruitmentCandidates(params = {}) {
  return recruitmentJson(`/candidates${buildQuery(params)}`);
}

export function createRecruitmentCandidate(payload = {}, resumeFile = null) {
  if (!resumeFile) {
    return recruitmentJson('/candidates', 'POST', payload);
  }

  return api(`${RECRUITMENT_API_PREFIX}/candidates`, {
    method: 'POST',
    body: recruitmentFormData(payload, resumeFile, 'resume'),
    timeoutMs: 60000,
  });
}

export function getRecruitmentCandidate(candidateId) {
  return recruitmentJson(
    `/candidates/${recruitmentId(candidateId, 'Candidate ID')}`,
  );
}

export function downloadRecruitmentCandidateResume(
  candidateId,
  fallbackFilename = 'candidate-resume',
) {
  return downloadRecruitmentFile(
    `/candidates/${recruitmentId(candidateId, 'Candidate ID')}/resume`,
    fallbackFilename,
  );
}

export function getRecruitmentApplications(params = {}) {
  return recruitmentJson(`/applications${buildQuery(params)}`);
}

export function createRecruitmentApplication(payload = {}) {
  return recruitmentJson('/applications', 'POST', payload);
}

export function getRecruitmentApplication(applicationId) {
  return recruitmentJson(
    `/applications/${recruitmentId(applicationId, 'Application ID')}`,
  );
}

export function updateRecruitmentScreening(applicationId, payload = {}) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/screening`,
    'PATCH',
    payload,
  );
}

export function changeRecruitmentApplicationStatus(
  applicationId,
  payload = {},
) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/status`,
    'POST',
    payload,
  );
}


export function completeRecruitmentInterviewProcess(applicationId) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/interview-process/complete`,
    'POST',
    {},
  );
}

export function getRecruitmentInterviews(params = {}) {
  return recruitmentJson(`/interviews${buildQuery(params)}`);
}

export function scheduleRecruitmentInterview(applicationId, payload = {}) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/interviews`,
    'POST',
    payload,
  );
}

export function rescheduleRecruitmentInterview(interviewId, payload = {}) {
  return recruitmentJson(
    `/interviews/${recruitmentId(
      interviewId,
      'Interview ID',
    )}/reschedule`,
    'POST',
    payload,
  );
}

export function changeRecruitmentInterviewStatus(interviewId, payload = {}) {
  return recruitmentJson(
    `/interviews/${recruitmentId(interviewId, 'Interview ID')}/status`,
    'POST',
    payload,
  );
}

export function submitRecruitmentInterviewFeedback(
  interviewId,
  payload = {},
) {
  return recruitmentJson(
    `/interviews/${recruitmentId(interviewId, 'Interview ID')}/feedback`,
    'POST',
    payload,
  );
}

export function getRecruitmentInterviewFeedback(interviewId) {
  return recruitmentJson(
    `/interviews/${recruitmentId(interviewId, 'Interview ID')}/feedback`,
  );
}

export function getRecruitmentApplicationInterviewFeedback(applicationId) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/interview-feedback`,
  );
}

export function getRecruitmentOffers(params = {}) {
  return recruitmentJson(`/offers${buildQuery(params)}`);
}

export function createRecruitmentOffer(
  applicationId,
  payload = {},
  offerFile = null,
) {
  const path = `/applications/${recruitmentId(
    applicationId,
    'Application ID',
  )}/offers`;

  if (!offerFile) {
    return recruitmentJson(path, 'POST', payload);
  }

  return api(`${RECRUITMENT_API_PREFIX}${path}`, {
    method: 'POST',
    body: recruitmentFormData(payload, offerFile, 'offer_file'),
    timeoutMs: 60000,
  });
}

export function submitRecruitmentOfferForApproval(
  offerId,
  payload = {},
) {
  return recruitmentJson(
    `/offers/${recruitmentId(offerId, 'Offer ID')}/submit-approval`,
    'POST',
    payload,
  );
}

export function decideRecruitmentOffer(offerId, payload = {}) {
  return recruitmentJson(
    `/offers/${recruitmentId(offerId, 'Offer ID')}/decision`,
    'POST',
    payload,
  );
}

export function sendRecruitmentOffer(offerId, payload = {}) {
  return recruitmentJson(
    `/offers/${recruitmentId(offerId, 'Offer ID')}/send`,
    'POST',
    payload,
  );
}

export function getRecruitmentJoiningDocuments(applicationId) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/joining-documents`,
  );
}

export function downloadRecruitmentJoiningDocument(
  documentId,
  fallbackFilename = 'joining-document',
) {
  return downloadRecruitmentFile(
    `/joining-documents/${recruitmentId(
      documentId,
      'Joining document ID',
    )}/download`,
    fallbackFilename,
  );
}

export function reviewRecruitmentJoiningDocument(
  documentId,
  payload = {},
) {
  return recruitmentJson(
    `/joining-documents/${recruitmentId(
      documentId,
      'Joining document ID',
    )}/review`,
    'POST',
    payload,
  );
}

export function getRecruitmentBackgroundChecks(applicationId) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/background-checks`,
  );
}

export function updateRecruitmentBackgroundCheck(
  applicationId,
  payload = {},
) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/background-checks`,
    'PUT',
    payload,
  );
}

export function changeRecruitmentJoiningStatus(
  applicationId,
  payload = {},
) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/joining-status`,
    'POST',
    payload,
  );
}

export function convertRecruitmentCandidateToEmployee(
  applicationId,
  payload = {},
) {
  return recruitmentJson(
    `/applications/${recruitmentId(
      applicationId,
      'Application ID',
    )}/convert-to-employee`,
    'POST',
    payload,
  );
}

export function getRecruitmentReports(params = {}) {
  return recruitmentJson(`/reports${buildQuery(params)}`);
}

export function getRecruitmentActivity(params = {}) {
  return recruitmentJson(`/activity${buildQuery(params)}`);
}

export function getPublicRecruitmentJobs(companyKey, params = {}) {
  return recruitmentJson(
    `/public/${recruitmentId(
      companyKey,
      'Company key',
    )}/jobs${buildQuery(params)}`,
  );
}

export function previewPublicRecruitmentResume(
  companyKey,
  jobSlug,
  resumeFile,
  payload = {},
) {
  if (!resumeFile) {
    throw new Error('Resume file is required.');
  }

  return api(
    `${RECRUITMENT_API_PREFIX}/public/${recruitmentId(
      companyKey,
      'Company key',
    )}/jobs/${recruitmentId(jobSlug, 'Job slug')}/resume-preview`,
    {
      method: 'POST',
      body: recruitmentFormData(payload, resumeFile, 'resume'),
      timeoutMs: 60000,
    },
  );
}

export function getPublicRecruitmentJob(companyKey, jobSlug) {
  return recruitmentJson(
    `/public/${recruitmentId(
      companyKey,
      'Company key',
    )}/jobs/${recruitmentId(jobSlug, 'Job slug')}`,
  );
}

export function applyToPublicRecruitmentJob(
  companyKey,
  jobSlug,
  payload = {},
  resumeFile,
) {
  if (!resumeFile) {
    throw new Error('Resume file is required.');
  }

  return api(
    `${RECRUITMENT_API_PREFIX}/public/${recruitmentId(
      companyKey,
      'Company key',
    )}/jobs/${recruitmentId(jobSlug, 'Job slug')}/apply`,
    {
      method: 'POST',
      body: recruitmentFormData(payload, resumeFile, 'resume'),
      timeoutMs: 60000,
    },
  );
}

export function getPublicRecruitmentOffer(responseToken) {
  return recruitmentJson(
    `/public/offers/${recruitmentId(
      responseToken,
      'Offer response token',
    )}`,
  );
}

export function respondToPublicRecruitmentOffer(
  responseToken,
  payload = {},
) {
  return recruitmentJson(
    `/public/offers/${recruitmentId(
      responseToken,
      'Offer response token',
    )}/respond`,
    'POST',
    payload,
  );
}

export function getPublicRecruitmentJoiningPortal(accessToken) {
  return recruitmentJson(
    `/public/joining/${recruitmentId(
      accessToken,
      'Joining access token',
    )}`,
  );
}

export function uploadPublicRecruitmentJoiningDocument(
  accessToken,
  documentKey,
  file,
  payload = {},
) {
  if (!file) {
    throw new Error('Joining document file is required.');
  }

  return api(
    `${RECRUITMENT_API_PREFIX}/public/joining/${recruitmentId(
      accessToken,
      'Joining access token',
    )}/documents/${recruitmentId(documentKey, 'Document key')}`,
    {
      method: 'POST',
      body: recruitmentFormData(payload, file, 'document'),
      timeoutMs: 60000,
    },
  );
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


export function normalizeOrganisation(organisation = {}) {
  if (!organisation || typeof organisation !== 'object') {
    return organisation;
  }

  const name =
    organisation.name ||
    organisation.organisation_name ||
    organisation.organization_name ||
    '';

  const code =
    organisation.code ||
    organisation.organisation_code ||
    organisation.organization_code ||
    '';

  return {
    ...organisation,
    id: organisation.id || organisation._id || '',
    _id: organisation._id || organisation.id || '',
    name,
    organisation_name: organisation.organisation_name || name,
    organization_name: organisation.organization_name || name,
    code,
    organisation_code: organisation.organisation_code || code,
    organization_code: organisation.organization_code || code,
    status: organisation.status || 'active',
    label: code ? `${name} (${code})` : name || 'Organisation',
    value: organisation.id || organisation._id || code || name,
  };
}

export function normalizeOrganisationList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeOrganisation(item)).filter(Boolean);
}

export function getOrganisations(params = {}) {
  return listCollection('organisations', {
    limit: 500,
    ...params,
  }).then((data = {}) => ({
    ...data,
    items: normalizeOrganisationList(data.items || []),
  }));
}

export function getActiveOrganisations(params = {}) {
  return getOrganisations({
    ...params,
    status: params.status || 'active',
  });
}

export function createOrganisation(payload = {}) {
  return createCollectionItem('organisations', payload).then((data = {}) => ({
    ...data,
    item: normalizeOrganisation(data.item || {}),
  }));
}

export function updateOrganisation(organisationId, payload = {}) {
  return updateCollectionItem('organisations', organisationId, payload).then((data = {}) => ({
    ...data,
    item: normalizeOrganisation(data.item || {}),
  }));
}

export function deleteOrganisation(organisationId) {
  return deleteCollectionItem('organisations', organisationId);
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
  ['organisation_code', 'Organisation Code'],
  ['organisation', 'Organisation / Entity'],
  ['department', 'Department'],
  ['designation', 'Designation'],
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
  ['organisation_code', 'Organisation Code'],
  ['organisation', 'Organisation / Entity'],
  ['department', 'Department'],
  ['designation', 'Designation'],
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

  normalized.organisation_id =
    normalized.organisation_id ||
    normalized.organization_id ||
    '';

  normalized.organization_id =
    normalized.organization_id ||
    normalized.organisation_id ||
    '';

  normalized.organisation =
    normalized.organisation ||
    normalized.organization ||
    normalized.organisation_name ||
    normalized.organization_name ||
    '';

  normalized.organization =
    normalized.organization ||
    normalized.organisation ||
    '';

  normalized.organisation_code =
    normalized.organisation_code ||
    normalized.organization_code ||
    normalized.code ||
    '';

  normalized.organization_code =
    normalized.organization_code ||
    normalized.organisation_code ||
    '';

  normalized.department = normalized.department || normalized.department_name || '';
  normalized.designation = normalized.designation || normalized.designation_name || '';
  normalized.state = firstNonEmpty(
  normalized.state,
  normalized.office_state,
  normalized.work_state,
  normalized.current_state,
  normalized.branch,
);

// Temporary read compatibility for old employee records.
normalized.branch = normalized.branch || normalized.state || '';

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

    normalizedPayload.organisation_id =
    normalizedPayload.organisation_id ||
    normalizedPayload.organization_id ||
    '';

  normalizedPayload.organization_id =
    normalizedPayload.organization_id ||
    normalizedPayload.organisation_id ||
    '';

  normalizedPayload.organisation =
    normalizedPayload.organisation ||
    normalizedPayload.organization ||
    normalizedPayload.organisation_name ||
    normalizedPayload.organization_name ||
    '';

  normalizedPayload.organization =
    normalizedPayload.organization ||
    normalizedPayload.organisation ||
    '';

  normalizedPayload.organisation_code =
    normalizedPayload.organisation_code ||
    normalizedPayload.organization_code ||
    normalizedPayload.code ||
    '';

  normalizedPayload.organization_code =
    normalizedPayload.organization_code ||
    normalizedPayload.organisation_code ||
    '';

  normalizedPayload.state = firstNonEmpty(
  normalizedPayload.state,
  normalizedPayload.office_state,
  normalizedPayload.work_state,
  normalizedPayload.current_state,
  normalizedPayload.branch,
);

// State is authoritative. Branch is accepted only as legacy input.
delete normalizedPayload.branch;

// Employee profile updates must never reset or modify passwords.
[
  'password',
  'confirm_password',
  'password_confirm',
  'new_password',
  'password_mode',
].forEach((key) => {
  delete normalizedPayload[key];
});


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
    employee.organisation,
    employee.organization,
    employee.organisation_name,
    employee.organization_name,
    employee.organisation_code,
    employee.organization_code,
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
  const organisation = String(
    filters.organisation ||
      filters.organization ||
      filters.organisation_code ||
      filters.organization_code ||
      ''
  ).trim().toLowerCase();
  const department = String(filters.department || '').trim().toLowerCase();
  const designation = String(filters.designation || '').trim().toLowerCase();
  const state = String(filters.state || filters.branch || '').trim().toLowerCase();
  const employmentStatus = String(filters.employment_status || filters.status || '').trim().toLowerCase();

  return normalizeEmployeeList(items).filter((employee) => {
    if (!employeeMatchesSearch(employee, searchText)) {
      return false;
    }

        if (
      organisation &&
      ![
        employee.organisation,
        employee.organization,
        employee.organisation_code,
        employee.organization_code,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .includes(organisation)
    ) {
      return false;
    }


    if (department && String(employee.department || '').trim().toLowerCase() !== department) {
      return false;
    }

    if (designation && String(employee.designation || '').trim().toLowerCase() !== designation) {
      return false;
    }

if (
  state &&
  String(employee.state || employee.branch || '').trim().toLowerCase() !== state
) {
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
  try {
    await refreshAccessToken();

    return downloadPolicy(
      policyId,
      filename,
    );
  } catch (refreshError) {
    clearSession();
    throw refreshError;
  }
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

export function updateProjectStatus(
  projectId,
  statusOrPayload,
  extraPayload = {},
) {
  const payload =
    statusOrPayload && typeof statusOrPayload === 'object'
      ? { ...statusOrPayload }
      : {
          ...extraPayload,
          status: statusOrPayload,
        };

  return api(`/projects/${projectId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function assignProject(projectId, payload = {}) {
  return api(`/projects/${projectId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}


export function updateProjectMembers(projectId, payload = {}) {
  return assignProject(projectId, payload);
}

export function addProjectMembers(
  projectId,
  employeeIds = [],
  extraPayload = {},
) {
  return assignProject(projectId, {
    ...extraPayload,
    add_employee_ids: employeeIds,
  });
}

export function removeProjectMembers(
  projectId,
  employeeIds = [],
  extraPayload = {},
) {
  return assignProject(projectId, {
    ...extraPayload,
    remove_employee_ids: employeeIds,
  });
}

export function reassignProjectPrimary(
  projectId,
  primaryAssigneeId,
  extraPayload = {},
) {
  return assignProject(projectId, {
    ...extraPayload,
    primary_assignee_id: primaryAssigneeId,
  });
}

export function getProjectAssignmentHistory(
  projectId,
  params = {},
) {
  return api(
    `/projects/${projectId}/assignment-history${buildQuery(params)}`,
  );
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
/* Holiday Work Request APIs                                                  */
/* -------------------------------------------------------------------------- */

export function createHolidayWorkRequest(payload = {}) {
  return api('/attendance/holiday-work-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMyHolidayWorkRequests(params = {}) {
  return api(`/attendance/my-holiday-work-requests${buildQuery(params)}`);
}

export function getHolidayWorkRequests(params = {}) {
  return api(`/attendance/holiday-work-requests${buildQuery(params)}`);
}

export function decideHolidayWorkRequest(requestId, payload = {}) {
  return api(`/attendance/holiday-work-requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getTeamFieldAttendance(params = {}) {
  return api(`/attendance/team-field-attendance${buildQuery(params)}`);
}

/* -------------------------------------------------------------------------- */
/* My Visit APIs                                                              */
/* -------------------------------------------------------------------------- */

function fieldVisitId(value) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new Error('Visit ID is required.');
  }

  return encodeURIComponent(normalized);
}

export function getFieldVisits(params = {}) {
  return api(`/field-visits${buildQuery(params)}`);
}

export function getMyFieldVisits(params = {}) {
  return getFieldVisits({
    ...params,
    scope: 'mine',
  });
}

export function getTeamFieldVisits(params = {}) {
  return getFieldVisits({
    ...params,
    scope: 'team',
  });
}

export function getFieldVisit(visitId) {
  return api(`/field-visits/${fieldVisitId(visitId)}`);
}

export function createFieldVisit(payload = {}) {
  return api('/field-visits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateFieldVisit(visitId, payload = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function uploadFieldVisitPicture(visitId, picture) {
  if (!(picture instanceof File)) {
    throw new Error('A valid picture file is required.');
  }

  const formData = new FormData();
  formData.append('picture', picture);

  return api(`/field-visits/${fieldVisitId(visitId)}/pictures`, {
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  });
}

export function rescheduleFieldVisit(visitId, payload = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelFieldVisit(visitId, payload = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function startFieldVisit(visitId, location = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}/start`, {
    method: 'POST',
    body: JSON.stringify(location),
  });
}

export function markFieldVisitReached(visitId, location = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}/reached`, {
    method: 'POST',
    body: JSON.stringify(location),
  });
}

export function endFieldVisit(visitId, location = {}) {
  return api(`/field-visits/${fieldVisitId(visitId)}/end`, {
    method: 'POST',
    body: JSON.stringify(location),
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
/* Management Group APIs                                                      */
/* -------------------------------------------------------------------------- */

export function normalizeManagementGroupMember(member = {}) {
  if (!member || typeof member !== 'object') {
    return member;
  }

  const normalized = normalizePerson(withProfilePhotoAliases({ ...member }));

  normalized.id = normalized.id || normalized._id || normalized.employee_id || '';
  normalized._id = normalized._id || normalized.id || '';
  normalized.employee_id = normalized.employee_id || normalized._id || normalized.id || '';
  normalized.user_id = normalized.user_id || '';

  normalized.name =
    normalized.name ||
    normalized.employee_name ||
    normalized.full_name ||
    normalized.email ||
    'Employee';

  normalized.employee_name = normalized.employee_name || normalized.name;
  normalized.email = normalized.email || normalized.official_email || '';
  normalized.phone = normalized.phone || normalized.mobile || '';
  normalized.department = normalized.department || normalized.department_name || '';
  normalized.designation = normalized.designation || normalized.designation_name || '';

  normalized.employee_code =
    normalized.employee_code ||
    normalized.emp_code ||
    normalized.employee_id ||
    '';

  normalized.is_group_admin = toBoolean(normalized.is_group_admin);

  return normalized;
}

export function normalizeManagementGroupMembers(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeManagementGroupMember(item)).filter(Boolean);
}

export function normalizeManagementGroupMeeting(meeting = {}) {
  if (!meeting || typeof meeting !== 'object') {
    return meeting;
  }

  const normalized = { ...meeting };

  normalized.id = normalized.id || normalized._id || '';
  normalized._id = normalized._id || normalized.id || '';

  normalized.topic = normalized.topic || normalized.title || 'Management Group Meeting';
  normalized.title = normalized.title || normalized.topic;

  normalized.meeting_date = normalized.meeting_date || normalized.date || '';
  normalized.date = normalized.date || normalized.meeting_date || '';

  normalized.start_time = normalized.start_time || '';
  normalized.end_time = normalized.end_time || '';
  normalized.mode = normalized.mode || 'Offline';
  normalized.location = normalized.location || '';
  normalized.agenda = normalized.agenda || '';

  normalized.assigned_minutes_user_id = normalized.assigned_minutes_user_id || '';
  normalized.assigned_minutes_user_name = normalized.assigned_minutes_user_name || '';

  normalized.status = normalized.status || 'scheduled';
  normalized.minutes_status = normalized.minutes_status || 'not_assigned';

  normalized.minutes = normalized.minutes || '';
  normalized.decisions = normalized.decisions || '';
  normalized.action_items = normalized.action_items || '';

  normalized.created_by_name = normalized.created_by_name || '';
  normalized.minutes_updated_by_name = normalized.minutes_updated_by_name || '';

  return normalized;
}

export function normalizeManagementGroupMeetings(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeManagementGroupMeeting(item)).filter(Boolean);
}

export function getManagementGroup() {
  return api('/management-groups').then((data = {}) => ({
    ...data,
    group: data.group || {},
    members: normalizeManagementGroupMembers(data.members || []),
    permissions: data.permissions || {},
  }));
}

export function getManagementGroupEmployeeOptions(params = {}) {
  return api(`/management-groups/employee-options${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeManagementGroupMembers(data.items || data.employees || []),
    employees: normalizeManagementGroupMembers(data.employees || data.items || []),
  }));
}

export function updateManagementGroupMembers(payload = {}) {
  return api('/management-groups/members', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    group: data.group || {},
    members: normalizeManagementGroupMembers(data.members || []),
  }));
}

export function createManagementGroupMeeting(payload = {}) {
  return api('/management-groups/meetings', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    meeting: normalizeManagementGroupMeeting(data.meeting || {}),
  }));
}

export function getManagementGroupMeetings(params = {}) {
  return api(`/management-groups/meetings${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeManagementGroupMeetings(data.items || data.meetings || []),
    meetings: normalizeManagementGroupMeetings(data.meetings || data.items || []),
  }));
}

export function getManagementGroupMeeting(meetingId) {
  return api(`/management-groups/meetings/${meetingId}`).then((data = {}) => ({
    ...data,
    meeting: normalizeManagementGroupMeeting(data.meeting || {}),
    permissions: data.permissions || {},
  }));
}

export function updateManagementGroupMinutes(meetingId, payload = {}) {
  return api(`/management-groups/meetings/${meetingId}/minutes`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    meeting: normalizeManagementGroupMeeting(data.meeting || {}),
  }));
}

export function assignManagementGroupMinutesWriter(meetingId, payload = {}) {
  return api(`/management-groups/meetings/${meetingId}/assign-minutes`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    meeting: normalizeManagementGroupMeeting(data.meeting || {}),
  }));
}

export function deleteManagementGroupMeeting(meetingId) {
  return api(`/management-groups/meetings/${meetingId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Asset APIs                                                                 */
/* -------------------------------------------------------------------------- */

export const ASSET_TYPES = [
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' },
];

export const ASSET_STATUSES = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'available', label: 'Available' },
  { value: 'returned', label: 'Returned' },
  { value: 'lost', label: 'Lost' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
];

export const ASSET_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

export const ASSET_VERIFICATION_STATUSES = [
  { value: 'pending', label: 'Pending Verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
];

export function normalizeAssetType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'hardware' || normalized === 'software') {
    return normalized;
  }

  return 'hardware';
}

export function normalizeAssetStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (ASSET_STATUSES.some((item) => item.value === normalized)) {
    return normalized;
  }

  return 'assigned';
}

export function normalizeAssetCondition(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (ASSET_CONDITIONS.some((item) => item.value === normalized)) {
    return normalized;
  }

  return 'good';
}

export function normalizeAssetVerificationStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (ASSET_VERIFICATION_STATUSES.some((item) => item.value === normalized)) {
    return normalized;
  }

  return 'pending';
}

export function getAssetTypeLabel(value = '') {
  const normalized = normalizeAssetType(value);
  return ASSET_TYPES.find((item) => item.value === normalized)?.label || 'Hardware';
}

export function getAssetStatusLabel(value = '') {
  const normalized = normalizeAssetStatus(value);
  return ASSET_STATUSES.find((item) => item.value === normalized)?.label || 'Assigned';
}

export function getAssetConditionLabel(value = '') {
  const normalized = normalizeAssetCondition(value);
  return ASSET_CONDITIONS.find((item) => item.value === normalized)?.label || 'Good';
}

export function getAssetVerificationStatusLabel(value = '') {
  const normalized = normalizeAssetVerificationStatus(value);
  return (
    ASSET_VERIFICATION_STATUSES.find((item) => item.value === normalized)?.label ||
    'Pending Verification'
  );
}

export function normalizeAssetEmployee(employee = {}) {
  if (!employee || typeof employee !== 'object') {
    return employee;
  }

  const normalized = normalizePerson(withProfilePhotoAliases({ ...employee }));

  normalized.id = normalized.id || normalized._id || normalized.employee_id || '';
  normalized._id = normalized._id || normalized.id || '';
  normalized.employee_id = normalized.employee_id || normalized._id || normalized.id || '';

  normalized.name =
    normalized.name ||
    normalized.employee_name ||
    normalized.full_name ||
    normalized.email ||
    'Employee';

  normalized.employee_name = normalized.employee_name || normalized.name;
  normalized.employee_code =
    normalized.employee_code ||
    normalized.emp_code ||
    normalized.code ||
    '';

  normalized.department = normalized.department || normalized.department_name || '';
  normalized.designation = normalized.designation || normalized.designation_name || '';
  normalized.email = normalized.email || normalized.official_email || '';

  return normalized;
}

export function normalizeAssetEmployees(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeAssetEmployee(item)).filter(Boolean);
}

export function normalizeAsset(asset = {}) {
  if (!asset || typeof asset !== 'object') {
    return asset;
  }

  const normalized = { ...asset };

  normalized.id = normalized.id || normalized._id || '';
  normalized._id = normalized._id || normalized.id || '';

  normalized.asset_type = normalizeAssetType(normalized.asset_type || normalized.type);
  normalized.type = normalized.asset_type;

  normalized.asset_name = normalized.asset_name || normalized.name || '';
  normalized.name = normalized.name || normalized.asset_name;

  normalized.category = normalized.category || '';
  normalized.brand = normalized.brand || '';
  normalized.model = normalized.model || '';
  normalized.serial_no = normalized.serial_no || '';
  normalized.asset_code = normalized.asset_code || '';

  normalized.license_key = normalized.license_key || '';
  normalized.license_email = normalized.license_email || '';

  normalized.vendor = normalized.vendor || '';
  normalized.purchase_date = normalized.purchase_date || '';
  normalized.warranty_expiry = normalized.warranty_expiry || '';
  normalized.license_expiry = normalized.license_expiry || '';

  normalized.status = normalizeAssetStatus(normalized.status);
  normalized.condition = normalizeAssetCondition(normalized.condition);
  normalized.verification_status = normalizeAssetVerificationStatus(
    normalized.verification_status,
  );

  normalized.remarks = normalized.remarks || '';
  normalized.rejection_reason = normalized.rejection_reason || '';

  normalized.entry_source = normalized.entry_source || '';
  normalized.created_by_name = normalized.created_by_name || '';
  normalized.updated_by_name = normalized.updated_by_name || '';
  normalized.verified_by_name = normalized.verified_by_name || '';

  normalized.assigned_to_employee_id = normalized.assigned_to_employee_id || '';
  normalized.assigned_to_user_id = normalized.assigned_to_user_id || '';
  normalized.assigned_to_name = normalized.assigned_to_name || 'Employee';
  normalized.assigned_to_employee_code = normalized.assigned_to_employee_code || '';
  normalized.assigned_to_department = normalized.assigned_to_department || '';
  normalized.assigned_to_designation = normalized.assigned_to_designation || '';
  normalized.assigned_to_email = normalized.assigned_to_email || '';
  normalized.assigned_to_phone = normalized.assigned_to_phone || '';

  normalized.type_label = getAssetTypeLabel(normalized.asset_type);
  normalized.status_label = getAssetStatusLabel(normalized.status);
  normalized.condition_label = getAssetConditionLabel(normalized.condition);
  normalized.verification_status_label = getAssetVerificationStatusLabel(
    normalized.verification_status,
  );

  return normalized;
}

export function normalizeAssets(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeAsset(item)).filter(Boolean);
}

export function normalizeAssetReportRow(row = {}) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const normalized = { ...row };

  normalized.employee_id = normalized.employee_id || '';
  normalized.employee_name = normalized.employee_name || 'Employee';
  normalized.employee_code = normalized.employee_code || '';
  normalized.department = normalized.department || '';
  normalized.designation = normalized.designation || '';
  normalized.email = normalized.email || '';

  normalized.hardware_count = Number(normalized.hardware_count || 0);
  normalized.software_count = Number(normalized.software_count || 0);
  normalized.total_assets = Number(normalized.total_assets || 0);

  normalized.assets = normalizeAssets(normalized.assets || []);

  return normalized;
}

export function normalizeAssetReportRows(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeAssetReportRow(item)).filter(Boolean);
}

export function getAssets(params = {}) {
  return api(`/assets/${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeAssets(data.items || data.assets || []),
    assets: normalizeAssets(data.assets || data.items || []),
    stats: {
      total: Number(data.stats?.total || 0),
      hardware: Number(data.stats?.hardware || 0),
      software: Number(data.stats?.software || 0),
      assigned: Number(data.stats?.assigned || 0),
      available: Number(data.stats?.available || 0),
      pending: Number(data.stats?.pending || 0),
      verified: Number(data.stats?.verified || 0),
    },
    can_manage: Boolean(data.can_manage),
    can_report: Boolean(data.can_report),
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    limit: Number(data.limit || 100),
  }));
}

export function getAssetEmployeeOptions(params = {}) {
  return api(`/assets/employee-options${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeAssetEmployees(data.items || data.employees || []),
    employees: normalizeAssetEmployees(data.employees || data.items || []),
  }));
}
export function createAsset(payload = {}) {
  return api('/assets/', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    item: normalizeAsset(data.item || data.asset || {}),
    asset: normalizeAsset(data.asset || data.item || {}),
  }));
}

export function updateAsset(assetId, payload = {}) {
  return api(`/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((data = {}) => ({
    ...data,
    item: normalizeAsset(data.item || data.asset || {}),
    asset: normalizeAsset(data.asset || data.item || {}),
  }));
}

export function deleteAsset(assetId) {
  return api(`/assets/${assetId}`, {
    method: 'DELETE',
  });
}

export function getAssetReport(params = {}) {
  return api(`/assets/report${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: normalizeAssetReportRows(data.items || data.rows || []),
    rows: normalizeAssetReportRows(data.rows || data.items || []),
    flat_items: normalizeAssets(data.flat_items || []),
    summary: {
      employee_count: Number(data.summary?.employee_count || 0),
      asset_count: Number(data.summary?.asset_count || 0),
      hardware_count: Number(data.summary?.hardware_count || 0),
      software_count: Number(data.summary?.software_count || 0),
    },
  }));
}

export function exportAssetReportCsv(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];

  const headers = [
    'Employee Name',
    'Employee Code',
    'Department',
    'Designation',
    'Asset Type',
    'Asset Name',
    'Category',
    'Brand',
    'Model',
    'Serial No',
    'Asset Code',
    'License Email',
    'Status',
    'Condition',
    'Verification',
    'Vendor',
    'Purchase Date',
    'Warranty Expiry',
    'License Expiry',
    'Remarks',
  ];

  const escapeCsvValue = (value = '') => {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
  };

  const lines = [headers.map(escapeCsvValue).join(',')];

  safeRows.forEach((row) => {
    const assets = Array.isArray(row.assets) ? row.assets : [];

    if (!assets.length) {
      lines.push([
        row.employee_name,
        row.employee_code,
        row.department,
        row.designation,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ].map(escapeCsvValue).join(','));

      return;
    }

    assets.forEach((asset) => {
      lines.push([
        row.employee_name,
        row.employee_code,
        row.department,
        row.designation,
        getAssetTypeLabel(asset.asset_type),
        asset.asset_name,
        asset.category,
        asset.brand,
        asset.model,
        asset.serial_no,
        asset.asset_code,
        asset.license_email,
        getAssetStatusLabel(asset.status),
        getAssetConditionLabel(asset.condition),
        getAssetVerificationStatusLabel(asset.verification_status),
        asset.vendor,
        asset.purchase_date,
        asset.warranty_expiry,
        asset.license_expiry,
        asset.remarks,
      ].map(escapeCsvValue).join(','));
    });
  });

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Reports APIs                                                               */
/* -------------------------------------------------------------------------- */

function employeeReportFilterParams(params = {}) {
  return {
    employee_scope: params.employee_scope,
    scope: params.scope,
    q: params.q,
    search: params.search,
    department: params.department,
    designation: params.designation,
    employment_status: params.employment_status,
    status: params.status,

    organisation_id: params.organisation_id,
    organization_id: params.organization_id,
    entity_id: params.entity_id,
    organisation_code: params.organisation_code,
    organization_code: params.organization_code,
    entity_code: params.entity_code,
    organisation: params.organisation,
    organization: params.organization,
    entity: params.entity,
    organisation_name: params.organisation_name,
    organization_name: params.organization_name,

    state: params.state,

    employee_id: params.employee_id,
    employee: params.employee,
    staff_id: params.staff_id,
    employee_code: params.employee_code,
    emp_code: params.emp_code,
    staff_code: params.staff_code,
    employee_email: params.employee_email,
    email: params.email,
    official_email: params.official_email,
    employee_name: params.employee_name,
    name: params.name,
  };
}

function attendanceReportPeriodParams(params = {}) {
  return {
    period: params.period,
    date: params.date,
    on_date: params.on_date,
    week_start: params.week_start,
    week_end: params.week_end,
    date_from: params.date_from,
    date_to: params.date_to,
    year: params.year,
    month: params.month,
  };
}

function attendanceExceptionReportParams(params = {}) {
  return {
    report_type: params.report_type,
    type: params.type,
    ...attendanceReportPeriodParams(params),
    ...employeeReportFilterParams(params),
  };
}

function responseDownloadFilename(response, fallbackFilename) {
  const disposition = response.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(
    /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
  );
  const filename =
    filenameMatch?.[1] ||
    filenameMatch?.[2] ||
    fallbackFilename;

  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

async function downloadAuthenticatedExcel(
  path,
  {
    fallbackFilename,
    permissionMessage,
    errorMessage,
  },
  authRetry = false,
) {
  const token = getToken();
  const headers = {
    Accept:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(buildUrl(path), {
      method: 'GET',
      headers,
    });
  } catch {
    throw new Error(getConnectionErrorMessage());
  }

  if (response.status === 401) {
    if (!authRetry && getRefreshToken()) {
      try {
        await refreshAccessToken();

        return downloadAuthenticatedExcel(
          path,
          {
            fallbackFilename,
            permissionMessage,
            errorMessage,
          },
          true,
        );
      } catch (refreshError) {
        clearSession();
        throw refreshError;
      }
    }

    clearSession();
    throw new Error('Session expired. Please login again.');
  }

  if (response.status === 403) {
    throw new Error(permissionMessage);
  }

  if (!response.ok) {
    const data = normalizeApiPayload(await parseResponse(response));

    throw buildApiError(
      data,
      response.status,
      errorMessage,
    );
  }

  const blob = await response.blob();
  const filename = responseDownloadFilename(
    response,
    fallbackFilename,
  );
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

export function downloadEmployeeMasterExcel(params = {}) {
  const query = buildQuery(
    employeeReportFilterParams(params),
  );

  return downloadAuthenticatedExcel(
    `/reports/employees.xlsx${query}`,
    {
      fallbackFilename: 'employee-master.xlsx',
      permissionMessage:
        'You do not have permission to export employee records.',
      errorMessage:
        'Unable to download the employee Excel report.',
    },
  );
}

export function downloadAttendanceRegisterExcel(params = {}) {
  const query = buildQuery({
    ...attendanceReportPeriodParams(params),
    ...employeeReportFilterParams(params),
  });

  return downloadAuthenticatedExcel(
    `/reports/attendance-register.xlsx${query}`,
    {
      fallbackFilename: 'attendance-register.xlsx',
      permissionMessage:
        'You do not have permission to download this attendance Excel report.',
      errorMessage:
        'Unable to download the attendance Excel report.',
    },
  );
}

export function getAttendanceExceptionReports(params = {}) {
  const query = buildQuery(
    attendanceExceptionReportParams(params),
  );

  return api(
    `/reports/attendance-exceptions${query}`,
  );
}

export function downloadAttendanceExceptionExcel(params = {}) {
  const query = buildQuery(
    attendanceExceptionReportParams(params),
  );

  return downloadAuthenticatedExcel(
    `/reports/attendance-exceptions.xlsx${query}`,
    {
      fallbackFilename: 'attendance-exceptions.xlsx',
      permissionMessage:
        'You do not have permission to export attendance exceptions.',
      errorMessage:
        'Unable to download the attendance exception Excel report.',
    },
  );
}

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


export function getPrivateAttendanceCorrectionTenants() {
  return api('/superadmin/private-attendance-corrections/tenants').then((data = {}) => ({
    ...data,
    items: data.items || data.tenants || [],
    tenants: data.tenants || data.items || [],
  }));
}

export function getPrivateAttendanceCorrectionEmployees(params = {}) {
  return api(`/superadmin/private-attendance-corrections/employees${buildQuery(params)}`).then((data = {}) => ({
    ...data,
    items: data.items || data.employees || [],
    employees: data.employees || data.items || [],
  }));
}

export function getPrivateAttendanceCorrectionRecord(params = {}) {
  return api(`/superadmin/private-attendance-corrections/record${buildQuery(params)}`);
}

export function savePrivateAttendanceCorrection(payload = {}) {
  return api('/superadmin/private-attendance-corrections/update', {
    method: 'POST',
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

export function updateUserProfileCover(userId, coverValue, extra = {}) {
  return updateUser(userId, buildProfileCoverPayload(coverValue, extra));
}

export function updateEmployeeProfileCover(employeeId, coverValue, extra = {}) {
  return updateCollectionItem(
    'employees',
    employeeId,
    buildProfileCoverPayload(coverValue, extra),
  );
}

export function updateMyEmployeeProfileCover(employeeId, coverValue, extra = {}) {
  return updateEmployeeProfileCover(employeeId, coverValue, extra);
}

export function uploadEmployeeProfileCover(employeeId, file) {
  if (!employeeId) {
    return Promise.reject(new Error('Employee ID is required to upload cover image.'));
  }

  if (!file) {
    return Promise.reject(new Error('Cover image file is required.'));
  }

  const formData = new FormData();

  formData.append('employee_id', employeeId);
  formData.append('cover', file);

  return api('/profile-covers/upload', {
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
/* Location Helpers                                                           */
/* -------------------------------------------------------------------------- */

const LOCATION_TARGET_ACCURACY_METERS = 80;
const LOCATION_FAST_TIMEOUT_MS = 5000;
const LOCATION_WATCH_INTERVAL_MS = 500;

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

function normalizeGeoPosition(position) {
  const accuracy = Number(position?.coords?.accuracy || 999999);

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy,
    address: '',
    location_accuracy_warning: accuracy > LOCATION_TARGET_ACCURACY_METERS,
    location_warning:
      accuracy > LOCATION_TARGET_ACCURACY_METERS
        ? `Location accuracy is ±${Math.round(accuracy)}m. Move to an open area and try again if attendance is blocked.`
        : '',
  };
}


export function getCurrentLocation(options = {}) {
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: LOCATION_FAST_TIMEOUT_MS,
    maximumAge: 0,
    ...options,
  };

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is not supported in this browser.'));
      return;
    }

    let bestPosition = null;
    let settled = false;
    let watchId = null;
    let timeoutId = null;

    const stop = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    const finish = (position) => {
      if (settled) return;

      settled = true;
      stop();
      resolve(normalizeGeoPosition(position));
    };

    const fail = (message) => {
      if (settled) return;

      settled = true;
      stop();
      reject(new Error(message));
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        bestPosition = position;

        const accuracy = Number(position.coords.accuracy || 999999);

        if (accuracy <= LOCATION_TARGET_ACCURACY_METERS) {
          finish(position);
        }
      },
      () => {},
      geoOptions,
    );

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy || 999999);
        const bestAccuracy = Number(bestPosition?.coords?.accuracy || 999999);

        if (!bestPosition || accuracy < bestAccuracy) {
          bestPosition = position;
        }

        if (accuracy <= LOCATION_TARGET_ACCURACY_METERS) {
          finish(position);
        }
      },
      (error) => {
        if (bestPosition) {
          finish(bestPosition);
          return;
        }

        if (error.code === 1) {
          fail('Location permission denied. Please allow location access to mark attendance.');
          return;
        }

        if (error.code === 2) {
          fail('Location unavailable. Please turn on GPS/location and try again.');
          return;
        }

        if (error.code === 3) {
          fail('Location request timed out. Please try again.');
          return;
        }

        fail('Unable to fetch current location. Please try again.');
      },
      geoOptions,
    );

    timeoutId = setTimeout(() => {
      if (bestPosition) {
        finish(bestPosition);
        return;
      }

      fail('Unable to fetch location. Please enable GPS/location and try again.');
    }, LOCATION_FAST_TIMEOUT_MS + LOCATION_WATCH_INTERVAL_MS);
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance Payload Helpers                                                 */
/* -------------------------------------------------------------------------- */

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ''));
    };

    reader.onerror = () => {
      reject(new Error('Unable to read selected file.'));
    };

    reader.readAsDataURL(file);
  });
}


export async function buildAttendancePayload(extraPayload = {}) {
  const payload = { ...extraPayload };

  if (hasLocationInPayload(payload)) {
    if (payload.field_photo_file && !payload.field_photo) {
      payload.field_photo = await fileToBase64(payload.field_photo_file);
    }

    delete payload.field_photo_file;
    return payload;
  }

  const location = await getCurrentLocation();

  const nextPayload = {
    ...payload,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    address: location.address || '',
    location_accuracy_warning: location.location_accuracy_warning || false,
    location_warning: location.location_warning || '',
  };

  if (nextPayload.field_photo_file && !nextPayload.field_photo) {
    nextPayload.field_photo = await fileToBase64(nextPayload.field_photo_file);
  }

  delete nextPayload.field_photo_file;

  return nextPayload;
}

export async function submitCheckIn(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkInAttendance(attendancePayload);
}

export async function submitCheckOut(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkOutAttendance(attendancePayload);
}

export async function getAiAssistantVoiceContext() {
  try {
    const response = await api("/ai-assistant/voice-context", {
      method: "GET",
      timeoutMs: 15000,
    });

    const localEmployee = currentEmployee();
    const localUser = currentUser();

    const unreadCount = Number(
      response?.unread_notification_count ||
        response?.unread_count ||
        response?.notifications_count ||
        0
    );

    const employeeName = firstNonEmpty(
      localEmployee?.employee_name,
      localEmployee?.display_name,
      localEmployee?.full_name,
      localEmployee?.name,
      localUser?.employee_name,
      localUser?.display_name,
      localUser?.full_name,
      localUser?.name,
      response?.employee_name === "Employee" ? "" : response?.employee_name,
      response?.display_name === "Employee" ? "" : response?.display_name,
      response?.full_name === "Employee" ? "" : response?.full_name,
      response?.name === "Employee" ? "" : response?.name,
      response?.user_name,
      response?.employee?.employee_name,
      response?.employee?.full_name,
      response?.employee?.display_name,
      response?.employee?.name,
      response?.email,
      "Employee"
    );

    const gender = String(
      firstNonEmpty(
        response?.gender,
        response?.sex,
        response?.employee?.gender,
        response?.employee?.sex,
        response?.employee?.employee_gender,
        localEmployee?.gender,
        localEmployee?.sex,
        localEmployee?.employee_gender,
        localUser?.gender,
        localUser?.sex,
        ""
      )
    )
      .trim()
      .toLowerCase();

    const formalTitle = firstNonEmpty(
      response?.formal_title,
      gender === "male" || gender === "m" ? "sir" : "",
      gender === "female" || gender === "f" ? "ma'am" : ""
    );

    return {
      success: Boolean(response?.success),
      wake_word: String(response?.wake_word || "hey saya").trim().toLowerCase(),
      employee_name: employeeName,
      name: employeeName,
      display_name: employeeName,
      gender,
      formal_title: formalTitle,
      unread_notification_count: Number.isFinite(unreadCount) ? unreadCount : 0,
      notification_phrase: String(response?.notification_phrase || "").trim(),
    };
  } catch (error) {
    const localEmployee = currentEmployee();
    const localUser = currentUser();

    const employeeName = firstNonEmpty(
      localEmployee?.employee_name,
      localEmployee?.display_name,
      localEmployee?.full_name,
      localEmployee?.name,
      localUser?.employee_name,
      localUser?.display_name,
      localUser?.full_name,
      localUser?.name,
      localUser?.email,
      "Employee"
    );

    const gender = String(
      firstNonEmpty(
        localEmployee?.gender,
        localEmployee?.sex,
        localUser?.gender,
        localUser?.sex,
        ""
      )
    )
      .trim()
      .toLowerCase();

    return {
      success: false,
      wake_word: "hey saya",
      employee_name: employeeName,
      name: employeeName,
      display_name: employeeName,
      gender,
      formal_title:
        gender === "male" || gender === "m"
          ? "sir"
          : gender === "female" || gender === "f"
            ? "ma'am"
            : "",
      unread_notification_count: 0,
      notification_phrase: "",
    };
  }
}
export async function askAiAssistant(message, history = [], options = {}) {
  const responseMode = normalizeSayaResponseMode(
    options?.responseMode || options?.response_mode || 'text'
  );
  const cleanMessage = normalizeSayaRequestMessage(message, responseMode);

  if (!cleanMessage) {
    throw new Error('Message is required.');
  }

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-6)
        .map((item) => ({
          role: item?.role,
          text: item?.text || item?.content || '',
        }))
        .filter((item) => item.role && item.text)
    : [];

  const needsAttendanceLocation =
    options?.includeLocation === true || isAiAttendanceCommand(cleanMessage);

  const attendanceLocation = needsAttendanceLocation
    ? await getBrowserAttendanceLocation(options)
    : {
        available: false,
        skipped: true,
        reason: 'not_attendance_command',
      };

  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    resolveSayaChatTimeoutMs(options)
  );

  let response;

  try {
    response = await fetch(buildUrl('/ai-assistant/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: cleanMessage,
        history: safeHistory,
        response_mode: responseMode,

        // Used by Saya AI attendance actions. The browser only supplies
        // location evidence; all attendance business rules remain backend-owned.
        client_context: {
          response_mode: responseMode,
          attendance_location: attendanceLocation,
          location: attendanceLocation,
          latitude: attendanceLocation?.latitude,
          longitude: attendanceLocation?.longitude,
          accuracy: attendanceLocation?.accuracy,
          source: 'frontend_ai_assistant',
        },

        // Backward-compatible direct location keys.
        attendance_location: attendanceLocation,
        location: attendanceLocation,
        latitude: attendanceLocation?.latitude,
        longitude: attendanceLocation?.longitude,
        accuracy: attendanceLocation?.accuracy,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'Saya is still taking too long to complete this response. Please try again.'
      );
    }

    throw new Error(
      'Saya could not reach the HRMS backend. Please check your connection and try again.'
    );
  } finally {
    clearTimeout(timeout);
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    if (options?.__sayaAuthRetried) {
      clearSession();
      throw new Error('Your session has expired. Please sign in again to use Saya.');
    }

    try {
      await refreshAccessToken();

      return askAiAssistant(message, history, {
        ...options,
        __sayaAuthRetried: true,
      });
    } catch (refreshError) {
      clearSession();
      throw refreshError;
    }
  }

  if (response.status === 402) {
    redirectForSaasRestriction('/ai-assistant/chat', data, response.status);
    throw createAiProviderError(
      response,
      data,
      'Saya is unavailable because the current HRMS subscription does not permit this request.'
    );
  }

  if (response.status === 403) {
    throw createAiProviderError(
      response,
      data,
      'Saya is not available for your current role or subscription access.'
    );
  }

  if (!response.ok || !data?.success) {
    throw createAiProviderError(
      response,
      data,
      'Saya could not process this request. Please try again.'
    );
  }

  const answer = String(data?.answer || data?.message || '').trim();
  const responseMeta = data?.response && typeof data.response === 'object'
    ? data.response
    : {};

  return {
    ...data,
    answer,
    response: {
      ...responseMeta,
      mode: responseMeta?.mode || responseMode,
      style: responseMeta?.style || 'professional',
      complete_expected: responseMeta?.complete_expected !== false,
    },
  };
}

export async function transcribeAiAssistantAudio(audioBlob, options = {}) {
  if (!audioBlob) {
    throw new Error('Audio recording is required.');
  }

  if (audioBlob.size && audioBlob.size < 2500) {
    return {
      success: true,
      provider: 'local',
      text: '',
      transcript: '',
      skipped: true,
      reason: 'audio_too_short',
    };
  }

  const formData = new FormData();

  const filename =
    options.filename ||
    (audioBlob.type && audioBlob.type.includes('wav')
      ? 'saya-audio.wav'
      : audioBlob.type && audioBlob.type.includes('mp4')
        ? 'saya-audio.mp4'
        : audioBlob.type && audioBlob.type.includes('mpeg')
          ? 'saya-audio.mp3'
          : audioBlob.type && audioBlob.type.includes('ogg')
            ? 'saya-audio.ogg'
            : 'saya-audio.webm');

  formData.append('audio', audioBlob, filename);

  if (options.language) {
    formData.append('language', options.language);
  }

  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    resolveSayaSttTimeoutMs(options)
  );

  let response;

  try {
    response = await fetch(buildUrl('/ai-assistant/transcribe'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Voice understanding timed out. Please try again.');
    }

    throw new Error(getConnectionErrorMessage());
  } finally {
    clearTimeout(timeout);
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    if (options?.__sayaAuthRetried) {
      clearSession();
      throw new Error('Your session has expired. Please sign in again to use Saya voice.');
    }

    try {
      await refreshAccessToken();

      return transcribeAiAssistantAudio(audioBlob, {
        ...options,
        __sayaAuthRetried: true,
      });
    } catch (refreshError) {
      clearSession();
      throw refreshError;
    }
  }

  if (response.status === 403) {
    throw new Error('You do not have permission to use Saya voice.');
  }

  if (!response.ok || !data?.success) {
    throw createAiProviderError(
      response,
      data,
      'Voice transcription failed. Please try again.'
    );
  }

  const transcript = String(
    data?.text ||
      data?.transcript ||
      ''
  ).trim();

  return {
    ...data,
    success: true,
    provider: data?.provider || 'deepgram',
    text: transcript,
    transcript,
  };
}

export async function speakAiAssistantText(text, options = {}) {
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    throw new Error('Text is required for Saya voice.');
  }

  const requestedVoice = String(options.voice || '').trim();
  const languageCode = String(options.languageCode || options.language_code || 'en-IN').trim();

  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    resolveSayaTtsTimeoutMs(options)
  );

  let response;

  try {
    response = await fetch(buildUrl('/ai-assistant/speak'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav, audio/mpeg, audio/*, application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text: cleanText,
        ...(requestedVoice ? { voice: requestedVoice } : {}),
        language_code: languageCode || 'en-IN',
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Saya voice generation timed out. Please try again.');
    }

    throw new Error(getConnectionErrorMessage());
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    if (options?.__sayaAuthRetried) {
      clearSession();
      throw new Error('Your session has expired. Please sign in again to use Saya voice.');
    }

    try {
      await refreshAccessToken();

      return speakAiAssistantText(text, {
        ...options,
        __sayaAuthRetried: true,
      });
    } catch (refreshError) {
      clearSession();
      throw refreshError;
    }
  }

  if (response.status === 403) {
    throw new Error('You do not have permission to use Saya voice.');
  }

  if (!response.ok) {
    let errorData = {};
    let errorMessage = `Voice generation failed with API Error ${response.status}`;

    try {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        errorData = await response.json();
        errorMessage =
          errorData?.message ||
          errorData?.error ||
          errorData?.details ||
          errorMessage;
      } else {
        const textResponse = await response.text();
        errorMessage = textResponse || errorMessage;
      }
    } catch {
      // Keep the safe default error message.
    }

    throw createAiProviderError(response, errorData, errorMessage);
  }

  const audioBlob = await response.blob();

  if (!audioBlob || audioBlob.size <= 0) {
    throw new Error('Saya voice service returned empty audio.');
  }

  const audioUrl = URL.createObjectURL(audioBlob);
  const provider =
    response.headers.get('X-AI-Provider') ||
    response.headers.get('X-Saya-Provider') ||
    response.headers.get('X-Eve-Provider') ||
    'server';

  return {
    success: true,
    provider,
    model: response.headers.get('X-Saya-Model') || '',
    cache: response.headers.get('X-Saya-Cache') || '',
    blob: audioBlob,
    audio_blob: audioBlob,
    audio_url: audioUrl,
    url: audioUrl,
    mime_type: audioBlob.type || response.headers.get('content-type') || 'audio/mpeg',
    voice:
      response.headers.get('X-Saya-Voice') ||
      response.headers.get('X-Eve-Voice') ||
      requestedVoice ||
      '',
  };
}
