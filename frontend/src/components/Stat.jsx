export default function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      <small>Live MongoDB data</small>
    </div>
  );
}
