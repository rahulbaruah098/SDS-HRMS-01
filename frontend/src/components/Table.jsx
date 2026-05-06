export default function Table({ rows }) {
  if (!rows?.length) return <div className="empty">No records found</div>;

  const keys = Object.keys(rows[0])
    .filter((k) => !['_id', 'password_hash', 'created_by', 'updated_by', 'employee_profile'].includes(k))
    .slice(0, 7);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{k.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row._id || i}>
              {keys.map((k) => (
                <td key={k}>
                  {Array.isArray(row[k])
                    ? row[k].join(', ')
                    : typeof row[k] === 'object'
                      ? JSON.stringify(row[k])
                      : String(row[k] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
