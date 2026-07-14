# YourComate HRMS SaaS Setup & Testing Checklist

This checklist is for the SaaS integration added to the SDS / YourComate HRMS project.

It covers:

- SDS lifetime company setup
- demo registration flow
- OTP email
- Superadmin approval/rejection
- auto-generated company admin credentials
- 30-day demo restriction
- 10 employee limit
- limited demo modules
- Razorpay upgrade flow
- trial reminder notifications
- production deployment checks

---

## 1. Required backend files added/updated

Important backend SaaS files:

```text
backend/app/routes/demo_requests.py
backend/app/routes/billing.py
backend/app/services/email_service.py
backend/app/services/otp_service.py
backend/app/services/demo_request_service.py
backend/app/services/tenant_service.py
backend/app/services/razorpay_service.py
backend/app/services/billing_service.py
backend/app/services/trial_notification_service.py
backend/app/middleware/tenant_guard.py
backend/scripts/seed_sds_tenant.py
backend/scripts/send_trial_reminders.py
backend/scripts/create_saas_indexes.py
backend/scripts/saas_smoke_check.py
```

Important backend route registration file:

```text
backend/app/__init__.py
```

Important backend config files:

```text
backend/app/config.py
backend/.env
backend/requirements.txt
```

---

## 2. Required frontend files added/updated

Important frontend SaaS files:

```text
frontend/src/pages/ApplyDemoRegistration.jsx
frontend/src/pages/DemoRequests.jsx
frontend/src/pages/Billing.jsx
frontend/src/pages/SubscriptionExpired.jsx
frontend/src/pages/Subscriptions.jsx
frontend/src/pages/Companies.jsx
frontend/src/pages/Attendance.jsx
frontend/src/pages/ApplyLeave.jsx
frontend/src/pages/Projects.jsx
frontend/src/pages/Employees.jsx
frontend/src/pages/Notifications.jsx
frontend/src/pages/SuperAdminDashboard.jsx
frontend/src/layouts/AppLayout.jsx
frontend/src/api/client.js
frontend/src/data/modules.js
frontend/src/App.jsx
frontend/index.html
```

---

## 3. Install backend dependencies

Run from backend folder:

```bash
cd backend
pip install -r requirements.txt
```

Confirm `razorpay==1.4.2` is present in:

```text
backend/requirements.txt
```

---

## 4. Confirm `.env` values

Check this file:

```text
backend/.env
```

Required SaaS values:

```env
SAAS_ENABLED=true

SDS_TENANT_ID=sds
SDS_TENANT_CODE=SDS
SDS_COMPANY_NAME=Sayanant Development Services Pvt. Ltd.
SDS_HAS_LIFETIME_ACCESS=true

YOURCOMATE_DOMAIN=yourcomate.com
AUTO_ADMIN_EMAIL_DOMAIN=yourcomate.com

DEMO_DURATION_DAYS=30
DEMO_EMPLOYEE_LIMIT=10
DEMO_ALLOWED_MODULES=attendance,apply_leave,projects

DEMO_OTP_LENGTH=6
DEMO_OTP_EXPIRY_MINUTES=10
DEMO_OTP_MAX_ATTEMPTS=5
DEMO_OTP_RESEND_COOLDOWN_SECONDS=60

TRIAL_REMINDER_DAY_1=7
TRIAL_REMINDER_DAY_2=3
TRIAL_REMINDER_DAY_3=1
TRIAL_REMINDER_DAY_4=0

MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your_email@gmail.com
MAIL_PASSWORD=your_app_password
MAIL_DEFAULT_SENDER=your_email@gmail.com

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_CURRENCY=INR

SAAS_FULL_PLAN_AMOUNT=4999
SAAS_FULL_PLAN_INTERVAL=monthly

FRONTEND_BASE_URL=http://localhost:5173
BILLING_PAGE_PATH=/billing
```

For production, update:

```env
FRONTEND_BASE_URL=https://hrms.sayanant.com
```

---

## 5. Seed SDS lifetime tenant

Run from backend:

```bash
python scripts/seed_sds_tenant.py --dry-run
python scripts/seed_sds_tenant.py
```

Expected result:

- SDS tenant exists
- tenant ID: `sds`
- tenant code: `SDS`
- plan type: `lifetime`
- status: `active`
- payment required: `false`

The SDS company should never be asked for recharge, renewal, subscription, or new account creation.

---

## 6. Create SaaS MongoDB indexes

Run:

```bash
python scripts/create_saas_indexes.py
```

