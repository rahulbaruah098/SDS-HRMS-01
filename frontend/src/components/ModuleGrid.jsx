export default function ModuleGrid({ modules, setPage }) {
  return (
    <section className="module-grid">
      {modules.map(([key, title, Icon, description]) => (
        <button
          type="button"
          className="module-card module-card-btn"
          key={key}
          onClick={() => setPage(key)}
        >
          <Icon />
          <h3>{title}</h3>
          <p>{description}</p>
        </button>
      ))}
    </section>
  );
}
