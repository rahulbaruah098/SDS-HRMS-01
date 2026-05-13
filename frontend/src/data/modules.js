import {
  Users,
  Clock,
  CalendarDays,
  Wallet,
  Briefcase,
  GraduationCap,
  BarChart3,
  Receipt,
  Laptop,
  MessageSquare,
  Bell,
  Settings,
  ShieldCheck,
  FileText,
  Building2,
  KeyRound,
  UserCircle,
  LockKeyhole,
  ClipboardList,
} from 'lucide-react';

/*
  Module format:
  [key, title, Icon, description, allowedRoles]

  Important workflow rule:
  - Every staff login created from Employee Master remains an employee login.
  - Team Leader and Reporting Officer are not separate login identities.
  - They are employee capabilities/mappings controlled from Employee Master:
      is_team_leader
      is_reporting_officer
      team_leader_id
      reporting_officer_id

  New grievance workflow:
  - Every login can raise grievance.
  - HR/Admin can view and update grievance status.
  - Anonymous grievance hides employee identity from HR/Admin frontend display.

  Correct IT Support workflow:
  - Every login can raise IT Support ticket.
  - Admin/HR can raise IT Support tickets only; they do not receive or manage IT tickets.
  - Normal IT Support request goes to the tenant IT Department.
  - IT Department Team Leader / IT Support Head can assign/reassign tickets to self or tenant IT Department members.
  - Assigned IT Department member can update progress/status.
  - Employee can review after resolution.
  - Super Admin receives/sees IT Support tickets only when IT Department Head escalates software/server/major issues.

  Performance workflow:
  - Performance page is available only for Team Leader and Reporting Officer capability users.
  - Team Leader can give weekly performance rating only to mapped team members.
  - Reporting Officer can give weekly performance rating to mapped Team Leaders/reporting members.
  - Monthly and yearly performance graphs are generated from weekly review data.
  - HR/Admin should not submit performance reviews from this module.
*/

export const BASE_EMPLOYEE_ROLE = 'employee';

export const CAPABILITY_ROLES = [
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const PERFORMANCE_REVIEW_ROLES = [
  'team_leader',
  'reporting_officer',
  'ro',
];

export const HR_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
];

export const TEAM_APPROVAL_ROLES = [
  ...HR_ROLES,
  'team_leader',
  'reporting_officer',
  'ro',
  'manager',
];

export const PROJECT_MANAGER_ROLES = [
  'team_leader',
  'reporting_officer',
  'ro',
];

export const ALL_COMMON_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  ...CAPABILITY_ROLES,
  BASE_EMPLOYEE_ROLE,
];

export const ADMIN_HR_FINANCE_ROLES = [
  ...HR_ROLES,
  'finance',
  'accounts_finance',
];

export const EMPLOYEE_PORTAL_ROLES = [
  ...HR_ROLES,
  ...CAPABILITY_ROLES,
  BASE_EMPLOYEE_ROLE,
];

export const TEAM_ROLES = EMPLOYEE_PORTAL_ROLES;

export const PROJECT_ROLES = [
  ...HR_ROLES,
  ...CAPABILITY_ROLES,
  BASE_EMPLOYEE_ROLE,
];

export const FINANCE_ROLES = [
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
];

export const ATTENDANCE_ROLES = EMPLOYEE_PORTAL_ROLES;

export const ATTENDANCE_MANAGER_ROLES = [
  ...HR_ROLES,
  ...CAPABILITY_ROLES,
];

export const REPORT_ROLES = [
  ...HR_ROLES,
  'finance',
  'accounts_finance',
  ...CAPABILITY_ROLES,
];

export const LEAVE_BALANCE_MANAGER_ROLES = HR_ROLES;

export const APPLICATION_STATUS_ROLES = ALL_COMMON_ROLES;

export const GRIEVANCE_ROLES = ALL_COMMON_ROLES;

export const GRIEVANCE_MANAGER_ROLES = HR_ROLES;

export const IT_SUPPORT_ROLES = ALL_COMMON_ROLES;

export const LEAVE_TYPES_FOR_EMPLOYEE = [
  { value: 'CL', label: 'Casual Leave' },
  { value: 'EL', label: 'Earned Leave' },
];

export const LEAVE_BALANCE_TYPES = [
  { value: 'CL', label: 'Casual Leave' },
  { value: 'EL', label: 'Earned Leave' },
];

export const PROJECT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
];

