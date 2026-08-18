import React, { useEffect, useMemo, useState } from 'react';
import { currentUser, getTodayCelebrations } from './api/client';
import {
  canAccessModule,
  hasFullSaasAccess,
  isExpiredOrSuspendedTenant,
  isSdsLifetimeTenant,
} from './data/modules';

import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import AccountAccessHelp from './pages/AccountAccessHelp.jsx';
import AccountAccessTracking from './pages/AccountAccessTracking.jsx';
// Page file name remains ApplyDemoRegistration for compatibility, but UI copy now says Trial Registration.
import ApplyDemoRegistration from './pages/ApplyDemoRegistration.jsx';
import CareerPortal from './pages/CareerPortal.jsx';
import Billing from './pages/Billing.jsx';
import SubscriptionExpired from './pages/SubscriptionExpired.jsx';
import DemoRequests from './pages/DemoRequests.jsx';
import Subscriptions from './pages/Subscriptions.jsx';
import PremiumRequests from './pages/PremiumRequests.jsx';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import Attendance from './pages/Attendance';
import AttendanceLogs from './pages/AttendanceLogs.jsx';
import MyVisits from './pages/MyVisits.jsx';
import Companies from './pages/Companies';
import UserControl from './pages/UserControl';
import ModuleCrud from './pages/ModuleCrud';
import HolidayCalendar from './pages/HolidayCalendar';
import Employees from './pages/Employees';
import EmployeeDirectory from './pages/EmployeeDirectory';
import Assets from './pages/Assets.jsx';
import Departments from './pages/Departments';
import Designations from './pages/Designations';
import States from './pages/States';
import Profile from './pages/Profile';
import Settings from './pages/Settings.jsx';
import Reports from './pages/Reports';
import AuditLogs from './pages/AuditLogs.jsx';
import Payroll from './pages/Payroll.jsx';
import PayrollConfiguration from './pages/PayrollConfiguration.jsx';
import LoansAdvances from './pages/LoansAdvances.jsx';
import Reimbursements from './pages/Reimbursements.jsx';
import PayrollBanking from './pages/PayrollBanking.jsx';
import PayrollReports from './pages/PayrollReports.jsx';
import TaxDeclarations from './pages/TaxDeclarations.jsx';
import Payslips from './pages/Payslips.jsx';
import Leave from './pages/Leave';
import ApplyLeave from './pages/ApplyLeave';
import LeaveBalances from './pages/LeaveBalances.jsx';
import CompOffCredits from './pages/CompOffCredits.jsx';
import Projects from './pages/Projects';
import Policies from './pages/Policies.jsx';
import Notifications from './pages/Notifications';
import ApplicationStatus from './pages/ApplicationStatus';
import TeamApprovals from './pages/TeamApprovals';
import Performance from './pages/Performance';
import Recruitment from './pages/Recruitment.jsx';
import Grievance from './pages/Grievance';
import ITSupport from './pages/ITSupport';
import ManagementGroup from './pages/ManagementGroup';
import CelebrationPopup from './components/CelebrationPopup.jsx';
import AiAssistantWidget from "./components/AiAssistantWidget";
import CustomAlertProvider from './components/CustomAlertProvider.jsx';
import HolidayWorkRequests from './pages/HolidayWorkRequests';
import SuperAdminAttendanceCorrection from './pages/SuperAdminAttendanceCorrection';

import './styles.css';

const ADMIN_DASHBOARD_ROLES = [
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
];

const EMPLOYEE_CAPABILITY_ROLES = [
  'employee',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

const PAYROLL_CONFIG_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
];

const PAYROLL_LOAN_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAYROLL_REIMBURSEMENT_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAYROLL_BANKING_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAYROLL_REPORT_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAYROLL_TAX_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAYSLIP_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'employee',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
];

