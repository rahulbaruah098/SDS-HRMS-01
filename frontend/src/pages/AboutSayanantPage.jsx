import { Link } from "react-router-dom";
import Icon from "../components/Icon";

const values = [
  ["01", "Equity", "Design participation and opportunity so that people and communities are not excluded by circumstance."],
  ["02", "Integrity", "Act with honesty, accountability and coherence between stated intent and delivery practice."],
  ["03", "Excellence", "Bring rigour, learning and high standards to advisory work, implementation and institutional support."],
  ["04", "Trust", "Build dependable relationships through respect, transparency and consistent follow-through."],
];

const portfolioColumns = [
  {
    number: "01",
    title: "Evidence & programme intelligence",
    items: [
      ["1.1", "Research & studies", "Primary and secondary research, field insight, communication and learning-oriented analysis."],
      ["1.2", "Monitoring & evaluation", "Frameworks, tracking, reviews and evidence that help programmes understand progress and improve."],
      ["1.3", "Communication for development", "Purposeful communication that supports awareness, participation, knowledge and behavioural outcomes."],
    ],
  },
  {
    number: "02",
    title: "Institutions, enterprise & markets",
    items: [
      ["2.1", "FPO promotion & management", "Support for producer institutions, governance, operations, business planning and sustainability."],
      ["2.2", "Agripreneurship & value chains", "Enterprise development, market connections and value-chain strengthening around rural sectors."],
      ["2.3", "Organisation development & IBCB", "Institutional and business-capacity building for organisations, collectives and delivery teams."],
    ],
  },
  {
    number: "03",
    title: "Systems & enabling services",
    items: [
      ["3.1", "Marketing support", "Market-facing strategy and practical support that helps products, enterprises and institutions reach opportunity."],
      ["3.2", "Natural resources & climate", "Work related to natural-resource management, climate change and climate-smart livelihood systems."],
      ["3.3", "IT consulting & transformation", "MIS/ERP, web and mobile systems, integration, cloud-native solutions, analytics, automation and security services."],
    ],
  },
];

const partners = [
  ["01", "Governments & public programmes", "Policy, programme, mission and implementation contexts."],
  ["02", "CSR agencies & development partners", "Outcome-led initiatives, studies, PMUs, monitoring and field delivery."],
  ["03", "FPOs, SHGs, CLFs & institutions", "Governance, capacity, enterprise, systems and market readiness."],
  ["04", "Enterprises, women & youth", "Skills, finance, technology, agripreneurship and livelihood opportunity."],
];

const sdgs = [
  ["1", "No poverty"],
  ["2", "Zero hunger"],
  ["5", "Gender equality"],
  ["10", "Reduced inequalities"],
  ["12", "Responsible production"],
  ["15", "Life on land"],
  ["16", "Strong institutions"],
];

const deliveryLogic = [
  "Listen & diagnose",
  "Design with context",
  "Build capability",
  "Connect markets & systems",
  "Measure & improve",
];

const philosophy = [
  [
    "01",
    "People and inclusion",
    "Sayanant centres rural, disadvantaged and livelihood communities.",
    "YourComate begins with the employee, manager and administrator completing real work.",
  ],
  [
    "02",
    "Institutions and roles",
    "Sayanant strengthens organisations, collectives and delivery capacity.",
    "YourComate translates responsibility into roles, permissions, queues and accountable workflows.",
  ],
  [
    "03",
    "Connected systems",
    "Sayanant links evidence, livelihoods, markets, institutions and enabling services.",
    "YourComate connects people records, operations, talent, pay, support and intelligence.",
  ],
  [
    "04",
    "Learning and improvement",
    "Sayanant uses research, monitoring, evaluation and organisational development.",
    "YourComate uses status visibility, reports and guided action to support operational follow-through.",
  ],
];