export const PROJECT_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const GRIEVANCE_TYPE_OPTIONS = [
  { value: 'workplace_issue', label: 'Workplace Issue' },
  { value: 'salary_payroll', label: 'Salary / Payroll' },
  { value: 'leave_attendance', label: 'Leave / Attendance' },
  { value: 'harassment', label: 'Harassment / Misconduct' },
  { value: 'policy_concern', label: 'Policy Concern' },
  { value: 'manager_team_issue', label: 'Manager / Team Issue' },
  { value: 'facilities', label: 'Facilities / Office Infrastructure' },
  { value: 'other', label: 'Other' },
];

export const GRIEVANCE_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const GRIEVANCE_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
];

export const IT_SUPPORT_CATEGORY_OPTIONS = [
  { value: 'login_password', label: 'Login / Password Issue' },
  { value: 'internet_network', label: 'Internet / Network Issue' },
  { value: 'laptop_desktop', label: 'Laptop / Desktop Issue' },
  { value: 'printer_scanner', label: 'Printer / Scanner Issue' },
  { value: 'software_application', label: 'Software / Application Issue' },
  { value: 'email_workspace', label: 'Email / Workspace Issue' },
  { value: 'attendance_hrms', label: 'Attendance / HRMS Issue' },
  { value: 'data_access', label: 'Data / Access Permission Issue' },
  { value: 'hardware_request', label: 'Hardware Request' },
  { value: 'server_issue', label: 'Server Issue' },
  { value: 'database_issue', label: 'Database Issue' },
  { value: 'security_issue', label: 'Security Issue' },
  { value: 'other', label: 'Other' },
];

export const IT_SUPPORT_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const IT_SUPPORT_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_for_user', label: 'Waiting for User' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
];

export const IT_SUPPORT_ESCALATION_TYPE_OPTIONS = [
  { value: 'software_application', label: 'Software / Application Problem' },
  { value: 'server_issue', label: 'Server Issue' },
  { value: 'database_issue', label: 'Database Issue' },
  { value: 'network_infrastructure', label: 'Network / Infrastructure Major Issue' },
  { value: 'security_issue', label: 'Security Issue' },
  { value: 'major_problem', label: 'Other Major Problem' },
];

export const PROJECT_TEAM_TREE_LEVELS = [
  { value: 'reporting_officer', label: 'Reporting Officer' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'assigned_member', label: 'Team Member Doing Project' },
  { value: 'collaborator', label: 'Collaborator' },
];

export const PERFORMANCE_REVIEW_TARGET_TYPES = [
  { value: 'team_member', label: 'Team Member' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'reporting_member', label: 'Reporting Member' },
];

export const PERFORMANCE_REVIEWER_ROLES = [
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'reporting_officer', label: 'Reporting Officer' },
];

export const PERFORMANCE_PERIOD_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const PROFILE_PHOTO_FIELDS = [
  'avatar',
  'profile_photo',
  'profile_picture',
  'photo',
];

export const superModules = [
  [
    'companies',
    'Companies / Tenants',
    Building2,
    'Create and manage companies using this SaaS HRMS.',
    ['super_admin'],
  ],
  [
    'users',
    'User Control',
    KeyRound,
    'Create users, reset passwords, update roles, profile photos and full employee profiles.',
    ['super_admin'],
  ],
  [
    'password_requests',
    'Password Requests',
    LockKeyhole,
    'Approve or reject user password change requests.',
    ['super_admin'],
  ],
];

