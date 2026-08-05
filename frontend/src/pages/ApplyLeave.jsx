import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileText,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  applyLeaveRequest,
  getLeaveOptions,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const HR_ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);

const ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
]);

const HR_ROLES = new Set([
  'hr_admin',
  'hr_manager',
  'hr',
]);

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  leave_type: 'CL',
  from_date: today,
  to_date: today,
  day_type: 'full_day',
  reason: '',
  project_handover_id: '',
  work_project_name: '',
  task_handover_to_id: '',
};

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const roles = new Set();

  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  if (typeof user.roles === 'string') {
    user.roles.split(',').forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  const role = normalizeRole(user.role);
  if (role) roles.add(role);

  return Array.from(roles);
}

function hasAnyRole(userRoles, roleSet) {
  return userRoles.some((role) => roleSet.has(role));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }

  return '';
}

function getEmployeeProfile(user = {}) {
  const employee = user.employee || user.employee_summary || user.employee_profile || {};

  return {
    employee_name: firstNonEmpty(
      employee.name,
      employee.employee_name,
      employee.full_name,
      user.name,
      user.full_name,
      user.email,
    ),
    employee_code: firstNonEmpty(
      employee.employee_code,
      employee.emp_code,
      employee.code,
      user.employee_code,
      user.emp_code,
      user.code,
    ),
    department: firstNonEmpty(employee.department, user.department),
    designation: firstNonEmpty(employee.designation, user.designation),
    team_leader_id: firstNonEmpty(
      employee.team_leader_id,
      employee.team_leader_employee_id,
      user.team_leader_id,
      user.team_leader_employee_id,
    ),
    team_leader_name: firstNonEmpty(employee.team_leader_name, user.team_leader_name),
    reporting_officer_id: firstNonEmpty(
      employee.reporting_officer_id,
      employee.reporting_officer_employee_id,
      user.reporting_officer_id,
      user.reporting_officer_employee_id,
    ),
    reporting_officer_name: firstNonEmpty(
      employee.reporting_officer_name,
      user.reporting_officer_name,
    ),
  };
}

function projectName(project = {}) {
  return (
    project.name ||
    project.project_name ||
    project.title ||
    project.project_title ||
    'Project'
  );
}

function memberName(member = {}) {
  const name =
    member.name ||
    member.employee_name ||
    member.full_name ||
    member.email ||
    'Employee';

  const code =
    member.employee_code ||
    member.emp_code ||
    member.employee_id ||
    member.code ||
    '';

  return code ? `${name} (${code})` : name;
}


function getSaasTenant(user = {}) {
  return user.tenant || user.company || {};
}

function getSaasSubscription(user = {}) {
  return user.subscription || user.saas_subscription || {};
}

