export default function MiniList({ title, rows = [] }) {
  function formatDate(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString();
  }

  function getPrimaryText(row = {}) {
    return (
      row.employee_name ||
      row.raised_by_name ||
      row.title ||
      row.type ||
      row.leave_type ||
      row.category ||
      row.status ||
      'Record'
    );
  }

  function getSecondaryText(row = {}) {
    const parts = [];

    if (row.status) {
      parts.push(`Status: ${row.status}`);
    }

    if (row.amount !== undefined && row.amount !== null && row.amount !== '') {
      parts.push(`Amount: ${row.amount}`);
    }

    if (row.from_date || row.to_date) {
      parts.push(`${row.from_date || ''}${row.to_date ? ` to ${row.to_date}` : ''}`);
    }

    if (row.created_at) {
      parts.push(formatDate(row.created_at));
    }

    return parts.filter(Boolean).join(' • ');
  }

  return (
    <div className="mini-list">
      <b>{title}</b>

      {!Array.isArray(rows) || !rows.length ? (
        <p>No pending records</p>
      ) : (
        rows.map((row, index) => {
          const primaryText = getPrimaryText(row);
          const secondaryText = getSecondaryText(row);

          return (
            <span key={row?._id || index}>
              <strong>{primaryText}</strong>
              {secondaryText && <small>{secondaryText}</small>}
            </span>
          );
        })
      )}
    </div>
  );
}