export const coreModules = [
  [
    'employees',
    'Employee Master',
    Users,
    'Employee database with profile photo, Team Leader, Reporting Officer and IT Support capability mapping.',
    HR_ROLES,
  ],
  [
    'attendance',
    'Attendance',
    Clock,
    'Office/WFH/Field check-in, geolocation, late reason, early checkout, holiday calendar and comp-off.',
    ATTENDANCE_ROLES,
  ],
  [
    'projects',
    'Projects',
    Briefcase,
    'Team Leaders and Reporting Officers create/assign projects; employees view scoped projects and update progress/status.',
    PROJECT_ROLES,
  ],
  [
    'team_approvals',
    'Team Approvals',
    ClipboardList,
    'Team Leader and Reporting Officer approval inbox plus HR/Admin leave record panel with live approval stage and history.',
    TEAM_APPROVAL_ROLES,
  ],
  [
    'leave_requests',
    'Leave Management',
    CalendarDays,
    'Apply Casual Leave or Earned Leave with mapped Team Leader / Reporting Officer approval.',
    TEAM_ROLES,
  ],
  [
    'application_status',
    'Application Status',
    ClipboardList,
    'Track live status of leave, WFH/Field, password, grievance, IT support and comp-off requests.',
    APPLICATION_STATUS_ROLES,
  ],
  [
    'grievances',
    'Grievance',
    MessageSquare,
    'Submit employee grievances with anonymous option; HR/Admin can review and update status.',
    GRIEVANCE_ROLES,
  ],
  [
    'it_support',
    'IT Support',
    Laptop,
    'Raise IT support tickets to tenant IT Department; IT Head assigns/reassigns and escalates major software/server issues to Super Admin.',
    IT_SUPPORT_ROLES,
  ],
  [
    'leave_balances',
    'Leave Balances',
    CalendarDays,
    'HR/Admin can assign Casual Leave and Earned Leave together from one form.',
    LEAVE_BALANCE_MANAGER_ROLES,
  ],
  [
    'holiday_calendar',
    'Holiday Calendar',
    CalendarDays,
    'State-wise holiday calendar for Assam(HO), Manipur, Mizoram and Arunachal Pradesh.',
    ATTENDANCE_ROLES,
  ],
  [
    'attendance_mode_requests',
    'WFH / Field Requests',
    Clock,
    'Work From Home and Field attendance approval requests.',
    ATTENDANCE_ROLES,
  ],
  [
    'attendance_logs',
    'Attendance Logs',
    Clock,
    'System generated attendance records with location, late entry and checkout details.',
    ATTENDANCE_MANAGER_ROLES,
  ],
  [
    'compoff_credits',
    'Comp-Off Credits',
    CalendarDays,
    'System generated compensatory leave credits for employees working on holidays.',
    ATTENDANCE_ROLES,
  ],
  [
    'reports',
    'Reports',
    BarChart3,
    'Attendance, WFH/Field, holiday, comp-off, leave, project and audit reports.',
    REPORT_ROLES,
  ],
  [
    'payroll_runs',
    'Payroll Runs',
    Wallet,
    'Payroll processing and control.',
    FINANCE_ROLES,
  ],
  [
    'payslips',
    'Payslips',
    FileText,
    'Generated employee payslips.',
    [...FINANCE_ROLES, BASE_EMPLOYEE_ROLE],
  ],
  [
    'job_openings',
    'Recruitment Jobs',
    Briefcase,
    'Job openings and pipeline.',
    HR_ROLES,
  ],
  [
    'candidates',
    'Candidates',
    Users,
    'Candidate screening and status.',
    HR_ROLES,
  ],
  [
    'trainings',
    'Training',
    GraduationCap,
    'Training plan and feedback.',
    TEAM_ROLES,
  ],
  [
    'performance_reviews',
    'Performance',
    BarChart3,
    'Weekly performance rating page for Team Leaders and Reporting Officers with auto monthly/yearly analytics.',
    PERFORMANCE_REVIEW_ROLES,
  ],
  [
    'expenses',
    'Expenses',
    Receipt,
    'Claims and approvals.',
    [
      'super_admin',
      'admin',
      'finance',
      'accounts_finance',
      ...CAPABILITY_ROLES,
      BASE_EMPLOYEE_ROLE,
    ],
  ],
  [
    'assets',
    'Assets',
    Laptop,
    'Inventory and allocation.',
    HR_ROLES,
  ],
  [
    'notifications',
    'Notifications',
    Bell,
    'Alerts and notification center.',
    ALL_COMMON_ROLES,
  ],
  [
    'policies',
    'Policies',
    ShieldCheck,
    'Tenant-wise HR policy documents. HR can upload and employees can download.',
    EMPLOYEE_PORTAL_ROLES,
  ],
  [
    'departments',
    'Departments',
    Settings,
    'Department master.',
    HR_ROLES,
  ],
  [
    'designations',
    'Designations',
    Settings,
    'Designation master used in Employee Master and User Control dropdowns.',
    HR_ROLES,
  ],
  [
    'states',
    'States',
    Settings,
    'Operating states.',
    HR_ROLES,
  ],
  [
    'system_settings',
    'System Settings',
    Settings,
    'Rule engine settings.',
    ['super_admin', 'admin'],
  ],
  [
    'audit_logs',
    'Audit Logs',
    ShieldCheck,
    'Trace all actions.',
    ['super_admin', 'admin'],
  ],
  [
    'profile',
    'My Profile',
    UserCircle,
    'View profile, profile photo and request password change.',
    ALL_COMMON_ROLES,
  ],
];

