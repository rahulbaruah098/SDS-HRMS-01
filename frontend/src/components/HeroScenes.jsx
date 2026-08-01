import Icon from "./Icon";

const sceneData = {
  product: {
    label: "Platform map",
    title: "One record, many workflows",
    modules: ["People", "Attendance", "Leave", "Projects", "Approvals", "Support", "Payroll", "Payslips", "Saya AI"],
  },
  pricing: {
    label: "Access planning",
    title: "Choose scope before cost",
    modules: ["Employees", "Modules", "Locations", "Support"],
  },
  customers: {
    label: "Outcome board",
    title: "What teams improve first",
    modules: ["Less follow-up", "Clear ownership", "Faster decisions"],
  },
  resources: {
    label: "Knowledge desk",
    title: "Useful material, not filler",
    modules: ["Guides", "Checklists", "Templates", "FAQs"],
  },
  about: {
    label: "Product workshop",
    title: "Built around real operating work",
    modules: ["Listen", "Simplify", "Build", "Improve"],
  },
  security: {
    label: "Access review",
    title: "Identity, role and responsibility",
    modules: ["Verify", "Authorise", "Review", "Record"],
  },
  support: {
    label: "Help routing",
    title: "The right help, without bouncing around",
    modules: ["Access", "Demo", "Product", "Tickets"],
  },
  contact: {
    label: "Conversation brief",
    title: "Start with the real requirement",
    modules: ["Team size", "Work modes", "Priorities", "Timeline"],
  },
  resource: {
    label: "Working document",
    title: "A practical starting point",
    modules: ["Assess", "Prepare", "Roll out", "Review"],
  },
  saya: {
    label: "Inside YourComate HRMS",
    title: "Saya belongs in the signed-in workspace",
    modules: ["Context", "Guidance", "Actions", "Role control"],
  },
};

function ProductScene({ data }) {
  return (
    <div className="hero-scene hero-product-scene">
      <div className="scene-window-bar"><i /><i /><i /><span>{data.label}</span></div>
      <div className="product-scene-core">
        <span className="product-scene-logo">
          <img src="/images/yc_logo.png" alt="YourComate" />
        </span>

        <div>
          <small>Shared people foundation</small>
          <strong>{data.title}</strong>
        </div>
      </div>

      <div className="product-scene-modules">
        {data.modules.map((item, index) => (
          <span key={item} className={`scene-chip scene-chip-${index + 1}`}>
            {item}
          </span>
        ))}
      </div>

      <div className="product-scene-footer">
        <Icon name="link" />
        <span>Records stay connected across workflows</span>
      </div>
    </div>
  );
}

function PricingScene({ data }) {
  const icons = ["people", "hierarchy", "building", "support"];
  const descriptions = [
    "Define the employee range the workspace must support.",
    "Choose the HR, payroll and operational modules required.",
    "Map office, field and multi-location workforce coverage.",
    "Select the onboarding and support level your team needs.",
  ];

  return (
    <div className="hero-scene hero-pricing-scene">
      <div className="pricing-brief-card">
        <small>{data.label}</small>
        <strong>{data.title}</strong>
        <p>
          Start with the work you need to improve, then define access,
          rollout and support before choosing a plan.
        </p>
      </div>

      <div className="pricing-control-list">
        {data.modules.map((item, index) => (
          <article className={`pricing-control-card pricing-control-card-${index + 1}`} key={item}>
            <header>
              <span>
                <Icon name={icons[index]} />
              </span>

              <b>{item}</b>
            </header>

            <p>{descriptions[index]}</p>

            <i
              aria-hidden="true"
              style={{ "--pricing-progress": `${54 + index * 10}%` }}
            />
          </article>
        ))}
      </div>

      <div className="pricing-stamp">
        <Icon name="check" />
        Scope reviewed
      </div>
    </div>
  );
}

