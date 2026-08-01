import Icon from "./Icon";

const recruitmentRows = [
  "Application Support Officer · Screening",
  "HR Executive · Interview scheduled",
  "Field Coordinator · Offer review",
];

export default function RecruitmentFeatureVisual() {
  return (
    <div className="feature-workbench feature-workbench-recruitment">
      <header>
        <span>
          <Icon name="recruitment" />
        </span>

        <div>
          <small>Live hiring preview</small>
          <strong>Candidate pipeline</strong>
        </div>

        <em>Active</em>
      </header>

      <div className="feature-workbench-list">
        {recruitmentRows.map((row, index) => (
          <div key={row}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <span>{row}</span>
            <Icon
              name={
                index === recruitmentRows.length - 1
                  ? "arrow"
                  : "check"
              }
            />
          </div>
        ))}
      </div>

      <footer>
        <Icon name="link" />
        <span>
          Openings, candidates, interviews and offers remain connected
        </span>
      </footer>
    </div>
  );
}