export const allModules = [...superModules, ...coreModules];

export function normalizeRoleValue(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

export function normalizeRoleList(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  return [];
}

export function hasAnyRole(userRoles = [], allowedRoles = []) {
  const normalizedUserRoles = normalizeRoleList(userRoles);
  const normalizedAllowedRoles = normalizeRoleList(allowedRoles);

  return normalizedAllowedRoles.some((role) => normalizedUserRoles.includes(role));
}

export function truthyValue(value) {
  return ['true', 'yes', '1', 'on', '1.0'].includes(
    String(value || '').trim().toLowerCase(),
  );
}

export function profilePhotoValue(record = {}) {
  return (
    record.avatar ||
    record.profile_photo ||
    record.profile_picture ||
    record.photo ||
    record.image ||
    record.picture ||
    ''
  );
}

export function applyProfilePhotoAliases(payload = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(payload) || '').trim();

  if (photo) {
    payload.avatar = photo;
    payload.profile_photo = photo;
    payload.profile_picture = photo;
    payload.photo = photo;
  }

  return payload;
}

export function buildProfilePhotoPayload(photoValue = '', extra = {}) {
  const payload = { ...extra };
  applyProfilePhotoAliases(payload, photoValue);
  return payload;
}

export function isCapabilityRole(role) {
  return CAPABILITY_ROLES.includes(normalizeRoleValue(role));
}

export function isTeamApprovalRole(role) {
  return TEAM_APPROVAL_ROLES.includes(normalizeRoleValue(role));
}

export function isProjectManagerRole(role) {
  return PROJECT_MANAGER_ROLES.includes(normalizeRoleValue(role));
}

export function isPerformanceReviewerRole(role) {
  return PERFORMANCE_REVIEW_ROLES.includes(normalizeRoleValue(role));
}

export function getEmployeeProfile(user = {}) {
  return user.employee_summary || user.employee || user.employee_profile || user.profile || {};
}

export function effectiveRoleList(user = {}) {
  const roles = normalizeRoleList(user?.roles || []);
  const employee = getEmployeeProfile(user);

  if (truthyValue(employee?.is_team_leader) && !roles.includes('team_leader')) {
    roles.push('team_leader');
  }

  if (truthyValue(employee?.is_reporting_officer)) {
    if (!roles.includes('reporting_officer')) {
      roles.push('reporting_officer');
    }

    if (!roles.includes('ro')) {
      roles.push('ro');
    }
  }

  if (!roles.length && user?.email) {
    roles.push(BASE_EMPLOYEE_ROLE);
  }

  return [...new Set(roles)];
}

export function isEmployeePortalUser(user) {
  const roles = effectiveRoleList(user);

  if (!roles.length) {
    return false;
  }

  return roles.includes(BASE_EMPLOYEE_ROLE) || roles.some(isCapabilityRole);
}

export function isAdminHrUser(user) {
  const roles = effectiveRoleList(user);
  return hasAnyRole(roles, HR_ROLES);
}

export function isFinanceUser(user) {
  const roles = effectiveRoleList(user);
  return hasAnyRole(roles, FINANCE_ROLES);
}

export function isItSupportHead(user) {
  const employee = getEmployeeProfile(user);
  return truthyValue(employee?.is_it_support_head) || truthyValue(user?.is_it_support_head);
}

export function isItSupportMember(user) {
  const employee = getEmployeeProfile(user);

  return (
    isItSupportHead(user) ||
    truthyValue(employee?.is_it_support_member) ||
    truthyValue(user?.is_it_support_member)
  );
}

export function canManageItSupport(user) {
  return isItSupportHead(user);
}

export function canWorkOnItSupport(user) {
  return isItSupportHead(user) || isItSupportMember(user);
}

export function canManageProjects(user) {
  const roles = effectiveRoleList(user);
  const employee = getEmployeeProfile(user);

  return (
    truthyValue(employee?.is_team_leader) ||
    truthyValue(employee?.is_reporting_officer) ||
    roles.some(isProjectManagerRole)
  );
}

export function canAssignProjectMembers(user) {
  return canManageProjects(user);
}

export function canAddProjectCollaborators(user) {
  return canManageProjects(user);
}

