import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  applyLeaveRequest,
  getLeaveOptions,
} from '../api/client';

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

function localDateInputValue(value = new Date()) {
  const localValue = new Date(
    value.getTime() - value.getTimezoneOffset() * 60 * 1000,
  );

  return localValue.toISOString().slice(0, 10);
}

function preventDateWheelChange(event) {
  event.currentTarget.blur();
}

const today = localDateInputValue();

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

const APPLY_LEAVE_NOTICE_HIDE_MS = 3600;

function ApplyLeaveInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`apply-leave-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="apply-leave-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="apply-leave-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="apply-leave-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="apply-leave-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export default function ApplyLeave({ user = {}, setPage } = {}) {
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
  const [refreshingOptions, setRefreshingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

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

  function clearFeedback(scopeKey) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => ({
      ...current,
      [scopeKey]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setFeedbackMap((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });

        delete feedbackTimersRef.current[scopeKey];
      }, APPLY_LEAVE_NOTICE_HIDE_MS);
    }
  }

  async function loadOptions({ showLoader = true, feedbackScope = '' } = {}) {
    if (showLoader) {
      setLoadingOptions(true);
    } else {
      setRefreshingOptions(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing leave balances and handover options...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const data = await getLeaveOptions();

      setProjects(data.projects || []);
      setMembers(data.task_handover_options || data.members || []);
      setLeaveBalances(extractLeaveBalances(data));

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Leave balances and handover options are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      const errorMessage =
        error.message || 'Unable to load leave options.';

      if (showLoader) {
        setProjects([]);
        setMembers([]);
        setLeaveBalances({ cl: 0, el: 0 });
      }

      showFeedback(
        feedbackScope || 'page',
        'error',
        errorMessage,
        feedbackScope ? 'Refresh Failed' : 'Leave Options Failed',
      );

      return false;
    } finally {
      if (showLoader) {
        setLoadingOptions(false);
      } else {
        setRefreshingOptions(false);
      }
    }
  }

  useEffect(() => {
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.apply-leave-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
  }, []);

  function openBillingPage() {
    showFeedback(
      'billing',
      'info',
      'Opening Billing so you can review or upgrade the subscription.',
      'Opening Billing',
    );

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
  clearFeedback('submit');

  if (isExpiredOrSuspendedTenant) {
    showFeedback(
      'submit',
      'warning',
      'Your demo subscription is expired or suspended. Please upgrade to continue.',
      'Subscription Required',
    );
    openBillingPage();
    return;
  }

  if (!form.from_date || !form.to_date) {
    showFeedback(
      'submit',
      'warning',
      'From date and to date are required.',
      'Missing Details',
    );
    return;
  }

  if (form.to_date < form.from_date) {
    showFeedback(
      'submit',
      'warning',
      'To date cannot be before from date.',
      'Invalid Date Range',
    );
    return;
  }

  if (!form.reason.trim()) {
    showFeedback(
      'submit',
      'warning',
      'Leave reason is required.',
      'Missing Reason',
    );
    return;
  }

  if (
    isHrAdminUser &&
    !form.work_project_name.trim() &&
    !form.project_handover_id
  ) {
    showFeedback(
      'submit',
      'warning',
      'Please enter your work/project details before applying leave.',
      'Work Details Required',
    );
    return;
  }

  try {
    setSubmitting(true);

    showFeedback(
      'submit',
      'info',
      'Submitting your leave request for approval...',
      'Submitting Leave',
      { loading: true },
    );

    const selectedProject = projects.find(
      (project) =>
        String(project._id || project.id) === form.project_handover_id,
    );

    const payload = {
      leave_type:
        form.day_type === 'half_day' ? 'HALF-DAY' : form.leave_type,
      from_date: form.from_date,
      to_date: form.to_date,
      upto_date: form.to_date,
      day_type: form.day_type,
      is_half_day: form.day_type === 'half_day',
      leave_days: leaveDays,
      reason: form.reason.trim(),
      task_handover_to_id: form.task_handover_to_id,
      project_handover_id: form.project_handover_id,
      project_handover_name: selectedProject
        ? projectName(selectedProject)
        : '',
      work_project_name: form.work_project_name.trim(),
      manual_project_name: form.work_project_name.trim(),
    };

    const data = await applyLeaveRequest(payload);

    showFeedback(
      'submit',
      'success',
      data.message || 'Leave request submitted successfully.',
      'Leave Submitted',
    );

    setForm({
      ...EMPTY_FORM,
      from_date: today,
      to_date: today,
    });
  } catch (error) {
    showFeedback(
      'submit',
      'error',
      error.message || 'Unable to submit leave request.',
      'Leave Not Submitted',
    );
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
            --al-copy: #5d6d8d;
            --al-blue: #4d77dd;
            --al-cyan: #2eb2b9;
            --al-violet: #575092;
            width: 100%;
            min-width: 0;
            display: grid;
            gap: clamp(16px, 1.8vw, 24px);
            color: var(--al-ink);
          }

          .apply-leave-page,
          .apply-leave-page * {
            box-sizing: border-box;
          }

          .apply-leave-page > *,
          .apply-leave-page section,
          .apply-leave-page article,
          .apply-leave-page form,
          .apply-leave-page label {
            min-width: 0;
            max-width: 100%;
          }

          .apply-leave-page::before,
          .apply-leave-page::after,
          .apply-leave-hero::before,
          .apply-leave-hero::after,
          .apply-leave-balance-card::before,
          .apply-leave-balance-card::after {
            content: none;
            display: none;
            background: none;
          }

          .apply-leave-hero {
            position: relative;
            isolation: isolate;
            overflow: hidden;
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(210px, 300px);
            gap: clamp(20px, 3vw, 38px);
            align-items: center;
            min-height: 240px;
            padding: clamp(24px, 3vw, 40px);
            border: 1px solid rgba(154, 164, 205, .58);
            border-radius: clamp(28px, 2.7vw, 40px);
            background:
              linear-gradient(
                90deg,
                #d3f4fb 0%,
                #f7fcfb 34%,
                #fffdf8 52%,
                #fbf8fa 68%,
                #f0edfb 100%
              );
            box-shadow: 0 22px 46px rgba(70, 92, 140, .10);
          }

          .apply-leave-hero-copy {
            min-width: 0;
            max-width: 900px;
          }

          .apply-leave-kicker,
          .apply-leave-section-kicker {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            width: max-content;
            max-width: 100%;
            border-radius: 999px;
            color: #fff;
            background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
            font-size: 9px;
            font-weight: 950;
            line-height: 1;
            letter-spacing: .12em;
            text-transform: uppercase;
          }

          .apply-leave-kicker {
            margin-bottom: 15px;
            padding: 9px 13px;
            box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
          }

          .apply-leave-section-kicker {
            margin-bottom: 10px;
            padding: 7px 10px;
            box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
          }

          .apply-leave-hero h1 {
            max-width: 820px;
            margin: 0;
            color: var(--al-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(44px, 5.2vw, 76px);
            font-weight: 760;
            line-height: .94;
            letter-spacing: -.058em;
          }

          .apply-leave-hero h1 em {
            color: var(--al-blue);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 500;
          }

          .apply-leave-hero p {
            max-width: 820px;
            margin: 17px 0 0;
            color: var(--al-copy);
            font-size: clamp(13px, 1vw, 16px);
            line-height: 1.68;
          }

          .apply-leave-refresh-stack,
          .apply-leave-upgrade-stack,
          .apply-leave-submit-stack {
            display: grid;
            gap: 9px;
            width: 100%;
            min-width: 0;
          }

          .apply-leave-refresh-stack {
            width: min(300px, 100%);
          }

          .apply-leave-refresh,
          .apply-leave-upgrade-btn,
          .apply-leave-submit {
            min-height: 44px;
            padding: 10px 15px;
            border: 1px solid transparent;
            border-radius: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font: inherit;
            font-size: 12px;
            font-weight: 900;
            cursor: pointer;
            transition:
              transform 180ms ease,
              border-color 180ms ease,
              filter 180ms ease,
              opacity 180ms ease;
          }

          .apply-leave-refresh {
            width: max-content;
            min-width: 140px;
            color: #4767b4;
            border-color: rgba(77, 119, 221, .18);
            background: #fff;
          }

          .apply-leave-upgrade-btn,
          .apply-leave-submit {
            color: #fff;
            background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
            box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
          }

          .apply-leave-refresh:hover:not(:disabled),
          .apply-leave-upgrade-btn:hover:not(:disabled),
          .apply-leave-submit:hover:not(:disabled) {
            transform: translateY(-1px);
            filter: saturate(1.03);
          }

          .apply-leave-refresh:disabled,
          .apply-leave-upgrade-btn:disabled,
          .apply-leave-submit:disabled {
            opacity: .55;
            cursor: not-allowed;
            transform: none;
          }

          .apply-leave-inline-feedback {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 9px;
            align-items: start;
            width: 100%;
            min-width: 0;
            padding: 10px 11px;
            border: 1px solid rgba(102, 88, 220, .18);
            border-radius: 12px;
            color: #40348d;
            background: #f1efff;
            font-size: 10px;
            line-height: 1.45;
          }

          .apply-leave-inline-feedback.success {
            border-color: rgba(4, 120, 87, .18);
            color: #047857;
            background: #eaf8f4;
          }

          .apply-leave-inline-feedback.warning {
            border-color: rgba(154, 104, 23, .18);
            color: #9a6817;
            background: #fff4d5;
          }

          .apply-leave-inline-feedback.error {
            border-color: rgba(162, 52, 77, .18);
            color: #a2344d;
            background: #fff0f2;
          }

          .apply-leave-inline-feedback-icon {
            width: 22px;
            height: 22px;
            display: inline-grid;
            place-items: center;
          }

          .apply-leave-inline-feedback-copy {
            min-width: 0;
          }

          .apply-leave-inline-feedback-copy strong,
          .apply-leave-inline-feedback-copy span {
            display: block;
            overflow-wrap: anywhere;
          }

          .apply-leave-inline-feedback-copy strong {
            margin-bottom: 2px;
            font-weight: 950;
          }

          .apply-leave-inline-feedback-copy span {
            font-weight: 750;
          }

          .apply-leave-inline-feedback-close {
            width: 24px;
            min-width: 24px;
            height: 24px;
            padding: 0;
            border: 0;
            border-radius: 8px;
            display: inline-grid;
            place-items: center;
            color: currentColor;
            background: rgba(255, 255, 255, .58);
            font: inherit;
            font-size: 17px;
            line-height: 1;
            cursor: pointer;
          }

          .apply-leave-inline-feedback-close:hover {
            background: #fff;
          }

          .apply-leave-page-feedback {
            width: min(620px, 100%);
          }

          .apply-leave-balance-strip {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 14px;
          }

          .apply-leave-balance-card {
            min-width: 0;
            min-height: 120px;
            padding: 18px;
            border: 1px solid rgba(171, 181, 211, .66);
            border-radius: 22px;
            background: #edf6ff;
            box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
          }

          .apply-leave-balance-card:nth-child(2) {
            background: #eaf8f4;
          }

          .apply-leave-balance-card:nth-child(3) {
            background: #fff4d5;
          }

          .apply-leave-balance-card:nth-child(4) {
            background: #f1efff;
          }

          .apply-leave-balance-card span,
          .apply-leave-balance-card strong,
          .apply-leave-balance-card small {
            display: block;
          }

          .apply-leave-balance-card span {
            color: #5d6785;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .09em;
            text-transform: uppercase;
          }

          .apply-leave-balance-card strong {
            margin-top: 8px;
            overflow-wrap: anywhere;
            color: var(--al-ink);
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(28px, 3vw, 42px);
            line-height: 1;
          }

          .apply-leave-balance-card small {
            margin-top: 7px;
            color: var(--al-copy);
            font-size: 11px;
            line-height: 1.45;
          }

          .apply-leave-saas-banner {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 18px;
            padding: 20px;
            border: 1px solid rgba(171, 181, 211, .66);
            border-radius: 24px;
            background: linear-gradient(145deg, #edf6ff, #f6f4ff);
            box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
          }

          .apply-leave-saas-banner.expired {
            border-color: rgba(154, 104, 23, .20);
            background: linear-gradient(145deg, #fff4d5, #fffaf0);
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
            color: #fff;
            background: linear-gradient(135deg, #4d77dd, #2eb2b9);
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
            color: var(--al-copy);
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
            background: rgba(255, 255, 255, .78);
            font-size: 11px;
            font-weight: 820;
          }

          .apply-leave-upgrade-stack {
            width: min(300px, 100%);
          }

          .apply-leave-upgrade-btn {
            width: max-content;
            justify-self: end;
            white-space: nowrap;
          }

          .apply-leave-layout {
            display: grid;
            grid-template-columns: minmax(310px, .72fr) minmax(0, 1.28fr);
            gap: 20px;
            align-items: start;
          }

          .apply-leave-panel {
            min-width: 0;
            padding: clamp(20px, 2vw, 28px);
            border: 1px solid rgba(171, 181, 211, .70);
            border-radius: clamp(24px, 2.2vw, 34px);
            background: #fff;
            box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
          }

          .apply-leave-panel.form-panel {
            background:
              linear-gradient(
                145deg,
                rgba(239, 248, 255, .72),
                rgba(248, 244, 255, .62) 52%,
                rgba(255, 250, 238, .68)
              );
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
            color: var(--al-copy);
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
            border-radius: 15px;
            background: #f8fbff;
            box-shadow: none;
          }

          .apply-leave-profile-grid div:nth-child(2n) {
            background: #f4fbf8;
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
            border-color: rgba(98, 84, 218, .20);
            background: #f1efff;
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
            border-radius: 14px;
            outline: 0;
            color: var(--al-ink);
            background: rgba(255, 255, 255, .96);
            font: inherit;
            font-size: 13px;
            transition:
              border-color 170ms ease,
              box-shadow 170ms ease;
          }

          .apply-leave-field textarea {
            min-height: 128px;
            padding: 14px;
            resize: vertical;
          }

          .apply-leave-field input:focus,
          .apply-leave-field select:focus,
          .apply-leave-field textarea:focus {
            border-color: rgba(77, 119, 221, .65);
            box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
          }

          .apply-leave-submit-stack {
            grid-column: 1 / -1;
          }

          .apply-leave-submit {
            width: 100%;
            min-height: 52px;
          }

          .apply-leave-spin {
            animation: applyLeaveSpin .82s linear infinite;
          }

          @keyframes applyLeaveSpin {
            to {
              transform: rotate(360deg);
            }
          }

          @media (max-width: 1120px) {
            .apply-leave-balance-strip {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 1100px) {
            .apply-leave-layout {
              grid-template-columns: 1fr;
            }

            .apply-leave-profile-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 820px) {
            .apply-leave-hero {
              grid-template-columns: 1fr;
            }

            .apply-leave-refresh-stack {
              width: min(360px, 100%);
            }

            .apply-leave-saas-banner {
              flex-direction: column;
            }

            .apply-leave-upgrade-stack {
              width: min(360px, 100%);
            }

            .apply-leave-upgrade-btn {
              justify-self: start;
            }
          }

          @media (max-width: 760px) {
            .apply-leave-page {
              gap: 15px;
            }

            .apply-leave-hero {
              min-height: 0;
              padding: 20px;
              border-radius: 26px;
              box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
            }

            .apply-leave-hero h1 {
              font-size: clamp(36px, 10vw, 52px);
            }

            .apply-leave-refresh,
            .apply-leave-refresh-stack,
            .apply-leave-upgrade-stack,
            .apply-leave-upgrade-btn {
              width: 100%;
            }

            .apply-leave-profile-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .apply-leave-form {
              grid-template-columns: 1fr;
            }

            .apply-leave-field.full,
            .apply-leave-submit-stack {
              grid-column: auto;
            }

            .apply-leave-panel {
              padding: 18px;
              border-radius: 24px;
            }
          }

          @media (max-width: 520px) {
            .apply-leave-balance-strip,
            .apply-leave-profile-grid {
              grid-template-columns: 1fr;
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

          @media (max-width: 390px) {
            .apply-leave-hero {
              padding: 16px;
            }

            .apply-leave-hero h1 {
              font-size: clamp(32px, 11vw, 44px);
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
        <div className="apply-leave-hero-copy">
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

        <div className="apply-leave-refresh-stack">
          <button
            type="button"
            className="apply-leave-refresh"
            onClick={() =>
              loadOptions({
                showLoader: false,
                feedbackScope: 'refresh',
              })
            }
            disabled={loadingOptions || refreshingOptions}
          >
            {loadingOptions || refreshingOptions ? (
              <Loader2 size={16} className="apply-leave-spin" />
            ) : (
              <RefreshCcw size={16} />
            )}
            {refreshingOptions ? 'Refreshing...' : 'Refresh'}
          </button>

          <ApplyLeaveInlineMessage
            message={feedbackMap.refresh}
            onClose={() => clearFeedback('refresh')}
          />
        </div>
      </section>

      {feedbackMap.page ? (
        <div className="apply-leave-page-feedback">
          <ApplyLeaveInlineMessage
            message={feedbackMap.page}
            onClose={() => clearFeedback('page')}
          />
        </div>
      ) : null}

      <section
        className="apply-leave-balance-strip"
        aria-label="Leave request summary"
      >
        <article className="apply-leave-balance-card">
          <span>Available CL</span>
          <strong>{loadingOptions ? '—' : leaveBalances.cl}</strong>
          <small>Casual Leave currently available</small>
        </article>

        <article className="apply-leave-balance-card">
          <span>Available EL</span>
          <strong>{loadingOptions ? '—' : leaveBalances.el}</strong>
          <small>Earned Leave currently available</small>
        </article>

        <article className="apply-leave-balance-card">
          <span>Request Days</span>
          <strong>{leaveDays}</strong>
          <small>Calculated from the selected dates and day type</small>
        </article>

        <article className="apply-leave-balance-card">
          <span>Leave Type</span>
          <strong>
            {form.day_type === 'half_day' ? 'Half Day' : form.leave_type}
          </strong>
          <small>Current leave type selected in the request form</small>
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

          <div className="apply-leave-upgrade-stack">
            <button
              type="button"
              className="apply-leave-upgrade-btn"
              onClick={openBillingPage}
            >
              <CreditCard size={16} />
              Upgrade Plan
            </button>

            <ApplyLeaveInlineMessage
              message={feedbackMap.billing}
              onClose={() => clearFeedback('billing')}
            />
          </div>
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
                onWheel={preventDateWheelChange}
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
                  onWheel={preventDateWheelChange}
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

            <div className="apply-leave-submit-stack">
              <button
                type="submit"
                className="apply-leave-submit"
                disabled={submitting || isExpiredOrSuspendedTenant}
              >
                {submitting ? (
                  <Loader2 size={17} className="apply-leave-spin" />
                ) : (
                  <Send size={17} />
                )}
                {submitting ? 'Submitting...' : 'Submit Leave Request'}
              </button>

              <ApplyLeaveInlineMessage
                message={feedbackMap.submit}
                onClose={() => clearFeedback('submit')}
              />
            </div>
          </form>
        </main>
      </section>
    </div>
  );
}