const PAGE_ALIASES = {
  home: 'dashboard',
  dashboard_home: 'dashboard',

  billing: 'billing',
  upgrade: 'billing',
  subscription: 'billing',
  subscribe: 'billing',
  payment: 'billing',
  razorpay: 'billing',
  'billing-page': 'billing',
  'upgrade-page': 'billing',
  'subscription-page': 'billing',

  subscription_expired: 'subscription_expired',
  trial_expired: 'subscription_expired',
  demo_expired: 'subscription_expired',
  expired_subscription: 'subscription_expired',
  expired_demo: 'subscription_expired',

  'subscription-expired': 'subscription_expired',
  'trial-expired': 'subscription_expired',
  'demo-expired': 'subscription_expired',
  'expired-subscription': 'subscription_expired',
  'expired-demo': 'subscription_expired',

  trial_request: 'demo_requests',
  trial_requests: 'demo_requests',
  trial_application: 'demo_requests',
  trial_applications: 'demo_requests',
  saas_trial_request: 'demo_requests',
  saas_trial_requests: 'demo_requests',
  company_trial_requests: 'demo_requests',
  company_trial_applications: 'demo_requests',

  'trial-request': 'demo_requests',
  'trial-requests': 'demo_requests',
  'trial-application': 'demo_requests',
  'trial-applications': 'demo_requests',
  'saas-trial-request': 'demo_requests',
  'saas-trial-requests': 'demo_requests',
  'company-trial-requests': 'demo_requests',
  'company-trial-applications': 'demo_requests',

  // Backward-compatible old demo aliases.
  demo_request: 'demo_requests',
  demo_requests: 'demo_requests',
  demo_application: 'demo_requests',
  demo_applications: 'demo_requests',
  saas_demo_request: 'demo_requests',
  saas_demo_requests: 'demo_requests',
  company_demo_requests: 'demo_requests',
  company_demo_applications: 'demo_requests',

  'demo-request': 'demo_requests',
  'demo-requests': 'demo_requests',
  'demo-application': 'demo_requests',
  'demo-applications': 'demo_requests',
  'saas-demo-request': 'demo_requests',
  'saas-demo-requests': 'demo_requests',
  'company-demo-requests': 'demo_requests',
  'company-demo-applications': 'demo_requests',

  subscriptions: 'subscriptions',
  subscription_management: 'subscriptions',
  saas_subscriptions: 'subscriptions',
  billing_management: 'subscriptions',
  payment_management: 'subscriptions',
  payments: 'subscriptions',
  razorpay_orders: 'subscriptions',
  pricing: 'subscriptions',
  pricing_plans: 'subscriptions',
  dynamic_pricing: 'subscriptions',
  saas_pricing: 'subscriptions',

  'subscription-management': 'subscriptions',
  'saas-subscriptions': 'subscriptions',
  'billing-management': 'subscriptions',
  'payment-management': 'subscriptions',
  'razorpay-orders': 'subscriptions',
  'pricing-plans': 'subscriptions',
  'dynamic-pricing': 'subscriptions',
  'saas-pricing': 'subscriptions',

  premium_requests: 'premium_requests',
  premium_request: 'premium_requests',
  premium_plan_requests: 'premium_requests',
  premium_plan_request: 'premium_requests',
  custom_plan_requests: 'premium_requests',
  custom_premium_requests: 'premium_requests',
  sales_requests: 'premium_requests',
  sales_request: 'premium_requests',

  'premium-requests': 'premium_requests',
  'premium-request': 'premium_requests',
  'premium-plan-requests': 'premium_requests',
  'premium-plan-request': 'premium_requests',
  'custom-plan-requests': 'premium_requests',
  'custom-premium-requests': 'premium_requests',
  'sales-requests': 'premium_requests',
  'sales-request': 'premium_requests',

  employee: 'employees',
  employees: 'employees',
  employee_master: 'employees',
  employee_management: 'employees',
  staff_master: 'employees',
  staff_management: 'employees',

  employee_directory: 'employee_directory',
  employee_contact_directory: 'employee_directory',
  employee_contacts: 'employee_directory',
  staff_directory: 'employee_directory',
  staff_contacts: 'employee_directory',
  directory: 'employee_directory',

  department: 'departments',
  departments: 'departments',
  department_master: 'departments',
  designation: 'designations',
  designations: 'designations',
  designation_master: 'designations',
  state: 'states',
  states: 'states',
  state_master: 'states',

  user: 'users',
  users: 'users',
  user_control: 'users',
  user_management: 'users',
  superadmin_user_control: 'users',
  super_admin_user_control: 'users',
  tenant_user_control: 'users',
  tenant_users: 'users',
  tenant_employee_control: 'users',
  tenant_employees: 'users',

  leave: 'leave',
  leave_management: 'leave',

  apply_leave: 'leave_requests',
  leave_apply: 'leave_requests',
  leave_request: 'leave_requests',
  leave_requests: 'leave_requests',
  my_leave: 'leave_requests',
  my_leaves: 'leave_requests',

  leave_deductions: 'reports',
  leave_records: 'reports',

  holiday_work_requests: 'holiday_work_requests',
  holiday_work_request: 'holiday_work_requests',
  holiday_work: 'holiday_work_requests',
  holiday_work_approval: 'holiday_work_requests',
  holiday_work_approvals: 'holiday_work_requests',
  holiday_work_request_approval: 'holiday_work_requests',
  holiday_work_request_approvals: 'holiday_work_requests',
  'holiday-work-requests': 'holiday_work_requests',
  'holiday-work-request': 'holiday_work_requests',
  'holiday-work': 'holiday_work_requests',
  'holiday-work-approval': 'holiday_work_requests',
  'holiday-work-approvals': 'holiday_work_requests',

  leave_approval: 'team_approvals',
  leave_approvals: 'team_approvals',
  team_approval: 'team_approvals',
  team_approvals: 'team_approvals',
  team_leave_approval: 'team_approvals',
  team_leave_approvals: 'team_approvals',
  leave_approval_inbox: 'team_approvals',
  approval_inbox: 'team_approvals',
  pending_approvals: 'team_approvals',
  pending_leave_approvals: 'team_approvals',
  tl_approvals: 'team_approvals',
  team_leader_approvals: 'team_approvals',
  ro_approvals: 'team_approvals',
  reporting_officer_approvals: 'team_approvals',
  manager_approvals: 'team_approvals',

  'team-approvals': 'team_approvals',
  'team-approval': 'team_approvals',
  'leave-approval': 'team_approvals',
  'leave-approvals': 'team_approvals',
  'approval-inbox': 'team_approvals',
  'pending-approvals': 'team_approvals',
  'pending-leave-approvals': 'team_approvals',

  leave_balance: 'leave_balances',
  leave_balances: 'leave_balances',

  attendance_mode_request: 'attendance_mode_requests',
  attendance_mode_requests: 'attendance_mode_requests',
  wfh_field_requests: 'attendance_mode_requests',

  my_visit: 'my_visits',
  my_visits: 'my_visits',
  field_visit: 'my_visits',
  field_visits: 'my_visits',
  team_field_attendance: 'my_visits',

  'my-visit': 'my_visits',
  'my-visits': 'my_visits',
  'field-visit': 'my_visits',
  'field-visits': 'my_visits',
  'team-field-attendance': 'my_visits',

  application_status: 'application_status',
  application_statuses: 'application_status',
  application: 'application_status',
  application_status_page: 'application_status',
  applicationstatus: 'application_status',
  application_status_report: 'application_status',
  request_status: 'application_status',
  request_status_page: 'application_status',
  my_requests: 'application_status',
  my_request_status: 'application_status',
  my_applications: 'application_status',
  application_tracking: 'application_status',

  'application-status': 'application_status',
  'request-status': 'application_status',
  'my-requests': 'application_status',
  'my-applications': 'application_status',

  grievance: 'grievances',
  grievances: 'grievances',
  employee_grievance: 'grievances',
  employee_grievances: 'grievances',
  grievance_module: 'grievances',
  grievance_form: 'grievances',
  grievance_requests: 'grievances',
  anonymous_grievance: 'grievances',

  'employee-grievance': 'grievances',
  'employee-grievances': 'grievances',
  'grievance-module': 'grievances',
  'grievance-form': 'grievances',
  'anonymous-grievance': 'grievances',

  it_support: 'it_support',
  it_supports: 'it_support',
  it_ticket: 'it_support',
  it_tickets: 'it_support',
  support: 'it_support',
  support_ticket: 'it_support',
  support_tickets: 'it_support',
  technology_support: 'it_support',
  helpdesk: 'it_support',
  help_desk: 'it_support',

  'it-support': 'it_support',
  'it-ticket': 'it_support',
  'it-tickets': 'it_support',
  'support-ticket': 'it_support',
  'support-tickets': 'it_support',
  'technology-support': 'it_support',
  'help-desk': 'it_support',

  management_group: 'management_groups',
  management_groups: 'management_groups',
  management: 'management_groups',
  management_committee: 'management_groups',
  management_meetings: 'management_groups',
  meeting_minutes: 'management_groups',
  group_meetings: 'management_groups',

  'management-group': 'management_groups',
  'management-groups': 'management_groups',
  'management-committee': 'management_groups',
  'management-meetings': 'management_groups',
  'meeting-minutes': 'management_groups',
  'group-meetings': 'management_groups',


  asset: 'assets',
  assets: 'assets',
  asset_management: 'assets',
  hardware_assets: 'assets',
  software_assets: 'assets',

  'asset-management': 'assets',
  'hardware-assets': 'assets',
  'software-assets': 'assets',

  notification: 'notifications',
  notifications: 'notifications',

  policy: 'policies',
  policies: 'policies',
  policy_module: 'policies',
  hr_policy: 'policies',
  hr_policies: 'policies',
  company_policy: 'policies',
  company_policies: 'policies',
  employee_policy: 'policies',
  employee_policies: 'policies',
  'policy-module': 'policies',
  'hr-policy': 'policies',
  'hr-policies': 'policies',
  'company-policy': 'policies',
  'company-policies': 'policies',
  'employee-policy': 'policies',
  'employee-policies': 'policies',

  project: 'projects',
  projects: 'projects',
  project_management: 'projects',
  project_progress: 'projects',
  project_analytics: 'projects',
  project_dashboard: 'projects',
  department_project_graph: 'projects',
  project_wise_graph: 'projects',
  team_project_graph: 'projects',
  project_team_tree: 'projects',
  project_tree: 'projects',
  team_tree: 'projects',
  team_hierarchy: 'projects',
  team_root_map: 'projects',
  root_map: 'projects',
  spider_map: 'projects',
  spider_tree: 'projects',
  collaborator_projects: 'projects',
  assigned_projects: 'projects',
  my_projects: 'projects',

  performance: 'performance_reviews',
  performance_review: 'performance_reviews',
  performance_reviews: 'performance_reviews',
  appraisal: 'performance_reviews',
  appraisals: 'performance_reviews',
  ratings: 'performance_reviews',
  team_performance: 'performance_reviews',
  team_leader_performance: 'performance_reviews',
  reporting_officer_performance: 'performance_reviews',

    recruitment: 'recruitment',
  recruitment_module: 'recruitment',
  talent_acquisition: 'recruitment',
  hiring: 'recruitment',

  hiring_request: 'recruitment',
  hiring_requests: 'recruitment',
  recruitment_hiring_request: 'recruitment',
  recruitment_hiring_requests: 'recruitment',

  job_opening: 'recruitment',
  job_openings: 'recruitment',
  recruitment_job: 'recruitment',
  recruitment_jobs: 'recruitment',

  candidate: 'recruitment',
  candidates: 'recruitment',
  recruitment_candidate: 'recruitment',
  recruitment_candidates: 'recruitment',

  interview: 'recruitment',
  interviews: 'recruitment',
  recruitment_interview: 'recruitment',
  recruitment_interviews: 'recruitment',

  offer: 'recruitment',
  offers: 'recruitment',
  recruitment_offer: 'recruitment',
  recruitment_offers: 'recruitment',

  joining_document: 'recruitment',
  joining_documents: 'recruitment',
  recruitment_joining: 'recruitment',
  recruitment_joining_documents: 'recruitment',

  report: 'reports',
  reports: 'reports',

  payroll_configuration: 'payroll_configuration',
  payroll_config: 'payroll_configuration',
  payroll_settings: 'payroll_configuration',
  salary_structure_management: 'payroll_configuration',
  salary_structures: 'payroll_configuration',
  statutory_configuration: 'payroll_configuration',
  statutory_config: 'payroll_configuration',

  'payroll-configuration': 'payroll_configuration',
  'payroll-config': 'payroll_configuration',
  'payroll-settings': 'payroll_configuration',
  'salary-structure-management': 'payroll_configuration',
  'salary-structures': 'payroll_configuration',
  'statutory-configuration': 'payroll_configuration',
  'statutory-config': 'payroll_configuration',

  loans_advances: 'loans_advances',
  loan_advances: 'loans_advances',
  loans: 'loans_advances',
  advances: 'loans_advances',
  payroll_loans: 'loans_advances',
  payroll_advances: 'loans_advances',

  'loans-advances': 'loans_advances',
  'loan-advances': 'loans_advances',
  'payroll-loans': 'loans_advances',
  'payroll-advances': 'loans_advances',

  reimbursements: 'reimbursements',
  reimbursement: 'reimbursements',
  claims: 'reimbursements',
  employee_claims: 'reimbursements',
  expense_claims: 'reimbursements',
  payroll_reimbursements: 'reimbursements',

  'employee-claims': 'reimbursements',
  'expense-claims': 'reimbursements',
  'payroll-reimbursements': 'reimbursements',

  payroll_banking: 'payroll_banking',
  payroll_bank: 'payroll_banking',
  bank_details: 'payroll_banking',
  employee_bank_details: 'payroll_banking',
  salary_disbursement: 'payroll_banking',
  bank_exports: 'payroll_banking',

  'payroll-banking': 'payroll_banking',
  'payroll-bank': 'payroll_banking',
  'bank-details': 'payroll_banking',
  'employee-bank-details': 'payroll_banking',
  'salary-disbursement': 'payroll_banking',
  'bank-exports': 'payroll_banking',

  payroll_reports: 'payroll_reports',
  payroll_report: 'payroll_reports',
  payroll_analytics: 'payroll_reports',
  payroll_register: 'payroll_reports',
  payroll_summary: 'payroll_reports',
  statutory_reports: 'payroll_reports',
  statutory_summary: 'payroll_reports',
  department_payroll_report: 'payroll_reports',
  employee_payroll_statement: 'payroll_reports',
  payroll_variance: 'payroll_reports',
  payroll_trend: 'payroll_reports',
  salary_reports: 'payroll_reports',

  'payroll-reports': 'payroll_reports',
  'payroll-report': 'payroll_reports',
  'payroll-analytics': 'payroll_reports',
  'payroll-register': 'payroll_reports',
  'payroll-summary': 'payroll_reports',
  'statutory-reports': 'payroll_reports',
  'statutory-summary': 'payroll_reports',
  'department-payroll-report': 'payroll_reports',
  'employee-payroll-statement': 'payroll_reports',
  'payroll-variance': 'payroll_reports',
  'payroll-trend': 'payroll_reports',
  'salary-reports': 'payroll_reports',

  tax_declarations: 'tax_declarations',
  tax_declaration: 'tax_declarations',
  employee_tax_declarations: 'tax_declarations',
  income_tax_declarations: 'tax_declarations',
  payroll_tax: 'tax_declarations',
  payroll_tax_declarations: 'tax_declarations',
  tds: 'tax_declarations',
  tds_management: 'tax_declarations',
  tds_instructions: 'tax_declarations',
  tax_proofs: 'tax_declarations',
  investment_declarations: 'tax_declarations',

  'tax-declarations': 'tax_declarations',
  'tax-declaration': 'tax_declarations',
  'employee-tax-declarations': 'tax_declarations',
  'income-tax-declarations': 'tax_declarations',
  'payroll-tax': 'tax_declarations',
  'payroll-tax-declarations': 'tax_declarations',
  'tds-management': 'tax_declarations',
  'tds-instructions': 'tax_declarations',
  'tax-proofs': 'tax_declarations',
  'investment-declarations': 'tax_declarations',

  payslips: 'payslips',
  payslip: 'payslips',
  salary_slip: 'payslips',
  salary_slips: 'payslips',
  employee_payslip: 'payslips',
  employee_payslips: 'payslips',

  'salary-slip': 'payslips',
  'salary-slips': 'payslips',
  'employee-payslip': 'payslips',
  'employee-payslips': 'payslips',

  profile: 'profile',
  my_profile: 'profile',
  profile_photo: 'profile',
  avatar: 'profile',

  superadmin_attendance_correction: 'superadmin_attendance_correction',
  super_admin_attendance_correction: 'superadmin_attendance_correction',
  private_attendance_correction: 'superadmin_attendance_correction',
  attendance_correction_private: 'superadmin_attendance_correction',
  attendance_corrections_private: 'superadmin_attendance_correction',
  attendance_editor_private: 'superadmin_attendance_correction',
  hidden_attendance_editor: 'superadmin_attendance_correction',

  'superadmin-attendance-correction': 'superadmin_attendance_correction',
  'super-admin-attendance-correction': 'superadmin_attendance_correction',
  'private-attendance-correction': 'superadmin_attendance_correction',
  'attendance-correction-private': 'superadmin_attendance_correction',
  'attendance-corrections-private': 'superadmin_attendance_correction',
  'attendance-editor-private': 'superadmin_attendance_correction',
  'hidden-attendance-editor': 'superadmin_attendance_correction',
};

