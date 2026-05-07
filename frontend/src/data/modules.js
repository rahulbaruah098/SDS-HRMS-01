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
} from 'lucide-react';

/*
  Module format:
  [key, title, Icon, description, allowedRoles]

  Attendance + Leave rules:
  - Attendance main page handles Office/WFH/Field check-in, holiday calendar,
    WFH/Field approval requests and comp-off tracking.
  - Leave Management handles CL, EL and COMP-OFF requests.
  - Leave Balances are managed by HR/Admin.
  - Holiday Calendar is managed by HR/Admin.
  - Attendance Logs and Comp-Off Credits are system generated/view-only.
  - Reports page shows attendance, holiday, comp-off, leave and audit reports.
*/

export const ALL_COMMON_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export const HR_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
];

export const TEAM_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export const FINANCE_ROLES = [
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
];

export const ATTENDANCE_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export const ATTENDANCE_MANAGER_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const REPORT_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
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
    'Create users, reset passwords, update roles and full employee profiles.',
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
    'Employee database, designation, team leader and reporting officer mapping.',
    HR_ROLES,
  ],
  [
    'attendance',
    'Attendance',
    Clock,
    'Press-and-hold Office/WFH/Field check-in, geolocation, late reason, early checkout, holiday calendar and comp-off.',
    ATTENDANCE_ROLES,
  ],
  [
    'leave_requests',
    'Leave Management',
    CalendarDays,
    'Apply CL, EL and COMP-OFF with Team Leader, Reporting Officer and HR approval stages.',
    TEAM_ROLES,
  ],
  [
    'leave_balances',
    'Leave Balances',
    CalendarDays,
    'HR/Admin can assign and update employee CL and EL balances.',
    TEAM_ROLES,
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
    'Attendance, WFH/Field, holiday, comp-off, leave and audit reports.',
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
    [...FINANCE_ROLES, 'employee'],
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
    'KPI and appraisal records.',
    TEAM_ROLES,
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
      'manager',
      'ro',
      'team_leader',
      'reporting_officer',
      'employee',
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
    'tickets',
    'Grievance / Tickets',
    MessageSquare,
    'Helpdesk and grievance.',
    TEAM_ROLES,
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
    'Policy register.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'employee'],
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
    'projects',
    'Projects',
    Settings,
    'Project master.',
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
    'View profile and request password change.',
    ALL_COMMON_ROLES,
  ],
];

export const allModules = [...superModules, ...coreModules];

export function normalizeRoleList(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((role) => String(role || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  return [];
}

export function hasAnyRole(userRoles = [], allowedRoles = []) {
  const normalizedUserRoles = normalizeRoleList(userRoles);
  return allowedRoles.some((role) => normalizedUserRoles.includes(role));
}

export function moduleList(user) {
  const roles = normalizeRoleList(user?.roles || []);

  if (roles.includes('super_admin')) {
    return allModules;
  }

  return allModules.filter((module) => hasAnyRole(roles, module[4] || []));
}

export function canAccessModule(user, moduleKey) {
  const roles = normalizeRoleList(user?.roles || []);

  if (roles.includes('super_admin')) {
    return true;
  }

  const module = allModules.find((item) => item[0] === moduleKey);

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
    previous_designation: 'Manager',
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
    status: 'active',
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
    leave_type: 'CL',
    opening_balance: 0,
    credited: 0,
    used: 0,
    available: 0,
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
    from_date: '',
    to_date: '',
    leave_days: 1,
    reason: '',
    status: 'pending',
    approval_stage: 'team_leader',
    approval_stage_label: 'Team Leader',
    approval_history: [],
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
    employee_name: '',
    department: '',
    designation: '',
    cycle: '',
    rating: 0,
    comments: '',
    reviewer_name: '',
    reviewer_role: '',
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

  tickets: {
    title: '',
    category: 'HR',
    description: '',
    priority: 'medium',
    status: 'open',
  },

  notifications: {
    user_id: '',
    title: '',
    body: '',
    read: false,
    status: 'unread',
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
  roles: 'employee',
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

  team_leader_id: '',
  reporting_officer_id: '',
};