import { Link } from "react-router-dom";
import { Camera, CheckCircle2, ScanFace, ShieldCheck, UserRoundCheck, Settings2 } from "lucide-react";
import Icon from "./Icon";

const highlights = [
  { icon: Camera, title: "Guided enrollment", copy: "Register with the employee camera." },
  { icon: UserRoundCheck, title: "Reviewed by your team", copy: "Authorised HR, Admin or IT Head approval." },
  { icon: ShieldCheck, title: "Privacy-conscious", copy: "Consent-led enrollment and protected face data." },
  { icon: Settings2, title: "Company-controlled", copy: "Prepare first, then choose when to enable verification." },
];

/** Decorative product illustration: no camera access or live verification occurs here. */
export default function FaceRecognitionShowcase() {
  return (
    <section className="public-section yc-face-story-panel" data-panel-label="AI face recognition attendance" aria-labelledby="yc-face-story-title">
      <div className="page-width yc-face-story-shell">
        <header className="yc-face-story-copy">
          <span className="yc-face-story-kicker"><ScanFace aria-hidden="true" size={17} /> AI-POWERED ATTENDANCE</span>
          <h2 id="yc-face-story-title">A familiar check-in.<em>A smarter way to verify.</em></h2>
          <p>
            Bring secure, AI-powered face recognition into the everyday workday.
            Employees enroll with consent, authorised teams review registrations,
            and face verification supports accurate check-in and checkout when enabled.
          </p>
          <div className="yc-face-story-proof">
            <span><CheckCircle2 aria-hidden="true" /> Guided registration</span>
            <span><CheckCircle2 aria-hidden="true" /> Verified attendance</span>
            <span><CheckCircle2 aria-hidden="true" /> Flexible rollout</span>
          </div>
          <Link to="/product/attendance" className="yc-face-story-cta">
            Explore Face Recognition Attendance <Icon name="arrow" />
          </Link>
        </header>

        <div className="yc-face-story-visual" aria-label="Illustration of the face verification and approval experience">
          <div className="yc-face-story-preview" aria-hidden="true">
            <div className="yc-face-preview-top">
              <span><i /> EMPLOYEE VERIFICATION</span>
              <span className="yc-face-preview-secure"><ShieldCheck size={15} /> SECURE</span>
            </div>
            <div className="yc-face-preview-frame">
              <div className="yc-face-preview-corners" />
              <div className="yc-face-preview-orbit"><ScanFace strokeWidth={1.35} /></div>
              <div className="yc-face-preview-scan-line" />
            </div>
            <div className="yc-face-preview-bottom">
              <div><CheckCircle2 size={18} /><strong>Identity verification</strong></div>
              <small>Camera-based check-in & checkout</small>
            </div>
          </div>
          <div className="yc-face-story-highlights">
            {highlights.map(({ icon: VisualIcon, title, copy }) => (
              <article className="yc-face-story-highlight" key={title}>
                <span><VisualIcon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
                <div><strong>{title}</strong><small>{copy}</small></div>
              </article>
            ))}
          </div>
          <span className="yc-face-story-visual-note">Illustrative preview · not a live camera feed</span>
        </div>
      </div>
    </section>
  );
}