function SectionHeading({ eyebrow, title, copy, number }) {
  return (
    <header className="yc-profile-section-heading">
      <div>
        <span className="yc-profile-section-number">{number}</span>
        <span className="yc-profile-eyebrow">{eyebrow}</span>
      </div>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

export default function AboutSayanantPage() {
  return (
    <main className="public-main yc-profile-page yc-profile-page-sayanant">
      <section className="yc-profile-hero yc-profile-hero-sayanant">
        <div className="page-width yc-profile-hero-grid">
          <div className="yc-profile-hero-copy">
            <div className="yc-profile-document-line">
              <span>YOURCOMATE × SAYANANT GROUP</span>
              <span>COMPANY & PLATFORM PROFILE</span>
            </div>

            <span className="yc-profile-part">PART 02 · ABOUT SAYANANT GROUP</span>

            <h1>
              About
              <em>Sayanant Group</em>
            </h1>

            <p>
              An enabling ecosystem for inclusive growth, combining development
              consulting, institution building, sector expertise, research,
              market thinking and technology-enabled delivery.
            </p>

            <div className="yc-profile-hero-actions">
              <Link className="button button-primary" to="/contact">
                Contact the team <Icon name="arrow" />
              </Link>
              <Link className="button button-ghost" to="/about">
                Explore YourComate
              </Link>
            </div>
          </div>

          <aside className="yc-profile-hero-board yc-profile-hero-board-sayanant" aria-label="Sayanant Group profile summary">
            <span>02</span>
            <small>A CONNECTED VIEW OF</small>
            <strong>PURPOSE</strong>
            <strong>PEOPLE</strong>
            <strong>PRACTICE</strong>
            <div>
              <i />
              <p>People. Process. Performance. Purpose.</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="yc-profile-section">
        <div className="page-width">
          <SectionHeading
            number="14"
            eyebrow="Sayanant Group / Overview"
            title="Nurturing innovation. Delivering excellence."
            copy="Sayanant’s official materials position the group around enabling ecosystems for inclusive growth, with SDS and allied initiatives working across rural livelihoods, institutions, markets, skills, research and technology."
          />

          <div className="yc-profile-group-overview">
            <article className="yc-profile-group-story">
              <small>GROUP PROFILE</small>
              <h3>Development expertise grounded in field realities.</h3>
              <p>
                The official About page describes work with governments,
                corporate social responsibility agencies, farmer producer
                organisations and enterprises across Eastern and North-Eastern
                India. The wider website connects this work with agripreneurship,
                producer collectives, climate-smart practice, research,
                programme management and digital transformation.
              </p>
            </article>

            <div className="yc-profile-stat-grid">
              <article>
                <strong>60+</strong>
                <span>Advisory engagements</span>
              </article>
              <article>
                <strong>13+</strong>
                <span>States impacted</span>
              </article>
              <article>
                <strong>1,80,000+</strong>
                <span>People impacted directly or indirectly</span>
              </article>
            </div>
          </div>

          <div className="yc-profile-history">
            <article>
              <b>3+ decades</b>
              <p>The official home page describes the wider Sayanant Group legacy as spanning more than three decades in development consulting.</p>
            </article>
            <article>
              <b>2013</b>
              <p>The official About page states that SDS was founded in 2013 to strengthen livelihoods, markets, institutions and development delivery.</p>
            </article>
            <article>
              <b>Today</b>
              <p>SDS and allied initiatives are presented as combining advisory, field implementation, research, systems, skills and technology-enabled services.</p>
            </article>
          </div>

          <p className="yc-profile-footnote">
            Published on the official Sayanant website; accessed 11 August 2026.
            Figures may change over time.
          </p>
        </div>
      </section>

      <section className="yc-profile-section yc-profile-section-soft">
        <div className="page-width">
          <SectionHeading
            number="15"
            eyebrow="Sayanant Group / Purpose"
            title="Mission, vision and values."
            copy="The group’s public narrative brings together ambition for strong development institutions with a disciplined values framework for work affecting rural and disadvantaged communities."
          />

          <div className="yc-profile-mission-grid">
            <article>
              <small>MISSION</small>
              <p>
                Enable organisations and individuals to unlock their potential in
                ways that create meaningful impact for rural poor and
                disadvantaged communities.
              </p>
            </article>
            <article>
              <small>VISION</small>
              <p>
                Be recognised as a world-class development-support organisation
                for rural livelihood promotion.
              </p>
            </article>
          </div>

          <h3 className="yc-profile-subheading">The four stated values</h3>
          <div className="yc-profile-card-grid yc-profile-card-grid-four">
            {values.map(([number, title, copy]) => (
              <article key={title}>
                <b>{number}</b>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="yc-profile-purpose-band">
            <small>STRATEGIC DIRECTION</small>
            <p>
              The mission explains who should benefit; the vision defines the
              standard of organisation Sayanant seeks to become; the values
              describe how the work should be carried out.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-profile-section">
        <div className="page-width">
          <SectionHeading
            number="16"
            eyebrow="Sayanant Group / Service portfolio"
            title="From evidence and institutions to enterprise and technology."
            copy="The official website presents a broad portfolio that can support programmes from diagnosis and design through execution, capability building, monitoring and market linkage."
          />

          <div className="yc-profile-portfolio-grid">
            {portfolioColumns.map((column) => (
              <article key={column.number}>
                <header>
                  <b>{column.number}</b>
                  <h3>{column.title}</h3>
                </header>

                <div>
                  {column.items.map(([number, title, copy]) => (
                    <section key={number}>
                      <small>{number}</small>
                      <h4>{title}</h4>
                      <p>{copy}</p>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="yc-profile-callout">
            <strong>
              The portfolio is multidisciplinary by design: evidence informs
              programmes; institutions organise people; markets and systems enable scale.
            </strong>
          </div>
        </div>
      </section>

      <section className="yc-profile-section yc-profile-section-soft">
        <div className="page-width">
          <SectionHeading
            number="17"
            eyebrow="Sayanant Group / Operating landscape"
            title="Sectors, partners and sustainable-development intent."
            copy="Sayanant’s official public material links sector knowledge with institution building, programme delivery and a defined set of Sustainable Development Goal commitments."
          />

          <div className="yc-profile-sector-band">
            <small>PRIORITY SECTORS</small>
            <div>
              {["Rural livelihoods", "Agriculture", "Fishery", "Poultry", "Piggery"].map((sector) => (
                <span key={sector}>{sector}</span>
              ))}
            </div>
          </div>

          <div className="yc-profile-landscape-grid">
            <section>
              <h3>Who Sayanant works with</h3>
              <div className="yc-profile-partner-list">
                {partners.map(([number, title, copy]) => (
                  <article key={title}>
                    <b>{number}</b>
                    <div>
                      <strong>{title}</strong>
                      <p>{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <h3>Sustainable Development Goals identified by Sayanant</h3>
              <div className="yc-profile-sdg-grid">
                {sdgs.map(([number, label]) => (
                  <article key={number}>
                    <b>{number}</b>
                    <span>{label}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="yc-profile-delivery-logic">
            <small>DELIVERY LOGIC</small>
            <div>
              {deliveryLogic.map((step, index) => (
                <span key={step}>
                  <b>{index + 1}</b>
                  {step}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="yc-profile-section yc-profile-shared-section">
        <div className="page-width">
          <SectionHeading
            number="18"
            eyebrow="YourComate × Sayanant"
            title="A shared operating philosophy."
            copy="The connection below is an evidence-based positioning interpretation: it links YourComate’s implemented product principles with themes in Sayanant’s official mission, values and service model."
          />

          <div className="yc-profile-philosophy-grid">
            {philosophy.map(([number, title, sayanant, yourcomate]) => (
              <article key={title}>
                <b>{number}</b>
                <h3>{title}</h3>
                <dl>
                  <div>
                    <dt>SAYANANT</dt>
                    <dd>{sayanant}</dd>
                  </div>
                  <div>
                    <dt>YOURCOMATE</dt>
                    <dd>{yourcomate}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="yc-profile-positioning">
            <small>POSITIONING STATEMENT</small>
            <strong>
              Technology becomes useful when it respects people, roles and real
              operating context.
            </strong>
            <p>
              Viewed together, Sayanant contributes an institution-and-impact
              lens while YourComate expresses that lens as a connected digital
              workspace for everyday people operations.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-profile-section">
        <div className="page-width">
          <SectionHeading
            number="19"
            eyebrow="Sources & editorial basis"
            title="What this profile is—and is not."
            copy="This section makes the evidence boundary explicit so the material can be used confidently as a content foundation and reviewed where necessary before public publication."
          />

          <div className="yc-profile-source-grid">
            <article>
              <small>YOURCOMATE SOURCE SET</small>
              <p>
                The YourComate profile is based on the supplied project’s
                public-facing source content and implemented feature descriptions,
                including the About page, Product page, Saya page and public-site
                feature data.
              </p>
            </article>

            <article>
              <small>OFFICIAL SAYANANT SOURCES</small>
              <p>
                Sayanant descriptions are based on its official About, home, IT
                consulting and contact materials covering mission, values,
                services, sectors, SDG commitments and technology services.
              </p>
            </article>

            <article>
              <small>INTERPRETATION RULES</small>
              <p>
                Official claims are paraphrased; no unsupported entity,
                ownership, certification or financial claims are introduced.
                Dynamic outreach figures are dated 11 August 2026.
              </p>
            </article>
          </div>

          <div className="yc-profile-editorial-note">
            <Icon name="shield" />
            <p>
              The shared-philosophy section is positioning interpretation, not a
              formal corporate statement. Legal names, marks, statistics and
              contact details should receive owner approval before public release.
            </p>
          </div>

          <div className="yc-profile-hero-actions yc-profile-final-actions">
            <Link className="button button-primary" to="/contact">
              Start a conversation <Icon name="arrow" />
            </Link>
            <Link className="button button-ghost" to="/about">
              Read about YourComate
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