export function canUpdateProjectProgress(user) {
  const roles = effectiveRoleList(user);

  return (
    roles.includes(BASE_EMPLOYEE_ROLE) ||
    roles.some(isCapabilityRole) ||
    hasAnyRole(roles, HR_ROLES)
  );
}

export function canViewProjectTeamTree(user) {
  const roles = effectiveRoleList(user);

  return (
    roles.includes(BASE_EMPLOYEE_ROLE) ||
    roles.some(isCapabilityRole) ||
    hasAnyRole(roles, ADMIN_HR_FINANCE_ROLES)
  );
}

export function canManageLeaveBalances(user) {
  const roles = effectiveRoleList(user);
  return hasAnyRole(roles, LEAVE_BALANCE_MANAGER_ROLES);
}

export function canApproveTeamRequests(user) {
  const roles = effectiveRoleList(user);
  const employee = getEmployeeProfile(user);

  return (
    hasAnyRole(roles, HR_ROLES) ||
    truthyValue(employee?.is_team_leader) ||
    truthyValue(employee?.is_reporting_officer) ||
    roles.some(isTeamApprovalRole)
  );
}

export function canSubmitPerformanceReview(user) {
  const roles = effectiveRoleList(user);
  const employee = getEmployeeProfile(user);

  return (
    truthyValue(employee?.is_team_leader) ||
    truthyValue(employee?.is_reporting_officer) ||
    roles.includes('team_leader') ||
    roles.includes('reporting_officer') ||
    roles.includes('ro')
  );
}

export function getEmployeeCapabilities(user) {
  const roles = effectiveRoleList(user);
  const employee = getEmployeeProfile(user);

  const isTeamLeader =
    truthyValue(employee?.is_team_leader) ||
    roles.includes('team_leader');

  const isReportingOfficer =
    truthyValue(employee?.is_reporting_officer) ||
    roles.includes('reporting_officer') ||
    roles.includes('ro');

  const isHrAdmin = hasAnyRole(roles, HR_ROLES);
  const itSupportHead = isItSupportHead(user);
  const itSupportMember = isItSupportMember(user);

  return {
    isEmployee: isEmployeePortalUser(user),
    isTeamLeader,
    isReportingOfficer,
    isHrAdmin,
    isItSupportHead: itSupportHead,
    isItSupportMember: itSupportMember,
    canApproveTeamRequests: isHrAdmin || isTeamLeader || isReportingOfficer,
    canManageProjects: isTeamLeader || isReportingOfficer,
    canAssignProjectMembers: isTeamLeader || isReportingOfficer,
    canAddProjectCollaborators: isTeamLeader || isReportingOfficer,
    canUpdateProjectProgress: true,
    canViewProjectTeamTree: true,
    canManageLeaveBalances: hasAnyRole(roles, LEAVE_BALANCE_MANAGER_ROLES),
    canSubmitPerformanceReview: canSubmitPerformanceReview(user),
    canManageItSupport: canManageItSupport(user),
    canWorkOnItSupport: canWorkOnItSupport(user),
    displayRole: 'Employee',
  };
}

export function getDisplayRole(user) {
  const roles = effectiveRoleList(user);

  if (roles.includes('super_admin')) return 'Super Admin';
  if (roles.includes('admin')) return 'Admin';
  if (roles.includes('hr_admin')) return 'HR Admin';
  if (roles.includes('hr_manager')) return 'HR Manager';
  if (roles.includes('hr')) return 'HR';
  if (roles.includes('finance') || roles.includes('accounts_finance')) return 'Finance';

  return 'Employee';
}

export function getCapabilityDisplayText(user) {
  const capabilities = getEmployeeCapabilities(user);
  const labels = [];

  if (capabilities.isTeamLeader) {
    labels.push('Team Leader');
  }

  if (capabilities.isReportingOfficer) {
    labels.push('Reporting Officer');
  }

  if (capabilities.isItSupportHead) {
    labels.push('IT Support Head');
  } else if (capabilities.isItSupportMember) {
    labels.push('IT Support Member');
  }

  if (capabilities.isHrAdmin) {
    labels.push('HR Approval Records');
  }

  return labels.join(' + ');
}

export function moduleList(user) {
  const roles = effectiveRoleList(user);

  if (roles.includes('super_admin')) {
    return allModules;
  }

  return allModules.filter((module) => hasAnyRole(roles, module[4] || []));
}

