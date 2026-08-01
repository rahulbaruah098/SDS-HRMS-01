import Icon from "./Icon";

const visualMap = {
  "core-hr": {
    label: "People directory",
    icon: "people",
    rows: ["Aarav Sharma · Team Lead", "Nisha Das · HR Executive", "Imran Ali · Field Officer"],
    footer: "Reporting lines and records stay connected",
  },
  attendance: {
    label: "Today’s attendance",
    icon: "attendance",
    rows: ["Office · 34 present", "WFH · 12 active", "Field · 8 checked in"],
    footer: "Worked time and exceptions remain visible",
  },
  leave: {
    label: "Leave decision desk",
    icon: "calendar",
    rows: ["Casual leave · 2 days", "Medical leave · 1 day", "Holiday request · Pending"],
    footer: "Employees and approvers see the same status",
  },
  projects: {
    label: "Delivery board",
    icon: "project",
    rows: ["Website rollout · In progress", "Mobile QA · Review", "Client training · Planned"],
    footer: "Owners, collaborators and progress stay clear",
  },
  "employee-self-service": {
    label: "Employee workspace",
    icon: "mobile",
    rows: ["Check attendance", "Apply for leave", "View assigned projects"],
    footer: "Routine work without waiting for HR",
  },
  policies: {
    label: "Policy shelf",
    icon: "document",
    rows: ["Leave policy · Updated", "IT usage policy · Active", "Travel policy · Published"],
    footer: "One trusted place for current documents",
  },
  assets: {
    label: "Asset register",
    icon: "briefcase",
    rows: ["Laptop · Assigned", "Access card · Active", "Headset · Returned"],
    footer: "Asset accountability connected to employees",
  },
  approvals: {
    label: "Decision queue",
    icon: "approval",
    rows: ["Leave request · Review", "Support access · Pending", "Project update · Confirm"],
    footer: "Requests reach the right authorised role",
  },
  helpdesk: {
    label: "Support desk",
    icon: "support",
    rows: ["Email issue · Assigned", "Laptop setup · In progress", "VPN access · Resolved"],
    footer: "Every ticket has an owner and a status",
  },
  reports: {
    label: "Workforce summary",
    icon: "chart",
    rows: ["Attendance consistency · 92%", "Open projects · 14", "Pending approvals · 8"],
    footer: "Operational data becomes usable visibility",
  },
  payroll: {
    label: "Payroll review",
    icon: "payroll",
    rows: ["Salary inputs · Ready", "Attendance review · Complete", "Payroll batch · Awaiting approval"],
    footer: "Every payroll step keeps its owner and review status",
  },
  payslip: {
    label: "Payslip centre",
    icon: "payslip",
    rows: ["June payroll · Approved", "Payslip preview · Ready", "Employee access · Published"],
    footer: "Approved salary records remain clear and accessible",
  },
  mobile: {
    label: "Mobile workday",
    icon: "mobile",
    rows: ["Check in", "Update site visit", "Raise support request"],
    footer: "Focused actions for smaller screens",
  },
};

export default function FeatureHeroVisual({ featureKey }) {
  const visual = visualMap[featureKey] || visualMap["core-hr"];
  return (
    <div className={`feature-workbench feature-workbench-${featureKey}`}>
      <header>
        <span><Icon name={visual.icon} /></span>
        <div><small>Live workflow preview</small><strong>{visual.label}</strong></div>
        <em>Today</em>
      </header>
      <div className="feature-workbench-list">
        {visual.rows.map((row, index) => (
          <div key={row}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <span>{row}</span>
            <Icon name={index === visual.rows.length - 1 ? "arrow" : "check"} />
          </div>
        ))}
      </div>
      <footer><Icon name="link" /><span>{visual.footer}</span></footer>
    </div>
  );
}
