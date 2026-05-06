export default function ModuleGrid({ modules = [], setPage }) {
  function openModule(key) {
    if (typeof setPage === 'function') {
      setPage(key);
    }
  }

  return (
    <section className="module-grid">
      {modules.map(([key, title, Icon, description]) => (
        <button
          type="button"
          className="module-card module-card-btn"
          key={key}
          onClick={() => openModule(key)}
        >
          {Icon ? <Icon /> : null}

          <h3>{title}</h3>

          {description && <p>{description}</p>}
        </button>
      ))}

      {!modules.length && (
        <div className="panel">
          <p>No modules available for your role.</p>
        </div>
      )}
    </section>
  );
}