export function canAccessModule(user, moduleKey) {
  const roles = effectiveRoleList(user);

  if (roles.includes('super_admin')) {
    return true;
  }

  const normalizedModuleKey = String(moduleKey || '')
    .trim()
    .replaceAll('-', '_');

  const module = allModules.find((item) => item[0] === normalizedModuleKey);

  if (!module) {
    return false;
  }

  return hasAnyRole(roles, module[4] || []);
}

export const templates = {
  employees: {
    name: '',
    email: '',

    avatar: '',
    profile_photo: '',
    profile_picture: '',
    photo: '',

    phone: '',
    country: 'India',
    joining_date: '',
    date_of_birth: '',
    blood_group: '',
    gross_salary: '',
    branch: 'Assam(HO)',
    state: 'Assam(HO)',
    aadhar_no: '',
    employee_uan_no: '',
    employee_type: '',
    skill_level: '',
    are_parents_senior_citizen: 'false',
    number_of_children: '',
    payment_mode: 'Bank Transfer',
    previous_designation: '',
    previous_employment_tenure_end_date: '',
    password: '12345678',
    password_mode: 'default',

    role: 'Employee',

    designation: 'Employee',
    department: 'HR & Admin',
    shift: 'General',
    gender: 'Male',
    address: '',
    religion: '',
    marital_status: '',
    speak_language: '',
    pan_no: '',
    disability_level: 'No Disability',
    employee_esic_ip: '',
    employment_status: 'Active',
    father_name: '',
    dependent_disability_level: 'No Disability',
    children_in_hostel: '',
    previous_employer_name: '',
    previous_employment_tenure_from_date: '',
    employee_id: '',
    emp_code: '',
    job_type: 'Regular',
    project: '',
    salary: 0,
    status: 'Active',

    is_team_leader: 'false',
    is_reporting_officer: 'false',
    is_it_support_head: 'false',
    is_it_support_member: 'false',

    team_leader_id: '',
    team_leader_name: '',
    reporting_officer_id: '',
    reporting_officer_name: '',
  },

  departments: {
    name: '',
    status: 'active',
  },

  designations: {
    title: '',
    status: 'active',
  },

  projects: {
    tenant_id: 'sds',
    name: '',
    project_name: '',
    title: '',
    description: '',
    department: '',
    status: 'active',
    priority: 'medium',

    reporting_officer_id: '',
    reporting_officer_name: '',
    reporting_officer: {},

    team_leader_id: '',
    team_leader_name: '',
    team_leader: {},

    assigned_to_id: '',
    assigned_to_name: '',
    assigned_employee_ids: [],
    assigned_members: [],

    collaborator_ids: [],
    collaborators: [],

    doing_people: [],
    doing_people_names: [],
    doing_person_name: '',

    project_team_tree: {
      reporting_officer: {},
      team_leader: {},
      assigned_members: [],
      collaborators: [],
      doing_people: [],
      latest_progress_person: {},
      all_people: [],
      tree_levels: [],
      connection_label: 'Reporting Officer → Team Leader → Team Members → Collaborators',
    },

    latest_progress: 0,
    latest_progress_note: '',
    latest_progress_date: '',
    latest_progress_by: '',
    latest_progress_by_name: '',
    latest_progress_person: {},

    can_create_projects: false,
    can_assign_projects: false,
    can_add_collaborators: false,
    can_create_assign_collaborate: false,
    can_update_status_progress: false,
    can_view_project_team_tree: true,

    start_date: '',
    due_date: '',
    completed_at: '',
  },

  team_approvals: {
    request_type: 'leave_request',
    employee_id: '',
    employee_name: '',
    employee_code: '',
    department: '',
    designation: '',
    leave_type: 'CL',
    leave_type_label: 'Casual Leave',
    from_date: '',
    to_date: '',
    upto_date: '',
    leave_days: 1,
    reason: '',
    task_handover_to_id: '',
    task_handover_to_name: '',
    project_handover_id: '',
    project_handover_name: '',
    status: 'pending',
    approval_stage: '',
    approval_stage_label: '',
    live_status: '',
    status_text: '',
    status_display: '',
    approval_history: [],
    approved_by_team_leader: false,
    approved_by_team_leader_id: '',
    approved_by_team_leader_name: '',
    approved_by_team_leader_at: '',
    approved_by_reporting_officer: false,
    approved_by_reporting_officer_id: '',
    approved_by_reporting_officer_name: '',
    approved_by_reporting_officer_at: '',
    rejected_by_id: '',
    rejected_by_name: '',
    rejected_by_role: '',
    rejected_at: '',
    decision_note: '',
    hr_notified: false,
    hr_notified_at: '',
    hr_notified_status: '',
    hr_record_notification_sent: false,
  },

  grievances: {
    ticket_no: '',
    grievance_type: 'workplace_issue',
    grievance_type_label: 'Workplace Issue',
    priority: 'medium',
    priority_label: 'Medium',
    subject: '',
    description: '',
    is_anonymous: false,
    status: 'pending',
    status_label: 'Pending',
    hr_remarks: '',
    resolution_note: '',
    employee_id: '',
    employee_user_id: '',
    employee_name: '',
    employee_code: '',
    employee_snapshot: {},
    history: [],
  },

  it_support: {
    ticket_no: '',
    issue_category: 'login_password',
    issue_category_label: 'Login / Password Issue',
    priority: 'medium',
    priority_label: 'Medium',
    subject: '',
    description: '',
    status: 'open',
    status_label: 'Open',
    created_by_employee_id: '',
    created_by_user_id: '',
    raised_by_employee_id: '',
    raised_by_user_id: '',
    raised_by_name: '',
    raised_by_code: '',
    employee_snapshot: {},
    assigned_to_employee_id: '',
    assigned_to_user_id: '',
    assigned_to_name: '',
    assigned_to_code: '',
    assigned_to_designation: '',
    assignment_label: 'Not assigned yet',
    assignment_status: 'empty_slot',
    assigned_by_employee_id: '',
    assigned_by_user_id: '',
    assigned_by_name: '',
    assigned_at: '',
    last_status_note: '',
    resolution_note: '',
    resolved_at: '',
    closed_at: '',
    review: null,
    review_rating: 0,
    review_comment: '',
    reviewed_at: '',

    is_escalated: false,
    escalated_to: '',
    escalated_by_employee_id: '',
    escalated_by_user_id: '',
    escalated_by_name: '',
    escalated_at: '',
    escalation_type: '',
    escalation_type_label: '',
    escalation_reason: '',
    superadmin_status_note: '',

    history: [],
  },

  states: {
    tenant_id: 'sds',
    name: '',
    status: 'active',
  },

  leave_types: {
    tenant_id: 'sds',
    name: '',
    code: '',
    days_per_year: 0,
    carry_forward: false,
    status: 'active',
  },

  leave_balances: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',

    cl_opening_balance: 0,
    cl_credited: 0,
    cl_used: 0,
    cl_available: 0,

    el_opening_balance: 0,
    el_credited: 0,
    el_used: 0,
    el_available: 0,

    status: 'active',
  },

  leave_requests: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    team_leader_id: '',
    team_leader_name: '',
    reporting_officer_id: '',
    reporting_officer_name: '',
    leave_type: 'CL',
    leave_type_label: 'Casual Leave',
    from_date: '',
    to_date: '',
    upto_date: '',
    leave_days: 1,
    reason: '',
    task_handover_to_id: '',
    task_handover_to_name: '',
    task_handover_employee_id: '',
    project_handover_id: '',
    project_handover_name: '',
    status: 'pending',
    live_status: '',
    status_text: '',
    status_display: '',
    approval_stage: '',
    approval_stage_label: '',
    approval_history: [],
    approved_by_team_leader: false,
    approved_by_team_leader_id: '',
    approved_by_team_leader_name: '',
    approved_by_team_leader_at: '',
    approved_by_reporting_officer: false,
    approved_by_reporting_officer_id: '',
    approved_by_reporting_officer_name: '',
    approved_by_reporting_officer_at: '',
    hr_notified: false,
    hr_notified_at: '',
    hr_notified_status: '',
    hr_record_notification_sent: false,
    balance_deducted: false,
  },

  holiday_calendar: {
    state: 'Assam(HO)',
    date: '',
    title: '',
    message: '',
    status: 'active',
  },

  attendance_logs: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    state: 'Assam(HO)',
    date: '',
    mode: 'office',
    status: '',
    check_in: '',
    check_out: '',
    late_reason: '',
    early_checkout_reason: '',
    field_location: '',
    holiday_title: '',
    holiday_message: '',
    is_late: false,
    is_early_checkout: false,
    is_holiday_work: false,
    verified_by_ro: false,
  },

  attendance_mode_requests: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    team_leader_id: '',
    team_leader_name: '',
    reporting_officer_id: '',
    reporting_officer_name: '',
    mode: 'wfh',
    date: '',
    reason: '',
    field_location: '',
    status: 'pending',
    decision_note: '',
  },

  compoff_credits: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    earned_date: '',
    valid_until: '',
    claimed_date: '',
    leave_days: 1,
    holiday_title: '',
    holiday_message: '',
    status: 'available',
  },

  payroll_runs: {
    tenant_id: 'sds',
    month: '',
    status: 'draft',
  },

  payslips: {
    employee_id: '',
    employee_name: '',
    month: '',
    gross: 0,
    deductions: 0,
    net_pay: 0,
    status: 'generated',
  },

  job_openings: {
    tenant_id: 'sds',
    title: '',
    department: '',
    description: '',
    status: 'open',
  },

  candidates: {
    tenant_id: 'sds',
    name: '',
    email: '',
    phone: '',
    status: 'new',
  },

  trainings: {
    tenant_id: 'sds',
    name: '',
    venue: '',
    trainer: '',
    duration: '',
    status: 'scheduled',
  },

  performance_reviews: {
    employee_id: '',
    target_employee_id: '',
    employee_name: '',
    target_employee_name: '',
    employee_code: '',
    employee_user_id: '',
    department: '',
    designation: '',

    team_leader_id: '',
    team_leader_name: '',
    reporting_officer_id: '',
    reporting_officer_name: '',

    period_type: 'weekly',
    review_frequency: 'weekly',
    cycle: '',
    review_date: '',
    week_start: '',
    week_end: '',
    week_key: '',
    week_label: '',
    month: '',
    month_key: '',
    month_label: '',
    year: '',
    year_key: '',

    rating: 0,
    rating_value: 0,
    rating_percent: 0,
    rating_percentage: 0,
    rating_bucket: '',
    rating_label: '',
    score: 0,
    performance_score: 0,
    score_label: '',

    comments: '',
    remarks: '',
    strengths: '',
    improvement_areas: '',

    reviewer_id: '',
    reviewer_employee_id: '',
    reviewer_employee_code: '',
    reviewer_name: '',
    reviewer_employee_name: '',
    reviewer_role: '',

    review_target_type: '',
    review_scope_label: '',
    reviewed_employee_is_team_leader: false,
    reviewed_employee_is_reporting_officer: false,

    graph_group: '',
    graph_label: '',
    graph_value: 0,

    visibility: [],
    status: 'submitted',
  },

  expenses: {
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    type: 'Local Conveyance',
    amount: 0,
    description: '',
    status: 'pending',
  },

  assets: {
    tenant_id: 'sds',
    name: '',
    type: '',
    serial_no: '',
    status: 'available',
    assigned_to: '',
  },

  notifications: {
    user_id: '',
    title: '',
    body: '',
    read: false,
    status: 'unread',
    target: '',
    meta: {},
  },

  policies: {
    tenant_id: 'sds',
    title: '',
    category: '',
    summary: '',
    status: 'published',
  },

  documents: {
    tenant_id: 'sds',
    title: '',
    doc_type: '',
    description: '',
    status: 'active',
  },

  system_settings: {
    tenant_id: 'sds',
    setting_group: '',
    setting_key: '',
    setting_value: '',
  },
};

export const emptyCompany = {
  tenant_id: '',
  name: '',
  domain: '',
  contact_email: '',
  contact_phone: '',
  address: '',
  plan: 'Trial',
  admin_name: '',
  admin_email: '',
  admin_password: 'Admin@123',
};

export const emptyUser = {
  tenant_id: 'sds',
  name: '',
  email: '',
  password: 'User@123',

  avatar: '',
  profile_photo: '',
  profile_picture: '',
  photo: '',

  // Keep created staff as employee. Do not create a separate Team Leader login.
  roles: BASE_EMPLOYEE_ROLE,

  emp_code: '',
  department: 'HR & Admin',
  designation: 'Employee',
  job_type: 'Regular',
  project: '',
  state: 'Assam(HO)',
  branch: 'Assam(HO)',
  status: 'Active',
  salary: 0,
  is_active: true,

  is_team_leader: 'false',
  is_reporting_officer: 'false',
  is_it_support_head: 'false',
  is_it_support_member: 'false',

  team_leader_id: '',
  team_leader_name: '',
  reporting_officer_id: '',
  reporting_officer_name: '',
};