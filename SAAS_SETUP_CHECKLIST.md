# YourComate HRMS SaaS Setup Checklist

This checklist is for the final YourComate HRMS SaaS setup.

## Final SaaS Model

### SDS Company

SDS is the platform owner company.

- SDS has lifetime full access.
- SDS does not need payment.
- SDS subscription must never expire.
- SDS employee access must remain unrestricted.
- SDS should be able to access all HRMS modules.

### Trial Companies

New companies get trial access only after Superadmin approval.

- Trial duration: 15 days
- Trial access: full HRMS access
- Trial employee limit: unlimited when `DEMO_EMPLOYEE_LIMIT=0`
- After 15 days, the company must pay to continue.
- Expired trial companies should be redirected to Billing / Upgrade page.
- After payment, the trial company becomes an official paid registered company.

### Paid Plans

Pricing is dynamic and controlled by Superadmin.

Default pricing:

| Plan | Price | Employee Limit | Payment |
| --- | ---: | ---: | --- |
| Essential | ₹2,495/month | 50 employees | Razorpay enabled |
| Growth | ₹4,495/month | 100 employees | Razorpay enabled |
| Premium | Custom | Unlimited | Contact/admin controlled |

Superadmin can edit pricing from:

```text
Subscriptions & Payments → Pricing Plans
```

---

## Required Backend Files

Confirm these files exist:

```text
backend/app/services/email_service.py
backend/app/services/otp_service.py
backend/app/services/demo_request_service.py
backend/app/services/tenant_service.py
backend/app/services/pricing_service.py
backend/app/services/razorpay_service.py
backend/app/services/billing_service.py
backend/app/services/trial_notification_service.py
backend/app/middleware/tenant_guard.py
backend/app/routes/demo_requests.py
backend/app/routes/billing.py
backend/app/routes/superadmin.py
backend/scripts/create_saas_indexes.py
backend/scripts/seed_sds_tenant.py
backend/scripts/seed_pricing_plans.py
backend/scripts/send_trial_reminders.py
backend/scripts/saas_smoke_check.py
```

---

## Required Frontend Files

Confirm these files exist:

```text
frontend/src/pages/ApplyDemoRegistration.jsx
frontend/src/pages/DemoRequests.jsx
frontend/src/pages/Billing.jsx
frontend/src/pages/SubscriptionExpired.jsx
frontend/src/pages/Subscriptions.jsx
frontend/src/pages/Companies.jsx
frontend/src/pages/SuperAdminDashboard.jsx
frontend/src/pages/Notifications.jsx
frontend/src/pages/Attendance.jsx
frontend/src/pages/ApplyLeave.jsx
frontend/src/pages/Projects.jsx
frontend/src/pages/Employees.jsx
frontend/src/layouts/AppLayout.jsx
frontend/src/data/modules.js
frontend/src/App.jsx
```

---

## Backend .env Required Values

Add or confirm:

```env
SAAS_ENABLED=true

SDS_TENANT_ID=sds
SDS_TENANT_CODE=SDS
SDS_COMPANY_NAME=Sayanant Development Services Pvt Ltd
SDS_HAS_LIFETIME_ACCESS=true

YOURCOMATE_DOMAIN=yourcomate.com
AUTO_ADMIN_EMAIL_DOMAIN=yourcomate.com

DEMO_DURATION_DAYS=15
DEMO_HAS_FULL_ACCESS=true
DEMO_EMPLOYEE_LIMIT=0
DEMO_ALLOWED_MODULES=all

DEMO_OTP_LENGTH=6
DEMO_OTP_EXPIRY_MINUTES=10
DEMO_OTP_MAX_ATTEMPTS=5
DEMO_OTP_RESEND_COOLDOWN_SECONDS=60

TRIAL_REMINDER_DAY_1=10
TRIAL_REMINDER_DAY_2=13
TRIAL_REMINDER_DAY_3=14
TRIAL_REMINDER_DAY_4=15

RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_CURRENCY=INR
RAZORPAY_WEBHOOK_SECRET=

SAAS_FULL_PLAN_NAME=Growth
SAAS_FULL_PLAN_AMOUNT=4495
SAAS_FULL_PLAN_INTERVAL=monthly

SAAS_ESSENTIAL_PLAN_AMOUNT=2495
SAAS_ESSENTIAL_EMPLOYEE_LIMIT=50

SAAS_GROWTH_PLAN_AMOUNT=4495
SAAS_GROWTH_EMPLOYEE_LIMIT=100

SAAS_PREMIUM_PLAN_AMOUNT=0
SAAS_PREMIUM_EMPLOYEE_LIMIT=0
SAAS_PREMIUM_IS_CUSTOM=true

SAAS_DEFAULT_PAID_PLAN_CODE=growth

FRONTEND_BASE_URL=http://localhost:5173
BILLING_PAGE_PATH=/billing
```

