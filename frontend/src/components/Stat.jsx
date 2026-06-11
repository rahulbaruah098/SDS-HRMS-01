export default function Stat({ label, value, note = "" }) {
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
      {note ? <small>{note}</small> : null}
    </div>
  );
}