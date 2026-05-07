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
    'is_deleted',
    '__v',
  ];

  const priorityKeys = [
    'action',
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
    'earned_date',
    'valid_until',
    'claimed_date',
    'mode',
    'leave_type',
    'leave_days',
    'status',
    'approval_stage',
    'approval_stage_label',
    'check_in',
    'check_out',
    'late_reason',
    'early_checkout_reason',
    'reason',
    'field_location',
    'holiday',
    'holiday_title',
    'available',
    'used',
    'credited',
    'opening_balance',
    'amount',
    'rating',
    'verified',
    'decided_by',
    'decided_at',
    'created_at',
    'updated_at',
  ];

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

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      if (aIndex !== -1) {
        return -1;
      }

      if (bIndex !== -1) {
        return 1;
      }

      return a.localeCompare(b);
    });

    return sortedKeys.slice(0, maxColumns);
  }

  const keys = getKeys();

  function formatKey(key) {
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
      if (!value.length) {
        return '—';
      }

      const formattedItems = value
        .map((item) => {
          if (item === null || item === undefined || item === '') {
            return '';
          }

          if (isReactNode(item)) {
            return item;
          }

          if (typeof item === 'object') {
            return formatObjectValue(item);
          }

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

    if (
      [
        'status',
        'mode',
        'approval_stage',
        'approval_stage_label',
        'leave_type',
        'priority',
        'verified',
      ].includes(key)
    ) {
      return prettifyValue(stringValue);
    }

    if (
      [
        'date',
        'from_date',
        'to_date',
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

    if (key === 'status' || key === 'verified') {
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
        ].includes(rawValue)
      ) {
        return 'table-status table-status-success';
      }

      if (
        [
          'pending',
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
        ].includes(rawValue)
      ) {
        return 'table-status table-status-info';
      }
    }

    if (key === 'mode') {
      return 'table-status table-status-info';
    }

    if (key === 'leave_type') {
      return 'table-status table-status-info';
    }

    return '';
  }

  function renderValue(value, key) {
    const formatted = formatValue(value, key);
    const cellClass = getCellClass(key, value);

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