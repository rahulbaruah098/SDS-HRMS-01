export default function Table({ rows = [], maxColumns = 8 }) {
  if (!Array.isArray(rows) || !rows.length) {
    return <div className="empty">No records found</div>;
  }

  const hiddenKeys = [
    '_id',
    'password_hash',
    'password',
    'created_by',
    'updated_by',
    'employee_profile',
    'tenant_id',
    'user_id',
    'user_id_for_edit',
    'employee_id_for_edit',
    'is_deleted',
    '__v',
  ];

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

    return Array.from(keySet).slice(0, maxColumns);
  }

  const keys = getKeys();

  function formatKey(key) {
    return String(key || '')
      .replaceAll('_', ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString();
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (Array.isArray(value)) {
      if (!value.length) {
        return '—';
      }

      return value
        .map((item) => {
          if (item === null || item === undefined || item === '') {
            return '';
          }

          if (typeof item === 'object') {
            return JSON.stringify(item);
          }

          return String(item);
        })
        .filter(Boolean)
        .join(', ');
    }

    if (typeof value === 'object') {
      if (value.$$typeof) {
        return value;
      }

      if (value instanceof Date) {
        return value.toLocaleString();
      }

      if (value.$date) {
        return formatDate(value.$date);
      }

      return JSON.stringify(value);
    }

    const stringValue = String(value);

    if (
      /^\d{4}-\d{2}-\d{2}T/.test(stringValue) ||
      /^\d{4}-\d{2}-\d{2} \d{2}:/.test(stringValue)
    ) {
      return formatDate(stringValue);
    }

    return stringValue;
  }

  function renderValue(value) {
    return formatValue(value);
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
            <tr key={row?._id || index}>
              {keys.map((key) => (
                <td key={key}>{renderValue(row?.[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}