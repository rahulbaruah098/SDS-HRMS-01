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

  Important hierarchy rule:
  - Team Leader dropdown can show all employees.
  - Reporting Officer dropdown is filtered in ModuleCrud.jsx/UserControl.jsx.
  - Only employees with designation "Managing Director" or "Manager"
    can appear as Reporting Officer.
*/

const ALL_COMMON_ROLES = [
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

const HR_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
];

const TEAM_ROLES = [
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

const FINANCE_ROLES = [
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
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
    'Office/field check-in, late reason and reports.',
    [
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
    ],
  ],
  [
    'leave_requests',
    'Leave Management',
    CalendarDays,
    'Leave application and approvals.',
    TEAM_ROLES,
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

export function hasAnyRole(userRoles = [], allowedRoles = []) {
  return allowedRoles.some((role) => userRoles.includes(role));
}

export function moduleList(user) {
  const roles = user?.roles || [];

  if (roles.includes('super_admin')) {
    return allModules;
  }

  return allModules.filter((module) => hasAnyRole(roles, module[4] || []));
}

export function canAccessModule(user, moduleKey) {
  const roles = user?.roles || [];

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
    country: 'Bangladesh',
    joining_date: '',
    date_of_birth: '',
    blood_group: '',
    gross_salary: '',
    branch: 'Assam/Guwahati (HO)',
    aadhar_no: '',
    employee_uan_no: '',
    employee_type: '',
    skill_level: '',
    are_parents_senior_citizen: 'false',
    number_of_children: '',
    payment_mode: 'Cash',
    previous_designation: 'Manager',
    previous_employment_tenure_end_date: '',
    password: '12345678',
    password_mode: 'default',
    role: 'Admin',
    designation: 'Manager',
    department: 'Human Resource',
    shift: 'General',
    gender: 'Male',
    address: '',
    religion: '',
    marital_status: '',
    speak_language: '',
    pan_no: '',
    disability_level: 'No Disability',
    employee_esic_ip: '',
    employment_status: '',
    father_name: '',
    dependent_disability_level: 'No Disability',
    children_in_hostel: '',
    previous_employer_name: '',
    previous_employment_tenure_from_date: '',
    employee_id: '',

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
    status: 'active',
  },

  leave_requests: {
    employee_id: '',
    employee_name: '',
    leave_type: 'Casual Leave',
    from_date: '',
    to_date: '',
    reason: '',
    status: 'pending',
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
  department: '',
  designation: '',
  job_type: 'Regular',
  project: '',
  state: 'Assam',
  status: 'Active',
  salary: 0,
  is_active: true,

  is_team_leader: 'false',
  is_reporting_officer: 'false',

  team_leader_id: '',
  reporting_officer_id: '',
};