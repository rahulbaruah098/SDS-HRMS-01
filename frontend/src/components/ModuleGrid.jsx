export default function ModuleGrid({ modules }) {
  return (
    <section className="module-grid">
      {modules.map(([key, title, Icon, description]) => (
        <div className="module-card" key={key}>
          <Icon />
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      ))}
    </section>
  );
}
