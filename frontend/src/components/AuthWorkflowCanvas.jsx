import Icon from "./Icon";

export default function AuthWorkflowCanvas({
  variant,
  facts = [],
  steps = [],
}) {
  if (variant === "demo") {
    return (
      <div
        className="auth-workflow-canvas auth-workflow-canvas-demo"
        aria-label="YourComate demo onboarding journey"
      >
        <div className="auth-demo-stage-grid">
          {steps.map(([number, title, copy], index) => (
            <article
              className={`auth-demo-stage auth-demo-stage-${index + 1}`}
              key={number}
            >
              <b>{number}</b>

              <div>
                <strong>{title}</strong>
                <small>{copy}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  const loginModules = [
    ["attendance", "Attendance", "Live"],
    ["calendar", "Leave", "05"],
    ["project", "Projects", "14"],
    ["approval", "Approvals", "08"],
  ];

  return (
    <div
      className="auth-workflow-canvas auth-workflow-canvas-login"
      aria-label="Connected YourComate workday"
    >
      <article className="auth-flow-console">
        <header>
          <span>YC</span>

          <div>
            <small>Today at YourComate</small>
            <strong>Operations snapshot</strong>
          </div>

          <b>
            <i />
            Live
          </b>
        </header>

        <div className="auth-flow-metrics">
          {facts.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </article>

      <div className="auth-flow-module-grid">
        {loginModules.map(([icon, label, value], index) => (
          <span
            className={`auth-flow-module auth-flow-module-${index + 1}`}
            key={label}
          >
            <Icon name={icon} />
            <b>{label}</b>
            <em>{value}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
