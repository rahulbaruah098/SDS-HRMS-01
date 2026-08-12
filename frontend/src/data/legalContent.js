export const POLICY_VERSION = "2026-08-12-v2";
export const POLICY_EFFECTIVE_DATE = "12 August 2026";

export const legalPages = {
  privacy: {
    eyebrow: "Privacy Policy",
    title: "Privacy Policy",
    summary:
      "This Privacy Policy explains how SDS handles personal data when organisations and individuals visit the YourComate website, request a trial, use a YourComate tenant, contact support, use optional HRMS capabilities or complete a payment through Razorpay.",
    icon: "shield",
    tone: "violet",
    sections: [
      [
        "Policy at a glance",
        `This Privacy Policy explains how SDS handles personal data when organisations and individuals visit the YourComate website, request a trial, use a YourComate tenant, contact support, use optional HRMS capabilities or complete a payment through Razorpay.

Website and account data

Customer workforce data

Payment data

SDS decides why and how public enquiries, trial registrations, accounts, security logs and billing records are processed.

The Customer generally decides the purposes of employee, candidate and HR data; SDS processes that data to deliver the service and follow valid instructions.

Razorpay processes payment instruments in its checkout. YourComate receives transaction and verification metadata needed to activate and administer subscriptions.

INTERPRETATION This document is written for practical website use. It does not remove non-waivable rights under applicable law, and an expressly accepted Order Form may contain more specific terms for a Customer.`,
        "GL",
      ],
      [
        "Scope and who is responsible",
        `This Policy applies to personal data handled through the public YourComate website, demo and contact forms, signed-in HRMS workspaces, support channels, mobile or responsive experiences, Saya-assisted features and billing workflows. It applies alongside any Order Form, data-processing agreement, employment notice or Customer policy that lawfully governs a particular use. Processing context

Primary role

Public website, enquiries, trials, SDS account administration and SDS billing records

SDS ordinarily acts as the data fiduciary because it determines the purpose and means of this processing.

Employee, candidate, payroll, attendance and other HRMS records uploaded or generated for a Customer

The Customer ordinarily acts as the data fiduciary; SDS acts as its processor/service provider, subject to contract and valid instructions.

Razorpay checkout and payment-instrument processing

Razorpay processes data under its own legal obligations and privacy terms; SDS acts as merchant and receives limited transaction metadata.

IMPORTANT ROLE BOUNDARY Employees and candidates should normally raise an HR-record request with their employer or prospective employer first. SDS will support the Customer where required and may redirect a request so the responsible organisation can verify identity and authority.`,
        "01",
      ],
      [
        "Personal data we may process",
        `The categories processed depend on the modules enabled, the user’s role and the information supplied by the Customer or user. YourComate may process the following:

• Organisation and account data: company name, workforce size, administrator details, name, work email, phone number, department, designation, reporting structure, user role and authentication information.

• Recruitment data: job applications, resumes, education and work history, skills, screening notes, interview schedules, evaluations, offer details and onboarding records.

• Employment and HR data: employee identifiers, profile details, contact information, branch, shift, reporting line, policies, documents, assets, training, performance, leave, grievances and lifecycle status.

• Time, attendance and field-work data: check-in/out records, worked time, work mode, timesheets, visit details and—where the Customer enables them—location, photographs or face-attendance data.

• Payroll and financial administration data: salary structures, earnings, deductions, payable days, bank-related details, tax declarations, reimbursements, loans/advances, payroll reports and payslips.

• Projects, support and communications: assignments, collaborators, progress, approvals, IT tickets, enquiry messages, emails, notification preferences and support history.

• Technical and security data: IP address, browser/device details, operating system, timestamps, session and audit logs, error records, security events, push-notification token and essential browser-storage state.

• Billing data: selected plan, amount, currency, quotation and invoice details, Razorpay order/payment/refund identifiers, payment status, method summary and reconciliation information.

• Saya and optional assistance data: typed or spoken request, transcription, response, feedback and the minimum role/workspace context needed to provide the enabled assistance. DATA MINIMISATION Customers and users should not upload personal data that is irrelevant to an enabled HRMS purpose. Free-text fields, attachments, support messages and AI prompts should be used carefully because they can contain information beyond what the workflow requires.`,
        "02",
      ],
      [
        "How personal data is collected",
        `Personal data may be collected directly from a visitor, Customer administrator, Authorised User, candidate or support requester; uploaded or entered by a Customer; generated through the use of YourComate; received from a device with permission; or received from an enabled integration.

• Direct submissions include trial registration, OTP verification, contact forms, account setup, employee self-service, applications, requests and support communications.

• Customer-provided data includes workforce records, reporting structures, payroll inputs, policies, candidate records and documents migrated or entered by authorised teams.

• Automatically generated data includes workflow status, audit history, login/security logs, attendance timestamps, notification activity and diagnostic events.

• Third-party data may include Razorpay transaction metadata, Cloudflare Turnstile verification results, email-delivery status and information returned by a Customer-authorised integration.`,
        "03",
      ],
      [
        "Why we process personal data",
        `SDS processes personal data only for lawful and defined purposes. Depending on the context, processing supports consent, a user-requested step, performance of a contract, compliance with law, a permitted legitimate use under applicable Indian data-protection law, or valid instructions from the responsible Customer.

• Respond to enquiries; verify company email by OTP; review trial requests; create and administer tenant accounts; and communicate credentials, service notices or support updates.

• Deliver configured HRMS capabilities, including recruitment, employee records, attendance, leave, projects, approvals, payroll, payslips, support, reports, mobile workflows and Saya assistance.

• Create Razorpay orders, verify successful payment, activate or renew subscriptions, issue billing records, reconcile failures and administer eligible refunds.

• Authenticate users, apply role permissions, protect tenant boundaries, detect misuse, investigate incidents, maintain auditability and improve reliability.

• Meet tax, accounting, employment-support, dispute-resolution, regulatory and other legal obligations applicable to SDS or the Customer.

• Develop and improve the product using aggregated, de-identified or appropriately controlled information where reasonably practicable.`,
        "04",
      ],
      [
        "Customer responsibilities for workforce data",
        `A Customer determines which people are placed in its tenant, which modules are enabled, who receives access and how HRMS information is used. The Customer must ensure that its collection and use of employee, candidate and other personal data is lawful, fair and transparent.

• Give employees, candidates and other Data Principals appropriate notices and obtain consent where consent is required.

• Use proportionate role permissions and promptly remove or change access when responsibilities change.
• Keep records accurate, relevant and limited to genuine employment, workforce, recruitment or organisational purposes.

• Apply additional care to location, face-attendance, financial, grievance, health-related or other higher-impact data and enable such features only with a documented lawful basis.

• Respond to rights requests and grievances concerning Customer-controlled HR records, with SDS assistance where required by the service agreement.

• Do not use YourComate for unlawful surveillance, discriminatory profiling or decisions that bypass applicable employment and data-protection obligations.`,
        "05",
      ],
      [
        "Razorpay-enabled payments",
        `Eligible YourComate subscription payments are facilitated through Razorpay. YourComate creates an order using the server-side plan price or approved Premium quotation and activates access only after the payment response is verified.

• Razorpay checkout may collect payment-instrument and authentication information directly from the payer, including card, banking, wallet or UPI information, according to the selected method.

• YourComate ordinarily does not receive or store a full card number, card verification value or UPI PIN. It receives the order ID, payment ID, signature/verification result, amount, currency, status, limited method metadata and related billing information.

• Razorpay’s independent privacy policy and terms also apply to the payer’s interaction with its checkout, banks, card networks and other payment participants.

• Payment and refund records may be retained for reconciliation, tax, accounting, fraud prevention, customer support and legal compliance. PAYMENT SAFETY Never send a card verification value, UPI PIN, online-banking password or one-time banking password to SDS by email, chat, support ticket or an HRMS free-text field.`,
        "06",
      ],
      [
        "Cookies, browser storage and verification tools",
        `YourComate uses essential browser storage and similar technologies needed for authentication, policy acknowledgement, security and requested interface behaviour. The supplied public website does not currently configure advertising trackers.

• Authentication and session information may be stored or accessed so an authorised user can remain signed in and use role-controlled features.

• The public website may remember the version of the Privacy Policy and Terms acknowledged by the visitor.
• Cloudflare Turnstile is used on relevant public forms to distinguish genuine activity from automated abuse and may process device, network and interaction signals under Cloudflare’s terms.

• Razorpay checkout may use cookies or comparable technologies governed by Razorpay’s own policy. A user can clear browser storage through browser settings. Doing so may sign the user out, reset preferences or require policy acknowledgement again. If non-essential analytics or advertising tools are added, this Policy and consent controls should be updated before activation.`,
        "07",
      ],
      [
        "Saya, voice, location and face-attendance features",
        `Some YourComate capabilities can process data that requires additional context and care. These features are available only where implemented, enabled and permitted for the relevant tenant and user.

Saya assistance Saya may use the signed-in user’s role, permissions, prompt and relevant workspace context to provide guidance. Voice interaction may require microphone permission and may create a transcription. Outputs are assistive and must not replace authorised human decisions concerning recruitment, discipline, payroll, performance or employment rights.

Location and field activity Location is processed only when a location-enabled workflow is used and device permission is available. The Customer must define the purpose, access, retention and employee communication for such use.

Face attendance and photographs Where enabled, face or photograph-based attendance data must be collected and used only for the configured attendance purpose. Customers are responsible for the notice, consent or other lawful authority required for their workforce and jurisdiction.

PERMISSION IS NOT PURPOSE Device permission alone does not establish that workforce monitoring is lawful. The Customer must separately establish a lawful, necessary and proportionate business purpose.`,
        "08",
      ],
      [
        "Sharing and service providers",
        `SDS does not sell personal data to advertisers. Personal data may be disclosed only when necessary for the purposes described in this Policy, permitted by contract or required by law.

• Authorised SDS personnel and contractors who need access for implementation, support, security, billing or service operation and are subject to confidentiality obligations.

• The relevant Customer and its Authorised Users according to tenant roles, workflow ownership and reporting structure.

• Infrastructure, hosting, database, email, notification, cybersecurity, anti-abuse, backup, support and approved AI/integration providers acting under appropriate controls.

• Razorpay, banks, card networks, UPI participants and payment partners for payment processing, reconciliation, refund, fraud management and compliance.

• Professional advisers, auditors, insurers, authorities or law-enforcement bodies where disclosure is reasonably necessary and legally permitted or required.

• A successor in a merger, reorganisation, financing or transfer of business, subject to confidentiality, notice and applicable law.`,
        "09",
      ],
      [
        "Storage, location and cross-border processing",
        `Personal data may be stored or processed on systems operated by SDS and approved service providers. The location depends on the deployed infrastructure, Customer configuration and providers used for hosting, communications, payments, security or optional integrations. Where personal data is processed outside the state or country in which a user is located, SDS and the Customer will apply contractual, access-control and other safeguards appropriate to their roles and comply with transfer restrictions notified under applicable law. A Customer requiring a specific data-residency arrangement must record it in the applicable Order Form or data-processing agreement.`,
        "10",
      ],
      [
        "Retention, return and deletion",
        `Personal data is retained only for as long as reasonably necessary for the stated purpose, the active Customer relationship, documented Customer instructions, security, backup integrity, legal compliance, tax/accounting records and dispute resolution.

• Public enquiry and trial records are retained for follow-up, fraud prevention and reasonable sales/operational records, then deleted or anonymised when no longer needed.

• Customer HRMS data is retained during the subscription and handled after expiry or termination according to the Order Form, data-processing agreement, documented export/deletion process and legal holds.

• Payment, invoice and refund information may be retained for statutory accounting, tax, audit, fraud and dispute periods even after access ends.

• Backups and security logs may remain for a limited rolling period and are isolated from ordinary use until securely overwritten, unless preservation is legally required. CUSTOMER ACTION BEFORE EXPIRY Customers should export information they are entitled to retain before subscription access ends. Expiry or suspension may restrict ordinary access while legally required billing and security records remain preserved.`,
        "11",
      ],
      [
        "Security and incident response",
        `SDS applies reasonable technical and organisational safeguards appropriate to the service and risk. Safeguards may include tenant-aware access controls, role permissions, authentication, transport security, password protection, audit logging, backups, monitoring, secure development practices and controlled administrative access. No internet service can guarantee absolute security. Customers must configure permissions carefully, use strong unique credentials, protect devices, review administrator access and notify SDS promptly of suspected compromise. SDS will investigate confirmed incidents and provide notices to affected Customers, Data Principals or authorities when required by applicable law or contract.`,
        "12",
      ],
      [
        "Your rights and choices",
        `Subject to applicable law, identity verification and the role of the Customer, a Data Principal may request information about processing, correction or completion of inaccurate data, erasure when retention is no longer required, withdrawal of consent where processing depends on consent, grievance redressal and nomination of another person to exercise rights in permitted circumstances.

• For employee, candidate, payroll or attendance records, contact the relevant Customer organisation first because it ordinarily controls those records.

• For SDS-controlled website, account or billing data, email hr@sayanant.com with the subject ‘Privacy Request’. Include enough information to locate the record but do not send unnecessary identity documents.

• SDS or the Customer may request proportionate verification, clarify the scope, preserve information required by law or refuse a request where an applicable legal exception permits.

• Withdrawal of consent does not affect earlier lawful processing and may make a consent-dependent feature unavailable.`,
        "13",
      ],
      [
        "Children and young persons",
        `The public website, trial registration and subscription purchase are intended for adults acting for organisations. SDS does not knowingly invite children to create public commercial accounts. If a Customer lawfully employs, engages or recruits a person under the age threshold applicable under data-protection law, the Customer must ensure an appropriate notice, verifiable parental/guardian consent where required, age-appropriate safeguards and a lawful employment or recruitment purpose before entering that person’s data into YourComate.`,
        "14",
      ],
      [
        "Policy updates, grievances and contact",
        `SDS may update this Policy when the product, service providers, legal requirements or data practices change. Material changes will be identified by a revised version/effective date and may be communicated through the website, account or registered email where appropriate. Contact purpose

Published channel

Privacy request or grievance

Email hr@sayanant.com with subject: Privacy Request / Privacy Grievance

Customer-controlled employee or candidate record

Contact the relevant Customer HR or administrator first

Security concern

Email hr@sayanant.com promptly and include ‘Security’ in the subject

Postal/location reference

Sayanant Development Services Pvt. Ltd., Guwahati, Assam, India

This Policy is intended to operate consistently with the Digital Personal Data Protection Act, 2023, the Digital Personal Data Protection Rules, 2025 as applicable and in force from time to time, contractual data-processing commitments and other applicable Indian law.`,
        "15",
      ],
      [
        "Reference basis",
        `The policy language is tailored to the supplied YourComate implementation and the following official or first-party references. Links were reviewed on 11 August 2026. The listed materials inform the drafting but do not become contractual terms unless expressly stated.

01 Digital Personal Data Protection Act, 2023 — India Code
https://www.indiacode.nic.in/handle/123456789/22037?view_type=browse

02 Digital Personal Data Protection Rules, 2025 — MeitY
https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?hl=en-US

03 Razorpay Privacy Policy
https://razorpay.com/privacy-policy/

04 Razorpay Terms
https://razorpay.com/terms/

05 YourComate project legal and billing implementation
Internal supplied project source reviewed 11 August 2026

POLICY GOVERNANCE Policy owner: Sayanant Development Services Pvt. Ltd.. Contact: hr@sayanant.com.`,
        "REF",
      ],
    ],
  },
  terms: {
    eyebrow: "Terms & Conditions",
    title: "Terms & Conditions",
    summary:
      "These Terms form a binding agreement between SDS and the organisation or person accessing YourComate. They cover public website use, approved trials, accounts, subscriptions, payments, Customer data and acceptable use.",
    icon: "document",
    tone: "cyan",
    sections: [
      [
        "Policy at a glance",
        `These Terms form a binding agreement between SDS and the organisation or person accessing YourComate. They cover public website use, approved trials, accounts, subscriptions, payments, Customer data and acceptable use.

Organisation-first service A person creating or administering a tenant confirms authority to act for the Customer and manage its Authorised Users.

Verified subscription activation

Customer-controlled HR decisions

Razorpay payment does not activate a paid term until YourComate verifies the payment response and records the subscription.

YourComate supports workflows; the Customer remains accountable for employment, recruitment, payroll and access decisions.

INTERPRETATION This document is written for practical website use. It does not remove non-waivable rights under applicable law, and an expressly accepted Order Form may contain more specific terms for a Customer.`,
        "GL",
      ],
      [
        "Agreement and provider",
        `These Terms & Conditions (‘Terms’) govern access to and use of YourComate HRMS. YourComate is developed and operated by Sayanant Development Services Pvt. Ltd. (‘SDS’, ‘we’, ‘us’). By visiting the website, submitting a trial request, creating or using an account, accepting an Order Form or completing a payment, the Customer and each Authorised User agree to these Terms. If a person uses YourComate for an organisation, that person confirms that they are authorised to bind the organisation. If they lack authority, they must not accept commercial terms or administer a tenant on its behalf.

READ WITH OTHER DOCUMENTS These Terms should be read with the Privacy Policy, Refund Policy, applicable Order Form, data-processing agreement, implementation scope and any tenant-specific notices.`,
        "01",
      ],
      [
        "Definitions and interpretation",
        `Term

Meaning

YourComate

The YourComate HRMS website, software, APIs, mobile experiences and related services made available by SDS.

SDS / we / us

Sayanant Development Services Pvt. Ltd., the developer and operator of YourComate.

Customer

The organisation that requests, trials, purchases, administers or uses a YourComate tenant.

Authorised User

An employee, candidate, manager, administrator, contractor or other person whom a Customer permits to use the service.

Order Form

A checkout order, accepted quotation, proposal, statement of work or other written commercial document governing a subscription.

Razorpay

The independent payment service provider used to facilitate eligible online payments.

Headings are for convenience. ‘Including’ means including without limitation. A reference to law includes amendments and replacements. If a deadline falls on a non-business day, operational performance may occur on the next business day unless law or an Order Form requires otherwise.`,
        "02",
      ],
      [
        "Document priority",
        `If documents conflict, the following order applies only to the conflicting subject: (1) a signed or expressly accepted Order Form or master agreement; (2) a data-processing agreement for personal-data obligations; (3) these Terms; (4) the Privacy and Refund Policies; and (5) general website or marketing content. Feature pages, screenshots, demonstrations, roadmaps and examples describe intended or illustrative behaviour. They do not override an agreed implementation scope, service commitment, security schedule or commercial quotation.`,
        "03",
      ],
      [
        "Eligibility, registration and account authority",
        `• Commercial accounts and trials are intended for legally capable adults acting for legitimate organisations.
• Registration information must be accurate, current and complete. SDS may verify company email, identity, authority, business purpose and eligibility.

• A trial request is an application, not a guarantee. SDS may approve, reject or request clarification where reasonably necessary for security, capacity, sanctions, fraud prevention or service fit.

• The Customer must designate authorised administrators, maintain current contacts and promptly notify SDS when an administrator or signatory changes.

• Accounts and subscriptions may not be sold, transferred, sublicensed or shared between unrelated organisations without SDS’s written approval.`,
        "04",
      ],
      [
        "Accounts, credentials and tenant administration",
        `The Customer controls which Authorised Users are added to its tenant and which roles they receive. Credentials are personal to the assigned user and must not be shared. The Customer is responsible for actions performed through accounts it created or authorised, except to the extent caused by SDS’s breach.

• Use strong, unique credentials and enabled authentication controls; protect email accounts and devices used for OTP or password recovery.

• Grant the least access reasonably required and review administrator, HR, payroll, finance, manager and support permissions regularly.

• Disable or update access promptly when employment, role, reporting line or authority changes.
• Report suspected unauthorised access, credential exposure or tenant misuse promptly through the published contact channel.

SDS may require a password reset, session termination or temporary restriction when reasonably necessary to protect the service, Customer data or other tenants.`,
        "05",
      ],
      [
        "Fifteen-day trial",
        `The current YourComate evaluation model provides an approved 15-day trial. The trial begins when SDS approves the verified request and creates the trial tenant, not when the initial form is submitted. Enabled features, employee limits and other trial conditions are those displayed during registration or confirmed at approval.

• A trial is for genuine organisational evaluation and may be limited to one trial per organisation or related group unless SDS approves otherwise.

• Trial access is provided without a paid-service availability commitment and may contain evaluation configuration or limits.

• The Customer must use realistic but appropriately minimised data and should not upload unnecessary production data before completing its security, privacy and implementation review.

• At trial expiry, ordinary tenant access may be restricted until a paid subscription is verified or SDS grants a documented extension.

• Trial expiry does not itself delete every record immediately; retention and export are governed by the Privacy Policy, contract and applicable law.`,
        "06",
      ],
      [
        "Plans, pricing and quotations",
        `YourComate may offer Essential, Growth, Premium or other plans. Plan names, features, employee limits, price, currency, billing interval and availability are governed by the live plan record shown before checkout or by an accepted quotation.

• Essential and Growth use the latest administrator-configured price stored by YourComate when the payment order is created. A browser-supplied amount is not accepted as the authoritative price.

• Premium is quotation-based. The amount, employee scope, billing interval, validity, payment due date and implementation/support terms are those in the client-visible quotation or Order Form.

• A public price is an invitation to evaluate and may change prospectively. The amount attached to a created order or accepted quotation controls that purchase.

• Plan limits are enforced according to the active subscription. The Customer must upgrade or reduce configured usage when it exceeds the purchased entitlement. PREMIUM RENEWAL RULE Unless revised by SDS through a later approved quotation, the active Premium custom quotation may remain the price source for renewal. Any revised amount applies only when communicated and accepted before the relevant payment.`,
        "07",
      ],
      [
        "Razorpay checkout and payment verification",
        `Eligible online payments are facilitated through Razorpay. Razorpay is an independent payment service provider and not the supplier of YourComate. A payer’s use of Razorpay checkout is also governed by Razorpay’s terms and privacy policy.

• The Customer must review the plan, term, amount, currency, taxes and company details before authorising payment.

• Payment is considered complete for YourComate only after the required Razorpay order ID, payment ID and signature are verified and the local subscription record is activated.

• A created, pending, abandoned, failed, reversed or unverified transaction does not by itself create a paid subscription.

• Banks, UPI participants, card networks and Razorpay may decline, delay, reverse or investigate a payment under their own rules. SDS cannot compel approval by those parties.

• The Customer must not misuse checkout, test stolen instruments, split a transaction to avoid controls or use YourComate/Razorpay for unlawful or fraudulent activity.`,
        "08",
      ],
      [
        "Subscription term, renewal and cancellation",
        `A paid subscription starts when payment is successfully verified and access is activated, unless an Order Form states another commencement date. The term ends on the recorded subscription end date for the purchased billing interval.

• The current YourComate implementation uses a new customer-initiated order for a renewal payment. It does not treat a stored card or past payment as permission for an automatic debit.

• If an automatic or recurring mandate is introduced later, it will operate only after the payer expressly authorises it through the checkout and receives the applicable mandate/cancellation information.

• Essential and Growth renewal ordinarily uses the latest configured price at the time the renewal order is created. Premium renewal uses the current approved custom-quote source unless revised.

• The Customer may decide not to renew. Non-renewal stops future service after the current paid term; it does not ordinarily create a refund for the unused remainder of an already activated term.

• Downgrades normally take effect at the next term unless SDS agrees otherwise in writing. A downgrade must bring usage within the new plan limits.`,
        "09",
      ],
      [
        "Fees, taxes and billing records",
        `The Customer must pay the amount shown in the applicable order or quotation using an accepted payment method. Fees are stated in Indian Rupees unless another currency is expressly shown. Applicable taxes, deductions or statutory charges are handled as displayed in the Order Form or required by law. YourComate may make a payment receipt or invoice record available after successful verification. The Customer is responsible for providing accurate legal name, billing address, tax registration details and other invoice information before issuance. Corrections are subject to applicable tax and accounting rules. Late or unpaid renewal does not extend the existing term. Access may be restricted after expiry, and a later payment ordinarily starts or restores the applicable paid term from the activation date recorded by the service unless the Order Form provides otherwise.`,
        "10",
      ],
      [
        "Customer data and privacy responsibilities",
        `As between SDS and the Customer, the Customer retains its rights in Customer-provided content and determines the employment, recruitment and operational purposes for which it uses that content. The Customer grants SDS a limited right to host, copy, transmit, back up and otherwise process Customer data only as needed to provide, secure, support and comply with the service and law.

• The Customer must have a lawful basis and provide appropriate notices for employee, candidate, location, attendance, face/photo, payroll, grievance and other data entered into YourComate.

• The Customer must not instruct SDS to process unlawful, infringing, deceptive or irrelevant personal data.
• The Customer is responsible for the accuracy of payroll, tax, attendance, leave, performance, recruitment and employee records and for reviewing outputs before acting.

• SDS may provide reasonable export, correction, deletion or rights-request assistance according to the plan, technical capability, contract and applicable law.`,
        "11",
      ],
      [
        "Acceptable use",
        `No person may use YourComate to:

• Violate law, employment rights, privacy, intellectual property, confidentiality or another person’s rights.
• Gain or attempt unauthorised access; probe security; bypass tenant, role, plan or usage controls; or introduce malware or harmful code.

• Share credentials, impersonate another person, falsify attendance or records, manipulate payment status or misrepresent authority.

• Scrape, copy, reverse engineer, decompile or systematically extract the service except where a non-waivable law expressly permits.

• Overload, disrupt or interfere with service operation, integrations, networks or other Customers.
• Use HR data or Saya output for unlawful surveillance, discriminatory profiling, harassment, retaliation or an automated material decision without required human review.

• Upload content that is illegal, defamatory, fraudulent, abusive, sexually exploitative, threatening or unrelated to a legitimate Customer purpose.

SDS may investigate suspected misuse and preserve relevant records. Proportionate restrictions may be applied to protect users, tenants, the service or legal compliance.`,
        "12",
      ],
      [
        "Saya and automated assistance",
        `Saya is an assistive interface intended to help authorised users understand and navigate enabled YourComate workflows. Its availability and capabilities may vary by tenant, role, plan and technical configuration.

• Saya output may be incomplete, delayed or incorrect and must be checked against the underlying record, policy and authorised process.

• Saya does not provide legal, tax, payroll, medical, financial or employment advice and does not replace professional judgement.

• The Customer must keep accountable human review for hiring, rejection, discipline, promotion, performance, compensation, payroll release and other material decisions.

• Users must not place secrets, banking credentials or irrelevant sensitive information in an AI prompt or voice request.`,
        "13",
      ],
      [
        "Third-party services and integrations",
        `YourComate may depend on or link to third-party services, including Razorpay, Cloudflare, hosting, email, notification, mapping, device, AI or Customer-selected integrations. Those services are independently operated and may have separate terms, privacy practices, availability and technical limits. SDS is responsible for its own contractual obligations but is not responsible for third-party content, payment approval, bank delay, card-network decision or an integration the Customer configures outside SDS’s control. SDS may replace, suspend or modify a third-party integration when necessary for security, law, compatibility or service continuity.`,
        "14",
      ],
      [
        "Intellectual property and feedback",
        `SDS and its licensors retain all rights in YourComate, including software, APIs, workflows, design, documentation, trademarks, graphics and non-Customer materials. Subject to payment and these Terms, SDS grants the Customer a limited, non-exclusive, non-transferable, non-sublicensable right for its Authorised Users to use the subscribed service during the active term for internal organisational operations. Customer names, marks and content remain owned by the Customer or their respective owners. The Customer grants only the limited rights needed for service operation and authorised display within its tenant. SDS will not use a Customer’s name as a public endorsement without permission. If a user voluntarily provides product feedback, SDS may use it to improve the service without an obligation to pay, provided SDS does not publicly identify the Customer or disclose confidential information without permission.`,
        "15",
      ],
      [
        "Confidentiality and security",
        `Each party must protect the other party’s non-public business, technical and personal information using reasonable care and use it only for the relationship. Confidential information does not include information independently developed, lawfully received without restriction, publicly available without breach or required to be disclosed by law after permitted notice. SDS applies reasonable technical and organisational safeguards but does not promise that any internet service is invulnerable. The Customer remains responsible for endpoint security, user administration, internal policies, exports and secure handling outside YourComate.`,
        "16",
      ],
      [
        "Service availability, support and changes",
        `SDS will use reasonable efforts to operate the service reliably. Maintenance, security work, internet conditions, device limitations, third-party failures and force-majeure events may cause interruption. A specific uptime, support response time, backup schedule or recovery commitment applies only if stated in an Order Form or service-level agreement. SDS may improve, replace or discontinue features where reasonably necessary. SDS will seek to avoid materially reducing a paid service during its term and will communicate significant changes where practicable. Beta, preview or trial features may change or end without a production commitment.`,
        "17",
      ],
      [
        "Suspension and termination",
        `SDS may suspend or restrict access where a subscription expires, payment remains unpaid, plan limits are materially exceeded, the Customer breaches these Terms, use creates a security/legal risk, an authority requires action or urgent protection is reasonably necessary. Where appropriate, SDS will give notice and an opportunity to cure. Either party may terminate according to the Order Form. If no written termination provision applies, the Customer may terminate by not renewing; SDS may terminate a paid service for material uncured breach after reasonable notice, or immediately for fraud, unlawful use, serious security harm or mandatory legal action. On termination, rights to use the service end. Payment, confidentiality, intellectual-property, liability, dispute, records-retention and other clauses intended by their nature to survive will remain effective. Data export, retention and deletion follow the Privacy Policy and applicable agreement.`,
        "18",
      ],
      [
        "Warranties and disclaimers",
        `SDS warrants that it has authority to provide YourComate and will perform contracted services with reasonable skill and care. Except for express written commitments and rights that cannot lawfully be excluded, YourComate is provided on an ‘as available’ basis. SDS does not warrant that the service will be uninterrupted or error-free, that every configuration will meet a Customer’s legal obligations, or that software output will be correct without Customer review. The Customer is responsible for professional, legal, tax, payroll, employment and compliance decisions and for validating configuration and results.`,
        "19",
      ],
      [
        "Limitation of liability",
        `To the maximum extent permitted by law, neither party will be liable under these Terms for indirect, incidental, special, punitive or consequential loss, or loss of profit, revenue, goodwill or anticipated savings, where such loss was not the direct and reasonably foreseeable result of the breach. Unless an Order Form states another cap, SDS’s aggregate liability arising from the affected paid service will not exceed the subscription fees paid to SDS for that service during the six months immediately preceding the event giving rise to the claim. This cap does not limit liability that cannot lawfully be limited or liability arising from fraud or wilful misconduct. Nothing in these Terms limits a Customer’s payment obligations, either party’s confidentiality or intellectual-property obligations, statutory data-protection responsibility, or rights and remedies that applicable law does not permit the parties to exclude.`,
        "20",
      ],
      [
        "Indemnity",
        `The Customer will defend and indemnify SDS against a third-party claim arising from the Customer’s unlawful use, Customer-provided content, infringement, employment decision, failure to obtain required authority/notice/consent, or material breach of these Terms, except to the extent the claim results from SDS’s breach, negligence or wilful misconduct. SDS will promptly notify the Customer of a covered claim and permit reasonable control of the defence, while retaining the right to participate. No settlement may admit fault or impose a non-monetary obligation on the non-controlling party without its consent.`,
        "21",
      ],
      [
        "Governing law and disputes",
        `These Terms are governed by the laws of India. The parties should first attempt in good faith to resolve a dispute through authorised business representatives. A party should give written details of the issue and allow a reasonable opportunity for discussion before proceedings, except where urgent interim protection is required. Subject to any different jurisdiction or dispute procedure in an Order Form, the competent courts at Guwahati, Assam will have exclusive jurisdiction. Nothing prevents either party from seeking urgent injunctive relief or using a statutory consumer, data-protection or regulatory remedy that cannot lawfully be waived.`,
        "22",
      ],
      [
        "Changes, notices and contact",
        `SDS may update these Terms prospectively for changes in law, security, payments or service operation. A material change will be identified by a new effective date and may be communicated through the website, tenant or registered email. A change will not retroactively alter an accepted paid Order Form unless required by law or agreed by the parties. Purpose

Channel

Legal, billing or service question

hr@sayanant.com

Website

https://yourcomate.com

Provider

Sayanant Development Services Pvt. Ltd.

Location / jurisdiction reference

Guwahati, Assam, India`,
        "23",
      ],
      [
        "Reference basis",
        `The policy language is tailored to the supplied YourComate implementation and the following official or first-party references. Links were reviewed on 11 August 2026. The listed materials inform the drafting but do not become contractual terms unless expressly stated.

01 Razorpay Terms
https://razorpay.com/terms/

02 Razorpay Privacy Policy
https://razorpay.com/privacy-policy/

03 Consumer Protection Act and E-Commerce Rules — Department of Consumer Affairs
https://consumeraffairs.nic.in/acts-and-rules/consumer-protection/consumer-protection

04 Digital Personal Data Protection Act, 2023 — India Code
https://www.indiacode.nic.in/handle/123456789/22037?view_type=browse

05 YourComate project account, trial, pricing, billing and payment-verification source
Internal supplied project source reviewed 11 August 2026

POLICY GOVERNANCE Policy owner: Sayanant Development Services Pvt. Ltd.. Contact: hr@sayanant.com.`,
        "REF",
      ],
    ],
  },
  refund: {
    eyebrow: "Refund Policy",
    title: "Refund Policy",
    summary:
      "This Policy explains when a YourComate subscription payment may be refunded, how to request review, how failed or duplicate Razorpay transactions are handled, and the difference between cancellation and refund.",
    icon: "document",
    tone: "coral",
    sections: [
      [
        "Policy at a glance",
        `This Policy explains when a YourComate subscription payment may be refunded, how to request review, how failed or duplicate Razorpay transactions are handled, and the difference between cancellation and refund.

Evaluate before purchase

Activated digital service

Fair correction

An approved 15-day trial is available so an organisation can assess the platform before paying.

A successfully verified payment creates immediate subscription access; change-of-mind and non-use are normally non-refundable.

Duplicate charges, verified billing errors, unresolved activation failure and mandatory legal/contractual cases are reviewed for full or proportionate refund.

INTERPRETATION This document is written for practical website use. It does not remove non-waivable rights under applicable law, and an expressly accepted Order Form may contain more specific terms for a Customer.`,
        "GL",
      ],
      [
        "Scope",
        `This Refund Policy applies to subscription payments made to SDS for YourComate through Razorpay or another payment method expressly accepted in an Order Form. It should be read with the Terms & Conditions and the applicable order, quotation or contract. It does not govern refunds for a service supplied by an unrelated third party. Razorpay facilitates payment and refund transmission; SDS remains responsible for deciding a YourComate service refund under this Policy, while banks and payment networks control final posting time.`,
        "01",
      ],
      [
        "Trial and informed purchase",
        `YourComate currently offers an approval-based 15-day trial. The trial is intended to let an organisation evaluate the available workflows, role model and service fit before purchasing. Customers should use the trial, request a demonstration and clarify implementation, security, payroll, statutory and integration requirements before payment.

REVIEW BEFORE AUTHORISING PAYMENT The payer should confirm the company, plan, employee limit, billing interval, amount, currency, tax treatment and—where applicable—the Premium quotation before completing Razorpay checkout.`,
        "02",
      ],
      [
        "General refund rule",
        `A YourComate subscription is a time-bound digital service. Once a payment is successfully verified and the subscription is activated, the fee is normally non-refundable for change of mind, non-use or reduced usage, subject to the eligible cases below, an Order Form and rights that applicable law does not permit SDS to exclude.

A decision not to renew prevents a future customer-initiated purchase but does not ordinarily refund the unused part of the current active term. A plan downgrade normally takes effect at the next paid term and does not create a mid-term credit unless SDS agrees in writing.`,
        "03",
      ],
      [
        "Eligible refund cases",
        `SDS will review a request where evidence reasonably shows one of the following:

• The same payable order or subscription was charged more than once and the duplicate amount was successfully captured.

• YourComate charged an amount different from the authoritative order or accepted quotation because of an SDS system or configuration error.

• Payment was successfully verified, but subscription activation failed solely because of YourComate and SDS could not restore the purchased access within a reasonable remediation period after notice.

• SDS permanently discontinued the paid service during the active term for reasons not caused by the Customer and did not provide a materially equivalent service, in which case a proportionate unused-term refund may be considered.

• SDS expressly approved a refund in the Order Form, quotation or written resolution.
• A refund is required by applicable law, a binding regulatory direction, court order, valid card-network/payment decision or non-waivable consumer right. FULL OR PROPORTIONATE Duplicate charges and confirmed incorrect amounts are ordinarily corrected in full. Service-unavailability cases may be calculated proportionately for the unused paid period after any service already delivered.`,
        "04",
      ],
      [
        "Normally non-refundable cases",
        `• Change of mind after verified subscription activation.
• Failure to use the service, delayed internal rollout, staff turnover, reduced employee count or a decision to move to another system.

• Dissatisfaction with a feature, integration or outcome that was not included in the purchased plan, accepted proposal or written implementation scope.

• Partial use of a monthly, quarterly, annual or custom term, except where this Policy expressly provides a proportionate remedy.

• Loss of access caused by Customer breach, unlawful use, shared credentials, failure to secure accounts, suspension, exceeding plan entitlement or non-payment.

• A bank, UPI, card-network, device, internet or third-party outage outside SDS’s reasonable control where the YourComate subscription was correctly activated.

• Taxes, withholding or currency-conversion effects that result from incorrect billing/tax details supplied by the Customer or policies of the payer’s bank.

• Custom onboarding, migration, configuration, development or professional services already performed, unless the applicable Order Form states otherwise.`,
        "05",
      ],
      [
        "Failed, pending and debited transactions",
        `A failed, pending or unverified payment is not the same as a refund. If the payer’s account shows a debit but YourComate did not verify the payment, the amount may be only authorised, pending or automatically reversed by the payment chain.

• Do not immediately repeat payment unless the first transaction status is known; repeating may create a duplicate successful charge.

• Check the YourComate billing page, payer bank statement and Razorpay/payment confirmation for order and payment status.

• Send SDS the company name, payment date, amount, Razorpay order/payment ID and a redacted proof of debit. Never send a CVV, UPI PIN, banking password or full card number.

• If the payment was not captured, the bank or payment network may release/reverse the amount without SDS initiating a merchant refund.

• If two payments were captured for the same purchase, SDS will reconcile them and initiate an eligible duplicate refund.`,
        "06",
      ],
      [
        "Cancellation and non-renewal",
        `The current YourComate billing implementation uses a customer-initiated payment order for each new paid term. A past successful payment does not by itself authorise another automatic debit. The Customer can cancel future continuation by not completing the next renewal payment. Access continues until the current subscription end date, subject to the Terms, and may then be restricted. If SDS later introduces an expressly authorised recurring mandate, the checkout and account will provide the applicable mandate and cancellation route before it is used. Cancellation of future renewal does not erase records immediately and does not cancel statutory invoice, tax, security, dispute or retention obligations. Data handling after expiry follows the Privacy Policy and applicable agreement.`,
        "07",
      ],
      [
        "How to request a refund review",
        `Send the request to hr@sayanant.com with subject ‘YourComate Refund Request’. For ordinary billing corrections, submit the request as soon as possible and preferably within seven calendar days of the payment or discovery of the issue. A statutory right is not shortened where law requires a longer period. Required information

What to provide

Customer identity

Company name, tenant/company code if available, authorised contact name and registered email

Transaction

Invoice/receipt number, amount, date, plan, Razorpay order ID and payment ID

Reason

A concise explanation identifying the eligible ground and relevant dates

Evidence

Redacted bank/payment proof, error screenshot or support reference; never include secret banking credentials

Requested resolution

Refund, duplicate correction, activation/restoration or invoice correction

SDS may request proportionate verification to confirm the requester’s authority and prevent fraud. A request lacking the information needed to identify the transaction may remain pending until clarified.`,
        "08",
      ],
      [
        "Review and decision process",
        `• SDS aims to acknowledge a complete request within two business days, although complex cases, holidays or provider dependencies may take longer.

• SDS will compare YourComate order, payment, subscription, invoice and support records and may seek status information from Razorpay.

• SDS normally aims to communicate an approval, rejection or request for more information within seven business days after receiving a complete request.

• Approval may be conditional on deactivation, correction of access, issuance of a credit note or confirmation that a duplicate subscription benefit was not consumed.

• A rejection will identify the principal policy reason. The Customer may request one reconsideration with material new evidence. OPERATIONAL TARGETS The acknowledgement and review periods are service targets, not guaranteed settlement periods. They do not include the time banks, UPI participants, card networks or Razorpay take after a refund is initiated.`,
        "09",
      ],
      [
        "Refund method and processing time",
        `An approved online-payment refund is ordinarily initiated through Razorpay to the original payment method. SDS does not normally redirect a refund to a different person, bank account, card, wallet or cash channel because that can create fraud and reconciliation risk.

• A full refund returns the approved captured amount. A partial refund returns only the approved portion.
• SDS does not charge the Customer a separate fee for a standard eligible refund. Tax invoices or credit notes are adjusted as required by applicable accounting and tax law.

• Razorpay currently states that normal refunds are returned to the original payment method and may take approximately 7–10 business days after initiation, depending on the bank/payment mode.

• A bank may take longer to display the credit. The Customer can use the Razorpay refund/payment reference to follow up with the issuing bank or payment provider.

• If a refund fails or is returned, SDS will work with Razorpay and the Customer on the provider-supported resolution; an alternate destination will be used only after lawful verification and provider approval.`,
        "10",
      ],
      [
        "Chargebacks and payment disputes",
        `A payer should contact SDS first so an activation, duplicate charge or billing error can be investigated promptly. Raising a chargeback does not automatically establish that YourComate failed to provide the service. SDS may provide the bank, card network or Razorpay with relevant order, verification, subscription, access and communication records to respond to a dispute. Fraudulent or abusive chargebacks may result in account restriction and recovery of amounts lawfully due. Nothing in this section prevents a payer from using a legitimate bank, card-network, consumer or statutory remedy.`,
        "11",
      ],
      [
        "Policy changes and contact",
        `SDS may update this Policy prospectively when the product, payment flow, law or provider process changes. The Policy in effect when the relevant payment was made will ordinarily govern that transaction, unless a later change is required by law or is more favourable to the Customer. Refund channel

Details

Email

hr@sayanant.com

Subject

YourComate Refund Request

Provider

Sayanant Development Services Pvt. Ltd.

Location

Guwahati, Assam, India`,
        "12",
      ],
      [
        "Reference basis",
        `The policy language is tailored to the supplied YourComate implementation and the following official or first-party references. Links were reviewed on 11 August 2026. The listed materials inform the drafting but do not become contractual terms unless expressly stated.

01 Razorpay — Normal Refunds
https://razorpay.com/docs/payments/refunds/normal/

02 Razorpay — Customer Refunds
https://razorpay.com/docs/payments/customers/customer-refunds/

03 Razorpay — Refund FAQs
https://razorpay.com/docs/payments/refunds/faqs/

04 Consumer Protection materials — Department of Consumer Affairs
https://consumeraffairs.nic.in/acts-and-rules/consumer-protection/consumer-protection

05 YourComate project trial, pricing, Razorpay order, verification and subscription source
Internal supplied project source reviewed 11 August 2026

POLICY GOVERNANCE Policy owner: Sayanant Development Services Pvt. Ltd.. Contact: hr@sayanant.com.`,
        "REF",
      ],
    ],
  },
  cookies: {
    eyebrow: "Cookie policy",
    title: "Browser storage and similar technologies used by this website.",
    summary: "This page explains essential browser storage currently used by the public website and how the policy should change if analytics or advertising tools are added later.",
    icon: "settings",
    tone: "amber",
    sections: [
      ["What browser storage means", "Cookies and similar technologies can store or retrieve information on a device. This front-end currently uses local browser storage for essential preferences rather than advertising profiles."],
      ["Essential preference storage", "The website stores the published policy version after you acknowledge the Privacy Policy and Terms and Conditions. This prevents the acknowledgement window from appearing on every visit until the policy version changes or local storage is cleared."],
      ["Interface preferences", "The website may temporarily store or retain essential interface state needed for normal operation, security or user-requested functionality."],
      ["Analytics and advertising", "No analytics or advertising tracker is configured in this supplied React front-end. If such tools are added, this policy and the consent controls should be updated before non-essential storage is activated."],
      ["Managing storage", "You can clear website storage through your browser settings. Doing so will reset the policy acknowledgement and other locally stored preferences."],
      ["Changes", "The cookie and storage list should be reviewed whenever hosting, analytics, customer-support, advertising or embedded third-party services change."],
    ],
  },
  accessibility: {
    eyebrow: "Accessibility Statement",
    title: "Accessibility Statement",
    summary:
      "SDS wants the YourComate public website and HRMS experience to be usable by people with diverse visual, hearing, motor, speech and cognitive needs across desktop, tablet and mobile devices.",
    icon: "people",
    tone: "mint",
    sections: [
      [
        "Policy at a glance",
        `SDS wants the YourComate public website and HRMS experience to be usable by people with diverse visual, hearing, motor, speech and cognitive needs across desktop, tablet and mobile devices.

Target

Scope

Feedback

YourComate uses WCAG 2.2 Level AA as its design and testing target; this is a commitment to improvement, not a claim of independent certification.

The commitment covers public pages and first-party HRMS interfaces. Customer-uploaded content and independent third-party services have separate responsibilities.

Users can report a barrier and request a reasonable alternative format or assisted route through the published contact channel.

INTERPRETATION This document is written for practical website use. It does not remove non-waivable rights under applicable law, and an expressly accepted Order Form may contain more specific terms for a Customer.`,
        "GL",
      ],
      [
        "Our commitment",
        `SDS is committed to improving digital access to YourComate and to removing barriers that prevent people with disabilities from independently understanding, navigating and using the service. Our design and testing target is the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA, considered across the four accessibility principles: perceivable, operable, understandable and robust. This Statement describes an ongoing programme. It does not claim that every page, workflow, uploaded file or third-party component has been independently audited or certified.

ACCESSIBILITY IS CONTINUOUS New modules, content, browser changes, mobile devices and third-party integrations can introduce barriers. Accessibility therefore forms part of design, development, content review, testing and support—not a one-time exercise.`,
        "01",
      ],
      [
        "Scope of this Statement",
        `This Statement applies to the public YourComate website, trial and contact journeys, signed-in first-party HRMS pages, responsive/mobile web experiences, first-party help content and policy documents supplied by SDS. A Customer is responsible for the accessibility of content it uploads or creates, including job descriptions, policies, images, PDFs, spreadsheets, videos and free-text instructions. Razorpay checkout, Cloudflare Turnstile, device operating systems, browsers and Customer-selected integrations are independently operated and may publish their own accessibility information.`,
        "02",
      ],
      [
        "Standards and legal context",
        `WCAG 2.2 is the principal technical reference used by this Statement. It includes requirements concerning keyboard access, focus, contrast, reflow, target size, accessible authentication, form errors and prevention of mistakes in legal, financial or data-changing transactions. SDS also considers the accessibility objectives of the Rights of Persons with Disabilities Act, 2016, applicable rules and notified Indian ICT accessibility standards as relevant to the service and its users.

NO REDUCTION OF RIGHTS This Statement does not limit any accessibility, reasonable-accommodation or non-discrimination right available under applicable law or an employer’s duties to its workforce.`,
        "03",
      ],
      [
        "Design and engineering measures",
        `Depending on the page and stage of implementation, YourComate’s first-party design system aims to provide:

• Semantic headings, landmarks, lists, labels and controls that communicate structure to assistive technology.
• Keyboard-operable navigation and actions, logical focus order and a visible focus indicator.
• Text and interface contrast that does not rely on colour alone to communicate status.
• Responsive layouts that reflow across desktop, tablet and mobile views without unnecessary two-dimensional scrolling.

• Programmatic labels, instructions, required-field identification and meaningful error messages for forms.
• Text alternatives for informative images and hidden treatment for decorative graphics where appropriate.
• Support for zoom, text resizing, browser preferences and reduced-motion settings where non-essential animation is used.

• Touch targets and spacing intended to reduce accidental activation on smaller screens.
• Consistent navigation, page titles, status language and help routes across related workflows.`,
        "04",
      ],
      [
        "Navigation, keyboard and input methods",
        `Core actions should be possible without requiring a mouse. Menus, dialogs, forms, tables and controls should expose an understandable focus order and remain usable with keyboard, touch and pointer input. Where a drag gesture is used, a practical non-drag alternative should be considered. Focus should not be hidden behind sticky headers, banners or dialogs. Modal interfaces should identify their purpose, place focus appropriately and return focus when closed. Time limits, session expiry and security prompts should be communicated clearly and provide an extension or recovery path where security and law permit.`,
        "05",
      ],
      [
        "Visual presentation and motion",
        `• Text should remain readable at common zoom levels and on narrow screens without loss of essential information.

• Colour is supplemented with text, icons, patterns or other cues for states such as success, warning, pending, failed and required.

• Interface controls and focus states should maintain sufficient contrast against adjacent colours.
• Decorative movement should respect reduced-motion preferences where practical, and essential information should not depend on animation.

• Flashing content likely to trigger seizures is avoided.
• Charts and dashboards should provide labels, summaries or an alternative data representation where the visual alone is insufficient.`,
        "06",
      ],
      [
        "Forms, authentication and financial actions",
        `YourComate aims to make form purpose, field labels, required status, validation and correction understandable. Errors should be announced and associated with the relevant field. Where a user submits a legal, financial or significant data-changing action, the interface should provide an opportunity to review, confirm, correct or reverse the action where appropriate. Authentication should support password managers, copy/paste and accessible recovery rather than unnecessarily requiring a cognitive-function test. Security and anti-bot controls may introduce additional steps; SDS will seek a usable alternative where a first-party barrier is identified. Razorpay checkout is a third-party payment interface. A user encountering an accessibility barrier in checkout should report it to SDS and Razorpay so that an available payment or assisted resolution route can be explored without reducing payment security.`,
        "07",
      ],
      [
        "Content, documents, images and media",
        `First-party content should use plain headings, meaningful link text, readable paragraphs and alternatives for non-text information. Captions, transcripts or audio description should be considered where prerecorded media communicates information that is not otherwise available. PDFs and office documents can be harder to use than structured HTML. SDS will aim to provide properly ordered selectable text and readable contrast in first-party documents and, on request, a reasonable alternative such as accessible HTML, plain text or assisted explanation where practicable.

CUSTOMER-UPLOADED MATERIAL Tenant administrators should check the accessibility of policies, resumes, job posts, attachments, images and other documents before publishing them to employees or candidates.`,
        "08",
      ],
      [
        "Responsive and assistive-technology support",
        `YourComate is designed for responsive use on current desktop and mobile browsers. Accessibility can vary with browser, operating system, assistive technology, screen size and configuration. Testing should include keyboard-only use, zoom/reflow, colour/contrast review and representative screen-reader combinations as the product matures.

Users should keep their browser, device and assistive technology reasonably current. If a barrier occurs, the report should include the page/workflow, device, operating system, browser, assistive technology and steps that caused the problem; sensitive employee or payment data should be omitted.`,
        "09",
      ],
      [
        "Known limitations and priorities",
        `Despite ongoing work, some barriers may remain. Areas requiring continued review include:

• Complex data tables, dashboards, date pickers, charts and dense administrative workflows.
• Legacy screens or components created before the current public design system.
• Dynamic status updates, notifications, custom dialogs and focus management after asynchronous actions.
• Voice interaction, AI-generated responses and speech recognition for varied accents, noise and assistive technologies.

• Maps, location, camera, face-attendance and device-permission flows controlled partly by browsers or operating systems.

• Customer-uploaded PDFs, images, documents, job descriptions and media not authored by SDS.
• Razorpay, Cloudflare and other third-party or embedded components outside SDS’s direct code control. SDS prioritises barriers that prevent login, navigation, employment self-service, candidate application, payroll/payslip access, payment, support and other essential tasks.`,
        "10",
      ],
      [
        "Feedback and reasonable alternatives",
        `To report a barrier or request a reasonable alternative, email hr@sayanant.com with the subject ‘Accessibility — YourComate’. Please include the affected page or workflow, what you were trying to do, the barrier, and relevant device/browser/assistive-technology details. Do not include a password, OTP, UPI PIN, card details, full payroll information or unnecessary personal data. If the issue concerns a Customer-controlled HR record or workplace accommodation, contact the Customer’s HR/administrator as well. What SDS will try to do

Approach

Acknowledge

Confirm receipt within a reasonable operational period

Reproduce

Review the reported path using available device/accessibility information

Provide access

Offer a practical alternative route or format where reasonably possible

Remediate

Prioritise the issue according to severity, essential-task impact and technical scope

Communicate

Share status or resolution without exposing security-sensitive implementation detail`,
        "11",
      ],
      [
        "Assessment and review",
        `Accessibility review should be incorporated into component design, content publishing, code review, regression testing and release acceptance. Automated testing can identify some issues but does not replace manual keyboard, screen-reader, zoom/reflow and user-centred testing.

This Statement will be reviewed when major public journeys, authentication, payments, navigation or design-system components materially change, and periodically as standards and legal requirements evolve. The effective date identifies the current published edition.`,
        "12",
      ],
      [
        "Contact",
        `Accessibility contact

Details

Email

hr@sayanant.com

Subject

Accessibility — YourComate

Provider

Sayanant Development Services Pvt. Ltd.

Location

Guwahati, Assam, India

Website

https://yourcomate.com

If the concern is not resolved through the published channel, the user may use any grievance or disability-rights remedy available under applicable law. Nothing in this Statement limits a right to reasonable accommodation from the relevant employer or service provider.`,
        "13",
      ],
      [
        "Reference basis",
        `The policy language is tailored to the supplied YourComate implementation and the following official or first-party references. Links were reviewed on 11 August 2026. The listed materials inform the drafting but do not become contractual terms unless expressly stated.

01 W3C — Web Content Accessibility Guidelines (WCAG) 2.2
https://www.w3.org/TR/WCAG22/

02 Department of Empowerment of Persons with Disabilities — Acts, Rules & Regulations
https://depwd.gov.in/en/acts/

03 DEPwD — Notified accessibility standards and guidelines
https://depwd.gov.in/en/document-category/standards-guidelines-notified-under-the-rights-for-persons-with-disabilities-rules-2
017/

04 YourComate project public legal, navigation, responsive and interaction source
Internal supplied project source reviewed 11 August 2026

POLICY GOVERNANCE Policy owner: Sayanant Development Services Pvt. Ltd.. Contact: hr@sayanant.com.`,
        "REF",
      ],
    ],
  },
  disclaimer: {
    eyebrow: "Website disclaimer",
    title: "Important context for public product information.",
    summary: "Public pages explain the intended YourComate experience but are not a substitute for a signed proposal, implementation scope, security review or legal advice.",
    icon: "warning",
    tone: "coral",
    sections: [
      ["Product descriptions", "Features and workflows shown on the public website may be illustrative, under development, configurable or subject to plan and implementation scope."],
      ["Screens and examples", "Dashboard values, employee names, workflow states, customer situations and performance outcomes shown in visual examples are fictional unless explicitly identified otherwise."],
      ["Commercial information", "Pricing and access conditions should be confirmed through an authorised proposal or agreement before procurement."],
      ["Legal and compliance information", "Website content is general information and should not be treated as legal, tax, payroll, employment or compliance advice."],
      ["External links", "External websites and third-party services are controlled by their respective operators."],
    ],
  },
};