function normalizeRoleValue(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user) {
  const userRoles = user?.roles;

  if (Array.isArray(userRoles)) {
    return userRoles
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  if (typeof userRoles === 'string') {
    return userRoles
      .split(',')
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  const singleRole = normalizeRoleValue(user?.role);

  return singleRole ? [singleRole] : [];
}

function normalizePageKey(page) {
  const key = String(page || 'dashboard')
    .trim()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');

  if (!key) {
    return 'dashboard';
  }

  return PAGE_ALIASES[key] || PAGE_ALIASES[key.toLowerCase()] || key;
}

function moduleAccessKey(page) {
  const normalizedPage = normalizePageKey(page);

  // Existing tenant permissions store this module under the legacy key.
  // The visible page and route use "my_visits".
  if (normalizedPage === 'my_visits') {
    return 'team_field_attendance';
  }

  return normalizedPage;
}

function hasAnyRole(userRoles = [], allowedRoles = []) {
  const normalizedUserRoles = userRoles.map((role) => normalizeRoleValue(role));
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRoleValue(role));

  return normalizedAllowedRoles.some((role) => normalizedUserRoles.includes(role));
}

function profilePhotoValue(record = {}) {
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

function applyProfilePhotoAliases(payload = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(payload) || '').trim();

  if (photo) {
    payload.avatar = photo;
    payload.profile_photo = photo;
    payload.profile_picture = photo;
    payload.photo = photo;
  }

  return payload;
}

const HRMS_HOME_PATH = '/hrms';
const HRMS_LOGIN_PATH = '/login';
const HRMS_DEMO_REGISTRATION_PATH = '/apply-demo-registration';
const ACCOUNT_ACCESS_HELP_PATH = '/account-access-help';
const ACCOUNT_ACCESS_TRACKING_PATH = '/account-access-track';
const HRMS_SUBSCRIPTION_EXPIRED_PATH = '/hrms/subscription-expired';

function getBrowserPathname() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return window.location.pathname || '/';
}