function CustomerScene({ data }) {
  return (
    <div className="hero-scene hero-customer-scene">
      <div className="customer-note customer-note-one">
        <small>Before</small>
        <strong>Too many follow-ups</strong>
        <p>Records, requests and progress lived in separate places.</p>
      </div>

      <div className="customer-note customer-note-two">
        <small>After</small>
        <strong>{data.title}</strong>
        <p>People can see ownership, status and next actions.</p>
      </div>

      <div className="customer-outcome-row">
        {data.modules.map((item, index) => (
          <span key={item}>
            <b>0{index + 1}</b>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ResourceScene({ data }) {
  return (
    <div className="hero-scene hero-resource-scene">
      <div className="resource-shelf-title">
        <small>{data.label}</small>
        <strong>{data.title}</strong>
      </div>

      <div className="resource-book-row">
        {data.modules.map((item, index) => (
          <div key={item} className={`resource-book resource-book-${index + 1}`}>
            <Icon name={["book", "checklist", "document", "help"][index]} />
            <b>{item}</b>
          </div>
        ))}
      </div>

      <div className="resource-desk-line">
        <span>Use it. Adapt it. Put it to work.</span>
        <Icon name="arrow" />
      </div>
    </div>
  );
}

function WorkshopScene({ data }) {
  return (
    <div className="hero-scene hero-workshop-scene">
      <div className="workshop-board">
        <small>{data.label}</small>
        <strong>{data.title}</strong>
        <p>We start with what people actually do, where work gets stuck, and who needs visibility.</p>
      </div>

      <div className="workshop-steps">
        {data.modules.map((item, index) => (
          <span key={item}>
            <b>{index + 1}</b>
            {item}
          </span>
        ))}
      </div>

      <div className="workshop-pencil" aria-hidden="true" />
    </div>
  );
}

function SecurityScene({ data }) {
  return (
    <div className="hero-scene hero-security-scene">
      <div className="security-access-card">
        <header>
          <span><Icon name="shield" /></span>
          <div>
            <small>{data.label}</small>
            <strong>{data.title}</strong>
          </div>
        </header>

        <div className="security-access-rows">
          {data.modules.map((item, index) => (
            <div key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{item}</b>
              <Icon name="check" />
            </div>
          ))}
        </div>
      </div>

      <div className="security-key-card">
        <Icon name="lock" />
        <span>Role boundaries</span>
      </div>
    </div>
  );
}

function SupportScene({ data }) {
  return (
    <div className="hero-scene hero-support-scene">
      <div className="support-inbox-card">
        <header>
          <small>{data.label}</small>
          <strong>{data.title}</strong>
        </header>

        {data.modules.map((item, index) => (
          <div key={item}>
            <span><Icon name={["lock", "email", "book", "support"][index]} /></span>
            <b>{item}</b>
            <em>{["Sign in", "Start request", "Browse", "Open ticket"][index]}</em>
          </div>
        ))}
      </div>

      <div className="support-status-card">
        <i />
        <div>
          <small>Current response</small>
          <strong>Route identified</strong>
        </div>
      </div>
    </div>
  );
}

function ContactScene({ data }) {
  return (
    <div className="hero-scene hero-contact-scene">
      <div className="contact-brief-sheet">
        <small>{data.label}</small>
        <strong>{data.title}</strong>

        {data.modules.map((item, index) => (
          <label key={item}>
            <span>{item}</span>
            <i style={{ width: `${62 + index * 7}%` }} />
          </label>
        ))}
      </div>

      <div className="contact-conversation">
        <p>“We have field and office teams.”</p>
        <p>“Let’s map attendance, approvals and rollout.”</p>
      </div>
    </div>
  );
}

function ResourceDetailScene({ data, title }) {
  return (
    <div className="hero-scene hero-resource-detail-scene">
      <div className="resource-document-cover">
        <span><Icon name="document" /></span>
        <small>{data.label}</small>
        <strong>{title || data.title}</strong>
        <div>{data.modules.map((item) => <i key={item} />)}</div>
      </div>

      <div className="resource-paper-tabs">
        <span>01</span>
        <span>02</span>
        <span>03</span>
      </div>
    </div>
  );
}

function SayaScene() {
  return (
    <div className="hero-scene hero-saya-scene">
      <img
        className="hero-saya-scene-image"
        src="/images/yourcomate.png"
        alt="YourComate Saya AI assistant"
        loading="eager"
        decoding="async"
        draggable="false"
      />
    </div>
  );
}

export default function HeroScene({ type, title }) {
  const data = sceneData[type] || sceneData.product;

  const components = {
    product: ProductScene,
    pricing: PricingScene,
    customers: CustomerScene,
    resources: ResourceScene,
    about: WorkshopScene,
    security: SecurityScene,
    support: SupportScene,
    contact: ContactScene,
    resource: ResourceDetailScene,
    saya: SayaScene,
  };

  const Scene = components[type] || ProductScene;
  return <Scene data={data} title={title} />;
}
