/**
 * YourComate HRMS
 * Sprint Planning API Client
 *
 * Monthly -> Weekly -> Day-wise planning
 *
 * Uses the existing YourComate authenticated API client.
 */

import { api, buildQuery } from './client';

const BASE = '/sprint-planning';

const jsonBody = (payload = {}) => ({
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const safeId = (value) => {
  const id = String(value || '').trim();

  if (!id || id.includes('/')) {
    throw new Error('A valid record ID is required.');
  }

  return encodeURIComponent(id);
};

const validPlanKind = (kind) => {
  if (!['monthly', 'weekly'].includes(kind)) {
    throw new Error('Invalid planning type.');
  }

  return kind;
};

// =====================================================
// MONTHLY PLANNING
// =====================================================

export function createMonthlyPlan(payload) {
  return api(`${BASE}/monthly`, {
    method: 'POST',
    ...jsonBody(payload),
  });
}

export function getMonthlyPlans(params = {}) {
  return api(`${BASE}/monthly${buildQuery(params)}`);
}

export function submitMonthlyPlan(planId) {
  return api(
    `${BASE}/monthly/${safeId(planId)}/submit`,
    { method: 'POST' },
  );
}

export function reviewMonthlyPlan(planId, decision, remarks = '') {
  return api(
    `${BASE}/monthly/${safeId(planId)}/review`,
    {
      method: 'POST',
      ...jsonBody({ decision, remarks }),
    },
  );
}

// =====================================================
// WEEKLY AND DAY-WISE PLANNING
// =====================================================

export function createWeeklyPlan(payload) {
  return api(`${BASE}/weekly`, {
    method: 'POST',
    ...jsonBody(payload),
  });
}

export function getWeeklyPlans(params = {}) {
  return api(`${BASE}/weekly${buildQuery(params)}`);
}

export function submitWeeklyPlan(planId) {
  return api(
    `${BASE}/weekly/${safeId(planId)}/submit`,
    { method: 'POST' },
  );
}

export function reviewWeeklyPlan(planId, decision, remarks = '') {
  return api(
    `${BASE}/weekly/${safeId(planId)}/review`,
    {
      method: 'POST',
      ...jsonBody({ decision, remarks }),
    },
  );
}

export function reportDailyActivity(planId, activityId, payload) {
  return api(
    `${BASE}/weekly/${safeId(planId)}/activities/${safeId(activityId)}/report`,
    {
      method: 'PATCH',
      ...jsonBody(payload),
    },
  );
}

// =====================================================
// DAILY CHANGE REQUESTS
// =====================================================

export function createDailyChangeRequest(payload) {
  return api(`${BASE}/daily-change-requests`, {
    method: 'POST',
    ...jsonBody(payload),
  });
}

export function reviewDailyChangeRequest(
  requestId,
  approvalRole,
  decision,
  remarks = '',
) {
  return api(
    `${BASE}/daily-change-requests/${safeId(requestId)}/review`,
    {
      method: 'POST',
      ...jsonBody({
        approval_role: approvalRole,
        decision,
        remarks,
      }),
    },
  );
}

export function applyApprovedDailyChange(requestId) {
  return api(
    `${BASE}/daily-change-requests/${safeId(requestId)}/apply`,
    { method: 'POST' },
  );
}

// =====================================================
// ATTENDANCE CHECKOUT READINESS
// =====================================================

export function getDailyCheckoutReadiness(workDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate || ''))) {
    throw new Error('workDate must be YYYY-MM-DD.');
  }

  return api(
    `${BASE}/checkout-readiness${buildQuery({
      work_date: workDate,
    })}`,
  );
}

// =====================================================
// GENERIC PLANNING HELPERS
// =====================================================

export function getPlans(kind, params = {}) {
  return api(
    `${BASE}/${validPlanKind(kind)}${buildQuery(params)}`,
  );
}

export function submitPlan(kind, planId) {
  return api(
    `${BASE}/${validPlanKind(kind)}/${safeId(planId)}/submit`,
    { method: 'POST' },
  );
}

export function reviewPlan(kind, planId, decision, remarks = '') {
  return api(
    `${BASE}/${validPlanKind(kind)}/${safeId(planId)}/review`,
    {
      method: 'POST',
      ...jsonBody({ decision, remarks }),
    },
  );
}

// =====================================================
// SPRINT PLANNING APPROVAL INBOX
// =====================================================

/**
 * Fetch approval requests visible to the logged-in user.
 *
 * Backend determines whether the user is an assigned
 * Reporting Team Leader, Reporting Officer, or an
 * authorised organisation-level monitoring user.
 *
 * This function must not bypass backend permissions.
 */
export function getSprintApprovalInbox(limit = 50) {
  const count = Number(limit);

  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100
  ) {
    throw new Error('Approval inbox limit must be between 1 and 100.');
  }

  return api(
    `${BASE}/approval-inbox${buildQuery({ limit: count })}`
  );
}

// =====================================================
// SPRINT PLANNING - EMPLOYEE PERFORMANCE METRICS
// =====================================================

/**
 * Retrieves metrics from approved weekly planning records.
 *
 * month: YYYY-MM
 * employeeId: optional, for authorised TL/RO/HR/Admin users.
 *
 * Permissions are enforced by the Flask backend.
 */
export function getSprintEmployeeMetrics({
  month,
  employeeId
} = {}) {
  const query = {};

  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error('Month must use YYYY-MM format.');
    }

    query.month = month;
  }

  if (employeeId !== undefined && employeeId !== null) {
    const id = String(employeeId).trim();

    if (!id) {
      throw new Error('Employee ID cannot be empty.');
    }

    query.employee_id = id;
  }

  return api(
    `${BASE}/metrics/employee${buildQuery(query)}`
  );
}

// =====================================================
// SPRINT PLANNING - TEAM / MANAGEMENT METRICS
// =====================================================

/**
 * Fetch Sprint Planning progress for employees visible
 * to the authenticated reporting user.
 *
 * Team Leader / Reporting Officer:
 *   Backend limits results to assigned employees.
 *
 * HR / Admin / Super Admin:
 *   Backend applies tenant-level monitoring scope.
 *
 * The current endpoint returns up to 100 employees
 * and includes a truncated flag.
 */
export function getSprintTeamMetrics({ month } = {}) {
  const query = {};

  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error('Month must use YYYY-MM format.');
    }

    query.month = month;
  }

  return api(
    `${BASE}/metrics/team${buildQuery(query)}`
  );
}