function isCareerPortalPath(pathname) {
  const path = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  return (
    path === '/career' ||
    path.startsWith('/career/') ||
    path === '/careers' ||
    path.startsWith('/careers/')
  );
}

function isApplyDemoRegistrationPath(pathname) {
  const path = String(pathname || '/').trim().toLowerCase();

  return [
    '/apply-trial-registration',
    '/apply-trial-registration/',
    '/trial-registration',
    '/trial-registration/',
    '/register-trial',
    '/register-trial/',
    '/apply-demo-registration',
    '/apply-demo-registration/',
    '/demo-registration',
    '/demo-registration/',
    '/register-demo',
    '/register-demo/',
  ].includes(path);
}

function normalizePublicPath(pathname) {
  const normalized = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  return normalized || '/';
}

function isAccountAccessHelpPath(pathname) {
  return normalizePublicPath(pathname) === ACCOUNT_ACCESS_HELP_PATH;
}

function isAccountAccessTrackingPath(pathname) {
  return normalizePublicPath(pathname) === ACCOUNT_ACCESS_TRACKING_PATH;
}

function isBillingPath(pathname) {
  const path = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  return [
    '/hrms/billing',
    '/hrms/upgrade',
    '/hrms/subscription',
    '/hrms/subscribe',
    '/hrms/payment',
    '/hrms/plans',

    // Backward-compatible non-conflicting legacy URLs.
    '/billing',
    '/upgrade',
    '/subscription',
    '/subscribe',
    '/payment',
    '/plans',
  ].includes(path);
}

