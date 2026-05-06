export default function Table({ rows = [], maxColumns = 8 }) {
  if (!rows?.length) {
    return <div className="empty">No records found</div>;
  }

  const hiddenKeys = [
    '_id',
    'password_hash',
    'created_by',
    'updated_by',
    'employee_profile',
    'tenant_id',
  ];

  const keys = Object.keys(rows[0])
    .filter((key) => !hiddenKeys.includes(key))
    .slice(0, maxColumns);

  function formatKey(key) {
    return key.replaceAll('_', ' ');
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (typeof value === 'object') {
      if (value instanceof Date) {
        return value.toLocaleString();
      }

      if (value.$date) {
        return new Date(value.$date).toLocaleString();
      }

      return JSON.stringify(value);
    }

    return String(value);
  }

  function renderValue(value) {
    if (value && typeof value === 'object' && value.$$typeof) {
      return value;
    }

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
            <tr key={row._id || index}>
              {keys.map((key) => (
                <td key={key}>{renderValue(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}