For production, update:

```env
FRONTEND_BASE_URL=https://hrms.sayanant.com
```

---

## Python Package

Confirm this is in `backend/requirements.txt`:

```text
razorpay==1.4.2
```

Then install:

```powershell
cd backend
pip install -r requirements.txt
```

---

## Backend Route Registration

Confirm `backend/app/__init__.py` registers:

```python
from app.routes.demo_requests import demo_requests_bp
from app.routes.billing import billing_bp

app.register_blueprint(demo_requests_bp, url_prefix="/api/v1/demo-requests")
app.register_blueprint(billing_bp, url_prefix="/api/v1/billing")
```

---

## MongoDB Indexes

Run:

```powershell
cd backend
python scripts/create_saas_indexes.py
```

Expected:

```text
Total Indexes: 23
Success      : 23
Failed       : 0
```

---

## Seed SDS Lifetime Tenant

Run:

```powershell
cd backend
python scripts/seed_sds_tenant.py
```

Expected:

```text
SDS lifetime tenant ensured
```

SDS tenant must have:

```text
tenant_code: SDS
plan_type: lifetime
status: active
has_lifetime_access: true
is_sds_company: true
allowed_modules: ["all"]
```

---

## Seed Pricing Plans

Run:

```powershell
cd backend
python scripts/seed_pricing_plans.py
```

Expected pricing plans:

```text
essential
growth
premium
```

Preview only:

```powershell
python scripts/seed_pricing_plans.py --dry-run
```

Force update existing plans from `.env` defaults:

```powershell
python scripts/seed_pricing_plans.py --force
```

---

## Smoke Check

Run:

```powershell
cd backend
python scripts/saas_smoke_check.py
```

Expected:

```text
Routes OK
Config OK
Database connected
SDS Tenant Exists: True
Pricing Defaults: True
Pricing Plan Codes: essential, growth, premium
```

If pricing defaults are missing, run:

```powershell
python scripts/seed_pricing_plans.py
```

---

## Frontend Route Checks

These public trial routes should work:

```text
/apply-trial-registration
/trial-registration
/register-trial
```

Old demo routes should also still work for compatibility:

```text
/apply-demo-registration
/demo-registration
/register-demo
```

Superadmin routes should work:

```text
/trial-requests
/trial-applications
/company-trial-requests
/subscriptions
/pricing
/plans
/pricing-plans
/dynamic-pricing
```

---

## Trial Registration Flow Test

1. Open:

```text
/apply-trial-registration
```

2. Submit company details.

3. OTP should be sent to company email.

4. Verify OTP.

5. Superadmin should see request under:

```text
Trial Requests
```

6. Superadmin approves request.

7. Company admin email should receive:

```text
admin_email
temporary_password
login_url
trial_end_date
```

8. Login using generated credentials.

Expected after login:

```text
plan_type: demo
status: active
trial_status: active
demo_duration_days: 15
demo_has_full_access: true
allowed_modules: ["all"]
requires_payment: false
```