function isPremiumRequestsPath(pathname) {
  const path = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  return [
    '/hrms/premium-requests',
    '/hrms/premium-request',
    '/hrms/premium-plan-requests',
    '/hrms/custom-premium-requests',
    '/hrms/sales-requests',

    // Backward-compatible legacy URLs.
    '/premium-requests',
    '/premium-request',
    '/premium-plan-requests',
    '/custom-premium-requests',
    '/sales-requests',
  ].includes(path);
}

function isSubscriptionExpiredPath(pathname) {
  const path = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  return [
    '/hrms/subscription-expired',
    '/hrms/trial-expired',
    '/hrms/trial-ended',
    '/hrms/upgrade-required',
    '/hrms/demo-expired',

    // Backward-compatible legacy URLs.
    '/subscription-expired',
    '/trial-expired',
    '/trial-ended',
    '/upgrade-required',
    '/demo-expired',
  ].includes(path);
}

function readStoredEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function mergeUserWithEmployeeProfile(user = {}) {
  const storedEmployee = readStoredEmployee();
  const employee =
    user.employee ||
    user.employee_summary ||
    user.employee_profile ||
    storedEmployee ||
    {};

  const photo =
    profilePhotoValue(employee) ||
    profilePhotoValue(user);

  const mergedUser = {
    ...user,
    employee,
    employee_summary: user.employee_summary || employee,
    employee_profile: user.employee_profile || employee,
    roles: normalizeRoles(user),
  };

  applyProfilePhotoAliases(mergedUser, photo);

  if (mergedUser.employee && typeof mergedUser.employee === 'object') {
    applyProfilePhotoAliases(mergedUser.employee, photo);
  }

  if (mergedUser.employee_summary && typeof mergedUser.employee_summary === 'object') {
    applyProfilePhotoAliases(mergedUser.employee_summary, photo);
  }

  if (mergedUser.employee_profile && typeof mergedUser.employee_profile === 'object') {
    applyProfilePhotoAliases(mergedUser.employee_profile, photo);
  }

  return mergedUser;
}

