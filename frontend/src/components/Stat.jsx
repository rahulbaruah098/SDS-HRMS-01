export default function Stat({ label, value, note = 'Live MongoDB data' }) {
  function formatValue(input) {
    if (input === null || input === undefined || input === '') {
      return 0;
    }

    if (typeof input === 'number') {
      return input.toLocaleString();
    }

    if (typeof input === 'boolean') {
      return input ? 'Yes' : 'No';
    }

    return String(input);
  }

  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{formatValue(value)}</strong>
      <small>{note}</small>
    </div>
  );
}