---

## Active Trial Access Test

During active trial:

- Employee Management should open.
- Attendance should open.
- Apply Leave should open.
- Projects should open.
- Assets should open.
- Policies should open.
- Grievance should open.
- IT Support should open.
- Reports should open if role allows it.
- AI Assistant should open if role/UI allows it.

Trial users should see all role-based modules because trial is full access.

---

## Trial Expiry Test

After trial expiry:

Expected tenant/company values:

```text
status: expired
trial_status: expired
subscription_status: expired
requires_payment: true
```

Expected behavior:

- User can login.
- User is redirected to Subscription Expired / Billing.
- HRMS modules are blocked until payment.
- Billing page shows Essential, Growth, Premium.
- SDS lifetime company must not be affected.

---

## Payment Upgrade Test

1. Login as expired trial company admin.
2. Open Billing.
3. Select Essential or Growth.
4. Start Razorpay checkout.
5. Complete test payment.
6. Backend verifies payment.
7. Company becomes paid.

Expected paid company values:

```text
plan_type: paid
status: active
subscription_status: active
trial_status: converted_to_paid
requires_payment: false
allowed_modules: ["all"]
```

Expected selected plan values:

Essential:

```text
plan_code: essential
employee_limit: 50
is_unlimited_employees: false
```

Growth:

```text
plan_code: growth
employee_limit: 100
is_unlimited_employees: false
```

Premium:

```text
plan_code: premium
employee_limit: null
is_unlimited_employees: true
```

---

## Superadmin Pricing Test

Open:

```text
Subscriptions & Payments → Pricing Plans
```

Test editing:

- Essential amount
- Essential employee limit
- Growth amount
- Growth employee limit
- Premium custom/unlimited settings
- Recommended plan
- Online payment flag
- Active/inactive flag

Then open Billing as a trial company and confirm the updated price appears.

---

## Trial Reminder Test

Dry run:

```powershell
cd backend
python scripts/send_trial_reminders.py --dry-run
```

Actual run:

```powershell
python scripts/send_trial_reminders.py
```

Default reminder days:

```text
day 10
day 13
day 14
day 15 / expired
```

Expected reminder wording:

```text
15-day full-access trial
payment required after trial expiry
```

---

## Email Test Checklist

Emails should say trial, not old demo wording:

- OTP email
- Request received email
- Approval credentials email
- Rejection email
- Trial reminder email
- Payment success email

Approval email should include:

```text
15 days free trial
Full HRMS access during trial
Payment required after 15 days
Login URL
Admin email
Temporary password
Trial end date
```

Payment success email should include:

```text
plan name
amount
currency
employee limit
official paid registered company
```

---

## Important Compatibility Notes

Backend still uses this value for trial companies:

```text
plan_type: demo
```

Do not change it to `trial` in database logic unless all backend/frontend references are migrated together.

Visible UI wording can say:

```text
Trial
15-day full-access trial
Trial Requests
```

But backend compatibility should keep:

```text
demo_requests route
plan_type: demo
extend-demo action
```

---

## Final Deployment Order

1. Update backend files.
2. Update frontend files.
3. Update `.env`.
4. Install requirements.
5. Run indexes.
6. Seed SDS tenant.
7. Seed pricing plans.
8. Restart backend.
9. Restart frontend.
10. Run smoke check.
11. Test trial registration.
12. Test Superadmin approval.
13. Test active trial full access.
14. Test expired trial redirect.
15. Test Razorpay upgrade.
16. Test paid company employee limit.
17. Test SDS lifetime access.

---

## Quick Commands

```powershell
cd backend
pip install -r requirements.txt
python scripts/create_saas_indexes.py
python scripts/seed_sds_tenant.py
python scripts/seed_pricing_plans.py
python scripts/saas_smoke_check.py
python scripts/send_trial_reminders.py --dry-run
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Build test:

```powershell
npm run build
```