function shouldUseEmployeeDashboard(userRoles = []) {
  if (userRoles.includes('super_admin')) {
    return false;
  }

  if (hasAnyRole(userRoles, ADMIN_DASHBOARD_ROLES)) {
    return false;
  }

  return hasAnyRole(userRoles, EMPLOYEE_CAPABILITY_ROLES);
}

function DashboardRouter({ user, setPage }) {
  const userRoles = normalizeRoles(user);

  if (userRoles.includes('super_admin')) {
    return <SuperAdminDashboard setPage={setPage} />;
  }

  /*
    Important:
    Team Leader / Reporting Officer are employee capabilities, not separate
    dashboard/login identities. So if a login has employee + team_leader or
    employee + reporting_officer, it must still open EmployeeDashboard.
  */
  if (shouldUseEmployeeDashboard(userRoles)) {
    return <EmployeeDashboard setPage={setPage} />;
  }

  return (
    <AdminDashboard
      user={{
        ...user,
        roles: userRoles,
      }}
      setPage={setPage}
    />
  );
}

function UnauthorizedPage({ setPage }) {
  return (
    <section className="panel">
      <h2>Access Restricted</h2>
      <p>You do not have permission to access this module.</p>
      <p>Please contact Super Admin or HR Admin if this access is required.</p>

      <button
        type="button"
        className="primary"
        onClick={() => setPage('dashboard')}
      >
        Back to Dashboard
      </button>
    </section>
  );
}

function PageRouter({ page, user, setPage }) {
  const safeUser = mergeUserWithEmployeeProfile(user || {});
  const normalizedPage = normalizePageKey(page);

  if (normalizedPage === 'dashboard') {
    return <DashboardRouter user={safeUser} setPage={setPage} />;
  }

  if (normalizedPage === 'superadmin_attendance_correction') {
    const userRoles = normalizeRoles(safeUser);

    if (!userRoles.includes('super_admin')) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return (
      <SuperAdminAttendanceCorrection
        setPage={setPage}
        user={safeUser}
      />
    );
  }

  if (normalizedPage === 'billing') {
    // SDS has lifetime access and must never see subscription/payment screens.
    if (isSdsLifetimeTenant(safeUser)) {
      return <DashboardRouter user={safeUser} setPage={setPage} />;
    }

    // Client Billing contains company-level subscription, quotation, payment,
    // and invoice information. Only the client company admin may access it.
    if (!canAccessModule(safeUser, 'billing')) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <Billing setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'subscription_expired') {
    if (!isExpiredOrSuspendedTenant(safeUser)) {
      return <DashboardRouter user={safeUser} setPage={setPage} />;
    }

    return <SubscriptionExpired setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'demo_requests') {
    const userRoles = normalizeRoles(safeUser);

    if (!userRoles.includes('super_admin')) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <DemoRequests setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'subscriptions') {
    const userRoles = normalizeRoles(safeUser);

    if (!userRoles.includes('super_admin')) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <Subscriptions setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'premium_requests') {
    const userRoles = normalizeRoles(safeUser);

    if (!userRoles.includes('super_admin')) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <PremiumRequests setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'payroll_configuration') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_CONFIG_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <PayrollConfiguration setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'loans_advances') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_LOAN_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <LoansAdvances setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'reimbursements') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_REIMBURSEMENT_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <Reimbursements setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'payroll_banking') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_BANKING_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <PayrollBanking setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'payroll_reports') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_REPORT_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <PayrollReports setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'tax_declarations') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYROLL_TAX_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <TaxDeclarations setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'payslips') {
    const userRoles = normalizeRoles(safeUser);

    if (!hasAnyRole(userRoles, PAYSLIP_ROLES)) {
      return <UnauthorizedPage setPage={setPage} />;
    }

    return <Payslips setPage={setPage} user={safeUser} />;
  }

  if (!canAccessModule(safeUser, moduleAccessKey(normalizedPage))) {
    return <UnauthorizedPage setPage={setPage} />;
  }

if (normalizedPage === 'attendance') {
  return <Attendance setPage={setPage} user={safeUser} />;
}

if (normalizedPage === 'attendance_logs') {
  return <AttendanceLogs setPage={setPage} user={safeUser} />;
}

if (normalizedPage === 'my_visits') {
  return <MyVisits setPage={setPage} user={safeUser} />;
}

if (normalizedPage === 'companies') {
    return <Companies setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'users') {
    return <UserControl setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'employees') {
    return <Employees setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'assets') {
    return <Assets setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'employee_directory') {
    return <EmployeeDirectory setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'departments') {
    return <Departments setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'designations') {
    return <Designations setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'states') {
    return <States setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'projects') {
    return <Projects setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'policies') {
    return <Policies user={safeUser} setPage={setPage} />;
  }

  if (normalizedPage === 'team_approvals') {
    return <TeamApprovals setPage={setPage} user={safeUser} />;
  }

    if (normalizedPage === 'recruitment') {
    return <Recruitment setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'performance_reviews') {
    return <Performance setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'grievances') {
    return <Grievance setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'it_support') {
    return <ITSupport setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'management_groups') {
    return <ManagementGroup setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'profile') {
    return <Profile setPage={setPage} user={safeUser} />;
  }