Expected result:

```text
Success      : 20
Failed       : 0
```

If an index already exists with an old incompatible definition, run:

```bash
python scripts/create_saas_indexes.py --drop-existing
```

---

## 7. Run SaaS smoke check

Run:

```bash
python scripts/saas_smoke_check.py
```

Expected result:

```text
Overall OK              : True

Routes
- Registered            : 12 / 12

Config
- Runtime Config OK      : True
- SMTP/Razorpay Ready    : True

Database
- Connected             : True
- SDS Tenant Exists     : True
```

For full output:

```bash
python scripts/saas_smoke_check.py --json
```

---

## 8. Start backend and frontend

Backend:

```bash
cd backend
python run.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

---

## 9. Test public demo registration flow

Open login page.

Click:

```text
Apply for Demo Registration
```

Fill company details.

Example:

```text
Company Name: Rahul Baruah Private Limited
Company Email: real_test_email@example.com
Contact Person: Rahul Baruah
Phone: 9876543210
```

Submit demo application.

Expected:

- request is created
- OTP is sent by email
- user sees OTP verification screen

---

## 10. Test OTP verification

Enter OTP received in email.

Expected:

- OTP verification succeeds
- request status becomes OTP verified / pending Superadmin approval
- user sees approval pending message

If OTP email does not arrive:

Check:

```env
MAIL_USERNAME
MAIL_PASSWORD
MAIL_DEFAULT_SENDER
MAIL_SERVER
MAIL_PORT
MAIL_USE_TLS
```

For Gmail, use an App Password, not the normal Gmail account password.

---

## 11. Test Superadmin demo approval

Login as Superadmin.

Open:

```text
Demo Requests
```

Approve the OTP-verified request.

Expected:

- company tenant is created
- company admin user is created
- 30-day demo subscription is created
- generated admin email/password is emailed to company email

Generated credential example:

```text
Company: Rahul Baruah Private Limited
Email: rbpvt@yourcomate.com
Password: rbpvt@1234
```

---

## 12. Test rejected demo request

Create another demo request.

From Superadmin:

```text
Demo Requests > Reject
```

Expected:

- rejection reason is stored
- rejection email is sent
- company cannot login because no tenant/admin credentials are created

---

## 13. Test demo company login

Login with approved demo company admin credentials.

Expected:

- login works
- company name appears in layout/banner
- demo banner appears
- only allowed modules are available:
  - Attendance
  - Apply Leave
  - Projects
  - Notifications
  - Profile
  - limited employee setup for admin/HR

Blocked in demo:

- Assets
- Policies
- Reports
- Grievance
- IT Support
- AI Assistant
- Celebrations
- advanced HRMS modules

---

## 14. Test 10 employee demo limit

Login as demo company admin.

Open:

```text
Employees
```

Create employees until total reaches 10.

Expected:

- employee count banner appears
- after 10 employees, creation is blocked
- upgrade button appears
- backend also blocks employee creation beyond limit

---

## 15. Test Attendance in demo

Login as demo employee/admin.

Open:

```text
Attendance
```

Expected:

- attendance page opens
- demo access banner appears
- check-in/check-out flow remains usable
- expired demo is blocked

---

## 16. Test Apply Leave in demo

Open:

```text
Apply Leave
```

Expected:

- apply leave page opens
- demo access banner appears
- leave application works for active demo
- expired demo cannot submit leave

---

## 17. Test Projects in demo

Open:

```text
Projects
```

Expected:

- projects page opens
- demo access banner appears
- project creation/update works for active demo
- expired demo cannot create new project

---

## 18. Test expired demo blocking

For testing, manually set demo tenant status or trial date in MongoDB.

Example idea:

```js
db.tenants.updateOne(
  { tenant_code: "YOUR_TEST_TENANT_CODE" },
  {
    $set: {
      status: "expired",
      trial_end_date: new Date("2026-01-01")
    }
  }
)
```

Then login as that demo company.

Expected:

- user is redirected to `/subscription-expired`
- blocked modules are not accessible
- upgrade button is shown
- billing page remains accessible

---

## 19. Test Razorpay upgrade

Open as demo/expired company:

```text
Billing
```

Click:

```text
Pay with Razorpay
```

Expected:

- Razorpay checkout opens
- test payment completes
- backend verifies payment
- subscription status becomes paid
- full HRMS access unlocks
- user returns to dashboard
- session refreshes

For Razorpay test mode, use Razorpay test credentials and supported test payment details from Razorpay dashboard.

---

## 20. Test paid company access

After successful payment, login again.

Expected:

- all HRMS modules are visible
- demo restriction banners disappear or show paid status
- employee limit no longer blocks at 10
- AI Assistant and blocked modules are available again

---

## 21. Test SDS lifetime company

Login as existing SDS/Sayanant company user.

Expected:

- full access remains available
- no billing block
- no demo restriction
- no payment required
- no subscription expiry

Superadmin Companies page should show SDS as:

```text
Plan: lifetime
Status: active
Payment Required: No
```

SDS should not be suspended from frontend controls.

---

## 22. Test trial reminders

Run dry run:

```bash
python scripts/send_trial_reminders.py --dry-run
```

Run real:

```bash
python scripts/send_trial_reminders.py
```

Expected:

- demo companies near expiry get reminder emails
- in-app notifications are created
- expired demos are marked expired
- duplicate reminders are avoided

For production, schedule this script daily using cron, Windows Task Scheduler, or server scheduler.

Example Linux cron:

```cron
0 9 * * * cd /var/www/hrms/backend && /var/www/hrms/backend/venv/bin/python scripts/send_trial_reminders.py >> storage/logs/saas_trial_reminders.log 2>&1
```

---

## 23. Superadmin monitoring checks

Login as Superadmin.

Check:

```text
Companies
Demo Requests
Subscriptions & Payments
```

Expected:

- Companies page shows tenant status and SaaS controls
- Demo Requests page shows pending/approved/rejected requests
- Subscriptions page shows subscriptions, payments, Razorpay orders
- Refresh Expired Demos button works

---

## 24. Production deployment reminders

Before production:

1. Use production MongoDB.
2. Use production `.env`.
3. Use real SMTP App Password.
4. Use Razorpay live keys only after testing.
5. Set frontend URL:

```env
FRONTEND_BASE_URL=https://hrms.sayanant.com
```

6. Build frontend:

```bash
cd frontend
npm run build
```

7. Restart backend service:

```bash
sudo systemctl restart yourcomate-backend
```

8. Reload Nginx if config changed:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

9. Run smoke check on production server:

```bash
cd backend
python scripts/saas_smoke_check.py
```

---

## 25. Final acceptance checklist

Mark each item after testing:

```text
[ ] SDS lifetime company login works without payment
[ ] Demo registration form works from login page
[ ] OTP email is sent
[ ] OTP verification works
[ ] Superadmin can approve request
[ ] Superadmin can reject request
[ ] Approved company receives generated credentials
[ ] Demo admin can login
[ ] Demo shows only Attendance, Apply Leave, Projects
[ ] Demo employee limit blocks after 10 employees
[ ] Demo banners appear inside allowed modules
[ ] Expired demo redirects to subscription-expired page
[ ] Billing page opens for demo/expired company
[ ] Razorpay checkout opens
[ ] Payment verification activates paid subscription
[ ] Paid company gets full HRMS access
[ ] Trial reminder script works
[ ] Superadmin Subscriptions & Payments page works
[ ] Superadmin Companies SaaS controls work
[ ] Smoke check passes
[ ] MongoDB index setup passes
```

---

## 26. Useful troubleshooting

### Billing routes missing

Run:

```bash
python scripts/saas_smoke_check.py
```

If billing routes are missing, check:

```text
backend/app/__init__.py
```

It must include:

```python
from .routes.billing import billing_bp
app.register_blueprint(billing_bp, url_prefix="/api/v1/billing")
```

---

### Razorpay checkout does not open

Check:

```text
frontend/index.html
```

It must include:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

Also confirm backend `.env`:

```env
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

---

### OTP email not received

Check Gmail App Password and sender config:

```env
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=
```

Use an app password, not the normal Gmail password.

---

### Demo company can see blocked modules

Check:

```text
frontend/src/data/modules.js
backend/app/middleware/tenant_guard.py
backend/app/routes/crud.py
```

Frontend hides modules; backend blocks restricted APIs.

---

### Employee limit not blocking

Check:

```text
frontend/src/pages/Employees.jsx
backend/app/routes/crud.py
backend/app/services/tenant_service.py
```

The backend limit is the final protection.

---

### SDS company gets blocked

Run:

```bash
python scripts/seed_sds_tenant.py
python scripts/saas_smoke_check.py
```

Check SDS tenant fields in MongoDB:

```text
tenant_id: sds
tenant_code: SDS
plan_type: lifetime
status: active
is_sds_company: true
has_lifetime_access: true
```