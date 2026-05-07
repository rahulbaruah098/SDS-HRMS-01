export default function ModuleGrid({ modules = [], setPage }) {
  function openModule(key) {
    if (typeof setPage === 'function') {
      setPage(key);
    }
  }

  if (!Array.isArray(modules) || !modules.length) {
    return (
      <section className="module-grid">
        <div className="panel">
          <p>No modules available for your role.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="module-grid">
      {modules.map(([key, title, Icon, description]) => {
        const moduleTitle = title || key || 'Module';

        return (
          <button
            type="button"
            className="module-card module-card-btn"
            key={key}
            onClick={() => openModule(key)}
            aria-label={`Open ${moduleTitle}`}
          >
            {Icon ? <Icon size={24} /> : null}

            <h3>{moduleTitle}</h3>

            {description && <p>{description}</p>}
          </button>
        );
      })}
    </section>
  );
}