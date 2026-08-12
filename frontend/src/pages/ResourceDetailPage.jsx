import { Navigate, useParams } from "react-router-dom";

const resourceRoutes = {
  "hrms-guide": "/resources/hrms-guide",
  "guide": "/resources/hrms-guide",
  "product-walkthroughs": "/resources/product-walkthroughs",
  "walkthroughs": "/resources/product-walkthroughs",
  "frequently-asked-questions": "/resources/frequently-asked-questions",
  "faq": "/resources/frequently-asked-questions",
};

export default function ResourceDetailPage() {
  const { resourceKey } = useParams();
  const destination = resourceRoutes[resourceKey];

  return <Navigate to={destination || "/resources"} replace />;
}
