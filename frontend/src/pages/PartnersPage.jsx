import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const programmes = [
  ["implementation", "Implementation partners", "Help organisations prepare data, configure workflows, guide adoption and support rollout.", "settings", "violet"],
  ["referral", "Referral partners", "Introduce suitable organisations and collaborate through a clear opportunity and handover process.", "people", "cyan"],
  ["technology", "Technology partners", "Explore integrations and complementary capabilities that strengthen the wider HR technology experience.", "link", "amber"],
];

export default function PartnersPage() {
  return (
    <main className="public-main">
      <PageHero eyebrow="Partner ecosystem" title="Create better HR outcomes together." description="YourComate welcomes implementation, referral and technology collaboration with partners who value practical delivery and a strong customer experience." icon="link" tone="mint" variant="partners" primary={["Contact Partnerships", "/contact"]} secondary={["Explore Product", "/product"]}>
        <HeroScene type="partners" />
      </PageHero>
      <section className="public-section"><div className="page-width"><div className="partner-grid">{programmes.map(([id, title, copy, icon, tone]) => <article id={id} className={`partner-card partner-${tone}`} key={id}><span><Icon name={icon} /></span><h2>{title}</h2><p>{copy}</p><ul><li><Icon name="check" />Structured collaboration</li><li><Icon name="check" />Product and rollout guidance</li><li><Icon name="check" />Shared customer success focus</li></ul><Link to={`/contact?topic=partner&programme=${id}`}>Discuss partnership <Icon name="arrow" /></Link></article>)}</div></div></section>
    </main>
  );
}
