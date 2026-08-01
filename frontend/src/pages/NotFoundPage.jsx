import { Link } from "react-router-dom";
import Icon from "../components/Icon";

export default function NotFoundPage() {
  return (
    <main className="public-main">
      <section className="public-simple-empty public-not-found"><div className="page-width"><span><Icon name="help" /></span><small>404 · Route not found</small><h1>That page is not available.</h1><p>Return to the homepage, explore the platform or ask the website guide for help.</p><div><Link className="button button-primary" to="/">Go Home</Link><Link className="button button-ghost" to="/product">Explore Product</Link></div></div></section>
    </main>
  );
}
