import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "People foundation",
  title: "Policies & Documents",
  purpose: "The Policies module provides a central tenant-specific library for official HR policy documents. Authorised HR roles publish a document with an identifier, title and summary, while employees of the same tenant can search and securely download the available file.",
  icon: "document",
  tone: "violet",
  heroHeading: "One tenant-specific library for approved workplace documents.",
  heroPillars: [
  "Controlled publishing",
  "Searchable library",
  "Secure download",
  "Tenant-scoped access"
],
  covers: [
  "Tenant-specific policy publishing rather than a shared cross-company document list.",
  "Document ID, policy title, short summary and uploaded file metadata.",
  "Accepted files in the supplied interface: PDF, DOCX, JPG, JPEG, PNG and WEBP.",
  "Employee search by document ID, title, summary or original filename.",
  "Download access for published policy files.",
  "Publisher and publication-date information in the policy list."
],
  users: [
  "The supplied Policies page allows upload for HR, HR Admin and HR Manager roles.",
  "Employees and other authorised tenant users can view or download documents made available to their tenant.",
  "A policy uploaded under one Customer tenant is not intended to appear to another tenant.",
  "Administrative publishing authority should follow the organisation's internal policy ownership process."
],
  workflow: [
  "The policy owner prepares and approves the authoritative document outside the upload action.",
  "An authorised HR user enters the unique document ID, title and concise summary.",
  "The user selects a supported file and submits it to the tenant policy library.",
  "Employees search or browse the tenant policy list.",
  "The employee downloads the required document and follows the published version.",
  "When a policy changes, the policy owner controls replacement and employee communication through the approved process."
],
  rules: [
  "Required upload fields are Document ID Number, Title of the Policy, Summary of the Policy and file.",
  "The interface displays the file extension, file size, original filename, creator and created date where available.",
  "Search works across the main identifying fields.",
  "The published file remains scoped to the current tenant.",
  "The supplied page focuses on upload, list, search and download; a separate acknowledgement workflow is not asserted here."
],
  modules: [
  "Employee self-service gives staff direct access to the library.",
  "Notifications can be used separately to announce important policy publication.",
  "Tenant and role controls determine publishing and viewing scope.",
  "Audit expectations should be set by the organisation's governance process."
],
};

export default function PoliciesDocumentsPage() {
  return <FeatureGuideLayout {...page} />;
}
