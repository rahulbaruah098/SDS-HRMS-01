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

export function updateMonthlyPlan(planId, payload) {
  return api(`${BASE}/monthly/${safeId(planId)}`, {
    method: 'PUT',
    ...jsonBody(payload),
  });
}

export function submitMonthlyPlan(planId) {
  return api(
    `${BASE}/monthly/${safeId(planId)}/submit`,
    { method: 'POST' },
  );
}

export function getMonthlyReviewInbox(month) {
  return api(`${BASE}/monthly/review-inbox${buildQuery({ month })}`);
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

export function getMonthlyTeamCoverage(month) {
  return api(`${BASE}/monthly/team-compilations/coverage${buildQuery({ month })}`);
}

export function getMonthlyTeamCompilations(month) {
  return api(`${BASE}/monthly/team-compilations${buildQuery({ month })}`);
}

export function createMonthlyTeamCompilation(month, missingEmployeeIds = []) {
  return api(`${BASE}/monthly/team-compilations`, {
    method: 'POST',
    ...jsonBody({ month, missing_employee_ids: missingEmployeeIds }),
  });
}

export function createApprovedMonthlyTeamRevision(id, missingEmployeeIds = []) {
  return api(`${BASE}/monthly/team-compilations/${safeId(id)}/new-revision`, {
    method: 'POST',
    ...jsonBody({ missing_employee_ids: missingEmployeeIds }),
  });
}

export function reviseMonthlyTeamCompilation(id, missingEmployeeIds = []) {
  return api(`${BASE}/monthly/team-compilations/${safeId(id)}/revise`, {
    method: 'POST',
    ...jsonBody({ missing_employee_ids: missingEmployeeIds }),
  });
}

export function submitMonthlyTeamCompilation(id) {
  return api(`${BASE}/monthly/team-compilations/${safeId(id)}/submit`, {
    method: 'POST',
  });
}

export function reviewMonthlyTeamCompilation(id, decision, remarks = '') {
  return api(`${BASE}/monthly/team-compilations/${safeId(id)}/review`, {
    method: 'POST',
    ...jsonBody({ decision, remarks }),
  });
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

// STEP 44B.53G.8F.18
// Freeze the daily template before the first required file upload.
export function prepareDailyActivityTemplate(planId, activityId) {
  return api(
    `${BASE}/weekly/${safeId(planId)}/activities/${safeId(activityId)}/prepare-daily-template`,
    { method: 'POST' },
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


// STEP 44B.52G - SPRINT PLANNING SETTINGS
export function getSprintPlanningSettings() {
  return api(`${BASE}/settings`);
}

export function updateSprintPlanningSettings(enabled) {
  if (typeof enabled !== 'boolean') {
    throw new Error('Sprint Planning enabled must be a boolean.');
  }

  return api(`${BASE}/settings`, {
    method: 'PATCH',
    ...jsonBody({ enabled }),
  });
}


// STEP 44B.53B.1 - Department planning templates
export function getSprintSheetTemplates(params = {}) {
  return api(`${BASE}/settings/templates${buildQuery(params)}`);
}

export function saveSprintSheetTemplate(payload) {
  return api(`${BASE}/settings/templates`, {
    method: 'POST',
    ...jsonBody(payload),
  });
}


// STEP 44B.53C.6 - Authenticated employee department template
export function getMySprintTemplate(planType = 'monthly') {
  return api(`${BASE}/my-template${buildQuery({ plan_type: planType })}`);
}


// STEP 44B.53G.8F.2
// Upload a Sprint Planning file through the existing authenticated API.
export function uploadSprintAttachment({
  planType,
  planId,
  file,
  fieldKey,
  rowId,
  activityId,
}) {
  const allowed = ['monthly', 'weekly', 'daily'];

  if (!allowed.includes(planType)) {
    return Promise.reject(new Error('Invalid Sprint Planning type.'));
  }

  if (!planId || !file || !fieldKey) {
    return Promise.reject(
      new Error('Plan, file and field are required.')
    );
  }

  if (planType === 'monthly' && !rowId) {
    return Promise.reject(
      new Error('Monthly row ID is required.')
    );
  }

  if (planType !== 'monthly' && !activityId) {
    return Promise.reject(
      new Error('Activity ID is required.')
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('field_key', fieldKey);

  if (planType === 'monthly') {
    formData.append('row_id', rowId);
  } else {
    formData.append('activity_id', activityId);
  }

  return api(
    `${BASE}/attachments/${planType}/${encodeURIComponent(planId)}`,
    {
      method: 'POST',
      body: formData,
      timeoutMs: 60000,
    }
  );
}

// Update one saved weekly draft activity's custom fields.
export function updateWeeklyActivityCustomFields(
  planId,
  activityId,
  customValues = {},
) {
  if (!planId || !activityId) {
    return Promise.reject(
      new Error('Plan and activity IDs are required.')
    );
  }

  return api(
    `${BASE}/weekly/${encodeURIComponent(planId)}/activities/` +
    `${encodeURIComponent(activityId)}/custom-fields`,
    {
      method: 'PUT',
      ...jsonBody({
        custom_values: customValues,
      }),
    }
  );
}

// Convert a server-issued attachment ID into a saved field reference.
export function sprintAttachmentReference(attachmentId) {
  const value = String(attachmentId || '').trim();

  if (!/^[0-9a-f]{32}$/.test(value)) {
    throw new Error('Invalid Sprint attachment ID.');
  }

  return `sprint-attachment:${value}`;
}


// STEP 44B.53G.8F.5-R3
// Download via the authenticated HRMS API client.
export async function downloadSprintAttachment(
  attachmentRecordId,
  filename = ''
) {
  const id = String(attachmentRecordId || '').trim();

  // STEP 44B.53G.8F.11
  // Backend attachment_id is UUID hex, not MongoDB ObjectId.
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw new Error('A valid 32-character attachment ID is required.');
  }

  const blob = await api(
    `${BASE}/attachments/${encodeURIComponent(id)}/download`,
    {
      method: 'GET',
      responseType: 'blob',
      timeoutMs: 60000,
    }
  );

  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error('Attachment download returned an empty file.');
  }

  const safeName = String(filename || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 180);

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = objectUrl;
    anchor.download = safeName || `sprint-attachment-${id}`;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      1000,
    );
  }
}
