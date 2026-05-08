export default function Table({
  rows = [],
  maxColumns = 10,
  emptyText = 'No records found',
}) {
  if (!Array.isArray(rows) || !rows.length) {
    return <div className="empty">{emptyText}</div>;
  }

  const hiddenKeys = [
    '_id',
    'id',
    'password_hash',
    'password',
    'created_by',
    'updated_by',
    'employee_profile',
    'tenant_id',
    'user_id',
    'user_id_for_edit',
    'employee_id_for_edit',
    'source_attendance_id',
    'leave_request_id',
    'compoff_id',
    'created_by_name',
    'updated_by_name',
    'created_by_role',
    'updated_by_role',
    'meta',
    'timeline',
    'check_in_location',
    'check_out_location',
    'approval_history',
    'raw_rows',
    'raw_status',
    'raw_stage',
    'raw_role',
    'is_deleted',
    '__v',
  ];

  const priorityKeys = [
    'action',

    'employee_id',
    'employee_name',
    'name',
    'title',
    'email',
    'phone',
    'department',
    'designation',
    'state',

    'date',
    'from_date',
    'to_date',
    'upto_date',
    'earned_date',
    'valid_until',
    'claimed_date',

    'mode',
    'leave_type',
    'leave_days',
    'reason',

    'current_stage',
    'current_status',
    'live_status',
    'status_text',
    'status_display',
    'approval_stage',
    'approval_stage_label',
    'final_status',
    'status',

    'team_leader',
    'team_leader_name',
    'reporting_officer',
    'reporting_officer_name',
    'task_handover_to',
    'task_handover_to_name',
    'project_handover',
    'project_handover_name',

    'opening_balance',
    'credited',
    'used',
    'used_deducted',
    'available',
    'available_balance',
    'deducted',

    'cl_opening_balance',
    'cl_credited',
    'cl_used',
    'cl_available',
    'el_opening_balance',
    'el_credited',
    'el_used',
    'el_available',

    'check_in',
    'check_out',
    'late_reason',
    'early_checkout_reason',
    'field_location',
    'holiday',
    'holiday_title',

    'amount',
    'rating',
    'verified',
    'decided_by',
    'decided_at',
    'approved_by',
    'approved_at',
    'rejected_by',
    'rejected_at',
    'created_at',
    'updated_at',
  ];

  const customLabels = {
    employee_id: 'Employee ID',
    employee_name: 'Employee Name',
    from_date: 'From Date',
    to_date: 'To Date',
    upto_date: 'Upto Date',
    leave_type: 'Leave Type',
    leave_days: 'Leave Days',

    live_status: 'Live Status',
    status_text: 'Live Status',
    status_display: 'Live Status',
    current_stage: 'Current Stage',
    current_status: 'Current Status',
    approval_stage: 'Approval Stage',
    approval_stage_label: 'Approval Stage',
    final_status: 'Final Status',

    task_handover_to: 'Task Handover To',
    task_handover_to_name: 'Task Handover To',
    project_handover: 'Project Handover',
    project_handover_name: 'Project Handover',

    opening_balance: 'Opening',
    credited: 'Credited',
    used: 'Used',
    used_deducted: 'Used / Deducted',
    available: 'Available',
    available_balance: 'Available Balance',

    cl_opening_balance: 'CL Opening',
    cl_credited: 'CL Credited',
    cl_used: 'CL Used',
    cl_available: 'CL Available',
    el_opening_balance: 'EL Opening',
    el_credited: 'EL Credited',
    el_used: 'EL Used',
    el_available: 'EL Available',

    check_in: 'Check In',
    check_out: 'Check Out',
    late_reason: 'Late Reason',
    early_checkout_reason: 'Early Checkout Reason',
    field_location: 'Field Location',

    decided_by: 'Decided By',
    decided_at: 'Decided At',
    approved_by: 'Approved By',
    approved_at: 'Approved At',
    rejected_by: 'Rejected By',
    rejected_at: 'Rejected At',
    created_at: 'Created At',
    updated_at: 'Updated At',
  };

  function isReactNode(value) {
    return (
      value &&
      typeof value === 'object' &&
      (
        value.$$typeof ||
        typeof value.type !== 'undefined' ||
        typeof value.props !== 'undefined'
      )
    );
  }

  function isVisibleKey(key) {
    return !hiddenKeys.includes(key);
  }

  function getKeys() {
    const keySet = new Set();

    rows.forEach((row) => {
      if (!row || typeof row !== 'object') {
        return;
      }

      Object.keys(row).forEach((key) => {
        if (isVisibleKey(key)) {
          keySet.add(key);
        }
      });
    });

    const availableKeys = Array.from(keySet);

    const sortedKeys = availableKeys.sort((a, b) => {
      const aIndex = priorityKeys.indexOf(a);
      const bIndex = priorityKeys.indexOf(b);

      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      return a.localeCompare(b);
    });

    return sortedKeys.slice(0, maxColumns);
  }

  const keys = getKeys();

  function formatKey(key) {
    if (customLabels[key]) {
      return customLabels[key];
    }

    return String(key || '')
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatDate(value) {
    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return String(value);
    }

    return parsedDate.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDateOnly(value) {
    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return String(value);
    }

    return parsedDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function prettifyValue(value) {
    return String(value || '')
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function leaveTypeLabel(value) {
    const normalized = String(value || '').trim().toUpperCase();

    if (normalized === 'CL' || normalized === 'CASUAL LEAVE') {
      return 'Casual Leave';
    }

    if (normalized === 'EL' || normalized === 'EARNED LEAVE') {
      return 'Earned Leave';
    }

    if (normalized === 'COMP-OFF' || normalized === 'COMPOFF') {
      return 'Comp-Off';
    }

    return prettifyValue(value);
  }

  function formatObjectValue(value) {
    if (value.$date) {
      return formatDate(value.$date);
    }

    if (
      Object.prototype.hasOwnProperty.call(value, 'latitude') &&
      Object.prototype.hasOwnProperty.call(value, 'longitude')
    ) {
      const accuracy = value.accuracy ? ` • ±${Math.round(value.accuracy)}m` : '';
      return `${value.latitude}, ${value.longitude}${accuracy}`;
    }

    if (value.original_name || value.file_path || value.filename) {
      return value.original_name || value.filename || value.file_path;
    }

    return JSON.stringify(value);
  }

  function formatValue(value, key = '') {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    if (isReactNode(value)) {
      return value;
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    }

    if (Array.isArray(value)) {
      if (!value.length) return '—';

      const formattedItems = value
        .map((item) => {
          if (item === null || item === undefined || item === '') return '';
          if (isReactNode(item)) return item;
          if (typeof item === 'object') return formatObjectValue(item);
          return String(item);
        })
        .filter(Boolean);

      return formattedItems.length ? formattedItems.join(', ') : '—';
    }

    if (typeof value === 'object') {
      if (value instanceof Date) {
        return formatDate(value);
      }

      return formatObjectValue(value);
    }

    const stringValue = String(value);

    if (key === 'leave_type') {
      return leaveTypeLabel(stringValue);
    }

    if (
      [
        'status',
        'final_status',
        'mode',
        'approval_stage',
        'approval_stage_label',
        'current_stage',
        'current_status',
        'live_status',
        'status_text',
        'status_display',
        'priority',
        'verified',
        'deducted',
      ].includes(key)
    ) {
      return prettifyValue(stringValue);
    }

    if (
      [
        'date',
        'from_date',
        'to_date',
        'upto_date',
        'earned_date',
        'valid_until',
        'claimed_date',
        'joining_date',
        'date_of_birth',
      ].includes(key) &&
      /^\d{4}-\d{2}-\d{2}$/.test(stringValue)
    ) {
      return formatDateOnly(stringValue);
    }

    if (
      /^\d{4}-\d{2}-\d{2}T/.test(stringValue) ||
      /^\d{4}-\d{2}-\d{2} \d{2}:/.test(stringValue)
    ) {
      return formatDate(stringValue);
    }

    return stringValue;
  }

  function getCellClass(key, value) {
    const rawValue = String(value || '').toLowerCase();

    const statusKeys = [
      'status',
      'final_status',
      'current_stage',
      'current_status',
      'live_status',
      'status_text',
      'status_display',
      'approval_stage',
      'approval_stage_label',
      'verified',
      'deducted',
    ];

    if (statusKeys.includes(key)) {
      if (
        [
          'approved',
          'present',
          'active',
          'available',
          'generated',
          'submitted',
          'verified',
          'yes',
          'paid',
          'resolved',
          'closed',
          'deducted',
        ].includes(rawValue)
      ) {
        return 'table-status table-status-success';
      }

      if (
        [
          'pending',
          'pending with team leader',
          'pending with reporting officer',
          'pending with hr',
          'team_leader',
          'reporting_officer',
          'hr',
          'late',
          'early_checkout',
          'open',
          'draft',
          'in_review',
          'in_progress',
          'claimed',
          'unread',
        ].includes(rawValue)
      ) {
        return 'table-status table-status-warning';
      }

      if (
        [
          'rejected',
          'inactive',
          'expired',
          'deleted',
          'terminated',
          'no',
          'not deducted',
          'cancelled',
          'failed',
        ].includes(rawValue)
      ) {
        return 'table-status table-status-danger';
      }

      if (
        [
          'holiday_work',
          'field',
          'wfh',
          'office',
          'read',
          'casual leave',
          'earned leave',
          'comp-off',
        ].includes(rawValue)
      ) {
        return 'table-status table-status-info';
      }
    }

    if (key === 'mode' || key === 'leave_type') {
      return 'table-status table-status-info';
    }

    return '';
  }

  function renderValue(value, key) {
    const formatted = formatValue(value, key);
    const cellClass = getCellClass(key, formatted);

    if (cellClass && !isReactNode(formatted)) {
      return <span className={cellClass}>{formatted}</span>;
    }

    return formatted;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key}>{formatKey(key)}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={row?._id || row?.id || index}>
              {keys.map((key) => (
                <td key={key}>{renderValue(row?.[key], key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}