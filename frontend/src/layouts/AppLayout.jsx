import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  clearSession,
  getInitials,
  getProfilePhotoUrl,
  normalizeProfilePhotoUrl,
  refreshCurrentSession,
} from '../api/client';
import {
  moduleList,
  getDisplayRole,
  getEmployeeCapabilities,
} from '../data/modules';

function safeBrandingText(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeTenantBranding(data = {}) {
  const branding = data.branding || data.tenant_branding || {};
  const tenant = data.tenant || data.company || {};
  const nestedBranding = tenant.branding || {};

  return {
    companyName: safeBrandingText(
      branding.company_name ||
        branding.name ||
        tenant.company_name ||
        tenant.name ||
        tenant.tenant_name ||
        nestedBranding.company_name,
    ),
    logo: safeBrandingText(
      branding.company_logo ||
        branding.company_logo_url ||
        branding.logo ||
        branding.logo_url ||
        tenant.company_logo ||
        tenant.company_logo_url ||
        tenant.logo ||
        tenant.logo_url ||
        nestedBranding.company_logo ||
        nestedBranding.company_logo_url ||
        nestedBranding.logo ||
        nestedBranding.logo_url,
    ),
  };
}

function normalizePlatformBranding(data = {}) {
  const branding = data.branding || data.platform_branding || {};

  return {
    tagline: safeBrandingText(
      branding.tagline || branding.platform_tagline,
      'People, Process and Performance',
    ),
    logo: safeBrandingText(
      branding.logo ||
        branding.logo_url ||
        branding.platform_logo ||
        branding.platform_logo_url,
    ),
  };
}

function companyInitials(value = '') {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return 'CO';
  }

  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

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

function truthyValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return ['true', '1', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase(),
  );
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

function applyProfilePhotoAliases(record = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(record) || '').trim();

  if (photo) {
    record.avatar = photo;
    record.profile_photo = photo;
    record.profile_picture = photo;
    record.photo = photo;
  }

  return record;
}

function getStoredEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_user') || '{}');
  } catch {
    return {};
  }
}

function getUserPhoto(user = {}) {
  const storedUser = getStoredUser();
  const storedEmployee = getStoredEmployee();

  const employee =
    user.employee ||
    user.employee_summary ||
    user.employee_profile ||
    storedUser.employee ||
    storedUser.employee_summary ||
    storedUser.employee_profile ||
    storedEmployee ||
    {};

  return (
    profilePhotoValue(employee) ||
    profilePhotoValue(user) ||
    profilePhotoValue(storedEmployee) ||
    profilePhotoValue(storedUser)
  );
}

function userDisplayName(user = {}) {
  return (
    user.name ||
    user.full_name ||
    user.display_name ||
    user.email ||
    'User'
  );
}

function UserAvatar({ user = {}, size = 'sm' }) {
  const [imageFailed, setImageFailed] = useState(false);

  const photo = getUserPhoto(user);
  const photoUrl = photo && !imageFailed ? getProfilePhotoUrl({ avatar: photo }) : '';
  const name = userDisplayName(user);

  useEffect(() => {
    setImageFailed(false);
  }, [photo]);

  return (
    <span className={`layout-avatar layout-avatar-${size}`}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <b>{getInitials(name)}</b>
      )}
    </span>
  );
}

function roleLabel(role = '') {
  const normalized = normalizeRoleValue(role);

  if (normalized === 'team_leader') {
    return 'Team Leader Capability';
  }

  if (normalized === 'reporting_officer') {
    return 'Reporting Officer Capability';
  }

  if (normalized === 'ro') {
    return 'Reporting Officer Capability';
  }

  return normalized
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function moduleGroup(key) {
  if (
    [
      'companies',
      'users',
      'billing',
      'system_settings',
      'audit_logs',
    ].includes(key)
  ) {
    return 'Administration';
  }

  if (
    [
      'employees',
      'departments',
      'designations',
      'states',
    ].includes(key)
  ) {
    return 'Employee Setup';
  }

  if (key === 'projects') {
    return 'Projects';
  }

  if (
    [
      'attendance',
      'attendance_logs',
      'holiday_work_requests',
      'team_field_attendance',
      'attendance_mode_requests',
      'holiday_calendar',
      'compoff_credits',
      'compoff_records',
      'team_approvals',
      'leave_requests',
      'leave',
      'leave_balances',
      'leave_types',
      'application_status',
    ].includes(key)
  ) {
    return 'Attendance & Leave';
  }

  if (key === 'reports') {
    return 'Reports';
  }

if (['payroll_runs', 'payslips'].includes(key)) {
  return 'Payroll & Finance';
}

if (
  [
    'job_openings',
    'candidates',
    'performance_reviews',
  ].includes(key)
) {
  return 'Talent & Performance';
}

  if (
    [
      'assets',
      'tickets',
      'grievances',
      'it_support',
      'notifications',
      'policies',
      'documents',
    ].includes(key)
  ) {
    return 'Support & Records';
  }

  if (key === 'profile') {
    return 'Account';
  }

  return 'Modules';
}

function groupOrder(group) {
  const order = {
    Administration: 1,
    'Employee Setup': 2,
    Projects: 3,
    'Attendance & Leave': 4,
    Reports: 5,
    'Payroll & Finance': 6,
    'Talent & Performance': 7,
    'Support & Records': 8,
    Account: 9,
    Modules: 99,
  };

  return order[group] || 99;
}

function buildCapabilityText(user) {
  const capabilities = getEmployeeCapabilities(user);
  const items = [];

  if (capabilities.isTeamLeader) {
    items.push('Team Leader');
  }

  if (capabilities.isReportingOfficer) {
    items.push('Reporting Officer');
  }

  if (capabilities.isHrAdmin) {
    items.push('HR Records');
  }

  if (capabilities.isItSupportHead) {
    items.push('IT Support Head');
  } else if (capabilities.isItSupportMember) {
    items.push('IT Support Member');
  }

  return items.length ? items.join(' + ') : '';
}

function formatNotificationTime(value) {
  if (!value) {
    return '';
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleString();
  } catch {
    return '';
  }
}

function formatSaasDate(value) {
  if (!value) {
    return '';
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value || '').trim();
    }

    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value || '').trim();
  }
}

function calculateDaysLeft(value) {
  if (!value) {
    return null;
  }

  try {
    const endDate = new Date(value);

    if (Number.isNaN(endDate.getTime())) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    return Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
  } catch {
    return null;
  }
}

