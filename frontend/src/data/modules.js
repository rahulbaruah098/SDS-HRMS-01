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

  Roles:
  super_admin = sees everything
  admin = company admin modules
  hr_admin / hr_manager / hr = HR modules
  finance / accounts_finance = finance modules
  manager / ro = team modules
  employee = employee self-service modules
*/

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
    'Employee database and lifecycle records.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'attendance',
    'Attendance',
    Clock,
    'Office/field check-in, late reason and reports.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'employee'],
  ],
  [
    'leave_requests',
    'Leave Management',
    CalendarDays,
    'Leave application and approvals.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'manager', 'ro', 'employee'],
  ],
  [
    'payroll_runs',
    'Payroll Runs',
    Wallet,
    'Payroll processing and control.',
    ['super_admin', 'admin', 'finance', 'accounts_finance'],
  ],
  [
    'payslips',
    'Payslips',
    FileText,
    'Generated employee payslips.',
    ['super_admin', 'admin', 'finance', 'accounts_finance', 'employee'],
  ],
  [
    'job_openings',
    'Recruitment Jobs',
    Briefcase,
    'Job openings and pipeline.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'candidates',
    'Candidates',
    Users,
    'Candidate screening and status.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'trainings',
    'Training',
    GraduationCap,
    'Training plan and feedback.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'manager', 'ro', 'employee'],
  ],
  [
    'performance_reviews',
    'Performance',
    BarChart3,
    'KPI and appraisal records.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'manager', 'ro', 'team_leader', 'reporting_officer', 'employee']
  ],
  [
    'expenses',
    'Expenses',
    Receipt,
    'Claims and approvals.',
    ['super_admin', 'admin', 'finance', 'accounts_finance', 'manager', 'ro', 'employee'],
  ],
  [
    'assets',
    'Assets',
    Laptop,
    'Inventory and allocation.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'tickets',
    'Grievance / Tickets',
    MessageSquare,
    'Helpdesk and grievance.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'manager', 'ro', 'employee'],
  ],
  [
    'notifications',
    'Notifications',
    Bell,
    'Alerts and notification center.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr', 'finance', 'accounts_finance', 'manager', 'ro', 'employee'],
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
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'designations',
    'Designations',
    Settings,
    'Designation master.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'projects',
    'Projects',
    Settings,
    'Project master.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
  ],
  [
    'states',
    'States',
    Settings,
    'Operating states.',
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'],
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
    [
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
    ],
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
  tenant_id: 'sds',
  emp_code: '',
  name: '',
  email: '',
  password: '',
  department: '',
  designation: '',
  job_type: 'Regular',
  project: '',
  state: '',
  status: 'Active',
  salary: 30000,

  // Team hierarchy fields
  is_team_leader: 'false',
  is_reporting_officer: 'false',
  team_leader_id: '',
  team_leader_name: '',
  reporting_officer_id: '',
  reporting_officer_name: '',
},
  departments: {
    tenant_id: 'sds',
    name: '',
    status: 'active',
  },
  designations: {
    tenant_id: 'sds',
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
  employee_status: 'Active',
  salary: 0,
  is_active: true,
};