if (normalizedPage === 'system_settings') {
  return <Settings setPage={setPage} user={safeUser} />;
}

if (normalizedPage === 'audit_logs') {
  return <AuditLogs setPage={setPage} user={safeUser} />;
}

if (normalizedPage === 'leave') {
  return <Leave setPage={setPage} user={safeUser} />;
}

  if (normalizedPage === 'leave_requests') {
    return <ApplyLeave setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'leave_balances') {
    return <LeaveBalances setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'compoff_credits') {
    return <CompOffCredits setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'reports') {
    return <Reports setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'payroll_runs') {
    return <Payroll setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'notifications') {
    return <Notifications setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'application_status') {
    return <ApplicationStatus setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'holiday_calendar') {
    return <HolidayCalendar setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'holiday_work_requests') {
    return <HolidayWorkRequests setPage={setPage} user={safeUser} />;
  }

  return <ModuleCrud collection={normalizedPage} setPage={setPage} user={safeUser} />;
}

export default function App() {
  const savedUser = currentUser();
  const savedEmployee = readStoredEmployee();

  const initialUser = savedUser?.email
    ? mergeUserWithEmployeeProfile({
        ...savedUser,
        employee: savedEmployee,
        employee_summary: savedEmployee,
      })
    : null;

  const [user, setUser] = useState(initialUser);
  const [page, setPage] = useState(() => {
    const pathname = getBrowserPathname();

    if (isBillingPath(pathname)) {
      return 'billing';
    }

    if (isPremiumRequestsPath(pathname)) {
      return 'premium_requests';
    }

    if (isSubscriptionExpiredPath(pathname)) {
      return 'subscription_expired';
    }

    try {
      const hiddenPage = localStorage.getItem('sds_hrms_hidden_page');

      if (hiddenPage) {
        localStorage.removeItem('sds_hrms_hidden_page');
        return normalizePageKey(hiddenPage);
      }
    } catch {
      // Ignore localStorage errors and use dashboard.
    }

    return 'dashboard';
  });
  const [celebrations, setCelebrations] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => getBrowserPathname());

  const normalizedUser = useMemo(() => {
    if (!user) {
      return null;
    }

    return mergeUserWithEmployeeProfile(user);
  }, [user]);

  const normalizedPage = useMemo(() => normalizePageKey(page), [page]);
  const isTrialRegistrationRoute = useMemo(
    () => isApplyDemoRegistrationPath(currentPath),
    [currentPath],
  );
  const isAccountAccessHelpRoute = useMemo(
    () => isAccountAccessHelpPath(currentPath),
    [currentPath],
  );
  const isAccountAccessTrackingRoute = useMemo(
    () => isAccountAccessTrackingPath(currentPath),
    [currentPath],
  );

  const isCareerPortalRoute = useMemo(
    () => isCareerPortalPath(currentPath),
    [currentPath],
  );

  useEffect(() => {
    function syncPath() {
      setCurrentPath(getBrowserPathname());
    }

    window.addEventListener('popstate', syncPath);

    return () => {
      window.removeEventListener('popstate', syncPath);
    };
  }, []);


  useEffect(() => {
    if (!normalizedUser || !isBillingPath(currentPath)) {
      return;
    }

    const billingAllowed = canAccessModule(normalizedUser, 'billing');

    // SDS lifetime users, Superadmin, and non-admin client users must not open
    // the client company Billing screen through a direct browser URL.
    if (isSdsLifetimeTenant(normalizedUser) || !billingAllowed) {
      setPage('dashboard');

      try {
        window.history.replaceState({}, '', HRMS_HOME_PATH);
        setCurrentPath(HRMS_HOME_PATH);
      } catch {
        // Ignore browser history errors.
      }

      return;
    }

    setPage('billing');
  }, [currentPath, normalizedUser]);

  useEffect(() => {
    if (!normalizedUser || !isPremiumRequestsPath(currentPath)) {
      return;
    }

    const userRoles = normalizeRoles(normalizedUser);

    if (!userRoles.includes('super_admin')) {
      setPage('dashboard');

      try {
        window.history.replaceState({}, '', HRMS_HOME_PATH);
        setCurrentPath(HRMS_HOME_PATH);
      } catch {
        // Ignore browser history errors.
      }

      return;
    }

    setPage('premium_requests');
  }, [currentPath, normalizedUser]);

  useEffect(() => {
    if (!normalizedUser || !isSubscriptionExpiredPath(currentPath)) {
      return;
    }

    if (!isExpiredOrSuspendedTenant(normalizedUser)) {
      setPage('dashboard');

      try {
        window.history.replaceState({}, '', HRMS_HOME_PATH);
        setCurrentPath(HRMS_HOME_PATH);
      } catch {
        // Ignore browser history errors.
      }

      return;
    }

    setPage('subscription_expired');
  }, [currentPath, normalizedUser]);

  useEffect(() => {
    if (!normalizedUser || isCareerPortalRoute) {
      return;
    }

    if (!isExpiredOrSuspendedTenant(normalizedUser)) {
      return;
    }

    if (
      normalizedPage === 'billing' ||
      normalizedPage === 'subscription_expired'
    ) {
      return;
    }

    setPage('subscription_expired');

    try {
      window.history.replaceState({}, '', HRMS_SUBSCRIPTION_EXPIRED_PATH);
      setCurrentPath(HRMS_SUBSCRIPTION_EXPIRED_PATH);
    } catch {
      // Ignore browser history errors.
    }
  }, [isCareerPortalRoute, normalizedUser, normalizedPage]);

  useEffect(() => {
    if (!normalizedUser) {
      return;
    }

    if (normalizedPage === 'billing' && isSdsLifetimeTenant(normalizedUser)) {
      setPage('dashboard');

      try {
        window.history.replaceState({}, '', HRMS_HOME_PATH);
        setCurrentPath(HRMS_HOME_PATH);
      } catch {
        // Ignore browser history errors.
      }
    }

    if (normalizedPage === 'subscription_expired' && !isExpiredOrSuspendedTenant(normalizedUser)) {
      setPage('dashboard');

      try {
        window.history.replaceState({}, '', HRMS_HOME_PATH);
        setCurrentPath(HRMS_HOME_PATH);
      } catch {
        // Ignore browser history errors.
      }
    }
  }, [normalizedUser, normalizedPage]);

  function handleSetUser(nextUser) {
    if (!nextUser) {
      setUser(null);
      setPage('dashboard');
      setCelebrations([]);
      return;
    }

    const nextEmployee =
      nextUser.employee ||
      nextUser.employee_summary ||
      nextUser.employee_profile ||
      readStoredEmployee();

    setUser(
      mergeUserWithEmployeeProfile({
        ...nextUser,
        employee: nextEmployee,
        employee_summary: nextEmployee,
      }),
    );

    try {
      window.history.replaceState({}, '', HRMS_HOME_PATH);
      setCurrentPath(HRMS_HOME_PATH);
    } catch {
      // Ignore browser history errors.
    }

    setPage('dashboard');
  }

  function handleSetPage(nextPage) {
    setPage(normalizePageKey(nextPage));
  }

  useEffect(() => {
    if (!normalizedUser) {
      return;
    }

    if (page !== normalizedPage) {
      setPage(normalizedPage);
      return;
    }

    if (normalizedPage === 'superadmin_attendance_correction') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!userRoles.includes('super_admin')) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'billing') {
      return;
    }

    if (normalizedPage === 'subscription_expired') {
      return;
    }

    if (normalizedPage === 'demo_requests') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!userRoles.includes('super_admin')) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'subscriptions') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!userRoles.includes('super_admin')) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'premium_requests') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!userRoles.includes('super_admin')) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'payroll_configuration') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_CONFIG_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'loans_advances') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_LOAN_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'reimbursements') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_REIMBURSEMENT_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'payroll_banking') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_BANKING_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'payroll_reports') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_REPORT_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'tax_declarations') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYROLL_TAX_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (normalizedPage === 'payslips') {
      const userRoles = normalizeRoles(normalizedUser);

      if (!hasAnyRole(userRoles, PAYSLIP_ROLES)) {
        setPage('dashboard');
      }

      return;
    }

    if (
      normalizedPage !== 'dashboard' &&
      !canAccessModule(normalizedUser, moduleAccessKey(normalizedPage))
    ) {
      setPage('dashboard');
    }
  }, [page, normalizedPage, normalizedUser]);

  useEffect(() => {
    if (!normalizedUser || !hasFullSaasAccess(normalizedUser)) {
      setCelebrations([]);
      return;
    }

    let cancelled = false;

    async function loadCelebrations() {
      try {
        const data = await getTodayCelebrations();

        if (!cancelled) {
          setCelebrations(data.released ? data.items || [] : []);
        }
      } catch {
        if (!cancelled) {
          setCelebrations([]);
        }
      }
    }

    loadCelebrations();

    return () => {
      cancelled = true;
    };
  }, [normalizedUser]);