function normalizeSaasText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function getSaasSummary(user = {}) {
  const tenant = user.tenant || user.company || {};
  const subscription = user.subscription || user.saas_subscription || {};

  const tenantCode = String(
    user.tenant_code ||
      tenant.tenant_code ||
      tenant.code ||
      '',
  ).trim();

  const companyName =
    user.company_name ||
    tenant.company_name ||
    tenant.name ||
    tenant.legal_name ||
    tenantCode ||
    '';

  const planType = normalizeSaasText(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      '',
  );

  const planCode = normalizeSaasText(
    subscription.plan_code ||
      tenant.plan_code ||
      user.plan_code ||
      '',
  );

  const status = normalizeSaasText(
    subscription.status ||
      tenant.subscription_status ||
      tenant.plan_status ||
      tenant.status ||
      user.subscription_status ||
      user.plan_status ||
      user.status ||
      '',
  );

  const trialEndDate =
    subscription.trial_end_date ||
    tenant.trial_end_date ||
    user.trial_end_date ||
    '';

  const renewalDueDate =
    subscription.next_payment_due_date ||
    subscription.subscription_end_date ||
    subscription.current_period_end ||
    subscription.paid_until ||
    subscription.end_date ||
    tenant.next_payment_due_date ||
    tenant.subscription_end_date ||
    tenant.current_period_end ||
    tenant.paid_until ||
    user.next_payment_due_date ||
    user.subscription_end_date ||
    user.current_period_end ||
    user.paid_until ||
    '';

  const employeeLimit =
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    null;

  const employeeCount =
    subscription.employee_count ??
    subscription.employees_used ??
    tenant.employee_count ??
    tenant.employees_used ??
    user.employee_count ??
    user.employees_used ??
    null;

  const isSdsLifetime = Boolean(
    user.is_sds_company ||
      tenant.is_sds_company ||
      subscription.is_sds_company ||
      user.has_lifetime_access ||
      tenant.has_lifetime_access ||
      subscription.has_lifetime_access ||
      planType === 'lifetime' ||
      planCode === 'lifetime' ||
      tenantCode.toLowerCase() === 'sds',
  );

  const paidPlanCodes = ['essential', 'growth', 'premium'];
  const isPaidPlan = Boolean(
    planType === 'paid' ||
      paidPlanCodes.includes(planCode) ||
      truthyValue(subscription.is_paid_company) ||
      truthyValue(tenant.is_paid_company) ||
      truthyValue(user.is_paid_company),
  );

  const isDemo = Boolean(
    !isPaidPlan &&
      (planType === 'demo' ||
        planType === 'trial' ||
        status === 'demo' ||
        status === 'trial' ||
        status === 'trial_active'),
  );

  const accessEndDate = isPaidPlan ? renewalDueDate : trialEndDate;
  const daysLeft = calculateDaysLeft(accessEndDate);
  const isSuspended = status === 'suspended' || status === 'blocked';

  const isTrialExpired = Boolean(
    status === 'trial_expired' ||
      status === 'demo_expired' ||
      (!isSdsLifetime && isDemo && daysLeft !== null && daysLeft <= 0),
  );

  const isSubscriptionExpired = Boolean(
    status === 'subscription_expired' ||
      (status === 'expired' && isPaidPlan) ||
      (!isSdsLifetime && isPaidPlan && daysLeft !== null && daysLeft <= 0),
  );

  const isExpired = isTrialExpired || isSubscriptionExpired;
  const isPaid = isPaidPlan && !isExpired && !isSuspended;
  const isPaidRenewalSoon = Boolean(
    isPaid && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7,
  );

  const allowedModules =
    subscription.allowed_modules ||
    tenant.allowed_modules ||
    user.allowed_modules ||
    [];

  const planLabel =
    subscription.plan_name ||
    tenant.plan_name ||
    user.plan_name ||
    (planCode
      ? planCode.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : 'Paid');

  return {
    tenant,
    subscription,
    tenantCode,
    companyName,
    planType,
    planCode,
    planLabel,
    status,
    trialEndDate,
    renewalDueDate,
    accessEndDate,
    daysLeft,
    employeeLimit,
    employeeCount,
    isSdsLifetime,
    isPaidPlan,
    isPaid,
    isDemo,
    isExpired,
    isTrialExpired,
    isSubscriptionExpired,
    isSuspended,
    isPaidRenewalSoon,
    allowedModules,
    showSaasBanner:
      !isSdsLifetime &&
      (isDemo || isExpired || isSuspended || isPaidRenewalSoon),
  };
}
function normalizeNotificationMeta(notification = {}) {
  return {
    ...(notification.meta || {}),
    target: notification.target || notification.meta?.target || notification.target_scope,
    page: notification.page || notification.meta?.page,
    type: notification.type || notification.notification_type || notification.meta?.type,
    notification_type: notification.notification_type || notification.meta?.notification_type,
  };
}

