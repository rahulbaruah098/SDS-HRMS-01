import { Outlet } from "react-router-dom";
import PublicMotionLayer from "../components/PublicMotionLayer";
import ScrollToTopButton from "../components/ScrollToTopButton";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import WebsiteAssistant from "../components/WebsiteAssistant";

export default function PublicLayout() {
  return (
    <div className="public-site">
      <PublicMotionLayer />
      <SiteHeader />

      <div className="public-scroll-track" aria-label="Website sections">
        <div className="public-horizontal-viewport">
          <div className="public-horizontal-shell">
            <Outlet />
          </div>
        </div>
      </div>

      <SiteFooter />

      <div className="public-floating-actions" aria-label="Page assistance">
        <ScrollToTopButton />
        <WebsiteAssistant />
      </div>
    </div>
  );
}