if (isCareerPortalRoute) {
  return <CareerPortal key={currentPath} />;
}

if (isTrialRegistrationRoute) {
  return (
    <CustomAlertProvider>
      <ApplyDemoRegistration />
    </CustomAlertProvider>
  );
}

if (isAccountAccessHelpRoute) {
  return (
    <CustomAlertProvider>
      <AccountAccessHelp />
    </CustomAlertProvider>
  );
}

if (isAccountAccessTrackingRoute) {
  return (
    <CustomAlertProvider>
      <AccountAccessTracking />
    </CustomAlertProvider>
  );
}

if (!normalizedUser) {
  return (
    <CustomAlertProvider>
      <Login onLogin={handleSetUser} />
    </CustomAlertProvider>
  );
}

return (
  <CustomAlertProvider>
    <AppLayout
      user={normalizedUser}
      setUser={handleSetUser}
      page={normalizedPage}
      setPage={handleSetPage}
    >
      <PageRouter
        page={normalizedPage}
        user={normalizedUser}
        setPage={handleSetPage}
      />
    </AppLayout>

    {hasFullSaasAccess(normalizedUser) ? (
      <CelebrationPopup celebrations={celebrations} />
    ) : null}

    {hasFullSaasAccess(normalizedUser) ? <AiAssistantWidget /> : null}
  </CustomAlertProvider>
);
}