# SDS HRMS Fullstack Working MVP — Super Admin Edition

Runnable React Vite + Python Flask REST API + MongoDB HRMS project.

## What is included

- React Vite frontend
- Flask REST API backend
- MongoDB database
- JWT login
- SaaS-ready `tenant_id` data isolation
- Platform Super Admin login
- Company / tenant creation
- Super Admin user control
- Super Admin can create users, assign roles, reset passwords, change designation, department, salary, user status, company assignment, and employee profile details
- Company Admin dashboard
- Employee dashboard
- Attendance office/field mode
- Late reason required after 09:45 AM
- Attendance report for admin/HR/manager/superadmin
- Employee Master
- Departments
- Designations
- Projects
- States
- Leave Management
- Payroll Runs
- Payslips
- Recruitment Jobs
- Candidates
- Training
- Performance Reviews
- Expenses
- Assets
- Grievance / Tickets
- Notifications
- Policies
- System Settings
- Audit Logs
- Reports Summary

## Backend setup

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python seed.py
python run.py
```

Backend URL:

```txt
http://127.0.0.1:5000
```

Health check:

```txt
http://127.0.0.1:5000/api/v1/health
```

## Frontend setup

Open another terminal:

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Frontend URL:

```txt
http://127.0.0.1:5173
```

## Demo logins

```txt
Super Admin:
superadmin@sdshr.in / Super@123

SDS Admin:
admin@sdshr.in / Admin@123

HR:
hr@sdshr.in / Hr@123

Finance:
finance@sdshr.in / Finance@123

Manager:
manager@sdshr.in / Manager@123

Employee:
employee@sdshr.in / Employee@123

Demo Company Admin:
clientadmin@example.com / Client@123
```

## Super Admin capabilities

The Super Admin can:

- See all companies using the SaaS HRMS
- Create a new company / tenant
- Create that company’s first admin user
- View users across all companies
- Create users under any company
- Assign or change roles
- Reset passwords
- Update employee profile data
- Change designation, department, project, state, job type, salary and status
- View all module records across tenants or filter by tenant_id
- View platform-level stats and audit logs

## Important note

This is a working full-module MVP foundation. It is not yet a production-hardened commercial SaaS release. Production work still requires final business rules, detailed statutory payroll, advanced RBAC permission editor, approval matrix builder, file storage, email/SMS/WhatsApp integrations, automated testing, deployment hardening, and Flutter mobile app completion.

## Frontend page-based structure

The React frontend has now been split into separate page/component/layout files:

```text
frontend/src/
  App.jsx
  main.jsx
  api/client.js
  data/modules.js
  utils/authHelpers.js
  layouts/AppLayout.jsx
  components/
    AttendanceWidget.jsx
    MiniList.jsx
    ModuleGrid.jsx
    Stat.jsx
    Table.jsx
  pages/
    Login.jsx
    SuperAdminDashboard.jsx
    AdminDashboard.jsx
    EmployeeDashboard.jsx
    Attendance.jsx
    Companies.jsx
    UserControl.jsx
    Employees.jsx
    Leave.jsx
    Payroll.jsx
    Payslips.jsx
    Recruitment.jsx
    Candidates.jsx
    Training.jsx
    Performance.jsx
    Expenses.jsx
    Assets.jsx
    Tickets.jsx
    Notifications.jsx
    Policies.jsx
    Departments.jsx
    Designations.jsx
    Projects.jsx
    States.jsx
    Settings.jsx
    AuditLogs.jsx
    ModuleCrud.jsx
```

Use `frontend/src/pages/` for screen changes, `frontend/src/components/` for reusable UI blocks, `frontend/src/layouts/` for sidebar/topbar layout, and `frontend/src/styles.css` for common styling.