function notificationTarget(meta = {}) {
  const target = String(meta.target || meta.page || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');

  const notificationType = String(
    meta.notification_type || meta.type || '',
  )
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');

  const platformBillingTargets = [
    'billing',
    'subscription',
    'subscriptions',
    'payment',
    'payments',
    'order',
    'orders',
    'payment_orders',
    'billing_management',
    'subscription_management',
  ];

  if (
    notificationType.startsWith('platform_') &&
    (
      platformBillingTargets.includes(target) ||
      notificationType.includes('payment') ||
      notificationType.includes('billing') ||
      notificationType.includes('subscription')
    )
  ) {
    return 'subscriptions';
  }

  if (
    ['billing', 'upgrade', 'subscribe', 'payment'].includes(target)
  ) {
    return 'billing';
  }

  if (
    [
      'subscription_expired',
      'trial_expired',
      'demo_expired',
      'upgrade_required',
    ].includes(target)
  ) {
    return 'subscription_expired';
  }

  if (
    [
      'recruitment',
      'recruitment_hiring_requests',
      'recruitment_candidates',
      'recruitment_interviews',
      'recruitment_offers',
      'hiring_requests',
      'hiring-requests',
      'job_openings',
      'job-openings',
      'candidates',
      'interviews',
      'offers',
      'joining_documents',
      'joining-documents',
    ].includes(target) ||
    String(meta.notification_type || meta.type || '')
      .trim()
      .toLowerCase() === 'recruitment'
  ) {
    return 'recruitment';
  }

  if (
    [
      'team_approvals',
      'team-approvals',
      'team_approval',
      'team-approval',
      'leave_approval',
      'leave-approval',
      'leave_approvals',
      'leave-approvals',
      'leave_approval_inbox',
      'approval_inbox',
      'approval-inbox',
      'pending_approvals',
      'pending-approvals',
      'pending_leave_approvals',
      'pending-leave-approvals',
      'holiday_work_approval',
      'holiday-work-approval',
      'holiday_work_approvals',
      'holiday-work-approvals',
      'holiday_approval',
      'holiday-approval',
      'holiday_approvals',
      'holiday-approvals',
      'holiday_work_requests',
      'holiday-work-requests',
      'tl_approvals',
      'team_leader_approvals',
      'ro_approvals',
      'reporting_officer_approvals',
      'hr_leave_records',
      'hr-leave-records',
      'leave_records_panel',
      'leave-records-panel',
      'hr_record_panel',
      'hr-record-panel',
    ].includes(target)
  ) {
    return 'team_approvals';
  }

  if (
    meta.leave_request_id ||
    meta.team_approval_id ||
    meta.team_approval_request_id ||
    meta.approval_stage ||
    meta.pending_approver_role ||
    meta.approved_by_team_leader ||
    meta.approved_by_reporting_officer ||
    meta.hr_notified ||
    meta.hr_notified_at ||
    meta.hr_record_notification_sent ||
    meta.hr_record_status
  ) {
    const stage = String(meta.approval_stage || '').toLowerCase();
    const approverRole = String(meta.pending_approver_role || '').toLowerCase();
    const notificationType = String(meta.notification_type || meta.type || '').toLowerCase();

    if (
      stage === 'team_leader' ||
      stage === 'reporting_officer' ||
      stage === 'hr' ||
      approverRole === 'team_leader' ||
      approverRole === 'reporting_officer' ||
      approverRole === 'hr' ||
      notificationType.includes('approval') ||
      notificationType.includes('leave_record') ||
      notificationType.includes('hr_record')
    ) {
      return 'team_approvals';
    }

    return 'application_status';
  }

if (
  [
    'my_visits',
    'my-visits',
    'field_visit',
    'field-visit',
    'field_visits',
    'field-visits',
  ].includes(target)
) {
  return 'my_visits';
}

    if (
    [
      'attendance',
      'attendance_logs',
      'attendance-log',
      'attendance-log',
      'field_attendance',
      'field-attendance',
      'team_field_attendance',
      'team-field-attendance',
      'holiday_work',
      'holiday-work',
      'compoff',
      'comp-off',
      'compoff_credits',
      'comp-off-credits',
    ].includes(target)
  ) {
    return 'attendance';
  }


  if (
    [
      'application_status',
      'application-status',
      'request_status',
      'request-status',
      'my_requests',
      'my-requests',
    ].includes(target)
  ) {
    return 'application_status';
  }

  if (
    [
      'performance',
      'performance_review',
      'performance_reviews',
      'team_performance',
      'team_leader_performance',
      'reporting_officer_performance',
    ].includes(target)
  ) {
    return 'performance_reviews';
  }

  if (
    [
      'project',
      'projects',
      'project_progress',
      'project_analytics',
      'department_project_graph',
      'project_wise_graph',
      'team_project_graph',
      'project_team_tree',
      'team_hierarchy',
      'team_root_map',
    ].includes(target)
  ) {
    return 'projects';
  }

  if (
    [
      'notifications',
      'notification',
      'notification_center',
      'notification-centre',
      'notification-center',
    ].includes(target)
  ) {
    return 'notifications';
  }

  if (meta.performance_review_id || meta.review_target_type) {
    return 'performance_reviews';
  }

  if (meta.holiday_work_request_id) {
    const notificationType = String(
      meta.notification_type || meta.type || '',
    ).toLowerCase();

    const stage = String(meta.approval_stage || '').toLowerCase();
    const approverRole = String(meta.pending_approver_role || '').toLowerCase();

    if (
      notificationType.includes('approval') ||
      stage === 'team_leader' ||
      stage === 'reporting_officer' ||
      stage === 'hr' ||
      approverRole === 'team_leader' ||
      approverRole === 'reporting_officer' ||
      approverRole === 'hr'
    ) {
      return 'team_approvals';
    }

    return 'application_status';
  }

  if (meta.attendance_mode_request_id) {
    return 'application_status';
  }

  if (meta.ticket_id) {
    return 'application_status';
  }

  if (meta.field_attendance_id || meta.attendance_log_id) {
    return 'attendance';
  }

  if (meta.compoff_id || meta.compoff_credit_id) {
    return 'application_status';
  }

  if (
    meta.project_id ||
    meta.project_progress_id ||
    meta.assigned_employee_ids ||
    meta.collaborator_ids
  ) {
    return 'projects';
  }

  return 'notifications';
}

function notificationBody(notification = {}) {
  return notification.body || notification.message || 'No details available.';
}

function notificationIsUnread(notification = {}) {
  return notification.read !== true && notification.status !== 'read';
}

function notificationIsPopupPending(notification = {}) {
  return (
    notification.show_popup !== false &&
    notification.popup_seen !== true &&
    notificationIsUnread(notification)
  );
}

export default function AppLayout({ user, setUser, page, setPage, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [popupNotification, setPopupNotification] = useState(null);
  const [tenantBranding, setTenantBranding] = useState({
    companyName: '',
    logo: '',
  });
  const [companyLogoFailed, setCompanyLogoFailed] = useState(false);
  const [platformBranding, setPlatformBranding] = useState({
    tagline: 'People, Process and Performance',
    logo: '',
  });
  const [platformLogoFailed, setPlatformLogoFailed] = useState(false);
  const notificationRef = useRef(null);

  const safeUser = {
    ...(user || {}),
    roles: normalizeRoles(user),
  };

  applyProfilePhotoAliases(safeUser, getUserPhoto(safeUser));

  const modules = moduleList(safeUser).filter(
    (module) => module[0] !== 'dashboard',
  );

  const groupedModules = useMemo(() => {
    const grouped = modules.reduce((acc, module) => {
      const group = moduleGroup(module[0]);

      if (!acc[group]) {
        acc[group] = [];
      }

      acc[group].push(module);
      return acc;
    }, {});

    return Object.entries(grouped)
      .sort(([groupA], [groupB]) => groupOrder(groupA) - groupOrder(groupB))
      .map(([group, groupModules]) => ({
        group,
        modules: groupModules,
      }));
  }, [modules]);

  const currentTitle =
    page === 'dashboard'
      ? 'Dashboard'
      : modules.find((module) => module[0] === page)?.[1] ||
        'Access Restricted';

  const displayRole = getDisplayRole(safeUser);
  const capabilityText = buildCapabilityText(safeUser);
  const saasSummary = useMemo(() => getSaasSummary(safeUser), [safeUser]);
  const sessionBranding = normalizeTenantBranding({
    branding:
      safeUser.tenant_branding ||
      safeUser.branding ||
      safeUser.company_branding ||
      {},
    tenant: saasSummary.tenant || safeUser.tenant || safeUser.company || {},
  });
  const headerCompanyName =
    tenantBranding.companyName ||
    sessionBranding.companyName ||
    saasSummary.companyName ||
    'Your Company';
  const headerCompanyLogo = tenantBranding.logo || sessionBranding.logo || '';
  const headerCompanyLogoUrl = normalizeProfilePhotoUrl(headerCompanyLogo);
  const platformLogoUrl = normalizeProfilePhotoUrl(platformBranding.logo);
  const platformTagline =
    platformBranding.tagline || 'People, Process and Performance';
  const tenantIdentity = String(
    safeUser.tenant_id ||
      safeUser.company_id ||
      saasSummary.tenant?._id ||
      saasSummary.tenant?.id ||
      saasSummary.tenantCode ||
      '',
  );

  const saasBanner = useMemo(() => {
    if (saasSummary.isSubscriptionExpired) {
      return {
        title: `${saasSummary.planLabel} subscription expired`,
        message: `Renew your subscription to restore full HRMS access${
          saasSummary.renewalDueDate
            ? ` from ${formatSaasDate(saasSummary.renewalDueDate)}`
            : ''
        }.`,
        sidebarMessage: 'Renew the subscription to restore full HRMS access.',
        actionLabel: 'Renew Plan',
        expired: true,
      };
    }

    if (saasSummary.isTrialExpired) {
      return {
        title: '15-Day Trial Expired',
        message: 'Choose a paid plan to continue using YourComate HRMS.',
        sidebarMessage: 'Subscribe to continue using YourComate HRMS.',
        actionLabel: 'Subscribe Now',
        expired: true,
      };
    }

    if (saasSummary.isSuspended) {
      return {
        title: 'Subscription Access Suspended',
        message: 'Open Billing to review the subscription status or complete the required payment.',
        sidebarMessage: 'Review Billing to restore account access.',
        actionLabel: 'View Billing',
        expired: true,
      };
    }

    if (saasSummary.isPaidRenewalSoon) {
      return {
        title: `${saasSummary.planLabel} renewal due soon`,
        message: `Renewal is due ${
          saasSummary.renewalDueDate
            ? `on ${formatSaasDate(saasSummary.renewalDueDate)}`
            : 'soon'
        }${
          saasSummary.daysLeft !== null
            ? ` • ${saasSummary.daysLeft} day(s) left`
            : ''
        }.`,
        sidebarMessage: `${saasSummary.daysLeft ?? 'Few'} day(s) left before renewal.`,
        actionLabel: 'Renew Plan',
        expired: false,
      };
    }

    return {
      title: `15-day full-access trial active${
        saasSummary.daysLeft !== null
          ? ` • ${saasSummary.daysLeft} day(s) left`
          : ''
      }`,
      message: `All HRMS modules are available during the trial. Trial ends ${
        formatSaasDate(saasSummary.trialEndDate) || 'soon'
      }.`,
      sidebarMessage: `${saasSummary.daysLeft ?? 'Few'} day(s) left in the 15-day full-access trial.`,
      actionLabel: 'Upgrade Plan',
      expired: false,
    };
  }, [saasSummary]);

  async function loadNotifications({ silent = false, showPopup = true } = {}) {
    if (!safeUser?._id && !safeUser?.email) {
      return;
    }

    try {
      if (!silent) {
        setNotificationLoading(true);
      }

      const data = await api('/notifications?limit=20');

      const nextItems = data.items || [];
      setNotifications(nextItems);
      setNotificationCount(Number(data.unread_count || 0));
      setNotificationMessage('');

      if (showPopup) {
        const nextPopup = nextItems.find(notificationIsPopupPending);

        if (nextPopup) {
          setPopupNotification(nextPopup);
        }
      }
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to load notifications');
    } finally {
      setNotificationLoading(false);
    }
  }

  useEffect(() => {
    async function syncProfileSession() {
      try {
        const data = await refreshCurrentSession();

        if (data?.user && typeof setUser === 'function') {
          const syncedUser = {
            ...data.user,
            tenant: data.tenant || data.user?.tenant || {},
            subscription: data.subscription || data.user?.subscription || {},
            is_platform_superadmin: data.is_platform_superadmin || data.user?.is_platform_superadmin,
            employee: data.employee || {},
            employee_summary: data.employee || {},
            employee_profile: data.employee || {},
          };

          applyProfilePhotoAliases(
            syncedUser,
            profilePhotoValue(data.employee) || profilePhotoValue(data.user),
          );

          if (syncedUser.employee && typeof syncedUser.employee === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

          if (syncedUser.employee_summary && typeof syncedUser.employee_summary === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee_summary,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

          if (syncedUser.employee_profile && typeof syncedUser.employee_profile === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee_profile,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

          const photo = profilePhotoValue(data.employee) || profilePhotoValue(data.user);

          const compactSyncedUser = {
            id: syncedUser.id || syncedUser._id || '',
            _id: syncedUser._id || syncedUser.id || '',
            name: syncedUser.name || data.employee?.employee_name || '',
            email: syncedUser.email || '',
            role: syncedUser.role || '',
            roles: Array.isArray(syncedUser.roles) ? syncedUser.roles : [],
            tenant_id: syncedUser.tenant_id || data.employee?.tenant_id || data.tenant?._id || data.tenant?.id || '',
            company_id: syncedUser.company_id || data.employee?.company_id || data.tenant?.company_id || data.tenant?._id || data.tenant?.id || '',
            tenant_code: syncedUser.tenant_code || data.employee?.tenant_code || data.tenant?.tenant_code || data.tenant?.code || '',
            company_name: syncedUser.company_name || data.employee?.company_name || data.tenant?.company_name || data.tenant?.name || '',
            tenant: data.tenant || syncedUser.tenant || {},
            subscription: data.subscription || syncedUser.subscription || {},
            is_platform_superadmin: Boolean(data.is_platform_superadmin || syncedUser.is_platform_superadmin),
            employee_id: syncedUser.employee_id || data.employee?.id || data.employee?._id || '',
            employee_code: syncedUser.employee_code || data.employee?.employee_code || '',
            department_id: syncedUser.department_id || data.employee?.department_id || '',
            department_name: syncedUser.department_name || data.employee?.department_name || data.employee?.department || '',
            designation_id: syncedUser.designation_id || data.employee?.designation_id || '',
            designation_name: syncedUser.designation_name || data.employee?.designation_name || data.employee?.designation || '',
            team_leader_id: data.employee?.team_leader_id || '',
            team_leader_name: data.employee?.team_leader_name || '',
            reporting_officer_id: data.employee?.reporting_officer_id || '',
            reporting_officer_name: data.employee?.reporting_officer_name || '',
            is_team_leader: truthyValue(data.employee?.is_team_leader),
            is_reporting_officer: truthyValue(data.employee?.is_reporting_officer),
            is_it_support_head: truthyValue(data.employee?.is_it_support_head),
            is_it_support_member: truthyValue(data.employee?.is_it_support_member),
            avatar: photo,
            profile_photo: photo,
            profile_picture: photo,
            photo,
          };

          const employeePhoto = profilePhotoValue(data.employee);

          const compactSyncedEmployee = {
            id: data.employee?.id || data.employee?._id || '',
            _id: data.employee?._id || data.employee?.id || '',
            employee_name: data.employee?.employee_name || data.employee?.name || '',
            employee_code: data.employee?.employee_code || '',
            email: data.employee?.email || '',
            phone: data.employee?.phone || '',
            tenant_id: data.employee?.tenant_id || data.tenant?._id || data.tenant?.id || '',
            company_id: data.employee?.company_id || data.tenant?.company_id || data.tenant?._id || data.tenant?.id || '',
            tenant_code: data.employee?.tenant_code || data.tenant?.tenant_code || data.tenant?.code || '',
            company_name: data.employee?.company_name || data.tenant?.company_name || data.tenant?.name || '',
            department_id: data.employee?.department_id || '',
            department_name: data.employee?.department_name || data.employee?.department || '',
            department: data.employee?.department || data.employee?.department_name || '',
            designation_id: data.employee?.designation_id || '',
            designation_name: data.employee?.designation_name || data.employee?.designation || '',
            designation: data.employee?.designation || data.employee?.designation_name || '',
            team_leader_id: data.employee?.team_leader_id || '',
            team_leader_name: data.employee?.team_leader_name || '',
            reporting_officer_id: data.employee?.reporting_officer_id || '',
            reporting_officer_name: data.employee?.reporting_officer_name || '',
            is_team_leader: truthyValue(data.employee?.is_team_leader),
            is_reporting_officer: truthyValue(data.employee?.is_reporting_officer),
            is_it_support_head: truthyValue(data.employee?.is_it_support_head),
            is_it_support_member: truthyValue(data.employee?.is_it_support_member),
            avatar: employeePhoto,
            profile_photo: employeePhoto,
            profile_picture: employeePhoto,
            photo: employeePhoto,
          };

          try {
            localStorage.setItem('sds_hrms_user', JSON.stringify(compactSyncedUser));
            localStorage.setItem('sds_hrms_employee', JSON.stringify(compactSyncedEmployee));
          } catch (error) {
            console.warn('Unable to refresh compact session in localStorage', error);
          }

          setUser(syncedUser);
        }
      } catch {
        // Ignore session refresh failure here; api() handles expired sessions globally.
      }
    }

    syncProfileSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    useEffect(() => {
    async function handleProfileUpdated() {
      try {
        const data = await refreshCurrentSession();

        if (data?.user && typeof setUser === 'function') {
          const photo =
            profilePhotoValue(data.employee) ||
            profilePhotoValue(data.user);

          const syncedUser = {
            ...data.user,
            tenant: data.tenant || data.user?.tenant || {},
            subscription: data.subscription || data.user?.subscription || {},
            is_platform_superadmin: data.is_platform_superadmin || data.user?.is_platform_superadmin,
            employee: data.employee || {},
            employee_summary: data.employee || {},
            employee_profile: data.employee || {},
          };

          applyProfilePhotoAliases(syncedUser, photo);

          if (syncedUser.employee && typeof syncedUser.employee === 'object') {
            applyProfilePhotoAliases(syncedUser.employee, photo);
          }

          if (
            syncedUser.employee_summary &&
            typeof syncedUser.employee_summary === 'object'
          ) {
            applyProfilePhotoAliases(syncedUser.employee_summary, photo);
          }

          if (
            syncedUser.employee_profile &&
            typeof syncedUser.employee_profile === 'object'
          ) {
            applyProfilePhotoAliases(syncedUser.employee_profile, photo);
          }

          setUser(syncedUser);
        }
      } catch {
        // Ignore profile refresh error here.
      }
    }

    window.addEventListener('sds_hrms_profile_photo_updated', handleProfileUpdated);

    return () => {
      window.removeEventListener('sds_hrms_profile_photo_updated', handleProfileUpdated);
    };
  }, [setUser]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlatformBranding() {
      try {
        const data = await api('/platform-branding');

        if (!cancelled) {
          setPlatformBranding(normalizePlatformBranding(data));
        }
      } catch {
        if (!cancelled) {
          setPlatformBranding((current) => ({
            tagline:
              current.tagline || 'People, Process and Performance',
            logo: current.logo || '',
          }));
        }
      }
    }

    loadPlatformBranding();

    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    setPlatformLogoFailed(false);
  }, [platformLogoUrl]);

  useEffect(() => {
    if (page !== 'dashboard') {
      return undefined;
    }

    let cancelled = false;

    async function loadTenantBranding() {
      try {
        const data = await api('/tenant-branding');

        if (!cancelled) {
          setTenantBranding(normalizeTenantBranding(data));
        }
      } catch {
        if (!cancelled) {
          setTenantBranding((current) => ({
            companyName:
              current.companyName ||
              sessionBranding.companyName ||
              saasSummary.companyName ||
              '',
            logo: current.logo || sessionBranding.logo || '',
          }));
        }
      }
    }

    loadTenantBranding();

    return () => {
      cancelled = true;
    };
    // Reload when returning to Dashboard so recently updated branding appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tenantIdentity]);

  useEffect(() => {
    setCompanyLogoFailed(false);
  }, [headerCompanyLogoUrl]);

  useEffect(() => {
    let cancelled = false;

    async function refreshNotificationsFast() {
      if (cancelled) {
        return;
      }

      await loadNotifications({
        silent: true,
        showPopup: true,
      });
    }

    refreshNotificationsFast();

    const interval = window.setInterval(() => {
      refreshNotificationsFast();
    }, 8000);

    function handleNotificationCreated() {
      refreshNotificationsFast();
    }

    function handleWindowFocus() {
      refreshNotificationsFast();
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        refreshNotificationsFast();
      }
    }

    window.addEventListener('sds_hrms_notification_created', handleNotificationCreated);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('sds_hrms_notification_created', handleNotificationCreated);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeUser?._id, safeUser?.email]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setNotificationOpen(false);
      }
    }

    if (notificationOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notificationOpen]);

  function goTo(nextPage) {
    if (typeof setPage === 'function') {
      setPage(nextPage || 'dashboard');
    }

    setSidebarOpen(false);
    setNotificationOpen(false);
  }

  function goToBilling() {
    goTo('billing');

    try {
      window.history.pushState({}, '', '/hrms/billing');
    } catch {
      // Ignore browser history errors.
    }
  }

  function goToSubscriptionExpired() {
    goTo('subscription_expired');

    try {
      window.history.pushState({}, '', '/hrms/subscription-expired');
    } catch {
      // Ignore browser history errors.
    }
  }

  function goToNotificationTarget(target) {
    const normalizedTarget = String(target || 'notifications').trim() || 'notifications';

    if (typeof setPage === 'function') {
      setPage(normalizedTarget);
    }

    setSidebarOpen(false);
    setNotificationOpen(false);

    try {
      const routeMap = {
        billing: '/hrms/billing',
        subscription_expired: '/hrms/subscription-expired',
        premium_requests: '/hrms/premium-requests',
      };

      window.history.pushState(
        {},
        '',
        routeMap[normalizedTarget] || '/hrms',
      );
    } catch {
      // Ignore browser history errors.
    }
  }

  function logout() {
    clearSession();

    if (typeof setUser === 'function') {
      setUser(null);
    }

    if (typeof setPage === 'function') {
      setPage('dashboard');
    }

    setSidebarOpen(false);
    setNotificationOpen(false);

    try {
      window.history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      window.location.href = '/login';
    }
  }

  async function toggleNotifications() {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);

    if (nextOpen) {
      await loadNotifications({ showPopup: false });
    }
  }

  async function markNotificationRead(notification, shouldNavigate = true) {
    if (!notification?._id) {
      return;
    }

    try {
      await api(`/notifications/${notification._id}/read`, {
        method: 'PATCH',
      });

      if (shouldNavigate) {
        const target = notificationTarget(normalizeNotificationMeta(notification));

        if (target) {
          goToNotificationTarget(target);
        }
      }

      await loadNotifications({ silent: true, showPopup: false });
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to update notification');
    }
  }

  async function markNotificationPopupSeen(notification) {
    if (!notification?._id) {
      setPopupNotification(null);
      return;
    }

    try {
      await api(`/notifications/${notification._id}/popup_seen`, {
        method: 'PATCH',
      });

      setPopupNotification(null);
      await loadNotifications({ silent: true, showPopup: false });
    } catch {
      setPopupNotification(null);
    }
  }

  async function markAllNotificationsRead() {
    try {
      await api('/notifications/read_all', {
        method: 'PATCH',
      });

      await loadNotifications({ silent: true, showPopup: false });
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to mark all as read');
    }
  }

  async function openPopupNotification(notification) {
    const target = notificationTarget(normalizeNotificationMeta(notification));

    await markNotificationRead(notification, false);
    await markNotificationPopupSeen(notification);

    if (target) {
      goToNotificationTarget(target);
    }
  }

  return (
    <div className="app-shell layout-photo-aware">
      <style>{`
        .layout-photo-aware {
          --layout-sidebar-w: 330px;
        }

        .layout-photo-aware .side-brand.platform-side-brand {
          position: relative;
          isolation: isolate;
          width: calc(100% - 16px);
          min-width: 0;
          min-height: 108px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 76px minmax(0, 1fr);
          align-items: center;
          gap: 15px;
          margin: 12px 8px 20px;
          padding: 14px 16px 14px 14px;
          overflow: hidden;
          border: 1px solid rgba(99, 102, 241, .16);
          border-radius: 20px;
          background:
            radial-gradient(circle at 100% 0%, rgba(167, 243, 208, .42), transparent 42%),
            linear-gradient(135deg, rgba(255, 255, 255, .98), rgba(238, 242, 255, .96));
          box-shadow:
            0 14px 30px rgba(15, 23, 42, .10),
            inset 0 1px 0 rgba(255, 255, 255, .95);
          transition:
            transform .24s cubic-bezier(.22, 1, .36, 1),
            border-color .24s ease,
            box-shadow .24s ease;
          animation: platformBrandEnter .5s cubic-bezier(.22, 1, .36, 1) both;
        }

        .layout-photo-aware .side-brand.platform-side-brand:hover {
          transform: translateY(-2px);
          border-color: rgba(79, 70, 229, .28);
          box-shadow:
            0 18px 38px rgba(15, 23, 42, .14),
            inset 0 1px 0 rgba(255, 255, 255, .98);
        }

        .layout-photo-aware .side-brand.platform-side-brand::after {
          content: '';
          position: absolute;
          z-index: -1;
          width: 100px;
          height: 100px;
          right: -54px;
          bottom: -62px;
          border-radius: 999px;
          background: rgba(79, 70, 229, .08);
          pointer-events: none;
          animation: platformAccentDrift 7s ease-in-out infinite;
        }

        .layout-photo-aware .platform-side-logo {
          position: relative;
          width: 76px;
          height: 76px;
          min-width: 76px;
          padding: 0 !important;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(79, 70, 229, .16);
          background: #ffffff;
          color: #3730a3;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: .03em;
          box-shadow:
            0 10px 22px rgba(30, 41, 59, .13),
            inset 0 0 0 1px rgba(255, 255, 255, .9);
          animation: platformLogoBreathe 4.6s ease-in-out infinite;
        }

        .layout-photo-aware .platform-side-logo::after {
          content: '';
          position: absolute;
          inset: 5px;
          border-radius: 14px;
          border: 1px solid rgba(99, 102, 241, .08);
          pointer-events: none;
        }

        .layout-photo-aware .platform-side-logo img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          padding: 0 !important;
          transform: scale(1.42);
          transform-origin: center;
        }

        .layout-photo-aware .platform-side-copy {
          min-width: 0;
          width: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          animation: platformCopyEnter .58s .06s cubic-bezier(.22, 1, .36, 1) both;
        }

        .layout-photo-aware .platform-side-copy b {
          display: block;
          width: 100%;
          max-width: none;
          overflow: visible;
          color: #111827;
          text-overflow: clip;
          white-space: normal;
          word-break: normal;
          overflow-wrap: normal;
          font-size: clamp(20px, 1.65vw, 23px);
          font-weight: 950;
          line-height: 1.08;
          letter-spacing: -.025em;
          text-shadow: none;
          animation: platformTitlePulse 4.8s ease-in-out infinite;
        }

        .layout-photo-aware .platform-side-copy small {
          display: block;
          width: 100%;
          margin-top: 7px;
          overflow: visible;
          color: #52647f;
          text-overflow: clip;
          white-space: normal;
          word-break: normal;
          overflow-wrap: anywhere;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.42;
          letter-spacing: .005em;
          animation: platformTaglineEnter .66s .14s cubic-bezier(.22, 1, .36, 1) both;
        }

        @keyframes platformBrandEnter {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes platformCopyEnter {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes platformTaglineEnter {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes platformLogoBreathe {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-2px) scale(1.02);
          }
        }

        @keyframes platformTitlePulse {
          0%, 100% {
            color: #111827;
          }
          50% {
            color: #3730a3;
          }
        }

        @keyframes platformAccentDrift {
          0%, 100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(-10px, -7px, 0) scale(1.08);
          }
        }

        @media (max-width: 1366px) {
          .layout-photo-aware {
            --layout-sidebar-w: 318px;
          }

          .layout-photo-aware .side-brand.platform-side-brand {
            min-height: 102px;
            grid-template-columns: 72px minmax(0, 1fr);
            gap: 13px;
            padding: 13px 14px 13px 13px;
          }

          .layout-photo-aware .platform-side-logo {
            width: 72px;
            height: 72px;
            min-width: 72px;
            border-radius: 17px;
          }

          .layout-photo-aware .platform-side-copy b {
            font-size: 21px;
          }

          .layout-photo-aware .platform-side-copy small {
            font-size: 10.5px;
          }
        }

        @media (max-width: 1100px) {
          .layout-photo-aware {
            --layout-sidebar-w: 320px;
          }

          .layout-photo-aware .sidebar {
            width: min(320px, 88vw) !important;
            max-width: 88vw !important;
            left: min(-320px, -88vw) !important;
            padding-inline: 14px !important;
          }

          .layout-photo-aware .sidebar.open {
            left: 0 !important;
          }

          .layout-photo-aware .side-brand.platform-side-brand {
            width: 100%;
            margin: 56px 0 18px;
          }

          .layout-photo-aware .sidebar nav {
            padding-right: 4px;
            padding-bottom: calc(var(--safe-bottom) + 8px);
          }
        }

        @media (max-width: 520px) {
          .layout-photo-aware .sidebar {
            width: min(306px, 90vw) !important;
            max-width: 90vw !important;
            left: min(-306px, -90vw) !important;
            padding-inline: 12px !important;
          }

          .layout-photo-aware .sidebar.open {
            left: 0 !important;
          }

          .layout-photo-aware .side-brand.platform-side-brand {
            min-height: 88px;
            grid-template-columns: 60px minmax(0, 1fr);
            gap: 11px;
            padding: 12px;
            border-radius: 18px;
          }

          .layout-photo-aware .platform-side-logo {
            width: 60px;
            height: 60px;
            min-width: 60px;
            border-radius: 16px;
          }

          .layout-photo-aware .platform-side-copy b {
            font-size: 17px;
          }

          .layout-photo-aware .platform-side-copy small {
            margin-top: 5px;
            font-size: 9.5px;
            line-height: 1.32;
          }
        }

        @media (max-width: 380px) {
          .layout-photo-aware .sidebar {
            width: 92vw !important;
            max-width: 92vw !important;
            left: -92vw !important;
          }

          .layout-photo-aware .sidebar.open {
            left: 0 !important;
          }

          .layout-photo-aware .side-brand.platform-side-brand {
            grid-template-columns: 56px minmax(0, 1fr);
          }

          .layout-photo-aware .platform-side-logo {
            width: 56px;
            height: 56px;
            min-width: 56px;
          }

          .layout-photo-aware .platform-side-copy b {
            font-size: 16px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .layout-photo-aware .side-brand.platform-side-brand,
          .layout-photo-aware .side-brand.platform-side-brand::after,
          .layout-photo-aware .platform-side-logo,
          .layout-photo-aware .platform-side-copy,
          .layout-photo-aware .platform-side-copy b,
          .layout-photo-aware .platform-side-copy small {
            animation: none !important;
          }
        }

        .layout-avatar {
          overflow: hidden;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: #4338ca;
          border: 2px solid #ffffff;
          box-shadow: 0 10px 22px rgba(15, 23, 42, .12);
          font-weight: 900;
          flex: 0 0 auto;
        }

        .layout-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .layout-avatar b {
          font-size: inherit;
          line-height: 1;
        }

        .layout-avatar-sm {
          width: 34px;
          height: 34px;
          font-size: 11px;
        }

        .layout-avatar-md {
          width: 46px;
          height: 46px;
          font-size: 14px;
        }

        .layout-photo-aware .user-chip {
          border: 0;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
          cursor: pointer;
          background: rgba(255,255,255,.86);
          color: var(--ink);
          border-radius: 999px;
          padding: 8px 14px 8px 8px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, .08);
          transition: transform .18s ease, box-shadow .18s ease;
        }

        .layout-photo-aware .user-chip:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 36px rgba(15, 23, 42, .12);
        }

        .layout-photo-aware .user-chip span:last-child {
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .layout-photo-aware .notification-item {
          text-align: left;
        }

        .topbar.topbar-dashboard {
          display: grid;
          grid-template-columns: minmax(150px, auto) minmax(220px, 1fr) auto;
          align-items: center;
          column-gap: clamp(16px, 2vw, 30px);
          row-gap: 10px;
        }

        .topbar-title-block {
          min-width: 0;
        }

        .topbar-company-brand {
          min-width: 0;
          max-width: 520px;
          justify-self: end;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 7px 12px 7px 7px;
          border: 1px solid rgba(203, 213, 225, .8);
          border-radius: 999px;
          background: rgba(255, 255, 255, .78);
          box-shadow: 0 12px 28px rgba(15, 23, 42, .07);
          backdrop-filter: blur(14px);
        }

        .topbar-company-logo {
          width: 38px;
          height: 38px;
          flex: 0 0 38px;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid rgba(199, 210, 254, .9);
          background: linear-gradient(135deg, #ffffff, #f0fdf4);
          color: #174c2d;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: .02em;
        }

        .topbar-company-logo img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          padding: 3px;
        }

        .topbar-company-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #0f172a;
          font-size: clamp(13px, 1.15vw, 16px);
          font-weight: 850;
          line-height: 1.25;
        }

        .notification-wrap {
          position: relative;
        }

        .notification-btn {
          position: relative;
        }

        .notification-badge {
          position: absolute;
          top: -7px;
          right: -7px;
          min-width: 18px;
          height: 18px;
          border-radius: 999px;
          padding: 0 5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #ef4444;
          color: #ffffff;
          font-size: 10px;
          font-weight: 900;
          border: 2px solid #ffffff;
        }

        .notification-panel {
          position: absolute;
          top: calc(100% + 12px);
          right: 0;
          width: min(380px, calc(100vw - 24px));
          max-height: 520px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          box-shadow: 0 24px 70px rgba(15, 23, 42, .22);
          z-index: 80;
          overflow: hidden;
        }

        .notification-head {
          padding: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid #edf2f7;
          background: #f8fafc;
        }

        .notification-head b {
          display: block;
          color: #0f172a;
          font-size: 15px;
        }

        .notification-head small {
          display: block;
          color: #64748b;
          font-size: 12px;
          margin-top: 3px;
        }

        .notification-mark-all {
          border: 0;
          border-radius: 12px;
          padding: 8px 10px;
          background: #eef4ff;
          color: #1d4ed8;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
        }

        .notification-mark-all:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .notification-message {
          margin: 10px;
          border-radius: 12px;
          padding: 10px;
          background: #fff1f2;
          color: #be123c;
          font-size: 12px;
          font-weight: 800;
        }

        .notification-list {
          max-height: 430px;
          overflow-y: auto;
          padding: 8px;
        }

        .notification-empty {
          padding: 22px 12px;
          text-align: center;
          color: #64748b;
          font-weight: 800;
        }

        .notification-item {
          width: 100%;
          border: 0;
          border-radius: 14px;
          padding: 11px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          background: transparent;
          cursor: pointer;
          transition: background .18s ease, transform .18s ease;
        }

        .notification-item:hover {
          background: #f8fafc;
          transform: translateY(-1px);
        }

        .notification-item.unread {
          background: #eff6ff;
        }

        .notification-item.read {
          opacity: .78;
        }

        .notification-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          margin-top: 6px;
          background: #cbd5e1;
        }

        .notification-item.unread .notification-dot {
          background: #2563eb;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, .13);
        }

        .notification-item b {
          display: block;
          color: #0f172a;
          font-size: 13px;
          margin-bottom: 4px;
        }

        .notification-item small {
          display: -webkit-box;
          color: #475569;
          font-size: 12px;
          line-height: 1.4;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .notification-item em {
          display: block;
          margin-top: 5px;
          color: #94a3b8;
          font-size: 11px;
          font-style: normal;
        }

        .layout-popup-backdrop {
          position: fixed;
          inset: 0;
          z-index: 120;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 84px 18px 18px;
          background: rgba(15, 23, 42, .24);
          backdrop-filter: blur(3px);
          animation: layoutFadeIn .2s ease both;
        }

        .layout-popup-card {
          width: min(520px, 100%);
          border-radius: 24px;
          background: #ffffff;
          border: 1px solid #dbeafe;
          box-shadow: 0 28px 85px rgba(15, 23, 42, .28);
          overflow: hidden;
          animation: layoutPopupIn .28s cubic-bezier(.2,.85,.2,1.1) both;
        }

        .layout-popup-top {
          padding: 18px;
          background:
            radial-gradient(circle at top left, rgba(250,204,21,.28), transparent 32%),
            linear-gradient(135deg, #1e293b, #2563eb);
          color: #ffffff;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .layout-popup-top span {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 11px;
          border-radius: 999px;
          background: rgba(255,255,255,.14);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .layout-popup-close {
          border: 0;
          width: 34px;
          height: 34px;
          border-radius: 12px;
          color: #ffffff;
          background: rgba(255,255,255,.14);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .layout-popup-body {
          padding: 18px;
        }

        .layout-popup-body h3 {
          margin: 0 0 8px;
          color: #0f172a;
          font-size: 22px;
        }

        .layout-popup-body p {
          margin: 0;
          color: #475569;
          line-height: 1.6;
          white-space: pre-wrap;
        }

        .layout-popup-meta {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .layout-popup-pill {
          border-radius: 999px;
          padding: 7px 10px;
          color: #1d4ed8;
          background: #dbeafe;
          font-size: 12px;
          font-weight: 900;
          text-transform: capitalize;
        }

        .layout-popup-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 0 18px 18px;
        }

        .layout-popup-soft,
        .layout-popup-primary {
          border: 0;
          border-radius: 14px;
          padding: 11px 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .layout-popup-soft {
          color: #475569;
          background: #f1f5f9;
        }

        .layout-popup-primary {
          color: #ffffff;
          background: #2563eb;
          box-shadow: 0 12px 24px rgba(37, 99, 235, .22);
        }

        @keyframes layoutFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes layoutPopupIn {
          from {
            opacity: 0;
            transform: translateY(-18px) scale(.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .saas-sidebar-card {
          margin: 4px 0 12px;
          border-radius: 18px;
          padding: 12px;
          background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.13);
          color: #ffffff;
        }

        .saas-sidebar-card strong {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          margin-bottom: 6px;
        }

        .saas-sidebar-card p {
          margin: 0;
          color: rgba(255,255,255,.72);
          font-size: 11px;
          line-height: 1.45;
        }

        .saas-sidebar-card button {
          width: 100%;
          border: 0;
          border-radius: 13px;
          margin-top: 10px;
          padding: 9px 10px;
          background: #ffffff;
          color: #1d4ed8;
          font-weight: 900;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }

        .saas-sidebar-card.expired button {
          color: #dc2626;
        }

        .saas-top-banner {
          margin: 0 0 18px;
          border-radius: 22px;
          padding: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          background: linear-gradient(135deg, rgba(239,246,255,.96), rgba(255,255,255,.96));
          border: 1px solid rgba(37, 99, 235, .16);
          box-shadow: 0 12px 30px rgba(15, 23, 42, .06);
        }

        .saas-top-banner.warning {
          background: linear-gradient(135deg, rgba(255,247,237,.98), rgba(255,255,255,.96));
          border-color: rgba(249, 115, 22, .28);
        }

        .saas-top-banner.expired {
          background: linear-gradient(135deg, rgba(254,242,242,.98), rgba(255,255,255,.96));
          border-color: rgba(239, 68, 68, .28);
        }

        .saas-top-banner-left {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
        }

        .saas-top-icon {
          width: 42px;
          height: 42px;
          border-radius: 15px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          background: #dbeafe;
          color: #1d4ed8;
        }

        .saas-top-banner.warning .saas-top-icon {
          background: #ffedd5;
          color: #ea580c;
        }

        .saas-top-banner.expired .saas-top-icon {
          background: #fee2e2;
          color: #dc2626;
        }

        .saas-top-banner b {
          display: block;
          color: #0f172a;
          font-size: 14px;
          margin-bottom: 4px;
        }

        .saas-top-banner small {
          display: block;
          color: #64748b;
          font-size: 12px;
          line-height: 1.45;
        }

        .saas-top-banner button {
          border: 0;
          border-radius: 14px;
          padding: 11px 14px;
          background: #2563eb;
          color: #ffffff;
          font-weight: 900;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
          box-shadow: 0 12px 24px rgba(37, 99, 235, .22);
        }

        .saas-top-banner.warning button {
          background: #ea580c;
          box-shadow: 0 12px 24px rgba(234, 88, 12, .18);
        }

        .saas-top-banner.expired button {
          background: #dc2626;
          box-shadow: 0 12px 24px rgba(220, 38, 38, .18);
        }

        @media (max-width: 920px) {
          .topbar.topbar-dashboard {
            grid-template-columns: minmax(0, 1fr) auto;
          }

          .topbar-dashboard .topbar-title-block {
            grid-column: 1 / -1;
          }

          .topbar-dashboard .topbar-company-brand {
            grid-column: 1;
            grid-row: 2;
            justify-self: start;
            max-width: min(100%, 480px);
          }

          .topbar-dashboard .topbar-actions {
            grid-column: 2;
            grid-row: 2;
            width: auto;
            justify-content: flex-end;
          }
        }

        @media (max-width: 720px) {
          .topbar.topbar-dashboard {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            padding-left: 0;
          }

          .topbar-dashboard .topbar-company-brand {
            width: 100%;
            max-width: 100%;
          }

          .topbar-dashboard .topbar-company-name {
            font-size: 13px;
          }

          .topbar-dashboard .topbar-actions {
            display: inline-flex;
            flex-wrap: nowrap;
            gap: 8px;
          }

          .topbar-dashboard .user-chip {
            width: 44px;
            height: 44px;
            min-width: 44px;
            padding: 5px;
            justify-content: center;
          }

          .topbar-dashboard .user-chip > span:last-child {
            display: none;
          }

          .saas-top-banner {
            align-items: stretch;
            flex-direction: column;
          }

          .saas-top-banner button {
            width: 100%;
            justify-content: center;
          }

          .layout-photo-aware .user-chip span:last-child {
            max-width: 110px;
          }

          .notification-panel {
            position: fixed;
            top: 72px;
            right: 12px;
            left: 12px;
            width: auto;
          }

          .layout-popup-backdrop {
            align-items: flex-start;
            padding-top: 76px;
          }

          .layout-popup-actions {
            flex-direction: column;
          }

          .layout-popup-soft,
          .layout-popup-primary {
            width: 100%;
          }
        }
      `}</style>

      <button
        type="button"
        className={`mobile-menu-btn ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen((value) => !value)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-brand platform-side-brand">
          <span className="platform-side-logo">
            {platformLogoUrl && !platformLogoFailed ? (
              <img
                src={platformLogoUrl}
                alt="YourComate logo"
                onError={() => setPlatformLogoFailed(true)}
              />
            ) : (
              <b>YC</b>
            )}
          </span>

          <div className="platform-side-copy">
            <b>YourComate</b>
            <small>{platformTagline}</small>
          </div>
        </div>

        {saasSummary.showSaasBanner ? (
          <div className={`saas-sidebar-card ${saasBanner.expired ? 'expired' : ''}`}>
            <strong>
              {saasBanner.expired ? <AlertTriangle size={15} /> : <CalendarClock size={15} />}
              {saasBanner.title}
            </strong>
            <p>{saasBanner.sidebarMessage}</p>
            <button
              type="button"
              onClick={saasSummary.isExpired ? goToSubscriptionExpired : goToBilling}
            >
              <CreditCard size={14} />
              {saasBanner.actionLabel}
            </button>
          </div>
        ) : null}

        <nav>
          <button
            type="button"
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => goTo('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>

          {groupedModules.map(({ group, modules: groupModules }) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-title">{group}</div>

                    {groupModules.map(([key, title, Icon]) => {
                      const targetPage =
                        key === 'team_field_attendance'
                          ? 'my_visits'
                          : key;

                      return (
                        <button
                          type="button"
                          key={key}
                          className={page === targetPage ? 'active' : ''}
                          onClick={() => goTo(targetPage)}
                        >
                          {Icon ? <Icon size={18} /> : null}
                          {title}
                        </button>
                      );
                    })}
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="logout"
          onClick={logout}
          aria-label="Logout"
        >
          <LogOut size={18} /> Logout
        </button>
      </aside>

      <main className="main">
        <header
          className={`topbar ${page === 'dashboard' ? 'topbar-dashboard' : ''}`}
        >
          <div className="topbar-title-block">
            <h2>{currentTitle}</h2>

            {page !== 'dashboard' ? (
              <>
                <p>
                  {displayRole}
                  {capabilityText ? ` • ${capabilityText}` : ''}
                  {saasSummary.companyName ? ` • ${saasSummary.companyName}` : ''}
                </p>

                {safeUser.roles.length > 0 ? (
                  <small>
                    Access: {safeUser.roles.map(roleLabel).join(', ')}
                  </small>
                ) : null}
              </>
            ) : null}
          </div>

          {page === 'dashboard' ? (
            <div
              className="topbar-company-brand"
              title={headerCompanyName}
              aria-label={`Company: ${headerCompanyName}`}
            >
              <span className="topbar-company-logo">
                {headerCompanyLogoUrl && !companyLogoFailed ? (
                  <img
                    src={headerCompanyLogoUrl}
                    alt={`${headerCompanyName} logo`}
                    onError={() => setCompanyLogoFailed(true)}
                  />
                ) : (
                  <b>{companyInitials(headerCompanyName)}</b>
                )}
              </span>

              <span className="topbar-company-name">
                {headerCompanyName}
              </span>
            </div>
          ) : null}

          <div className="topbar-actions">
            <div className="notification-wrap" ref={notificationRef}>
              <button
                type="button"
                className="icon-button notification-btn"
                onClick={toggleNotifications}
                aria-label="Open notifications"
              >
                <Bell size={18} />

                {notificationCount > 0 ? (
                  <span className="notification-badge">
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </span>
                ) : null}
              </button>

              {notificationOpen && (
                <div className="notification-panel">
                  <div className="notification-head">
                    <div>
                      <b>Notifications</b>
                      <small>{notificationCount} unread</small>
                    </div>

                    <button
                      type="button"
                      className="notification-mark-all"
                      onClick={markAllNotificationsRead}
                      disabled={!notificationCount}
                    >
                      <CheckCheck size={14} />
                      Mark all read
                    </button>
                  </div>

                  {notificationMessage && (
                    <div className="notification-message">
                      {notificationMessage}
                    </div>
                  )}

                  <div className="notification-list">
                    {notificationLoading && (
                      <div className="notification-empty">
                        Loading notifications...
                      </div>
                    )}

                    {!notificationLoading && !notifications.length && (
                      <div className="notification-empty">
                        No notifications found.
                      </div>
                    )}

                    {!notificationLoading &&
                      notifications.map((notification) => (
                        <button
                          type="button"
                          key={notification._id}
                          className={`notification-item ${
                            notificationIsUnread(notification) ? 'unread' : 'read'
                          }`}
                          onClick={() => markNotificationRead(notification)}
                        >
                          <span className="notification-dot" />

                          <span>
                            <b>{notification.title || 'Notification'}</b>
                            <small>{notificationBody(notification)}</small>
                            <em>{formatNotificationTime(notification.created_at)}</em>
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="user-chip"
              onClick={() => goTo('profile')}
              aria-label="Open my profile"
            >
              <UserAvatar user={safeUser} size="sm" />
              <span>{safeUser?.name || safeUser?.email || 'User'}</span>
            </button>
          </div>
        </header>

        {saasSummary.showSaasBanner ? (
          <div
            className={`saas-top-banner ${
              saasBanner.expired
                ? 'expired'
                : saasSummary.isPaidRenewalSoon ||
                    (saasSummary.daysLeft !== null && saasSummary.daysLeft <= 5)
                  ? 'warning'
                  : ''
            }`}
          >
            <div className="saas-top-banner-left">
              <span className="saas-top-icon">
                {saasBanner.expired ? (
                  <AlertTriangle size={22} />
                ) : (
                  <CalendarClock size={22} />
                )}
              </span>

              <div>
                <b>{saasBanner.title}</b>
                <small>{saasBanner.message}</small>
              </div>
            </div>

            <button
              type="button"
              onClick={saasSummary.isExpired ? goToSubscriptionExpired : goToBilling}
            >
              <CreditCard size={16} />
              {saasBanner.actionLabel}
            </button>
          </div>
        ) : null}

        {children}
      </main>

      {popupNotification ? (
        <div className="layout-popup-backdrop">
          <div className="layout-popup-card">
            <div className="layout-popup-top">
              <span>
                <Bell size={15} />
                New Notification
              </span>

              <button
                type="button"
                className="layout-popup-close"
                onClick={() => markNotificationPopupSeen(popupNotification)}
                aria-label="Close notification popup"
              >
                <X size={18} />
              </button>
            </div>

            <div className="layout-popup-body">
              <h3>{popupNotification.title || 'Notification'}</h3>
              <p>{notificationBody(popupNotification)}</p>

              <div className="layout-popup-meta">
                <span className="layout-popup-pill">
                  {popupNotification.priority || 'normal'}
                </span>
                <span className="layout-popup-pill">
                  {popupNotification.notification_type || 'general'}
                </span>
                {popupNotification.created_by_name ? (
                  <span className="layout-popup-pill">
                    From: {popupNotification.created_by_name}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="layout-popup-actions">
              <button
                type="button"
                className="layout-popup-soft"
                onClick={() => markNotificationPopupSeen(popupNotification)}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="layout-popup-primary"
                onClick={() => openPopupNotification(popupNotification)}
              >
                Open Notification
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}