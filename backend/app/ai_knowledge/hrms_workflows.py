HRMS_WORKFLOWS = [
    {
        "module": "Leave",
        "title": "How to apply leave",
        "content": """
To apply leave in SDS HRMS:
1. Login to your HRMS account.
2. Open Apply Leave from the sidebar.
3. Select the leave type, such as Casual Leave, Earned Leave, or Half-Day if available.
4. Select start date and end date.
5. Enter the leave reason clearly.
6. Submit the leave request.
7. The request first goes to the Team Leader if mapped.
8. After Team Leader approval, it goes to the Reporting Officer.
9. If no Team Leader or Reporting Officer is mapped, HR fallback may be used.
10. Final status can be checked from Application Status.
"""
    },
    {
        "module": "Leave",
        "title": "How half-day leave works",
        "content": """
Half-day leave workflow in SDS HRMS:
1. Employee opens Apply Leave.
2. Selects Half-Day leave option if available.
3. Selects the date and enters reason.
4. Half-day leave is counted as 0.5 day.
5. The system may deduct Casual Leave first.
6. If Casual Leave is insufficient, Earned Leave may be used.
7. If both balances are insufficient, the remaining leave may be treated as LWP depending on configuration.
8. Approval follows Team Leader to Reporting Officer workflow.
"""
    },
    {
        "module": "Leave Management",
        "title": "How leave approval works",
        "content": """
Leave approval workflow in SDS HRMS:
1. Employee submits leave request from Apply Leave.
2. Team Leader receives the first approval request if the employee is mapped under a Team Leader.
3. Team Leader can approve or reject the request.
4. If approved by Team Leader, the request moves to Reporting Officer.
5. Reporting Officer gives final approval or rejection.
6. If no Team Leader is mapped, the request can move directly to Reporting Officer.
7. If no Reporting Officer is mapped, HR fallback may be used.
8. Employee can track the result from Application Status.
"""
    },
    {
        "module": "Leave Balances",
        "title": "How leave balances are managed",
        "content": """
Leave balance workflow in SDS HRMS:
1. HR/Admin/Super Admin can manage leave balances.
2. Employee can view leave balance if the module is available to their role.
3. Leave types include Casual Leave and Earned Leave.
4. Leave deductions happen after leave approval according to workflow rules.
5. Leave balance reports are available under Reports for authorized users.
"""
    },
    {
        "module": "Team Approvals",
        "title": "How team approval works",
        "content": """
Team Approval workflow:
1. Team Leader or Reporting Officer opens Team Approvals.
2. Pending requests from mapped employees are listed.
3. Approver reviews request details such as employee, dates, type, and reason.
4. Approver selects approve or reject.
5. Approved requests may move to the next approval level depending on workflow.
6. Rejected requests should include a proper reason if required.
7. Final status is shown to the employee in Application Status.
"""
    },
    {
        "module": "Application Status",
        "title": "How to check application status",
        "content": """
To check application status:
1. Login to SDS HRMS.
2. Open Application Status from the sidebar.
3. View submitted leave requests, attendance mode requests, comp-off claims, and other workflow requests.
4. Check each request status: pending, approved, or rejected.
5. If rejected, read the rejection reason shown with the request.
6. Use this module to track where the request currently stands.
"""
    },
    {
        "module": "Attendance",
        "title": "How to mark attendance",
        "content": """
To mark attendance in SDS HRMS:
1. Login to your HRMS account.
2. Open Attendance module.
3. Select attendance mode if required, such as Office, WFH, or Field.
4. Click Check In.
5. If check-in is late, enter the late reason if asked.
6. At the end of work, click Check Out.
7. Attendance history can be viewed from Attendance.
8. Attendance reports can be viewed or exported by authorized users from Reports.
"""
    },
    {
        "module": "Attendance",
        "title": "How late attendance works",
        "content": """
Late attendance workflow:
1. Employee checks in from Attendance module.
2. If check-in is after the configured cutoff time, the system may mark it as late.
3. The employee may need to enter a late reason.
4. HR/Admin can review attendance reports.
5. Late attendance details can appear in attendance reports and exports.
"""
    },
    {
        "module": "WFH / Field Requests",
        "title": "How WFH or Field attendance request works",
        "content": """
WFH / Field request workflow:
1. Employee opens Attendance or WFH / Field Requests module depending on menu access.
2. Employee submits a request for WFH or Field mode.
3. Employee enters date, mode, and reason/details.
4. The request goes through approval workflow.
5. Employee can track request status from Application Status.
6. Approved mode requests may reflect in attendance records or reports.
"""
    },
    {
        "module": "Comp-Off",
        "title": "How comp-off works",
        "content": """
Comp-Off workflow:
1. Comp-off may be generated based on eligible attendance or holiday/weekend work rules.
2. Employee can view available comp-off credits if module access is provided.
3. Employee can claim comp-off through the available workflow.
4. Approver reviews and approves or rejects the claim.
5. Employee can track claim status from Application Status.
6. Reports may show comp-off credits and claims for authorized users.
"""
    },
    {
        "module": "Holiday Calendar",
        "title": "How holiday calendar works",
        "content": """
Holiday Calendar workflow:
1. HR/Admin can add, update, or delete holidays.
2. Holidays can be maintained state-wise if the company uses state-specific holidays.
3. Employees can view holidays applicable to them.
4. Attendance and reports may use holiday calendar data.
"""
    },
    {
        "module": "Projects",
        "title": "How project workflow works",
        "content": """
Project workflow in SDS HRMS:
1. Authorized users such as Team Leader, Reporting Officer, Manager, or permitted project roles can create projects.
2. Project creator can assign team members and collaborators.
3. Assigned employees can view their projects.
4. Employees can update project progress.
5. Project detail, status, collaborators, and progress history can be viewed in Projects.
6. Project analytics and progress summary are available from Projects module.
"""
    },
    {
        "module": "Projects",
        "title": "How to update project progress",
        "content": """
To update project progress:
1. Login to HRMS.
2. Open Projects module.
3. Select the assigned project.
4. Open project progress or detail section.
5. Enter work update, progress percentage, remarks, or status as available.
6. Submit the progress update.
7. Reporting users can review project progress and analytics.
"""
    },
    {
        "module": "Projects",
        "title": "How project team tree works",
        "content": """
Project team tree workflow:
1. Open Projects module.
2. Select the project or analytics/team view.
3. The system shows project team structure based on assigned users, Team Leader, Reporting Officer, collaborators, or department mapping.
4. This helps understand project responsibility and reporting flow.
"""
    },
    {
        "module": "Grievance",
        "title": "How to submit grievance",
        "content": """
To submit a grievance in SDS HRMS:
1. Login to your HRMS account.
2. Open the Grievance module.
3. Select grievance category.
4. Enter subject and description.
5. Choose anonymous option if available and required.
6. Submit the grievance.
7. Admin or HR can review and update the grievance status.
8. Employee can check grievance progress from the Grievance module.
"""
    },
    {
        "module": "Grievance",
        "title": "How grievance review works",
        "content": """
Grievance review workflow:
1. HR/Admin opens Grievance module.
2. They view submitted grievances tenant-wise.
3. They open grievance details.
4. They update status, remarks, or resolution.
5. Employee can view updated status.
6. Anonymous grievance may hide employee identity depending on configuration.
"""
    },
    {
        "module": "IT Support",
        "title": "How to raise IT support ticket",
        "content": """
To raise an IT support ticket:
1. Login to your HRMS account.
2. Open IT Support module.
3. Select issue category.
4. Enter issue subject and details.
5. Submit the ticket.
6. IT Head or IT team can assign, update, escalate, review, or reopen the ticket.
7. Employee can track submitted tickets from IT Support module.
"""
    },
    {
        "module": "IT Support",
        "title": "How IT support escalation works",
        "content": """
IT Support escalation workflow:
1. Employee submits IT support ticket.
2. IT Head or authorized IT user reviews the ticket.
3. Ticket may be assigned to an IT team member.
4. Assigned IT member updates ticket status.
5. If needed, the ticket can be escalated.
6. Super Admin or higher authority may review escalated ticket depending on system configuration.
7. Employee may review or reopen the ticket after resolution.
"""
    },
    {
        "module": "Assets",
        "title": "How asset module works",
        "content": """
Asset workflow in SDS HRMS:
1. Employees can view or submit their assigned hardware or software asset details.
2. Admin, HR, or Super Admin can add assets for employees.
3. Asset details include asset type, code, serial number, condition, status, and assigned employee.
4. Assets can be verified by authorized users.
5. Asset status and condition can be updated.
6. Employee-wise asset reports can be generated.
"""
    },
    {
        "module": "Assets",
        "title": "How employee submits asset",
        "content": """
To submit an asset as employee:
1. Login to HRMS.
2. Open Assets module.
3. Choose hardware or software asset type.
4. Enter asset details such as asset name, code, serial/license details, condition, and remarks.
5. Submit the asset entry.
6. HR/Admin can verify or update the record.
"""
    },
    {
        "module": "Assets",
        "title": "How HR verifies assets",
        "content": """
HR/Admin asset verification workflow:
1. Open Assets module.
2. View pending or submitted asset records.
3. Open the asset entry.
4. Check asset details and assigned employee.
5. Update verification status.
6. Update condition/status if required.
7. Export employee-wise asset report if needed.
"""
    },
    {
        "module": "Management Group",
        "title": "How management group meetings work",
        "content": """
Management Group workflow:
1. Admin or HR can manage management group members.
2. Management group meetings can be scheduled.
3. Group members can view assigned meetings.
4. A minutes writer can be assigned for the meeting.
5. Assigned minutes writer can update meeting minutes.
6. Meeting updates create notifications for relevant users.
"""
    },
    {
        "module": "Management Group",
        "title": "How meeting minutes work",
        "content": """
Meeting minutes workflow:
1. Admin/HR or group admin schedules a meeting.
2. A minutes writer is assigned.
3. Assigned minutes writer opens the meeting.
4. They enter meeting minutes and save.
5. Minutes history may be maintained.
6. Notifications may be sent after minutes assignment or update.
"""
    },
    {
        "module": "Reports",
        "title": "How reports work",
        "content": """
Reports module in SDS HRMS:
1. Authorized users open Reports from the sidebar.
2. Reports include attendance, leave, mode requests, holidays, comp-off, leave approvals, leave deductions, leave records, and audit-related reports.
3. Filters such as date, organisation, entity, state, or employee may be available.
4. Attendance reports can be exported in styled Excel format.
5. Access to reports depends on role permission.
"""
    },
    {
        "module": "Reports",
        "title": "How attendance Excel export works",
        "content": """
Attendance Excel export workflow:
1. Authorized user opens Reports.
2. Selects attendance report.
3. Applies filters such as date range, organisation, entity, state, or employee if available.
4. Clicks export/download.
5. System generates a styled Excel attendance report.
"""
    },
    {
        "module": "Policies",
        "title": "How policies work",
        "content": """
Policy workflow in SDS HRMS:
1. Admin or HR can upload company policies.
2. Employees can view available policies.
3. Users can open policy details.
4. Policy files can be downloaded if available.
5. Policies are tenant-wise and shown based on user access.
"""
    },
    {
        "module": "Notifications",
        "title": "How notifications work",
        "content": """
Notification workflow:
1. HRMS creates notifications for important workflow events.
2. Notifications may include leave request updates, meeting updates, IT support updates, grievance updates, or admin messages.
3. User can view notification bell.
4. User can mark notifications as read.
5. Some notifications may appear as popup depending on configuration.
"""
    },
    {
        "module": "Employee Master",
        "title": "How employee master works",
        "content": """
Employee Master workflow:
1. HR/Admin/Super Admin can create employee records.
2. Employee record includes name, employee ID, designation, department, date of joining, state, contact, and reporting mappings.
3. Team Leader and Reporting Officer can be mapped to employees.
4. Employee profiles are tenant-wise.
5. Active employees appear in Employee Directory.
6. Resigned or inactive employees may be treated as alumni depending on system configuration.
"""
    },
    {
        "module": "Employee Directory",
        "title": "How employee directory works",
        "content": """
Employee Directory workflow:
1. Logged-in users can open Employee Directory if access is allowed.
2. Directory shows active tenant employees.
3. It may show employee photo/initials, name, designation, department, state, phone, and email.
4. Resigned or alumni employees are hidden.
5. Search and filter can be used to find employees.
"""
    },
    {
        "module": "Organisation / Entity Master",
        "title": "How organisation entity mapping works",
        "content": """
Organisation / Entity mapping workflow:
1. HR/Admin maintains organisations and related entities.
2. Employees can be mapped to organisation/entity where applicable.
3. Attendance reports and employee reports may use organisation/entity filters.
4. Proper mapping helps reporting and dashboard accuracy.
"""
    },
    {
        "module": "Profile",
        "title": "How profile works",
        "content": """
Profile workflow:
1. User opens My Profile.
2. User can view personal and employment details.
3. Profile photo can be uploaded if enabled.
4. Updated photo appears across profile, dashboard, and relevant employee UI.
5. Some profile fields may be editable only by HR/Admin.
"""
    },
    {
        "module": "Password Requests",
        "title": "How password request works",
        "content": """
Password request workflow:
1. Employee submits a password change/reset request.
2. Super Admin or authorized admin opens Password Requests.
3. Admin reviews request.
4. Admin approves or rejects the request.
5. If approved, password is reset or updated according to system process.
"""
    },
    {
        "module": "Super Admin",
        "title": "What Super Admin can do",
        "content": """
Super Admin workflow:
1. Super Admin can manage companies/tenants.
2. Super Admin can manage users and tenant users.
3. Super Admin can reset user passwords.
4. Super Admin can view platform-level dashboard.
5. Super Admin can access high-level control modules based on system permissions.
6. Super Admin should not be confused with normal Admin or HR roles.
"""
    },
    {
        "module": "Admin Dashboard",
        "title": "What Admin or HR dashboard shows",
        "content": """
Admin/HR dashboard workflow:
1. Admin, HR, HR Admin, HR Manager, Finance, or Accounts Finance may open Admin Dashboard depending on role.
2. Dashboard shows tenant-level HR records and summaries.
3. Users can navigate to employee management, attendance, reports, leave, projects, notifications, and other permitted modules.
4. Access depends on configured role permissions.
"""
    },
    {
        "module": "Employee Dashboard",
        "title": "What employee dashboard shows",
        "content": """
Employee Dashboard workflow:
1. Employee logs into HRMS.
2. Employee sees their own dashboard.
3. Employee can access modules allowed to their role.
4. Team Leader and Reporting Officer are employee capabilities, not separate login identities.
5. Employee dashboard may show attendance, leave, projects, application status, notifications, celebrations, and profile shortcuts.
"""
    },
    {
        "module": "Login",
        "title": "How login works",
        "content": """
Login workflow:
1. User opens SDS HRMS login page.
2. User enters registered email and password.
3. Backend verifies credentials.
4. On successful login, user role and tenant details are loaded.
5. User is redirected to the correct dashboard based on role.
6. Super Admin opens Super Admin Dashboard.
7. Admin/HR/Finance opens Admin Dashboard.
8. Employee and capability roles open Employee Dashboard.
"""
    },
]