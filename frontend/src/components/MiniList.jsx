export default function MiniList({ title, rows }) {
  return (
    <div className="mini-list">
      <b>{title}</b>
      {!rows?.length ? (
        <p>No pending records</p>
      ) : (
        rows.map((row, i) => <span key={row._id || i}>{row.employee_name || row.title || row.type || row.status}</span>)
      )}
    </div>
  );
}