function getSaasPlanType(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasStatus(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.status ||
      tenant.status ||
      user.subscription_status ||
      user.status ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getCompanyName(user = {}) {
  const tenant = getSaasTenant(user);

  return (
    user.company_name ||
    tenant.company_name ||
    tenant.name ||
    'Your company'
  );
}

function getTrialEndDate(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return (
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
  );
}

function getDemoEmployeeLimit(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  const rawLimit =
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    10;

  const parsed = Number(rawLimit);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function formatSaasDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getTrialDaysLeft(value) {
  if (!value) {
    return null;
  }

  const endDate = new Date(value);

  if (Number.isNaN(endDate.getTime())) {
    return null;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const endStart = new Date(endDate);
  endStart.setHours(0, 0, 0, 0);

  const diff = Math.ceil((endStart - todayStart) / (1000 * 60 * 60 * 24));

  return Math.max(diff, 0);
}

function daysBetween(fromDate, toDate, dayType) {
  if (dayType === 'half_day') return 0.5;

  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate || fromDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 1;
  }

  const diff = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;

  return diff > 0 ? diff : 1;
}


function normalizeLeaveCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
}

function findLeaveBalance(source, codes = []) {
  const wanted = codes.map(normalizeLeaveCode);

  const rows = Array.isArray(source)
    ? source
    : Array.isArray(source?.items)
      ? source.items
      : Array.isArray(source?.leave_balances)
        ? source.leave_balances
        : [];

  const match = rows.find((row = {}) => {
    const candidates = [
      row.leave_type,
      row.leave_type_code,
      row.leave_code,
      row.code,
      row.type,
      row.leave_type_label,
      row.name,
    ].map(normalizeLeaveCode);

    return candidates.some((candidate) => wanted.includes(candidate));
  });

  if (!match) return 0;

  const rawValue =
    match.available ??
    match.available_balance ??
    match.balance ??
    match.remaining ??
    match.remaining_balance ??
    match.current_balance ??
    0;

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractLeaveBalances(data = {}) {
  const source =
    data.leave_balances ||
    data.balances ||
    data.employee_leave_balances ||
    data.leave_balance ||
    data;

  return {
    cl: findLeaveBalance(source, ['CL', 'CASUAL LEAVE']),
    el: findLeaveBalance(source, ['EL', 'EARNED LEAVE']),
  };
}

export default function ApplyLeave({ user = {}, setPage } = {}) {
  const alerts = useCustomAlert();
  const userRoles = useMemo(() => normalizeRoles(user), [user]);
  const isHrAdminUser = hasAnyRole(userRoles, HR_ADMIN_ROLES);
  const isAdminUser = hasAnyRole(userRoles, ADMIN_ROLES);
  const isHrUser = hasAnyRole(userRoles, HR_ROLES) && !isAdminUser;
  const employeeProfile = useMemo(() => getEmployeeProfile(user), [user]);

  const saasPlanType = getSaasPlanType(user);
  const saasStatus = getSaasStatus(user);
  const isDemoTenant = saasPlanType === 'demo';
  const isExpiredOrSuspendedTenant = saasStatus === 'expired' || saasStatus === 'suspended';
  const trialEndDate = getTrialEndDate(user);
  const trialDaysLeft = getTrialDaysLeft(trialEndDate);
  const demoEmployeeLimit = getDemoEmployeeLimit(user);
  const showDemoAccessBanner = isDemoTenant || isExpiredOrSuspendedTenant;


  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState({ cl: 0, el: 0 });
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const leaveDays = useMemo(
    () => daysBetween(form.from_date, form.to_date, form.day_type),
    [form.from_date, form.to_date, form.day_type],
  );

  const approvalText = useMemo(() => {
    if (isHrUser) return 'This leave request will be sent to Admin for approval.';
    if (isAdminUser) return 'This leave request will be sent to HR for approval.';

    const teamLeaderName = employeeProfile.team_leader_name;
    const reportingOfficerName = employeeProfile.reporting_officer_name;
    const teamLeaderId = String(employeeProfile.team_leader_id || '').trim();
    const reportingOfficerId = String(employeeProfile.reporting_officer_id || '').trim();

    const sameTeamLeaderAndReportingOfficer = Boolean(
      teamLeaderName &&
      reportingOfficerName &&
      (
        (
          teamLeaderId &&
          reportingOfficerId &&
          teamLeaderId === reportingOfficerId
        ) ||
        teamLeaderName.trim().toLowerCase() === reportingOfficerName.trim().toLowerCase()
      )
    );

    if (sameTeamLeaderAndReportingOfficer) {
      return `This leave request will be sent to ${teamLeaderName} for approval.`;
    }

    if (teamLeaderName && reportingOfficerName) {
      return `This leave request will be sent to ${teamLeaderName} first, then ${reportingOfficerName}.`;
    }

    if (teamLeaderName) {
      return `This leave request will be sent to ${teamLeaderName} for approval.`;
    }

    if (reportingOfficerName) {
      return `This leave request will be sent to ${reportingOfficerName} for approval.`;
    }

    return 'This leave request will be sent to HR.';
  }, [isHrUser, isAdminUser, employeeProfile]);

  async function loadOptions() {
    try {
      setLoadingOptions(true);

      const data = await getLeaveOptions();

      setProjects(data.projects || []);
      setMembers(data.task_handover_options || data.members || []);
      setLeaveBalances(extractLeaveBalances(data));
        } catch (error) {
          setProjects([]);
          setMembers([]);
          setLeaveBalances({ cl: 0, el: 0 });
          alerts.error(error.message || 'Unable to load leave options.');
        } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  function openBillingPage() {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    try {
      window.history.pushState({}, '', '/billing');
    } catch {
      // Ignore browser history errors.
    }
  }

  function updateForm(key, value) {
    setForm((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === 'leave_type' && value === 'HALF-DAY') {
        next.day_type = 'half_day';
        next.to_date = next.from_date;
      }

      if (key === 'day_type' && value === 'half_day') {
        next.leave_type = 'HALF-DAY';
        next.to_date = next.from_date;
      }

      if (key === 'from_date' && current.day_type === 'half_day') {
        next.to_date = value;
      }

      return next;
    });
  }

async function handleSubmit(event) {
  event.preventDefault();

  if (isExpiredOrSuspendedTenant) {
    alerts.warning(
      'Your demo subscription is expired or suspended. Please upgrade to continue.',
      'Subscription Required',
    );
    openBillingPage();
    return;
  }

  if (!form.from_date || !form.to_date) {
      alerts.warning('From date and to date are required.', 'Missing Details');
      return;
    }

    if (form.to_date < form.from_date) {
      alerts.warning('To date cannot be before from date.', 'Invalid Date Range');
      return;
    }

    if (!form.reason.trim()) {
      alerts.warning('Leave reason is required.', 'Missing Reason');
      return;
    }

    if (isHrAdminUser && !form.work_project_name.trim() && !form.project_handover_id) {
          alerts.warning(
          'Please enter your work/project details before applying leave.',
          'Work Details Required',
        );
      return;
    }

    try {
      setSubmitting(true);

      const selectedProject = projects.find((project) => String(project._id || project.id) === form.project_handover_id);

      const payload = {
        leave_type: form.day_type === 'half_day' ? 'HALF-DAY' : form.leave_type,
        from_date: form.from_date,
        to_date: form.to_date,
        upto_date: form.to_date,
        day_type: form.day_type,
        is_half_day: form.day_type === 'half_day',
        leave_days: leaveDays,
        reason: form.reason.trim(),
        task_handover_to_id: form.task_handover_to_id,
        project_handover_id: form.project_handover_id,
        project_handover_name: selectedProject ? projectName(selectedProject) : '',
        work_project_name: form.work_project_name.trim(),
        manual_project_name: form.work_project_name.trim(),
      };

      const data = await applyLeaveRequest(payload);

      alerts.success(data.message || 'Leave request submitted successfully.', 'Leave Submitted');

      setForm({
        ...EMPTY_FORM,
        from_date: today,
        to_date: today,
      });
    } catch (error) {
      alerts.error(error.message || 'Unable to submit leave request.', 'Leave Not Submitted');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="apply-leave-page">
      <style>
        {`
          .apply-leave-page {
            --al-ink: #101a3a;
            --al-ink-soft: #5b6f92;
            --al-violet: #6658dc;
            --al-violet-deep: #40348d;
            --al-blue: #3766db;
            --al-cyan: #18b5c8;
            --al-teal: #34c9c4;
            --al-paper: #fbfcff;
            --al-line: rgba(16, 26, 58, 0.14);
            display: grid;
            gap: clamp(18px, 2vw, 26px);
            color: var(--al-ink);
          }

          .apply-leave-hero {
            position: relative;
            isolation: isolate;
            overflow: hidden;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 24px;
            align-items: center;
            min-height: 245px;
            padding: clamp(24px, 3vw, 42px);
            border: 1px solid rgba(154, 164, 205, 0.58);
            border-radius: clamp(28px, 2.6vw, 40px);
            background:
              radial-gradient(circle at 9% 8%, rgba(105, 217, 208, 0.24), transparent 29%),
              radial-gradient(circle at 94% 10%, rgba(153, 164, 245, 0.24), transparent 31%),
              linear-gradient(135deg, #edf8ff 0%, #f8f3ff 52%, #f0fbf8 100%);
            box-shadow:
              12px 14px 0 #c6d8f7,
              0 28px 48px rgba(34, 38, 110, 0.13);
          }

          .apply-leave-hero::before {
            content: "";
            position: absolute;
            z-index: -1;
            width: 150px;
            height: 150px;
            right: 9%;
            bottom: -84px;
            border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
            background: linear-gradient(145deg, rgba(105, 217, 208, .30), rgba(132, 181, 241, .28));
            transform: rotate(-18deg);
          }

          .apply-leave-kicker,
          .apply-leave-section-kicker {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            width: max-content;
            max-width: 100%;
            border-radius: 999px;
            color: #ffffff;
            background: #342b78;
            font-size: 9px;
            font-weight: 950;
            line-height: 1;
            letter-spacing: .12em;
            text-transform: uppercase;
          }

          .apply-leave-kicker {
            margin-bottom: 15px;
            padding: 9px 13px;
          }

          .apply-leave-section-kicker {
            margin-bottom: 10px;
            padding: 7px 10px;
          }

          .apply-leave-hero h1 {
            max-width: 780px;
            margin: 0;
            color: var(--al-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(42px, 5vw, 76px);
            font-weight: 760;
            line-height: .94;
            letter-spacing: -.058em;
          }

          .apply-leave-hero h1 em {
            display: inline;
            color: var(--al-violet);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 500;
          }

          .apply-leave-hero p {
            max-width: 760px;
            margin: 17px 0 0;
            color: var(--al-ink-soft);
            font-size: clamp(13px, 1vw, 16px);
            line-height: 1.68;
          }

          .apply-leave-refresh,
          .apply-leave-upgrade-btn,
          .apply-leave-submit {
            border: 1px solid rgba(65, 55, 161, .18);
            font-weight: 950;
            cursor: pointer;
            transition:
              transform 190ms cubic-bezier(.22, 1, .36, 1),
              box-shadow 190ms ease,
              filter 190ms ease;
          }

          .apply-leave-refresh {
            min-height: 54px;
            padding: 0 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            border-radius: 18px;
            color: #342b78;
            background: rgba(255, 255, 255, .88);
            box-shadow:
              6px 7px 0 #b9d7ff,
              0 14px 25px rgba(44, 75, 116, .10);
            white-space: nowrap;
          }

          .apply-leave-refresh svg {
            animation: applyLeaveRefreshIdle 4.2s linear infinite;
          }

          .apply-leave-refresh:hover,
          .apply-leave-upgrade-btn:hover,
          .apply-leave-submit:hover {
            transform: translateY(-3px);
            filter: saturate(1.05);
          }

          .apply-leave-refresh:hover {
            box-shadow:
              8px 9px 0 #b9d7ff,
              0 18px 30px rgba(44, 75, 116, .14);
          }

          .apply-leave-refresh:disabled svg {
            animation: applyLeaveSpin 1s linear infinite;
          }

          .apply-leave-alert {
            padding: 14px 16px;
            border: 1px solid #b9d7ff;
            border-radius: 18px;
            color: #244f9b;
            background: #edf6ff;
            box-shadow: 5px 6px 0 rgba(185, 215, 255, .9);
            font-weight: 780;
          }

          .apply-leave-balance-strip {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .apply-leave-balance-card {
            --balance-bg: #edf6ff;
            --balance-shadow: #b9d7ff;
            position: relative;
            isolation: isolate;
            overflow: hidden;
            display: grid;
            grid-template-columns: 54px minmax(0, 1fr) auto;
            align-items: center;
            gap: 15px;
            min-height: 112px;
            padding: 18px;
            border: 1px solid rgba(178, 185, 210, .72);
            border-radius: 25px;
            background: var(--balance-bg);
            box-shadow:
              8px 10px 0 var(--balance-shadow),
              0 18px 30px rgba(15, 20, 75, .11);
            transition:
              transform 210ms cubic-bezier(.22, 1, .36, 1),
              box-shadow 210ms ease;
          }

          .apply-leave-balance-card.el {
            --balance-bg: #eaf8f4;
            --balance-shadow: #aee6d9;
          }

          .apply-leave-balance-card:hover {
            transform: translateY(-4px);
            box-shadow:
              10px 12px 0 var(--balance-shadow),
              0 23px 38px rgba(15, 20, 75, .14);
          }

          .apply-leave-balance-icon {
            width: 54px;
            height: 54px;
            display: grid;
            place-items: center;
            border-radius: 17px;
            color: #ffffff;
            background: linear-gradient(145deg, #3f7ef0, #2ed1c1);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
            animation: applyLeaveIconFloat 3.4s ease-in-out infinite;
          }

          .apply-leave-balance-card.el .apply-leave-balance-icon {
            background: linear-gradient(145deg, #6658dc, #34c9c4);
            animation-delay: -.9s;
          }

          .apply-leave-balance-copy span {
            display: block;
            color: #566483;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .11em;
            text-transform: uppercase;
          }

          .apply-leave-balance-copy strong {
            display: block;
            margin-top: 6px;
            color: var(--al-ink);
            font-size: clamp(17px, 1.5vw, 23px);
          }

          .apply-leave-balance-value {
            color: var(--al-violet-deep);
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(34px, 3vw, 48px);
            font-weight: 760;
            line-height: 1;
          }

          .apply-leave-saas-banner {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 18px;
            padding: 20px;
            border: 1px solid rgba(178, 185, 210, .72);
            border-radius: 26px;
            background: linear-gradient(145deg, #edf6ff, #f5f3ff);
            box-shadow:
              7px 8px 0 #b9d7ff,
              0 18px 30px rgba(44, 75, 116, .10);
          }

          .apply-leave-saas-banner.expired {
            background: linear-gradient(145deg, #fff4d5, #fffaf0);
            box-shadow:
              7px 8px 0 #ffe0a5,
              0 18px 30px rgba(116, 75, 44, .10);
          }

          .apply-leave-saas-content {
            display: flex;
            gap: 14px;
            align-items: flex-start;
            min-width: 0;
          }

          .apply-leave-saas-icon {
            width: 48px;
            height: 48px;
            flex: 0 0 auto;
            display: grid;
            place-items: center;
            border-radius: 16px;
            color: #ffffff;
            background: #342b78;
          }

          .apply-leave-saas-banner.expired .apply-leave-saas-icon {
            background: #d97706;
          }

          .apply-leave-saas-content h3 {
            margin: 0;
            color: var(--al-ink);
            font-family: var(--yc-display, Georgia, serif);
            font-size: 23px;
            letter-spacing: -.035em;
          }

          .apply-leave-saas-content p {
            margin: 7px 0 0;
            color: var(--al-ink-soft);
            line-height: 1.6;
          }

          .apply-leave-saas-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
          }

          .apply-leave-saas-meta span {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 10px;
            border: 1px solid rgba(65, 55, 161, .13);
            border-radius: 999px;
            color: #334155;
            background: rgba(255,255,255,.78);
            font-size: 11px;
            font-weight: 820;
          }

          .apply-leave-upgrade-btn {
            min-height: 46px;
            padding: 0 15px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border-radius: 16px;
            color: #ffffff;
            background: #342b78;
            box-shadow:
              5px 6px 0 #18b5c8,
              0 14px 25px rgba(52, 43, 120, .16);
            white-space: nowrap;
          }

          .apply-leave-layout {
            display: grid;
            grid-template-columns: minmax(310px, .72fr) minmax(0, 1.28fr);
            gap: 24px;
            align-items: start;
          }

          .apply-leave-panel {
            min-width: 0;
            padding: clamp(20px, 2vw, 28px);
            border: 1px solid rgba(171, 181, 211, .72);
            border-radius: clamp(28px, 2.3vw, 38px);
            background: linear-gradient(145deg, #ffffff, #f7fbff);
            box-shadow:
              10px 12px 0 #c4ccff,
              0 28px 48px rgba(34, 38, 110, .12);
          }

          .apply-leave-panel.form-panel {
            background: linear-gradient(145deg, #f4fbff 0%, #f8f1ff 52%, #fff8e8 100%);
            box-shadow:
              12px 14px 0 #b9d7ff,
              0 30px 50px rgba(34, 38, 110, .14);
          }

          .apply-leave-panel h2,
          .apply-leave-panel h3 {
            margin: 0;
            color: var(--al-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(27px, 2.5vw, 40px);
            font-weight: 760;
            line-height: .98;
            letter-spacing: -.045em;
          }

          .apply-leave-panel > p {
            margin: 9px 0 0;
            color: var(--al-ink-soft);
            line-height: 1.58;
          }

          .apply-leave-profile-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-top: 18px;
          }

          .apply-leave-profile-grid div,
          .apply-leave-summary-card {
            min-width: 0;
            padding: 13px;
            border: 1px solid rgba(162, 169, 196, .48);
            border-radius: 17px;
            background: rgba(255,255,255,.80);
            box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
          }

          .apply-leave-profile-grid span,
          .apply-leave-summary-card span {
            display: block;
            margin-bottom: 6px;
            color: #625f7f;
            font-size: 8px;
            font-weight: 950;
            letter-spacing: .10em;
            text-transform: uppercase;
          }

          .apply-leave-profile-grid strong,
          .apply-leave-summary-card strong {
            color: var(--al-ink);
            font-size: 13px;
            overflow-wrap: anywhere;
          }

          .apply-leave-summary {
            display: grid;
            gap: 11px;
            margin-top: 16px;
          }

          .apply-leave-summary-card.info {
            border-color: rgba(98, 84, 218, .25);
            background: #f1efff;
            box-shadow: 4px 5px 0 #c9c0ff;
          }

          .apply-leave-form {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 15px;
            margin-top: 20px;
          }

          .apply-leave-field {
            display: grid;
            gap: 8px;
            min-width: 0;
          }

          .apply-leave-field.full {
            grid-column: 1 / -1;
          }

          .apply-leave-field label {
            color: #303b5b;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: .025em;
          }

          .apply-leave-field input,
          .apply-leave-field select,
          .apply-leave-field textarea {
            width: 100%;
            min-width: 0;
            min-height: 50px;
            padding: 0 14px;
            border: 1px solid rgba(151, 161, 197, .58);
            border-radius: 15px;
            outline: none;
            color: var(--al-ink);
            background: rgba(255,255,255,.92);
            font-size: 13px;
            transition:
              border-color 170ms ease,
              box-shadow 170ms ease,
              transform 170ms ease;
          }

          .apply-leave-field textarea {
            min-height: 128px;
            padding: 14px;
            resize: vertical;
          }

          .apply-leave-field input:focus,
          .apply-leave-field select:focus,
          .apply-leave-field textarea:focus {
            border-color: rgba(98, 84, 218, .65);
            box-shadow:
              4px 5px 0 rgba(102, 88, 220, .15),
              0 0 0 4px rgba(102, 88, 220, .09);
            transform: translateY(-1px);
          }

          .apply-leave-submit {
            grid-column: 1 / -1;
            min-height: 56px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            border-radius: 18px;
            color: #ffffff;
            background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
            box-shadow:
              7px 8px 0 #a9d6f5,
              0 18px 30px rgba(36, 74, 128, .18);
          }

          .apply-leave-submit svg {
            animation: applyLeaveSendFloat 2.8s ease-in-out infinite;
          }

          .apply-leave-submit:hover {
            box-shadow:
              9px 10px 0 #a9d6f5,
              0 22px 34px rgba(36, 74, 128, .22);
          }

          .apply-leave-submit:disabled,
          .apply-leave-refresh:disabled {
            opacity: .68;
            cursor: not-allowed;
            transform: none;
          }

          @keyframes applyLeaveIconFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-4px) rotate(-3deg); }
          }

          @keyframes applyLeaveSendFloat {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            50% { transform: translate(3px, -2px) rotate(4deg); }
          }

          @keyframes applyLeaveRefreshIdle {
            0%, 84% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes applyLeaveSpin {
            to { transform: rotate(360deg); }
          }

          @media (max-width: 1100px) {
            .apply-leave-layout {
              grid-template-columns: 1fr;
            }

            .apply-leave-profile-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 760px) {
            .apply-leave-page {
              gap: 18px;
            }

            .apply-leave-hero {
              grid-template-columns: 1fr;
              min-height: 0;
              padding: 22px;
              border-radius: 26px;
              box-shadow:
                6px 7px 0 #c6d8f7,
                0 18px 30px rgba(34, 38, 110, .10);
            }

            .apply-leave-hero h1 {
              font-size: clamp(36px, 10vw, 52px);
            }

            .apply-leave-refresh {
              width: 100%;
            }

            .apply-leave-balance-strip {
              gap: 12px;
            }

            .apply-leave-balance-card {
              grid-template-columns: 42px minmax(0, 1fr);
              min-height: 100px;
              gap: 10px;
              padding: 14px;
              border-radius: 20px;
              box-shadow:
                5px 6px 0 var(--balance-shadow),
                0 13px 22px rgba(15, 20, 75, .09);
            }

            .apply-leave-balance-icon {
              width: 42px;
              height: 42px;
              border-radius: 13px;
            }

            .apply-leave-balance-value {
              grid-column: 1 / -1;
              justify-self: end;
              margin-top: -34px;
              font-size: 30px;
            }

            .apply-leave-saas-banner {
              flex-direction: column;
              border-radius: 22px;
            }

            .apply-leave-upgrade-btn {
              width: 100%;
              justify-content: center;
            }

            .apply-leave-panel {
              padding: 18px;
              border-radius: 24px;
              box-shadow:
                6px 7px 0 #c4ccff,
                0 18px 30px rgba(34, 38, 110, .10);
            }

            .apply-leave-panel.form-panel {
              box-shadow:
                6px 7px 0 #b9d7ff,
                0 18px 30px rgba(34, 38, 110, .11);
            }

            .apply-leave-profile-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .apply-leave-form {
              grid-template-columns: 1fr;
            }

            .apply-leave-field.full,
            .apply-leave-submit {
              grid-column: auto;
            }
          }

          @media (max-width: 430px) {
            .apply-leave-balance-strip,
            .apply-leave-profile-grid {
              grid-template-columns: 1fr;
            }

            .apply-leave-balance-card {
              grid-template-columns: 42px minmax(0, 1fr) auto;
            }

            .apply-leave-balance-value {
              grid-column: auto;
              justify-self: end;
              margin-top: 0;
            }

            .apply-leave-saas-content {
              gap: 10px;
            }

            .apply-leave-saas-icon {
              width: 40px;
              height: 40px;
              border-radius: 13px;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .apply-leave-page *,
            .apply-leave-page *::before,
            .apply-leave-page *::after {
              animation: none !important;
              transition: none !important;
            }
          }
        `}
      </style>

      <section className="apply-leave-hero">
        <div>
          <span className="apply-leave-kicker">
            <Sparkles size={13} />
            Employee Leave Workspace
          </span>
          <h1>
            Plan your time off, <em>clearly.</em>
          </h1>
          <p>
            Submit a leave request, review your available Casual Leave and
            Earned Leave, confirm the approval path, and hand over work from
            one connected YourComate workspace.
          </p>
        </div>

        <button
          type="button"
          className="apply-leave-refresh"
          onClick={loadOptions}
          disabled={loadingOptions}
        >
          <RefreshCcw size={16} />
          {loadingOptions ? 'Refreshing...' : 'Refresh'}
          <ArrowUpRight size={15} />
        </button>
      </section>

      <section className="apply-leave-balance-strip" aria-label="Available leave balance">
        <article className="apply-leave-balance-card cl">
          <div className="apply-leave-balance-icon" aria-hidden="true">
            <CalendarDays size={23} />
          </div>

          <div className="apply-leave-balance-copy">
            <span>Available CL</span>
            <strong>Casual Leave</strong>
          </div>

          <div className="apply-leave-balance-value">
            {loadingOptions ? '—' : leaveBalances.cl}
          </div>
        </article>

        <article className="apply-leave-balance-card el">
          <div className="apply-leave-balance-icon" aria-hidden="true">
            <CheckCircle2 size={23} />
          </div>

          <div className="apply-leave-balance-copy">
            <span>Available EL</span>
            <strong>Earned Leave</strong>
          </div>

          <div className="apply-leave-balance-value">
            {loadingOptions ? '—' : leaveBalances.el}
          </div>
        </article>
      </section>

      {showDemoAccessBanner ? (
        <section
          className={`apply-leave-saas-banner ${isExpiredOrSuspendedTenant ? 'expired' : ''}`}
        >
          <div className="apply-leave-saas-content">
            <div className="apply-leave-saas-icon">
              {isExpiredOrSuspendedTenant ? (
                <AlertTriangle size={24} />
              ) : (
                <ShieldCheck size={24} />
              )}
            </div>

            <div>
              <h3>
                {isExpiredOrSuspendedTenant
                  ? 'Demo subscription expired'
                  : 'YourComate 15-Day Full Access Trial'}
              </h3>
              <p>
                {isExpiredOrSuspendedTenant
                  ? 'Your trial access is expired or suspended. Please upgrade to continue using HRMS modules.'
                  : `${getCompanyName(user)} is currently using trial access. Apply Leave is included in the demo plan along with Attendance and Projects.`}
              </p>

              <div className="apply-leave-saas-meta">
                <span>
                  <CalendarDays size={14} />
                  Trial ends: {formatSaasDate(trialEndDate)}
                </span>
                <span>
                  <FileText size={14} />
                  Days left: {trialDaysLeft === null ? 'N/A' : trialDaysLeft}
                </span>
                <span>
                  <UserCheck size={14} />
                  Employee limit: {demoEmployeeLimit}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="apply-leave-upgrade-btn"
            onClick={openBillingPage}
          >
            <CreditCard size={16} />
            Upgrade Plan
          </button>
        </section>
      ) : null}

      <section className="apply-leave-layout">
        <aside className="apply-leave-panel">
          <span className="apply-leave-section-kicker">Employee Context</span>
          <h2>Profile Summary</h2>
          <p>These details are auto-filled from your employee profile.</p>

          <div className="apply-leave-profile-grid">
            <div>
              <span>Employee</span>
              <strong>{employeeProfile.employee_name || '—'}</strong>
            </div>

            <div>
              <span>Employee Code</span>
              <strong>{employeeProfile.employee_code || '—'}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{employeeProfile.department || '—'}</strong>
            </div>

            <div>
              <span>Designation</span>
              <strong>{employeeProfile.designation || '—'}</strong>
            </div>

            <div>
              <span>Team Leader</span>
              <strong>{employeeProfile.team_leader_name || '—'}</strong>
            </div>

            <div>
              <span>Reporting Officer</span>
              <strong>{employeeProfile.reporting_officer_name || '—'}</strong>
            </div>
          </div>

          <div className="apply-leave-summary">
            <div className="apply-leave-summary-card info">
              <span>Approval Flow</span>
              <strong>{approvalText}</strong>
            </div>

            <div className="apply-leave-summary-card">
              <span>Calculated Days</span>
              <strong>{leaveDays}</strong>
            </div>
          </div>
        </aside>

        <main className="apply-leave-panel form-panel">
          <span className="apply-leave-section-kicker">Request Form</span>
          <h3>Leave Details</h3>
          <p>Fill the required leave details and submit for approval.</p>

          <form className="apply-leave-form" onSubmit={handleSubmit}>
            <div className="apply-leave-field">
              <label>Leave Type</label>
              <select
                value={form.leave_type}
                onChange={(event) => updateForm('leave_type', event.target.value)}
              >
                <option value="CL">Casual Leave</option>
                <option value="EL">Earned Leave</option>
                <option value="COMP-OFF">Comp-Off</option>
                <option value="HALF-DAY">Half Day</option>
              </select>
            </div>

            <div className="apply-leave-field">
              <label>Day Type</label>
              <select
                value={form.day_type}
                onChange={(event) => updateForm('day_type', event.target.value)}
              >
                <option value="full_day">Full Day</option>
                <option value="half_day">Half Day</option>
              </select>
            </div>

            <div className="apply-leave-field">
              <label>From Date</label>
              <input
                type="date"
                min={today}
                value={form.from_date}
                onChange={(event) => updateForm('from_date', event.target.value)}
              />
            </div>

            <div className="apply-leave-field">
              <label>To Date</label>
              <input
                type="date"
                min={form.from_date || today}
                value={form.to_date}
                disabled={form.day_type === 'half_day'}
                onChange={(event) => updateForm('to_date', event.target.value)}
              />
            </div>

            {isHrAdminUser ? (
              <>
                <div className="apply-leave-field">
                  <label>Assigned Project</label>
                  <select
                    value={form.project_handover_id}
                    onChange={(event) => updateForm('project_handover_id', event.target.value)}
                  >
                    <option value="">
                      {projects.length ? 'Select assigned project if applicable' : 'No assigned project'}
                    </option>

                    {projects.map((project) => {
                      const id = project._id || project.id || '';
                      return (
                        <option key={id || projectName(project)} value={id}>
                          {projectName(project)}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="apply-leave-field">
                  <label>Work / Project Details</label>
                  <input
                    type="text"
                    value={form.work_project_name}
                    placeholder="Type your current work or project manually"
                    onChange={(event) => updateForm('work_project_name', event.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="apply-leave-field">
                  <label>Project Handover</label>
                  <select
                    value={form.project_handover_id}
                    onChange={(event) => updateForm('project_handover_id', event.target.value)}
                  >
                    <option value="">No project handover</option>

                    {projects.map((project) => {
                      const id = project._id || project.id || '';
                      return (
                        <option key={id || projectName(project)} value={id}>
                          {projectName(project)}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="apply-leave-field">
                  <label>Task Handover To</label>
                  <select
                    value={form.task_handover_to_id}
                    onChange={(event) => updateForm('task_handover_to_id', event.target.value)}
                  >
                    <option value="">No handover required</option>

                    {members.map((member) => {
                      const id = member._id || member.id || member.employee_id || '';
                      return (
                        <option key={id || memberName(member)} value={id}>
                          {memberName(member)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </>
            )}

            <div className="apply-leave-field full">
              <label>Leave Reason</label>
              <textarea
                value={form.reason}
                placeholder="Write the reason for leave"
                onChange={(event) => updateForm('reason', event.target.value)}
              />
            </div>

            <button
              type="submit"
              className="apply-leave-submit"
              disabled={submitting || isExpiredOrSuspendedTenant}
            >
              <Send size={17} />
              {submitting ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </form>
        </main>
      </section>
    </div>
  );
}