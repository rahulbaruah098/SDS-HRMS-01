"""
Verified static workflow knowledge for Saya in YourComate HRMS.

This file contains product and workflow truth only. Live values such as
pricing, subscription dates, employee records, balances, attendance, salary,
payments, and approval state must be supplied by live capability context.
Backend route guards remain authoritative for permissions.
"""

from __future__ import annotations

KNOWLEDGE_VERSION = "2026-07-22-v5-recruitment-workflow-upgrade"

HRMS_WORKFLOWS = [
    {
        "module": 'Leave',
        "title": 'How to apply leave',
        "content": """
            Employee leave application workflow:
            1. Log in and open Apply Leave.
            2. Select Casual Leave, Earned Leave, Half Day, or Comp-Off according to the available balance and request type.
            3. Select the applicable date or date range and enter a clear reason.
            4. For Comp-Off leave, select an eligible unexpired comp-off credit generated from approved holiday work attendance.
            5. Submit the request.
            6. If a Team Leader is mapped, the request first goes to that Team Leader.
            7. After Team Leader approval, it goes to the mapped Reporting Officer when one exists.
            8. If only a Reporting Officer is mapped, it can go directly to the Reporting Officer.
            9. If neither approval mapping exists, the configured HR fallback handles the request.
            10. Check the live stage, decision, history, and rejection reason from Application Status.
        """,
        "keywords": ['apply leave', 'casual leave', 'earned leave', 'half day', 'comp off', 'approval', 'leave', 'how to apply leave'],
        "requires_live_data": False,
    },
    {
        "module": 'Leave',
        "title": 'How half-day leave works',
        "content": """
            Half-day leave workflow in YourComate HRMS:
            1. Employee opens Apply Leave.
            2. Selects Half-Day leave option if available.
            3. Selects the date and enters reason.
            4. Half-day leave is counted as 0.5 day.
            5. The system may deduct Casual Leave first.
            6. If Casual Leave is insufficient, Earned Leave may be used.
            7. If both balances are insufficient, the remaining leave may be treated as LWP depending on configuration.
            8. Approval follows Team Leader to Reporting Officer workflow.
        """,
        "keywords": ['leave', 'how half-day leave works'],
        "requires_live_data": False,
    },
    {
        "module": 'Leave Management',
        "title": 'How leave approval works',
        "content": """
            Leave approval hierarchy:
            1. An employee submits a leave request.
            2. A mapped Team Leader performs the first review.
            3. If approved, a mapped Reporting Officer performs the next or final review.
            4. When no Team Leader is mapped, the Reporting Officer can receive the request directly.
            5. When no Team Leader and no Reporting Officer are mapped, the request uses the configured HR fallback.
            6. HR/Admin users can monitor the workflow and handle only the stages permitted by backend rules.
            7. An approver can approve or reject only requests inside their mapped tenant/team scope.
            8. A rejection should include a reason, and the employee sees the result in Application Status.
            9. Team Leader and Reporting Officer are employee capabilities, not separate protected login identities.
        """,
        "keywords": ['leave approval', 'team leader', 'reporting officer', 'hr fallback', 'team approvals', 'leave management', 'how leave approval works'],
        "requires_live_data": False,
    },
    {
        "module": 'Leave Balances',
        "title": 'How leave balances are managed',
        "content": """
            Leave balance workflow in YourComate HRMS:
            1. HR/Admin/Super Admin can manage leave balances.
            2. Employee can view leave balance if the module is available to their role.
            3. Leave types include Casual Leave and Earned Leave.
            4. Leave deductions happen after leave approval according to workflow rules.
            5. Leave balance reports are available under Reports for authorized users.
        """,
        "keywords": ['leave balances', 'how leave balances are managed'],
        "requires_live_data": False,
    },
    {
        "module": 'Team Approvals',
        "title": 'How team approval works',
        "content": """
            Team Approval workflow:
            1. Team Leader or Reporting Officer opens Team Approvals.
            2. Pending requests from mapped employees are listed.
            3. Approver reviews request details such as employee, dates, type, and reason.
            4. Approver selects approve or reject.
            5. Approved requests may move to the next approval level depending on workflow.
            6. Rejected requests should include a proper reason if required.
            7. Final status is shown to the employee in Application Status.
        """,
        "keywords": ['team approvals', 'how team approval works'],
        "requires_live_data": False,
    },
    {
        "module": 'Application Status',
        "title": 'How to check application status',
        "content": """
            To check application status:
            1. Login to YourComate HRMS.
            2. Open Application Status from the sidebar.
            3. View submitted leave requests, attendance mode requests, comp-off claims, and other workflow requests.
            4. Check each request status: pending, approved, or rejected.
            5. If rejected, read the rejection reason shown with the request.
            6. Use this module to track where the request currently stands.
        """,
        "keywords": ['application status', 'how to check application status'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance',
        "title": 'How to mark attendance',
        "content": """
            To mark attendance in YourComate HRMS:
            1. Login to your HRMS account.
            2. Open Attendance module.
            3. Select attendance mode if required, such as Office, WFH, or Field.
            4. Click Check In.
            5. If check-in is late, enter the late reason if asked.
            6. At the end of work, click Check Out.
            7. Attendance history can be viewed from Attendance.
            8. Attendance reports can be viewed or exported by authorized users from Reports.
        """,
        "keywords": ['attendance', 'how to mark attendance'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance',
        "title": 'How late attendance works',
        "content": """
            Late attendance workflow:
            1. Employee checks in from Attendance module.
            2. If check-in is after the configured cutoff time, the system may mark it as late.
            3. The employee may need to enter a late reason.
            4. HR/Admin can review attendance reports.
            5. Late attendance details can appear in attendance reports and exports.
        """,
        "keywords": ['attendance', 'how late attendance works'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance',
        "title": 'How Office, WFH and Field attendance modes work',
        "content": """
            Attendance-mode workflow:
            1. Open Attendance and choose Office, WFH, or Field according to the available controls.
            2. Office attendance uses the normal check-in and check-out process.
            3. WFH or Field attendance can require a request and approval before the mode becomes valid.
            4. Enter the date, reason, visit place, or other required details.
            5. Field attendance can require location and a field photo at check-in.
            6. Approval follows the employee's mapped hierarchy and backend workflow rules.
            7. After approval, check in using the approved mode and check out at the end of work.
            8. Track pending or rejected requests in Application Status.
            9. Team-scoped Field attendance can be viewed only by authorized Team Leader, Reporting Officer, HR, or Admin users.
        """,
        "keywords": ['wfh', 'work from home', 'field attendance', 'office attendance', 'attendance mode', 'attendance', 'how office, wfh and field attendance modes work'],
        "requires_live_data": False,
    },
    {
        "module": 'Comp-Off',
        "title": 'Complete holiday work and comp-off workflow',
        "content": """
            Holiday-work and comp-off workflow:
            1. Before working on a Sunday, second Saturday, fourth Saturday, or HR-created holiday, the employee submits a Holiday Work Request.
            2. The request follows the mapped Team Leader, Reporting Officer, or HR fallback approval hierarchy.
            3. The employee can mark holiday attendance only after the request is approved.
            4. The employee checks in and checks out for the approved holiday-work date.
            5. The system generates an eligible comp-off credit after approved holiday work attendance satisfies the configured rules.
            6. The credit becomes claimable from the next working day.
            7. The employee must use the credit within seven working days unless the configured policy changes.
            8. To use it, open Apply Leave, choose Comp-Off, and select the available credit.
            9. The comp-off leave request follows the normal approval hierarchy.
            10. Used, expired, pending, and available credits can be reviewed in the relevant modules and reports.
        """,
        "keywords": ['comp off', 'holiday work', 'sunday work', 'second saturday', 'fourth saturday', 'credit expiry', 'comp-off', 'complete holiday work and comp-off workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Holiday Calendar',
        "title": 'How holiday calendar works',
        "content": """
            Holiday Calendar workflow:
            1. HR/Admin can add, update, or delete holidays.
            2. Holidays can be maintained state-wise if the company uses state-specific holidays.
            3. Employees can view holidays applicable to them.
            4. Attendance and reports may use holiday calendar data.
        """,
        "keywords": ['holiday calendar', 'how holiday calendar works'],
        "requires_live_data": False,
    },
    {
        "module": 'Projects',
        "title": 'Complete project creation and assignment workflow',
        "content": """
            Project workflow:
            1. Team Leader and Reporting Officer capability users can create and manage projects within their permitted scope.
            2. The project records title, description, dates, priority, status, ownership, and other available details.
            3. The creator assigns mapped team members who will work on the project.
            4. Collaborators can be added where the current workflow permits them.
            5. Employees see only projects assigned or otherwise accessible to them.
            6. Assigned employees update work progress, percentage, remarks, and status from Projects.
            7. Team Leader and Reporting Officer users review updates and project analytics within their mapped scope.
            8. The project team tree shows Reporting Officer, Team Leader, assigned members, and collaborators where available.
            9. A designation alone does not create project-management permission; the employee capability and backend mapping are authoritative.
        """,
        "keywords": ['project create', 'assign project', 'project progress', 'team tree', 'collaborator', 'projects', 'complete project creation and assignment workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Projects',
        "title": 'How to update project progress',
        "content": """
            To update project progress:
            1. Login to HRMS.
            2. Open Projects module.
            3. Select the assigned project.
            4. Open project progress or detail section.
            5. Enter work update, progress percentage, remarks, or status as available.
            6. Submit the progress update.
            7. Reporting users can review project progress and analytics.
        """,
        "keywords": ['projects', 'how to update project progress'],
        "requires_live_data": False,
    },
    {
        "module": 'Projects',
        "title": 'How project team tree works',
        "content": """
            Project team tree workflow:
            1. Open Projects module.
            2. Select the project or analytics/team view.
            3. The system shows project team structure based on assigned users, Team Leader, Reporting Officer, collaborators, or department mapping.
            4. This helps understand project responsibility and reporting flow.
        """,
        "keywords": ['projects', 'how project team tree works'],
        "requires_live_data": False,
    },
    {
        "module": 'Grievance',
        "title": 'How to submit grievance',
        "content": """
            To submit a grievance in YourComate HRMS:
            1. Login to your HRMS account.
            2. Open the Grievance module.
            3. Select grievance category.
            4. Enter subject and description.
            5. Choose anonymous option if available and required.
            6. Submit the grievance.
            7. Admin or HR can review and update the grievance status.
            8. Employee can check grievance progress from the Grievance module.
        """,
        "keywords": ['grievance', 'how to submit grievance'],
        "requires_live_data": False,
    },
    {
        "module": 'Grievance',
        "title": 'How grievance review works',
        "content": """
            Grievance review workflow:
            1. HR/Admin opens Grievance module.
            2. They view submitted grievances tenant-wise.
            3. They open grievance details.
            4. They update status, remarks, or resolution.
            5. Employee can view updated status.
            6. Anonymous grievance may hide employee identity depending on configuration.
        """,
        "keywords": ['grievance', 'how grievance review works'],
        "requires_live_data": False,
    },
    {
        "module": 'IT Support',
        "title": 'How to raise IT support ticket',
        "content": """
            To raise an IT support ticket:
            1. Login to your HRMS account.
            2. Open IT Support module.
            3. Select issue category.
            4. Enter issue subject and details.
            5. Submit the ticket.
            6. IT Head or IT team can assign, update, escalate, review, or reopen the ticket.
            7. Employee can track submitted tickets from IT Support module.
        """,
        "keywords": ['it support', 'how to raise it support ticket'],
        "requires_live_data": False,
    },
    {
        "module": 'IT Support',
        "title": 'How IT support assignment and escalation work',
        "content": """
            IT support routing and escalation:
            1. Any login role can raise an IT Support ticket for its own issue.
            2. Normal tenant tickets go to the tenant IT Department, not to HR/Admin for resolution.
            3. The tenant IT Department Team Leader or IT Support Head reviews the ticket.
            4. The IT Head assigns or reassigns it to self or an eligible tenant IT Department member.
            5. The assigned IT member updates progress and status such as Assigned, In Progress, Waiting for User, Resolved, or Closed.
            6. Software, server, database, security, network-infrastructure, or another major issue can be escalated by the IT Head to Platform Super Admin.
            7. Platform Super Admin sees escalated major issues, not every normal tenant ticket.
            8. After resolution, the requester can review the outcome and reopen the ticket where allowed.
        """,
        "keywords": ['it ticket', 'it head', 'assign ticket', 'escalate', 'server issue', 'reopen', 'it support', 'how it support assignment and escalation work'],
        "requires_live_data": False,
    },
    {
        "module": 'Assets',
        "title": 'How asset module works',
        "content": """
            Asset workflow in YourComate HRMS:
            1. Employees can view or submit their assigned hardware or software asset details.
            2. Admin, HR, or Super Admin can add assets for employees.
            3. Asset details include asset type, code, serial number, condition, status, and assigned employee.
            4. Assets can be verified by authorized users.
            5. Asset status and condition can be updated.
            6. Employee-wise asset reports can be generated.
        """,
        "keywords": ['assets', 'how asset module works'],
        "requires_live_data": False,
    },
    {
        "module": 'Assets',
        "title": 'How employee submits asset',
        "content": """
            To submit an asset as employee:
            1. Login to HRMS.
            2. Open Assets module.
            3. Choose hardware or software asset type.
            4. Enter asset details such as asset name, code, serial/license details, condition, and remarks.
            5. Submit the asset entry.
            6. HR/Admin can verify or update the record.
        """,
        "keywords": ['assets', 'how employee submits asset'],
        "requires_live_data": False,
    },
    {
        "module": 'Assets',
        "title": 'How HR verifies assets',
        "content": """
            HR/Admin asset verification workflow:
            1. Open Assets module.
            2. View pending or submitted asset records.
            3. Open the asset entry.
            4. Check asset details and assigned employee.
            5. Update verification status.
            6. Update condition/status if required.
            7. Export employee-wise asset report if needed.
        """,
        "keywords": ['assets', 'how hr verifies assets'],
        "requires_live_data": False,
    },
    {
        "module": 'Management Group',
        "title": 'How management group meetings work',
        "content": """
            Management Group workflow:
            1. Admin or HR can manage management group members.
            2. Management group meetings can be scheduled.
            3. Group members can view assigned meetings.
            4. A minutes writer can be assigned for the meeting.
            5. Assigned minutes writer can update meeting minutes.
            6. Meeting updates create notifications for relevant users.
        """,
        "keywords": ['management group', 'how management group meetings work'],
        "requires_live_data": False,
    },
    {
        "module": 'Management Group',
        "title": 'How meeting minutes work',
        "content": """
            Meeting minutes workflow:
            1. Admin/HR or group admin schedules a meeting.
            2. A minutes writer is assigned.
            3. Assigned minutes writer opens the meeting.
            4. They enter meeting minutes and save.
            5. Minutes history may be maintained.
            6. Notifications may be sent after minutes assignment or update.
        """,
        "keywords": ['management group', 'how meeting minutes work'],
        "requires_live_data": False,
    },
    {
        "module": 'Reports',
        "title": 'How reports work',
        "content": """
            Reports module in YourComate HRMS:
            1. Authorized users open Reports from the sidebar.
            2. Reports include attendance, leave, mode requests, holidays, comp-off, leave approvals, leave deductions, leave records, and audit-related reports.
            3. Filters such as date, organisation, entity, state, or employee may be available.
            4. Attendance reports can be exported in styled Excel format.
            5. Access to reports depends on role permission.
        """,
        "keywords": ['reports', 'how reports work'],
        "requires_live_data": False,
    },
    {
        "module": 'Reports',
        "title": 'How attendance Excel export works',
        "content": """
            Attendance Excel export workflow:
            1. Authorized user opens Reports.
            2. Selects attendance report.
            3. Applies filters such as date range, organisation, entity, state, or employee if available.
            4. Clicks export/download.
            5. System generates a styled Excel attendance report.
        """,
        "keywords": ['reports', 'how attendance excel export works'],
        "requires_live_data": False,
    },
    {
        "module": 'Policies',
        "title": 'How policies work',
        "content": """
            Policy workflow in YourComate HRMS:
            1. Admin or HR can upload company policies.
            2. Employees can view available policies.
            3. Users can open policy details.
            4. Policy files can be downloaded if available.
            5. Policies are tenant-wise and shown based on user access.
        """,
        "keywords": ['policies', 'how policies work'],
        "requires_live_data": False,
    },
    {
        "module": 'Notifications',
        "title": 'How notifications work',
        "content": """
            Notification workflow:
            1. HRMS creates notifications for important workflow events.
            2. Notifications may include leave request updates, meeting updates, IT support updates, grievance updates, or admin messages.
            3. User can view notification bell.
            4. User can mark notifications as read.
            5. Some notifications may appear as popup depending on configuration.
        """,
        "keywords": ['notifications', 'how notifications work'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Master',
        "title": 'How employee master works',
        "content": """
            Employee Master workflow:
            1. HR/Admin/Super Admin can create employee records.
            2. Employee record includes name, employee ID, designation, department, date of joining, state, contact, and reporting mappings.
            3. Team Leader and Reporting Officer can be mapped to employees.
            4. Employee profiles are tenant-wise.
            5. Active employees appear in Employee Directory.
            6. Resigned or inactive employees may be treated as alumni depending on system configuration.
        """,
        "keywords": ['employee master', 'how employee master works'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Directory',
        "title": 'How employee directory works',
        "content": """
            Employee Directory workflow:
            1. Logged-in users can open Employee Directory if access is allowed.
            2. Directory shows active tenant employees.
            3. It may show employee photo/initials, name, designation, department, state, phone, and email.
            4. Resigned or alumni employees are hidden.
            5. Search and filter can be used to find employees.
        """,
        "keywords": ['employee directory', 'how employee directory works'],
        "requires_live_data": False,
    },
    {
        "module": 'Organisation / Entity Master',
        "title": 'How organisation entity mapping works',
        "content": """
            Organisation / Entity mapping workflow:
            1. HR/Admin maintains organisations and related entities.
            2. Employees can be mapped to organisation/entity where applicable.
            3. Attendance reports and employee reports may use organisation/entity filters.
            4. Proper mapping helps reporting and dashboard accuracy.
        """,
        "keywords": ['organisation / entity master', 'how organisation entity mapping works'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll',
        "title": 'Complete monthly payroll workflow',
        "content": """
            Complete monthly payroll workflow in YourComate HRMS:
            1. The Payroll module must be enabled for the tenant before any payroll endpoint can be used.
            2. An authorized user creates and activates an effective-dated salary structure for every employee included in payroll.
            3. An authorized user creates and activates the statutory configuration for each employee work-state, including PF, ESI, PT, LWP and TDS-related settings.
            4. Employee bank details are entered and must be verified before the payroll run can be locked.
            5. Attendance is synchronized for the payroll month, or explicit manual attendance is supplied. LWP days are mandatory and are never silently assumed to be zero.
            6. Payroll is calculated for all active employees or a selected employee scope. The calculation uses the active salary revision, active statutory revision, attendance summary, approved reimbursements, eligible loan recoveries and the active payroll tax context.
            7. If any selected employee fails validation, the entire calculation batch fails and nothing is saved.
            8. A successful calculation creates or replaces a Draft payroll run and Draft employee payslips.
            9. The fixed main workflow is Draft -> HR Reviewed -> Finance Approved -> Locked -> Disbursed.
            10. HR Review reserves approved payroll reimbursements and passes the run to Finance.
            11. Finance Approval confirms the run before locking.
            12. Locking rebuilds and validates verified employee bank snapshots. A run cannot be locked when required bank details are missing, inactive, rejected or unverified.
            13. Once locked, employees are notified and their payslips become available.
            14. Finance records disbursement using transfer date, transfer mode and optional transaction or bank-file references.
            15. After disbursement, scheduled loan recoveries and payroll reimbursements are applied. Any recovery/payment failure is retained for an explicit retry without falsely reversing the salary disbursement.
            16. Locked or disbursed payroll is treated as official and cannot be recalculated like a Draft run.
        """,
        "keywords": ['payroll', 'complete monthly payroll workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Roles',
        "title": 'Payroll access and restrictions for every login role',
        "content": """
            Payroll permissions and restrictions by login role:
            1. Super Admin: Can operate payroll for the selected tenant, access tenant-wide payroll data, configure salary/statutory rules, calculate payroll, perform every main workflow action, manage loans, reimbursements, bank verification, tax, TDS and reports. Cross-tenant access is allowed only through the explicitly selected tenant context.
            2. Tenant Admin: Can work only inside their own tenant. Admin can configure salary/statutory rules, synchronize attendance, calculate payroll and manage tenant-wide payroll submodules. A plain Admin role does not satisfy the action-specific main run approval checks: HR Review requires an HR role and Finance Approval, Lock and Disbursement require a Finance role. An Admin with additional HR or Finance roles receives those corresponding actions.
            3. HR, HR Admin and HR Manager: Can configure salary/statutory rules, synchronize attendance, calculate Draft payroll, perform HR Review, manage employee payroll records, complete reimbursement HR review, review tax declarations and access company-wide payroll reports. They cannot perform Finance Approval, Lock or Disbursement unless they also have a Finance role.
            4. Finance and Accounts Finance: Can configure and calculate payroll, perform Finance Approval, Lock and Disbursement, verify or reject bank details, generate salary bank files, approve/disburse loans, approve or schedule reimbursements, approve/lock tax declarations, manage TDS instructions and access company-wide payroll reports. They cannot perform HR Review unless they also have an HR role.
            5. Employee: Can access only their own employee-linked payroll self-service records, including loan/advance requests, reimbursements, bank details, tax declarations, employee statements and released payslips. Employees cannot configure payroll, calculate payroll, approve runs or view another employee's payroll records.
            6. Team Leader, Reporting Officer, RO and Manager capability roles: Payroll access remains self-service and employee-scoped. A reporting role does not automatically permit viewing or changing a subordinate's salary, bank details, tax declaration, loan, reimbursement, statement or payslip.
            7. Payslip download roles are Super Admin, Admin, HR, HR Admin, HR Manager, Finance, Accounts Finance, Employee, Team Leader and Reporting Officer. Non-privileged users can download only their own payslip and only after it is Locked or Disbursed.
            8. Menu visibility can be narrower than backend role eligibility and also depends on tenant module configuration. No role may bypass tenant isolation or the Payroll-module-enabled check.
        """,
        "keywords": ['payroll roles', 'payroll access and restrictions for every login role'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Configuration',
        "title": 'Salary structure and statutory configuration workflow',
        "content": """
            Payroll Configuration workflow:
            1. Super Admin, Admin, HR Admin, HR Manager, HR, Finance and Accounts Finance can access payroll configuration.
            2. Select the tenant when operating as Super Admin; all other users remain restricted to their own tenant.
            3. Select an employee and create a Draft salary structure containing the required earning and deduction components.
            4. Set an effective-from date and save the Draft. Draft revisions remain editable until activation.
            5. Activate the salary revision. The previous active revision is superseded and the new revision becomes effective from its configured date.
            6. Create a Draft statutory configuration for the employee's state, including PF, ESI, PT, LWP and supported tax settings.
            7. Activate the statutory revision after validation. Previous effective revisions remain in history for auditability.
            8. A new revision must start after the current active revision. Mid-month salary or statutory changes are rejected for a payroll month because one payroll period cannot use two revisions.
            9. Payroll calculation requires an active salary structure and active statutory configuration effective for the selected month.
            10. Historical revisions are retained and should not be edited as if they were the active Draft.
        """,
        "keywords": ['payroll configuration', 'salary structure and statutory configuration workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Attendance',
        "title": 'Attendance synchronization and payroll calculation rules',
        "content": """
            Payroll attendance and calculation workflow:
            1. Super Admin, Admin, HR Admin, HR Manager, HR, Finance or Accounts Finance selects a payroll month and employee scope.
            2. Attendance can be synchronized from HRMS attendance into monthly attendance summaries, or supplied manually during calculation.
            3. Manual attendance must include explicit LWP days for every selected employee; zero must be entered explicitly when applicable.
            4. The system validates working days, paid leave, LWP and employee mappings before calculation.
            5. Payroll calculation loads the active salary structure, state statutory configuration, attendance summary, effective tax instruction, eligible loan recovery and approved reimbursement data for each employee.
            6. Request-body TDS cannot override the active Finance-controlled TDS instruction.
            7. Approved but not disbursed loans are not deducted. Only eligible disbursed/recovering advances are considered for payroll recovery.
            8. Only approved or scheduled payroll reimbursements for the selected period are included.
            9. Payroll calculation is atomic for the selected batch: if one employee fails, no payroll run or payslip in that batch is saved.
            10. Recalculation is allowed only while the existing run remains Draft and unlocked.
        """,
        "keywords": ['payroll attendance', 'attendance synchronization and payroll calculation rules'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Runs',
        "title": 'Payroll approval, lock and disbursement restrictions',
        "content": """
            Main payroll run workflow and action restrictions:
            1. Calculate creates status Draft.
            2. HR Review changes Draft to HR Reviewed. Allowed roles are HR, HR Admin and HR Manager; Super Admin is also allowed. Admin alone is not an HR reviewer.
            3. Finance Approval changes HR Reviewed to Finance Approved. Allowed roles are Finance and Accounts Finance; Super Admin is also allowed.
            4. Lock changes Finance Approved to Locked. This is a Finance action and requires verified bank details for every included employee.
            5. Disburse changes Locked to Disbursed. This is a Finance action and requires a valid transfer date and transfer mode.
            6. Every action must occur in order; skipping or repeating a stage is rejected.
            7. The payroll run and every active payslip must have the same status and expected employee count before a transition can proceed.
            8. Concurrent or partial updates are rejected, and the workflow attempts rollback when run and payslip states would diverge.
            9. A legacy payroll run cannot use this workflow until it is recalculated through the dedicated payroll calculation process.
            10. Locked and Disbursed states preserve immutable payroll, tax, bank, salary and statutory snapshots for audit and payslip generation.
        """,
        "keywords": ['payroll runs', 'payroll approval, lock and disbursement restrictions'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Banking',
        "title": 'Employee bank details and salary disbursement workflow',
        "content": """
            Payroll Banking workflow:
            1. Employees and employee-capability roles can add or update only their own bank details.
            2. Super Admin, Admin, HR Admin, HR Manager, HR, Finance and Accounts Finance can view/manage tenant employee bank records according to their management access.
            3. Saving changed bank details clears prior verification so the revised account must be checked again.
            4. Only Super Admin, Admin, Finance and Accounts Finance can verify, reject or deactivate bank details.
            5. A rejected verification must include a reason. Inactive, rejected or unverified bank details cannot be used for final payroll locking.
            6. Immediately before Lock, the system rebuilds bank snapshots from the latest verified revision for every payslip.
            7. If any employee lacks valid verified bank details, the entire Lock action is blocked.
            8. Salary bank-disbursement CSV generation is allowed only after payroll is Locked or Disbursed and only for Super Admin, Admin, Finance or Accounts Finance.
            9. Bank export status and bank references are tracked for audit.
            10. Employees cannot verify their own bank records, generate company bank files or inspect another employee's account details.
        """,
        "keywords": ['payroll banking', 'employee bank details and salary disbursement workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Loans & Advances',
        "title": 'Complete payroll loan and advance workflow',
        "content": """
            Payroll loan and advance workflow:
            1. An employee, Team Leader, Reporting Officer, RO or Manager can create and edit only their own Draft loan/advance request.
            2. Payroll management roles can create or inspect requests for employees in their tenant.
            3. The employee submits the Draft, changing it to Pending Approval.
            4. Only Super Admin, Admin, Finance or Accounts Finance can approve or reject a Pending Approval request.
            5. Approval records approved amount, recovery start period, installment/recovery terms and related controls.
            6. Only Super Admin, Admin, Finance or Accounts Finance can disburse an Approved request.
            7. After disbursement, the advance becomes eligible for payroll recovery and can progress through Disbursed, Recovering and Closed states.
            8. Draft, Pending Approval or Approved requests may be cancelled with a reason, subject to record ownership and role access.
            9. Finance can revise future recovery terms, but cannot rewrite deductions for payroll periods already Locked or Disbursed.
            10. Payroll deduction uses only eligible disbursed/recovering advances; approved-but-not-disbursed requests are never deducted.
            11. Employees cannot view, update or cancel another employee's loan record.
        """,
        "keywords": ['loans & advances', 'complete payroll loan and advance workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Reimbursements',
        "title": 'Complete payroll reimbursement workflow',
        "content": """
            Payroll reimbursement workflow:
            1. An employee or employee-capability role creates and edits only their own Draft claim, including category, amount, date, description and receipts where required.
            2. The employee submits the claim, changing it from Draft to Pending HR Review.
            3. Super Admin, Admin, HR Admin, HR Manager or HR completes HR Review and sends an accepted amount to Pending Finance Approval.
            4. Super Admin, Admin, Finance or Accounts Finance gives Finance approval, sets taxable/non-taxable treatment and chooses Payroll or Manual payment mode.
            5. Rejected claims can be rejected by authorized HR or Finance management roles with a reason.
            6. An approved Payroll reimbursement is scheduled for a payroll period and is reserved when that Draft payroll enters HR Review.
            7. If the approved amount changed after payroll calculation, HR Review is blocked until the Draft payroll is recalculated.
            8. Manual reimbursements can be marked paid only by Super Admin, Admin, Finance or Accounts Finance.
            9. Payroll reimbursements are marked paid after the corresponding salary run is Disbursed; failures remain available for explicit retry.
            10. Employees can cancel only eligible non-final claims and cannot access another employee's reimbursement.
        """,
        "keywords": ['reimbursements', 'complete payroll reimbursement workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Tax Declarations & TDS',
        "title": 'Complete tax declaration and TDS workflow',
        "content": """
            Payroll tax declaration and TDS workflow:
            1. Employees and employee-capability roles can create, update, submit, cancel and view only their own tax declaration for a financial year.
            2. Editable declaration states are Draft and Rejected. Supporting proof status is tracked component-wise.
            3. Submission starts the review flow and sends the declaration for HR review.
            4. Super Admin, Admin, HR Admin, HR Manager or HR reviews components and sends the declaration to Pending Finance Approval.
            5. Super Admin, Admin, Finance or Accounts Finance approves the declaration and may later Lock it.
            6. Authorized HR or Finance management roles may reject a submitted or pending-review declaration with a reason.
            7. Approved, Locked or already Cancelled declarations cannot be cancelled by the employee.
            8. Only an Approved declaration can be Locked; a Locked declaration is final for payroll use.
            9. TDS instructions are controlled only by Super Admin, Admin, Finance and Accounts Finance.
            10. Supported TDS modes are Disabled, Manual and External. The active instruction for the payroll period is authoritative.
            11. Payroll calculation never estimates or accepts an arbitrary request-body TDS override; it uses the effective Finance instruction and tax-declaration context.
            12. No user may view or modify another employee's declaration unless they have payroll tax management access within the same tenant.
        """,
        "keywords": ['tax declarations & tds', 'complete tax declaration and tds workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Reports',
        "title": 'Payroll reports and data-access restrictions',
        "content": """
            Payroll reporting workflow and restrictions:
            1. Super Admin, Admin, HR Admin, HR Manager, HR, Finance and Accounts Finance can generate company-wide payroll registers, payroll summaries, statutory summaries, department summaries, period variance and payroll trend reports.
            2. Management users can filter by payroll period, status, employee, department, designation, location and state according to the selected report.
            3. Employees, Team Leaders, Reporting Officers, RO and Managers may generate only their own employee payroll statement through self-service access.
            4. Non-management employee statements are restricted to official Locked or Disbursed payroll and cannot expose Draft or approval-stage amounts.
            5. Non-management users cannot select another employee, generate company-wide reports or use company-level filters.
            6. CSV exports are audited and include export identifiers, file hash, row count and total amount metadata.
            7. Payroll report-export history and export status management are limited to payroll management roles.
            8. Super Admin must select the target tenant; every other role is restricted to its own tenant.
        """,
        "keywords": ['payroll reports', 'payroll reports and data-access restrictions'],
        "requires_live_data": False,
    },
    {
        "module": 'Payslips',
        "title": 'Payslip release, download and privacy rules',
        "content": """
            Payslip workflow and restrictions:
            1. Payslip records are created as immutable calculation snapshots when Draft payroll is calculated.
            2. Payroll management users can preview employee payslips during authorized payroll processing.
            3. Employees and permitted employee-capability roles can download only the payslip linked to their own employee profile.
            4. A non-privileged employee cannot access a payslip until the payroll status is Locked or Disbursed.
            5. The PDF is generated from stored employee, attendance, earning, deduction, salary, statutory, tax, bank and transfer snapshots rather than mutable live values.
            6. Legacy payslips without the required immutable snapshots cannot be generated; the Draft payroll must be recalculated first.
            7. Every PDF generation is audited, and private no-store response controls are used.
            8. A role or employee reference from another tenant cannot be used to retrieve the payslip.
        """,
        "keywords": ['payslips', 'payslip release, download and privacy rules'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll Security',
        "title": 'Payroll tenant isolation, validation and immutability',
        "content": """
            Payroll security and integrity rules:
            1. Every payroll route requires the Payroll module to be enabled for the tenant.
            2. All payroll records are tenant-scoped. Non-Super-Admin users cannot request another tenant's payroll data.
            3. Super Admin cross-tenant work must use the explicitly selected tenant and does not merge records between companies.
            4. Employee self-service access is resolved through the logged-in user's linked employee profile and is restricted to that employee.
            5. Role checks are enforced by the backend even if a page or button is visible in the frontend.
            6. Payroll workflow transitions require the correct current status, action role, run employee count and payslip status consistency.
            7. The calculation batch is all-or-nothing when employee validation fails.
            8. Locked and Disbursed payroll cannot be recalculated or silently changed.
            9. Salary structures, statutory rules, tax context, bank details and calculation inputs are snapshotted for auditability.
            10. Important payroll actions create audit records and workflow-history entries with actor identity, role and timestamp.
        """,
        "keywords": ['payroll security', 'payroll tenant isolation, validation and immutability'],
        "requires_live_data": False,
    },
    {
        "module": 'Profile',
        "title": 'How profile works',
        "content": """
            Profile workflow:
            1. User opens My Profile.
            2. User can view personal and employment details.
            3. Profile photo can be uploaded if enabled.
            4. Updated photo appears across profile, dashboard, and relevant employee UI.
            5. Every authenticated user can change their own password by entering the current password, new password and confirmation.
            6. The password changes directly after verification and does not require a Super Admin request or approval.
            7. Some employment profile fields may remain editable only by HR/Admin.
        """,
        "keywords": ['profile', 'how profile works'],
        "requires_live_data": False,
    },
    {
        "module": 'Password Change',
        "title": 'How users change their own password',
        "content": """
            Direct password change workflow:
            1. The logged-in user opens My Profile.
            2. The user enters their current password, new password and new-password confirmation.
            3. The backend verifies the current password and confirms that the new values match.
            4. The new password must meet the configured minimum-length requirement and cannot be the same as the current password.
            5. On success, the logged-in user's password is changed immediately without a Super Admin approval request.
            6. A user can change only their own password through this workflow.
            7. Super Admin password reset capability in User Control remains a separate administrative recovery function.
        """,
        "keywords": ['password change', 'how users change their own password'],
        "requires_live_data": False,
    },
    {
        "module": 'Platform Super Admin',
        "title": 'Platform Super Admin responsibilities and boundaries',
        "content": """
            Platform Super Admin workflow:
            1. Open the platform dashboard to monitor tenants, trials, subscriptions, payments, and attention items.
            2. Manage Companies/Tenants, tenant status, subscription state, employee limits, and enabled modules.
            3. Review OTP-verified Trial Requests and approve or reject them.
            4. Review Premium Requests, prepare custom quotations, send quotation/payment details, and monitor conversion.
            5. Manage dynamic Essential and Growth pricing and subscription/payment records.
            6. Use User Control to select a tenant and manage that tenant's login users.
            7. Create global or selected-tenant notifications.
            8. Review platform audit logs, system settings, escalated IT issues, and platform notifications.
            9. Cross-tenant actions require an explicitly selected tenant and must never mix tenant records.
            10. Platform Super Admin is distinct from a tenant Admin and must not be described as an ordinary employee approver unless a tenant-scoped workflow explicitly supports it.
        """,
        "keywords": ['super admin', 'platform admin', 'tenants', 'trial requests', 'subscriptions', 'premium requests', 'platform super admin', 'platform super admin responsibilities and boundaries'],
        "requires_live_data": False,
    },
    {
        "module": 'Admin Dashboard',
        "title": 'How the tenant management dashboard works by role',
        "content": """
            Tenant management dashboard behavior:
            1. Admin, HR Admin, HR Manager, HR, Finance, and Accounts Finance can be routed to the tenant management dashboard according to their authenticated role.
            2. The dashboard remains restricted to the logged-in tenant.
            3. Admin and HR users receive employee, attendance, leave, report, policy, asset, notification, and other permitted HR modules.
            4. Finance users receive payroll, banking, loans, reimbursements, tax, payslip, and reporting modules according to permission.
            5. Module visibility can also depend on the tenant's active subscription and enabled modules.
            6. A visible menu does not override backend authorization.
            7. Private data answers must use live permitted records and must never be guessed.
        """,
        "keywords": ['admin dashboard', 'hr dashboard', 'finance dashboard', 'tenant dashboard', 'how the tenant management dashboard works by role'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Dashboard',
        "title": 'How the employee and capability dashboard works',
        "content": """
            Employee dashboard behavior:
            1. A staff login opens the employee dashboard and sees its own tenant-scoped information.
            2. Common self-service modules include Attendance, Apply Leave, Application Status, Projects, Grievance, IT Support, Assets, Policies, Notifications, Payroll self-service, and My Profile where enabled.
            3. Team Leader and Reporting Officer are employee capabilities attached to the employee profile, not separate protected login identities.
            4. Capability users can receive additional Team Approvals, project, team, field-tracking, or performance functions within their mapped scope.
            5. A Manager or Managing Director designation can shape guidance, but access still comes from the actual role, capability flags, mappings, subscription, and backend permission.
            6. Employees can access only their own salary, bank, tax, reimbursement, loan, and payslip records unless an authenticated management role grants broader access.
        """,
        "keywords": ['employee dashboard', 'team leader dashboard', 'reporting officer', 'manager', 'managing director', 'how the employee and capability dashboard works'],
        "requires_live_data": False,
    },
    {
        "module": 'Authentication',
        "title": 'How login and dashboard routing work',
        "content": """
            Login and routing workflow:
            1. Open the YourComate HRMS login page and enter the registered email and password.
            2. The backend validates the credentials, account status, tenant state, and subscription access.
            3. On success, authentication tokens, user roles, tenant information, and employee linkage are loaded.
            4. Platform Super Admin is routed to the Platform Super Admin dashboard.
            5. Tenant Admin, HR, and Finance management roles are routed to the tenant management dashboard.
            6. Employee logins, including Team Leader and Reporting Officer capability employees, are routed to the employee dashboard.
            7. Disabled users, suspended tenants, or expired subscriptions can be blocked or redirected according to SaaS rules.
            8. Persistent login and refresh behavior must use the connected authentication endpoints rather than storing or exposing credentials to Saya.
        """,
        "keywords": ['login', 'authentication', 'dashboard routing', 'disabled user', 'expired subscription', 'how login and dashboard routing work'],
        "requires_live_data": False,
    },
    {
        "module": 'Saya AI Assistant',
        "title": 'What Saya knows and how Saya should answer',
        "content": """
            Saya is the role-aware AI Assistant inside YourComate HRMS.
            1. Saya explains the actual YourComate workflow in numbered steps.
            2. Saya adapts the explanation to the authenticated role, employee capabilities, designation context, tenant, subscription, and enabled modules.
            3. Saya can use live HRMS context for permitted questions such as the user's own leave, attendance, payslip, payroll state, trial status, plan pricing, or payment state.
            4. Saya must not invent current balances, prices, employee records, payroll amounts, approval results, or subscription dates.
            5. Saya must not expose another tenant's data or another employee's private information without verified role permission and live context.
            6. Saya can guide an action step by step, but must not claim completion unless the connected action API confirms success.
            7. Saya must ask for confirmation before a guided action performs a final submission.
            8. Saya describes YourComate positively and factually without inventing awards, customer numbers, guarantees, discounts, or testimonials.
        """,
        "keywords": ['saya', 'ai assistant', 'what can saya do', 'role aware', 'workflow knowledge', 'saya ai assistant', 'what saya knows and how saya should answer'],
        "requires_live_data": False,
    },
    {
        "module": 'Roles and Permissions',
        "title": 'Protected login roles and employee capability roles',
        "content": """
            YourComate role model:
            1. Protected management login roles include Platform Super Admin, Tenant Admin, HR Admin, HR Manager, HR, Finance, and Accounts Finance.
            2. A normal staff login remains an Employee login.
            3. Team Leader and Reporting Officer are employee capabilities created through employee flags and mappings.
            4. The labels Manager and RO can appear as normalized capability aliases, but they must not be treated as new protected login identities.
            5. IT Support Head or IT Support Member behavior is derived from department, team, and ticket assignment context rather than an unrestricted platform role.
            6. Module access comes from authenticated roles, capability flags, employee mappings, tenant, subscription, enabled modules, and backend authorization.
            7. Saya may explain a workflow to a user, but explanation does not grant the user permission to perform it.
        """,
        "keywords": ['roles', 'permissions', 'employee capability', 'team leader role', 'reporting officer role', 'roles and permissions', 'protected login roles and employee capability roles'],
        "requires_live_data": False,
    },
    {
        "module": 'Designations',
        "title": 'How designation differs from login permission',
        "content": """
            Designation and permission rule:
            1. Department and Designation are employee master data used for classification, reporting, filters, and workflow eligibility.
            2. Designations such as Managing Director, Director, CEO, Manager, HR Manager, Accountant, or IT Head do not automatically become login roles.
            3. The Reporting Officer selection list is limited to eligible employees whose designation matches Manager, Managing Director, Director, CEO, or Chief Executive Officer according to the current frontend rule.
            4. A Manager or Managing Director receives executive or team-oriented guidance from Saya, but actual access still depends on authenticated roles and mappings.
            5. Never infer salary, employee, approval, cross-tenant, or administrative permission from designation text alone.
        """,
        "keywords": ['designation', 'managing director', 'manager', 'ceo', 'director', 'reporting officer dropdown', 'designations', 'how designation differs from login permission'],
        "requires_live_data": False,
    },
    {
        "module": 'Module Access',
        "title": 'How role and subscription module access combine',
        "content": """
            Effective module access is determined in layers:
            1. The authenticated login role establishes the base permission set.
            2. Employee capability flags and mappings can add team-scoped functions.
            3. The tenant ID restricts all business data to the current company.
            4. The active SaaS subscription and enabled-module configuration can hide or block modules.
            5. Tenant suspension, expiry, or payment-required state can block normal access.
            6. Backend route guards remain authoritative even when a frontend menu item is visible.
            7. Saya should mention the relevant restriction instead of instructing the user to bypass it.
        """,
        "keywords": ['module access', 'subscription modules', 'role permission', 'tenant guard', 'how role and subscription module access combine'],
        "requires_live_data": False,
    },
    {
        "module": 'Tenant Security',
        "title": 'Tenant isolation and private-data rules',
        "content": """
            Tenant and privacy rules:
            1. Every tenant user is restricted to the logged-in company.
            2. Platform Super Admin must explicitly select a target tenant for tenant-specific work.
            3. Cross-tenant employee, attendance, leave, payroll, asset, project, grievance, ticket, notification, or report data must never be merged.
            4. Employee self-service resolves the linked employee profile and limits private information to that employee.
            5. Team-scoped users see only mapped team members and accessible projects.
            6. Saya must use live authorized context for personal or confidential answers and say that no accessible record was found when context is missing.
        """,
        "keywords": ['tenant isolation', 'privacy', 'cross tenant', 'private data', 'tenant security', 'tenant isolation and private-data rules'],
        "requires_live_data": False,
    },
    {
        "module": 'Trial Registration',
        "title": 'How a company requests a YourComate trial',
        "content": """
            Trial application workflow:
            1. From the public login or registration entry point, choose the trial or demo registration option.
            2. Enter the requested company, contact, email, phone, employee estimate, and business details.
            3. Request and verify the email OTP.
            4. After OTP verification, the trial request becomes ready for Platform Super Admin review.
            5. Platform Super Admin reviews and approves or rejects the request.
            6. On approval, the platform creates the tenant and generated Admin login credentials.
            7. The credentials and onboarding information are sent through the configured email service.
            8. The current trial is intended as a 15-day full-access trial, subject to active platform configuration.
        """,
        "keywords": ['trial', 'demo registration', 'otp', 'trial request', '15 day', 'trial registration', 'how a company requests a yourcomate trial'],
        "requires_live_data": False,
    },
    {
        "module": 'Trial Requests',
        "title": 'How Platform Super Admin approves a trial',
        "content": """
            Trial approval workflow for Platform Super Admin:
            1. Open Trial Requests.
            2. Review OTP verification state and company/contact details.
            3. Approve or reject the request.
            4. Approval creates or activates the tenant and Admin login according to the trial setup service.
            5. Confirm that the credential email was sent; email failures should create an attention item instead of being silently ignored.
            6. The approved tenant receives the configured trial validity, employee limit, and module access.
            7. Duplicate or invalid requests should be handled without creating conflicting tenants or users.
        """,
        "keywords": ['approve trial', 'trial requests', 'otp verified', 'credential email', 'how platform super admin approves a trial'],
        "requires_live_data": False,
    },
    {
        "module": 'Trial Subscription',
        "title": 'How Saya should answer a trial or demo user',
        "content": """
            Trial-user guidance rules:
            1. Explain all enabled YourComate workflows according to the logged-in role.
            2. Use live trial start, end, and remaining-day values when they are provided.
            3. Explain Essential and Growth as direct paid-plan options using the latest active pricing-plan data.
            4. Explain Premium through the quotation-first Contact Sales workflow.
            5. Give factual benefits of relevant modules without inventing guarantees, discounts, awards, or customer claims.
            6. When the trial is near expiry, explain the available upgrade steps and consequences clearly.
            7. Do not claim that a payment or activation occurred unless the payment and subscription records confirm it.
        """,
        "keywords": ['demo user', 'trial user', 'upgrade trial', 'trial expiry', 'plan recommendation', 'trial subscription', 'how saya should answer a trial or demo user'],
        "requires_live_data": True,
    },
    {
        "module": 'Pricing Plans',
        "title": 'How Saya answers Essential and Growth pricing questions',
        "content": """
            Dynamic pricing answer rule:
            1. Essential and Growth prices are controlled by Platform Super Admin in the active pricing-plan records.
            2. Saya must read the latest active plan amount, billing interval, employee limit, and enabled features from live plan context.
            3. Saya must never rely on an amount written in static workflow knowledge.
            4. If live pricing is unavailable, Saya should say that the current price could not be retrieved and direct the user to Billing & Subscription or the sales team.
            5. When comparing plans, use only live plan facts and the currently configured feature/employee limits.
            6. Do not invent a discount or promotional price.
        """,
        "keywords": ['growth price', 'essential price', 'pricing', 'how much', 'plan cost', 'pricing plans', 'how saya answers essential and growth pricing questions'],
        "requires_live_data": True,
    },
    {
        "module": 'Essential Subscription',
        "title": 'How Essential direct subscription and renewal work',
        "content": """
            Essential subscription workflow:
            1. The tenant Admin selects Essential from the available paid plans.
            2. The current active Essential price and billing interval are loaded from platform pricing configuration.
            3. A Razorpay order is created for the live amount.
            4. The client completes payment through the connected checkout.
            5. The backend verifies the payment and activates or renews the subscription.
            6. The tenant receives the configured Essential employee limit and enabled modules.
            7. Renewal uses the latest active Platform Super Admin-set Essential price, not an old hard-coded amount.
            8. Billing & Subscription shows status, validity, payments, and invoice information.
        """,
        "keywords": ['essential plan', 'essential payment', 'essential renewal', 'razorpay', 'essential subscription', 'how essential direct subscription and renewal work'],
        "requires_live_data": True,
    },
    {
        "module": 'Growth Subscription',
        "title": 'How Growth direct subscription and renewal work',
        "content": """
            Growth subscription workflow:
            1. The tenant Admin selects Growth from Billing & Subscription or the applicable upgrade screen.
            2. The latest active Growth amount, billing interval, employee limit, and features are loaded from pricing-plan configuration.
            3. A Razorpay order is created for that live amount.
            4. The client completes payment.
            5. The backend verifies the payment and activates or renews Growth.
            6. The tenant's subscription, module access, validity, and employee limit are updated according to the active Growth plan.
            7. Growth renewal uses the latest active Platform Super Admin-set price.
            8. Saya must quote the price only from live plan context and should never invent a value.
        """,
        "keywords": ['growth plan', 'growth pricing', 'upgrade to growth', 'growth renewal', 'growth subscription', 'how growth direct subscription and renewal work'],
        "requires_live_data": True,
    },
    {
        "module": 'Premium Subscription',
        "title": 'Complete Premium quotation, payment, activation and renewal workflow',
        "content": """
            Premium is a quotation-first subscription:
            1. The prospect or tenant chooses Contact Sales or the Premium request option.
            2. The client submits company requirements, employee needs, billing preference, and contact details.
            3. Platform Super Admin opens Premium Requests and reviews the request.
            4. Platform Super Admin prepares and finalizes a custom quotation.
            5. The quotation and payment details are sent to the client panel and through configured communication channels.
            6. The client reviews the approved quotation before any Premium payment.
            7. Payment is made against the approved quotation amount.
            8. The backend verifies payment and activates Premium with the quoted terms and enabled modules.
            9. The approved custom amount becomes the authoritative Premium renewal amount for the chosen monthly or yearly interval unless a later approved quotation changes it.
            10. Premium must never use direct public-plan checkout before an approved quotation.
        """,
        "keywords": ['premium', 'custom quote', 'quotation', 'contact sales', 'premium payment', 'premium renewal', 'premium subscription', 'complete premium quotation, payment, activation and renewal workflow'],
        "requires_live_data": True,
    },
    {
        "module": 'Premium Requests',
        "title": 'How Platform Super Admin manages Premium requests',
        "content": """
            Premium request management:
            1. Open Premium Requests from the Platform Super Admin menu.
            2. Review company, contact, requirement, employee, module, and billing details.
            3. Contact the client where clarification is required.
            4. Prepare the custom monthly or yearly quotation.
            5. Finalize the quoted amount and terms.
            6. Send the quotation to the client panel and configured email channel.
            7. Monitor quotation state, payment details, payment verification, and conversion status.
            8. Activate Premium only after the quotation-linked payment is verified.
            9. Keep the finalized quote as the tenant's recurring Premium price source.
        """,
        "keywords": ['premium requests', 'send quotation', 'custom price', 'conversion status', 'how platform super admin manages premium requests'],
        "requires_live_data": False,
    },
    {
        "module": 'Billing & Subscription',
        "title": 'How a tenant Admin reviews and upgrades subscription',
        "content": """
            Tenant billing workflow:
            1. Log in as Tenant Admin and open Billing & Subscription.
            2. Review the active plan, status, employee usage/limit, remaining validity, renewal alerts, payment history, and available invoices.
            3. For Essential or Growth, select the plan and continue through direct Razorpay payment using the live plan price.
            4. For Premium, submit or review the Premium request and quotation; do not expect direct payment before quotation.
            5. After payment, refresh the billing state and confirm that the subscription status and validity were updated.
            6. Download available invoices or payment documents where supported.
            7. Contact Platform Support when payment succeeded but activation is not reflected.
        """,
        "keywords": ['billing', 'subscription', 'upgrade plan', 'payment history', 'invoice', 'billing & subscription', 'how a tenant admin reviews and upgrades subscription'],
        "requires_live_data": True,
    },
    {
        "module": 'Subscriptions & Payments',
        "title": 'How Platform Super Admin manages subscriptions and payments',
        "content": """
            Platform subscription administration:
            1. Open Subscriptions & Payments.
            2. Review trial tenants, paid tenants, subscription state, expiry, Razorpay orders, payment records, and current pricing plans.
            3. Update dynamic Essential and Growth pricing only through authorized plan controls.
            4. Inspect payment failures or mismatches before changing a tenant's status.
            5. Refresh expired trials and enforce the configured expiry behavior.
            6. Verify that paid activation uses a confirmed payment record.
            7. Preserve Premium's custom quotation as its price source.
            8. Use audit records and platform notifications for important changes and failures.
        """,
        "keywords": ['subscriptions payments', 'razorpay orders', 'pricing plans', 'expired trials', 'subscriptions & payments', 'how platform super admin manages subscriptions and payments'],
        "requires_live_data": False,
    },
    {
        "module": 'Subscription Expiry',
        "title": 'What happens when a trial or paid subscription expires',
        "content": """
            Expiry workflow:
            1. Reminder services can notify tenants before trial or subscription expiry.
            2. On expiry, the tenant can be marked expired, payment-required, suspended, or access-restricted according to the active SaaS guard.
            3. The user can be redirected to the expiry or Billing & Subscription page.
            4. Saya should use live expiry date, plan, amount, and payment state when explaining recovery steps.
            5. Essential and Growth renewal use the latest active plan price.
            6. Premium renewal uses the tenant's approved custom quotation amount and interval.
            7. Normal access resumes only after verified payment or an authorized Platform Super Admin status change.
        """,
        "keywords": ['expired subscription', 'trial expired', 'renew', 'payment required', 'suspended tenant', 'subscription expiry', 'what happens when a trial or paid subscription expires'],
        "requires_live_data": True,
    },
    {
        "module": 'Lifetime Tenant',
        "title": 'How lifetime tenant access should behave',
        "content": """
            Lifetime-tenant behavior:
            1. A lifetime tenant remains active without normal trial-expiry or recurring-payment pressure.
            2. The lifetime flag and enabled modules are authoritative.
            3. Saya should not show upgrade or expiry warnings merely because a generic trial field exists.
            4. Role, employee capability, tenant isolation, and backend module permissions still apply.
            5. Lifetime access does not remove privacy, audit, or workflow approval rules.
        """,
        "keywords": ['lifetime tenant', 'sds lifetime', 'no expiry', 'how lifetime tenant access should behave'],
        "requires_live_data": True,
    },
    {
        "module": 'Employee Limits',
        "title": 'How subscription employee limits work',
        "content": """
            Employee-limit workflow:
            1. The active plan supplies the configured employee limit, unless the tenant has an approved custom or lifetime rule.
            2. The platform compares active employee/login usage with the tenant limit.
            3. Warning notifications can be created as the tenant approaches the limit.
            4. Creation can be blocked when the limit is reached according to tenant guard rules.
            5. Resigned or inactive employee handling must follow the backend counting rule; Saya must not guess the available capacity.
            6. Saya should quote current usage and remaining capacity only from live tenant context.
            7. The tenant can upgrade to a higher plan or request Premium for custom/unlimited requirements.
        """,
        "keywords": ['employee limit', 'user limit', 'capacity', 'upgrade premium', 'employee limits', 'how subscription employee limits work'],
        "requires_live_data": True,
    },
    {
        "module": 'Companies / Tenants',
        "title": 'How Platform Super Admin manages companies and tenants',
        "content": """
            Company/Tenant administration:
            1. Open Companies / Tenants.
            2. Create or review a company record with tenant identity, contact, subscription, limits, and module configuration.
            3. Activate, suspend, or update the tenant only through authorized controls.
            4. Review tenant Admin and user associations before destructive changes.
            5. Ensure all tenant-specific records use the correct tenant ID.
            6. Important status and configuration changes should create audit and platform-notification records.
            7. Never combine employees or business records from different tenants.
        """,
        "keywords": ['companies tenants', 'create tenant', 'activate tenant', 'suspend tenant', 'companies / tenants', 'how platform super admin manages companies and tenants'],
        "requires_live_data": False,
    },
    {
        "module": 'User Control',
        "title": 'How Platform Super Admin manages tenant users',
        "content": """
            User Control workflow:
            1. Open User Control.
            2. Select the target tenant/company first.
            3. Review tenant users and filter by name, email, or designation.
            4. Create an employee/login user under the selected tenant where permitted.
            5. Reset a user's password as an administrative recovery action.
            6. Enable or disable a login according to account status requirements.
            7. Delete only when the backend and business rules permit deletion.
            8. Team Leader, Reporting Officer, and IT Support duties remain employee capabilities or mappings rather than separate unrestricted login roles.
            9. Every action must stay tenant-scoped and auditable.
        """,
        "keywords": ['user control', 'tenant users', 'reset password', 'disable user', 'delete user', 'how platform super admin manages tenant users'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Management',
        "title": 'Complete employee creation workflow',
        "content": """
            Create Employee workflow:
            1. An authorized Admin/HR user opens Employee Management and selects Create Employee.
            2. Enter personal, contact, employment, statutory, bank, and other required fields.
            3. Select Organisation/Entity, Department, Designation, and State from their tenant master records where available.
            4. Set employment type, job type, joining date, status, and reporting information.
            5. Enable Team Leader or Reporting Officer capability flags only when appropriate.
            6. Map the employee's Team Leader and Reporting Officer using eligible tenant employees.
            7. Do not assign a project from employee creation; project assignment happens later in Projects.
            8. Save the employee and create/link the login user according to the current employee service.
            9. Confirm that the employee appears in active Employee Master and can log in when enabled.
        """,
        "keywords": ['create employee', 'employee master', 'onboarding', 'team leader mapping', 'reporting officer mapping', 'employee management', 'complete employee creation workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Management',
        "title": 'How active employees, resignation and Alumni work',
        "content": """
            Employee lifecycle workflow:
            1. Employee Master shows active/current employees.
            2. HR/Admin can edit permitted employee information and status.
            3. When an active employee leaves, use the resignation/exit workflow and record exit type, date, reason, and other required details.
            4. The employee is separated from the active Employee Master and moved to Alumni according to the current service rules.
            5. HR/Admin can manually add a historical/past employee to Alumni without creating an active login account.
            6. Active employee and Alumni data can be exported separately as CSV where available.
            7. Restoring or reactivating an employee must update both employee and login state consistently.
            8. Do not delete historical employment records merely to remove an active login.
        """,
        "keywords": ['resign employee', 'alumni', 'past employee', 'employee exit', 'reactivate employee', 'employee management', 'how active employees, resignation and alumni work'],
        "requires_live_data": False,
    },
    {
        "module": 'Employee Directory',
        "title": 'How the tenant employee directory works',
        "content": """
            Employee Directory workflow:
            1. Open Employee Directory.
            2. View tenant-scoped employee contact cards or rows.
            3. Search or filter available employee records.
            4. Directory information can include name, designation, state, phone, email, and profile photo according to visibility rules.
            5. The directory must not expose employees from another tenant.
            6. Sensitive payroll, bank, tax, and private HR records are not directory information.
        """,
        "keywords": ['employee directory', 'contact', 'phone', 'designation', 'how the tenant employee directory works'],
        "requires_live_data": False,
    },
    {
        "module": 'Organisation / Entity Master',
        "title": 'How organisation and legal-entity mapping work',
        "content": """
            Organisation/Entity workflow:
            1. HR/Admin opens Organisation / Entity Master.
            2. Create the tenant's organisation, branch, operating entity, or legal entity record required by the company structure.
            3. Use the record in Employee Management when mapping employees.
            4. Entity mapping can be used in attendance exports and reports.
            5. Update or deactivate records carefully when employees are already linked.
            6. Entity records remain tenant-scoped.
        """,
        "keywords": ['organisation master', 'entity master', 'legal entity', 'employee entity', 'organisation / entity master', 'how organisation and legal-entity mapping work'],
        "requires_live_data": False,
    },
    {
        "module": 'Departments',
        "title": 'How Department Master works',
        "content": """
            Department Master workflow:
            1. HR/Admin opens Departments.
            2. Create the department records used by the tenant.
            3. Select those records while creating or updating employees.
            4. Department data is used in employee filters, reports, projects, IT routing, and other scoped workflows.
            5. Avoid deleting a department that is still referenced; update or reassign linked employees first.
        """,
        "keywords": ['department master', 'create department', 'employee department', 'departments', 'how department master works'],
        "requires_live_data": False,
    },
    {
        "module": 'Designations',
        "title": 'How Designation Master works',
        "content": """
            Designation Master workflow:
            1. HR/Admin opens Designations.
            2. Create tenant-specific designation names.
            3. Use the designation in Employee Management and User Control filters.
            4. Reporting Officer eligibility uses designation keywords such as Manager, Managing Director, Director, CEO, or Chief Executive Officer in the current UI rule.
            5. A designation does not grant a login role or permission by itself.
            6. Reassign linked employees before removing a designation that is in use.
        """,
        "keywords": ['designation master', 'create designation', 'manager designation', 'reporting officer eligibility', 'designations', 'how designation master works'],
        "requires_live_data": False,
    },
    {
        "module": 'States',
        "title": 'How State Master and state-wise holidays work',
        "content": """
            State Master workflow:
            1. HR/Admin opens States.
            2. Add the tenant's operating states.
            3. Map employees to a state in Employee Management.
            4. Create state-specific holidays in Holiday Calendar.
            5. Attendance and reports use the employee/state mapping to determine applicable holidays and filters.
            6. State records remain tenant-scoped.
        """,
        "keywords": ['state master', 'operating state', 'state holiday', 'states', 'how state master and state-wise holidays work'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance',
        "title": 'How Field attendance captures visit evidence',
        "content": """
            Field attendance workflow:
            1. Choose Field mode or use an approved Field request according to the current control.
            2. Enter the visit place and required field details.
            3. Allow location access when required.
            4. Capture or upload the field photo according to the attendance form.
            5. Submit Check In with the location, place, and photo evidence.
            6. Complete Check Out at the end of field work.
            7. Authorized Team Leader, Reporting Officer, HR, or Admin users can review team field attendance, photo, and location map within scope.
        """,
        "keywords": ['field attendance', 'field photo', 'visit place', 'location map', 'attendance', 'how field attendance captures visit evidence'],
        "requires_live_data": False,
    },
    {
        "module": 'Holiday Work Requests',
        "title": 'How to request work on a holiday',
        "content": """
            Holiday Work Request workflow:
            1. Open Holiday Work Requests before the holiday-work date.
            2. Select the Sunday, second Saturday, fourth Saturday, or HR-created holiday date.
            3. Enter the work reason and other required details.
            4. Submit the request.
            5. The request follows Team Leader, Reporting Officer, or HR fallback approval according to employee mapping.
            6. Only an approved request makes the employee eligible to mark holiday attendance.
            7. Track the live approval stage and decision in Application Status.
            8. Approved request alone is not the final comp-off credit; eligible attendance must also be completed.
        """,
        "keywords": ['holiday work request', 'work sunday', 'work holiday', 'approve holiday attendance', 'holiday work requests', 'how to request work on a holiday'],
        "requires_live_data": False,
    },
    {
        "module": 'Team Field Tracking',
        "title": 'How authorized users review field attendance',
        "content": """
            Team Field Tracking workflow:
            1. Open Team Field Tracking.
            2. View only employees within the user's mapped team or authorized HR/Admin scope.
            3. Filter or select the relevant date/employee where available.
            4. Review visit place, check-in/check-out, field photo, and captured location map.
            5. Use the evidence for operational review, not for unauthorized surveillance or cross-tenant access.
            6. If a record is missing, verify the employee's approved mode and completed attendance before assuming a system error.
        """,
        "keywords": ['team field tracking', 'field team', 'location map', 'field photo', 'how authorized users review field attendance'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance Logs',
        "title": 'How attendance logs are reviewed',
        "content": """
            Attendance Logs workflow:
            1. Authorized HR/Admin or mapped attendance-management users open Attendance Logs.
            2. Review system-generated check-in, check-out, attendance mode, late entry, location, and related record details.
            3. Filter by the available date, employee, department, entity, state, or status controls.
            4. Treat the log as a system record and use the connected correction/approval process rather than silently changing finalized data.
            5. Export through Reports where an audited export is required.
        """,
        "keywords": ['attendance logs', 'check in logs', 'late logs', 'attendance correction', 'how attendance logs are reviewed'],
        "requires_live_data": False,
    },
    {
        "module": 'Attendance Correction',
        "title": 'How attendance correction should be handled',
        "content": """
            Attendance correction guidance:
            1. Identify the exact employee and attendance date.
            2. Review the existing check-in, check-out, mode, late reason, approval history, and holiday status.
            3. Use only the authorized attendance-correction workflow available to the user's role.
            4. Record the correction reason and actor for auditability.
            5. Do not modify another tenant's record or bypass an approval requirement.
            6. Recalculate dependent reports or payroll attendance only through the connected synchronization process.
        """,
        "keywords": ['attendance correction', 'wrong check in', 'missing checkout', 'fix attendance', 'how attendance correction should be handled'],
        "requires_live_data": True,
    },
    {
        "module": 'Leave',
        "title": 'How LWP affects leave and payroll',
        "content": """
            Leave Without Pay workflow:
            1. LWP is used when an approved unpaid leave component applies or when the configured leave policy converts insufficient paid balance to LWP.
            2. Paid approved leave does not reduce payroll payable days as LWP.
            3. Only the LWP portion reduces payable days in payroll attendance calculation.
            4. Partial or half-day LWP is represented proportionally.
            5. Payroll uses the configured fixed-30-day or calendar-day policy for the selected tenant/rule.
            6. Joining mid-month can create a warning or proration context but must not be guessed by Saya.
            7. The final LWP amount must come from synchronized attendance/leave data and the current salary calculation.
        """,
        "keywords": ['lwp', 'leave without pay', 'payable days', 'half day lwp', 'leave', 'how lwp affects leave and payroll'],
        "requires_live_data": True,
    },
    {
        "module": 'Performance',
        "title": 'Complete weekly performance review workflow',
        "content": """
            Performance workflow:
            1. The Performance page is available to Team Leader and Reporting Officer capability users.
            2. A Team Leader can submit a weekly performance rating only for mapped team members.
            3. A Reporting Officer can submit weekly ratings for mapped Team Leaders or reporting members according to the hierarchy.
            4. HR/Admin users do not submit employee ratings from this module merely because they have HR access.
            5. The reviewer selects the eligible employee and week, enters the rating and available comments/criteria, and submits.
            6. Monthly and yearly graphs are generated from weekly review records.
            7. Users must not rate employees outside their mapped scope.
        """,
        "keywords": ['performance', 'weekly rating', 'monthly graph', 'yearly performance', 'team rating', 'complete weekly performance review workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Notifications',
        "title": 'How tenant, team and platform notifications work',
        "content": """
            Notification workflow:
            1. Tenant HR/Admin can create notifications for users inside their tenant.
            2. Authorized Team Leader or Reporting Officer users can create team-scoped notifications where enabled.
            3. Platform Super Admin can create a global notification for all tenants or target one selected tenant.
            4. Targeting can include tenant, department, team, or selected users according to the available form and permission.
            5. Notifications appear in the notification bell, notification center, and dashboard popup where implemented.
            6. When Firebase permission and a valid device token are available, the system can also send a device notification.
            7. A tenant notification must never reach another tenant unless Platform Super Admin intentionally uses the global target.
        """,
        "keywords": ['notifications', 'push notification', 'firebase', 'notify team', 'global notification', 'how tenant, team and platform notifications work'],
        "requires_live_data": False,
    },
    {
        "module": 'Platform Notifications',
        "title": 'Which events require Platform Super Admin attention',
        "content": """
            Platform attention events can include:
            1. New or OTP-verified trial applications.
            2. Trial approval, tenant creation, or credential-email failure.
            3. New Premium requests, quotation delivery failure, or payment-link problems.
            4. Razorpay order creation, successful payment, failed payment, or verification mismatch.
            5. Subscription renewal reminders, expiry, suspension, and activation.
            6. Tenant configuration or status changes.
            7. Employee-limit warnings.
            8. Escalated major IT issues.
            9. Other platform errors requiring action.
            Platform notifications should remain distinct from ordinary tenant employee announcements.
        """,
        "keywords": ['platform notifications', 'trial alert', 'payment failure', 'employee limit warning', 'which events require platform super admin attention'],
        "requires_live_data": False,
    },
    {
        "module": 'Management Group',
        "title": 'Complete management group membership and meeting workflow',
        "content": """
            Management Group workflow:
            1. Authorized tenant management users create or maintain the Management Group.
            2. Add eligible tenant members.
            3. Schedule a meeting with date, time, agenda, and other available details.
            4. Assign one group member as the minutes writer.
            5. Notify relevant members about the meeting and minutes responsibility.
            6. The assigned writer records and updates meeting minutes.
            7. Authorized users can search and review minutes history.
            8. Membership, meetings, and minutes remain tenant-scoped.
        """,
        "keywords": ['management group', 'meeting', 'minutes writer', 'meeting minutes', 'complete management group membership and meeting workflow'],
        "requires_live_data": False,
    },
    {
        "module": 'Celebrations',
        "title": 'How birthday and work-anniversary celebrations appear',
        "content": """
            Celebrations workflow:
            1. The dashboard can show birthday or work-anniversary information derived from tenant employee records.
            2. Only active and eligible tenant employees should appear according to the current date and data rules.
            3. Profile photo and employee information come from the linked employee record.
            4. Celebration data is informational and must not expose another tenant.
            5. When no celebration is available, Saya should say that no accessible celebration record was found rather than inventing one.
        """,
        "keywords": ['celebrations', 'birthday', 'work anniversary', 'how birthday and work-anniversary celebrations appear'],
        "requires_live_data": True,
    },
    {
        "module": 'Policies',
        "title": 'How HR policies are uploaded and accessed',
        "content": """
            Policy workflow:
            1. Authorized HR/Admin users open Policies.
            2. Upload or create the policy record with title, category, description, file, and other required fields.
            3. Publish it to the tenant's employees according to the available visibility settings.
            4. Employees open Policies and download or read permitted documents.
            5. Updated or replaced policies should preserve audit/history behavior where implemented.
            6. Policy files remain tenant-scoped.
        """,
        "keywords": ['policies', 'upload policy', 'download policy', 'hr policy', 'how hr policies are uploaded and accessed'],
        "requires_live_data": False,
    },
    {
        "module": 'Audit Logs',
        "title": 'How audit logs should be used',
        "content": """
            Audit Log workflow:
            1. Authorized Platform Super Admin or Tenant Admin opens Audit Logs.
            2. Search or filter recorded actions by the available actor, module, date, tenant, action, or status fields.
            3. Review who performed the action, when it occurred, and the affected record information supplied by the audit event.
            4. Use audit logs for investigation and accountability; do not edit them as ordinary business records.
            5. Tenant Admin remains limited to tenant-scoped logs, while Platform Super Admin follows explicit cross-tenant selection rules.
        """,
        "keywords": ['audit logs', 'who changed', 'action history', 'trace action', 'how audit logs should be used'],
        "requires_live_data": False,
    },
    {
        "module": 'System Settings',
        "title": 'How system and tenant settings should be managed',
        "content": """
            Settings workflow:
            1. Open System Settings only with an authorized Admin or Platform Super Admin role.
            2. Review whether the setting is platform-wide or tenant-specific before changing it.
            3. Update the available rule, feature, branding, attendance, payroll, notification, or other supported setting.
            4. Validate the value and save through the connected backend endpoint.
            5. Record important changes for audit and notification where implemented.
            6. Saya should explain a setting but must not invent an unsupported key or claim it was saved without API confirmation.
        """,
        "keywords": ['system settings', 'rule engine', 'tenant settings', 'configuration', 'how system and tenant settings should be managed'],
        "requires_live_data": False,
    },
    {
        "module": 'Tenant Branding',
        "title": 'How a tenant Admin updates company branding',
        "content": """
            Tenant branding workflow:
            1. Log in as an authorized tenant Admin.
            2. Open the tenant settings/profile area that contains company branding.
            3. Upload the supported company logo and update the company name where permitted.
            4. Save the branding information.
            5. The logo and company name are displayed on the tenant Admin and employee dashboards according to the current frontend integration.
            6. Branding is tenant-scoped and must not overwrite another company's branding.
        """,
        "keywords": ['company logo', 'tenant branding', 'company name', 'dashboard logo', 'how a tenant admin updates company branding'],
        "requires_live_data": False,
    },
{
    "module": 'Recruitment',
    "title": 'Complete recruitment journey from hiring request to onboarding',
    "content": """
        YourComate Recruitment follows one controlled journey:
        1. An authorized HR user or a Team Leader creates a Hiring Request. A Team Leader can create it only for the department assigned to their employee profile, and that department remains locked.
        2. The request is saved as Draft until complete and is then submitted for final hiring-requirement approval.
        3. Final approval belongs to an authorized Admin, Managing Director, or a user with an explicit final-hiring-approval capability. The requester cannot approve their own request.
        4. Approval of the requirement does not itself publish a vacancy. After final approval, authorized HR creates the Job Opening, reviews the public wording, and publishes it.
        5. Candidates can apply through the tenant's public Career Page or through authorized internal entry. The application is always linked to the correct tenant and job opening.
        6. On the public Career Page, the candidate can upload a supported resume for temporary preview. The parser proposes available details and an indicative job-match score before the final application is submitted.
        7. The candidate reviews and corrects extracted fields before submission. Resume preview alone does not create a candidate or application.
        8. HR reviews the submitted application, checks duplicates, verifies resume information, and records factual job-related screening notes.
        9. A Team Leader sees candidate information only for jobs where they are the hiring manager, panel member, or assigned interviewer. Unrelated candidates remain hidden.
        10. HR schedules interview rounds, and each assigned interviewer submits their own structured feedback.
        11. HR and authorized hiring participants record the selection decision using completed interview evidence. The resume-match score is decision support only and cannot automatically shortlist, reject, select, or hire a candidate.
        12. Salary and employment terms follow the configured approval process before the offer is sent.
        13. The candidate accepts or declines through the secure offer-response flow before the offer expiry date.
        14. After acceptance, HR collects and verifies required joining documents and completes approved background or reference checks.
        15. The application becomes Ready to Join only when configured joining requirements are complete.
        16. After the person actually reports for duty, HR converts the candidate to an employee and starts the connected employee, login, salary, attendance, leave, asset, and onboarding setup.
        17. The tenant-scoped recruitment history remains available after conversion for authorized future review.
    """,
    "keywords": ['recruitment workflow', 'hiring process', 'final hiring approval', 'admin approval', 'managing director approval', 'hr publish job', 'career page resume preview', 'resume match score', 'team leader candidate access', 'vacancy to employee', 'complete recruitment journey from hiring request to onboarding'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment',
    "title": 'Who can use Recruitment and what each role can do',
    "content": """
        Recruitment responsibility and access guidance:
        1. Authorized HR owns day-to-day recruitment operations, candidate communication, screening, interviews, offers, joining work, and employee conversion within the current tenant.
        2. HR/Recruiter can create cross-department hiring requests according to permission, but a job opening can be created and published only after final hiring-requirement approval.
        3. A Team Leader can create, save, and submit a hiring request only for the department assigned to their employee profile. The department is auto-selected and locked.
        4. A Team Leader can track their request and participate in candidate review or interviews only for jobs where they are the hiring manager, panel member, or assigned interviewer.
        5. A Team Leader cannot approve, reject, place On Hold, or return their own hiring request. They also cannot browse unrelated jobs or candidates.
        6. Final hiring-requirement approval belongs to an authorized Admin, Managing Director, or a user with an explicit capability such as recruitment_final_approval, approve_hiring_request, or approve_hiring_requirements.
        7. An Admin or Managing Director who provides final requirement approval does not automatically become an HR publisher. Job creation and publication remain restricted to authorized HR roles unless the same account separately has that HR authority.
        8. An assigned Interviewer sees only information needed for the assigned interview and submits their own feedback.
        9. Finance/Accounts reviews salary or hiring budget only when the tenant's configured workflow requires it.
        10. Tenant Admin controls Recruitment access and settings but must still follow candidate privacy and tenant-isolation rules.
        11. A Candidate can access only the public job, application, secure offer-response, and secure joining-document actions intended for that candidate.
        12. Platform Super Admin supports service operation and tenant configuration but does not routinely make a tenant's hiring decisions or browse private candidate records without an authorized support reason.
        13. Backend role, capability, employee assignment, job assignment, department, ownership, approver, and tenant checks are authoritative; a visible button alone does not grant permission.
    """,
    "keywords": ['recruitment roles', 'team leader candidate access', 'assigned hiring manager', 'final hiring approver', 'admin recruitment approval', 'managing director recruitment approval', 'hr publisher', 'interviewer access', 'recruitment permission', 'who can use recruitment and what each role can do'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment - Hiring Requests',
    "title": 'How to create and approve a hiring request',
    "content": """
        Hiring Request workflow:
        1. Open Recruitment and choose Hiring Requests.
        2. Authorized HR users can create requests across departments according to tenant permission.
        3. A Team Leader can create a request only for the department assigned to their employee profile. The system auto-selects and locks that department and records the Team Leader as requester and hiring manager.
        4. If the Team Leader has no assigned department, HR or Admin must correct the employee profile before the Team Leader creates a request.
        5. Enter the job title, vacancy count, work location, employment type, business reason, expected joining date, required experience, skills, qualification, and permitted salary range or budget.
        6. Save as Draft while information is incomplete. A Team Leader can edit and submit only their own departmental request.
        7. Submit the completed request. Its status becomes Submitted and it is routed for final approval.
        8. Final approval is performed by an authorized Admin, Managing Director, or user with an explicit final-hiring-approval capability.
        9. The final approver reviews the business need, headcount, budget, department, required date, and role details.
        10. The final approver can Approve, Reject, place On Hold, or return it for correction according to available controls. The requester cannot decide their own request.
        11. Rejection, hold, or correction should include a clear reason visible to the requester.
        12. After approval, authorized HR is notified and can create the Job Opening. Approval alone does not publish the vacancy.
        13. Only authorized HR roles create and publish the job after final approval.
        14. Material changes to approved headcount, department, role, or salary range must follow the permitted revision or approval process.
        15. Saya must use live context before stating whether a specific request is Draft, Submitted, Approved, Rejected, On Hold, Returned, or Closed.
    """,
    "keywords": ['hiring request', 'final hiring approval', 'admin approve hiring request', 'managing director approve hiring request', 'team leader hiring request', 'department locked', 'self approval blocked', 'hr creates job after approval', 'how to create and approve a hiring request'],
    "requires_live_data": True,
},
{
    "module": 'Recruitment - Hiring Requests',
    "title": 'How a Team Leader raises a departmental hiring request',
    "content": """
        Team Leader departmental hiring-request workflow:
        1. Log in with an employee account that has the Team Leader capability and open Recruitment, then Hiring Requests.
        2. Choose New Hiring Request. The department comes from the Team Leader's employee profile and remains read-only.
        3. The Team Leader cannot replace the department name or identifier with another department.
        4. Enter the required role, vacancy count, reason, skills, experience, qualification, work arrangement, budget information, and expected joining date.
        5. Save the request as Draft when more information is required, or submit it when complete.
        6. The Team Leader can edit and submit only a request created by themselves for their assigned department.
        7. On submission, the request goes to an authorized Admin, Managing Director, or explicitly configured final hiring approver.
        8. The Team Leader can monitor the request status and decision reason but cannot approve, reject, hold, or return their own request.
        9. After final approval, authorized HR creates and publishes the job opening.
        10. For the resulting job, the Team Leader can see candidate applications only when assigned as hiring manager, panel member, or interviewer.
        11. The Team Leader must not receive unrestricted salary, home-address, consent-IP, raw-parser, offer-approval, identity-document, or background-check information.
        12. Backend department, ownership, approver, capability, job-assignment, and tenant checks remain authoritative.
    """,
    "keywords": ['team leader hiring request', 'team leader vacancy', 'departmental manpower request', 'own department recruitment', 'team leader cannot approve own request', 'admin final approval', 'managing director final approval', 'team leader assigned candidates'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment - Job Openings',
    "title": 'How to create, publish, pause and close a job opening',
    "content": """
        Job Opening workflow:
        1. Confirm that the linked Hiring Request has completed final approval.
        2. An authorized HR user opens the Approved request and chooses Create Job Opening.
        3. Add the public job title, description, responsibilities, qualification, required skills, experience, location, employment type, HR owner, hiring manager, planned interview rounds, opening date, closing date, and permitted public details.
        4. Review the wording for accuracy, fairness, and relevance to the actual job.
        5. Save the opening as Draft while HR reviews it.
        6. Only authorized HR roles publish or change the public vacancy status. Final requirement approvers do not automatically receive HR publishing authority.
        7. Publish through enabled channels such as the company Career Page, referrals, social media, portals, agencies, or internal circulation.
        8. Confidential budget, internal approval notes, salary-review comments, and private candidate data must not appear on the public vacancy.
        9. Pause the opening when applications should temporarily stop, reopen it when approved, close it after recruitment is completed, or cancel it when the requirement is withdrawn.
        10. Job Opening statuses are Draft, Open, Paused, Closed, and Cancelled.
        11. A public application and resume preview must always resolve to the correct tenant and published job opening.
        12. Saya must use live context before stating whether a particular vacancy is Draft, Open, Paused, Closed, or Cancelled.
    """,
    "keywords": ['job opening', 'hr create job after approval', 'hr publish vacancy', 'admin approval then hr publish', 'career page job', 'pause recruitment', 'close vacancy', 'how to create, publish, pause and close a job opening'],
    "requires_live_data": True,
},
{
    "module": 'Recruitment - Resume Parser',
    "title": 'How the resume parser should be used',
    "content": """
        Resume Parser workflow:
        1. Internally, authorized HR can open Recruitment, choose Candidates, and start Add Candidate or Parse Resume.
        2. Publicly, a candidate can select a supported resume while applying on the company's Career Page.
        3. Supported PDF, DOCX, or TXT files must remain within the tenant's configured file-size limit.
        4. The parser extracts available text and proposes fields such as name, email, phone, location, links, summary, designation, employer, experience, skills, education, employment history, certifications, and languages.
        5. Text-based PDF and DOCX files are supported; image-only scanned resumes may require manual entry unless OCR support is added separately.
        6. On the public Career Page, the temporary preview does not save the resume, create a candidate, or create an application.
        7. The candidate reviews and corrects the extracted fields before submitting the final application.
        8. Existing values already entered by the candidate should not be silently overwritten when a resume preview is returned.
        9. Internally, HR must review and correct every important extracted value before relying on it.
        10. The system checks likely tenant-scoped duplicates using identifiers such as email, phone, file hash, and existing applications where supported.
        11. The parser result is a suggestion, not a verified fact and not an automatic hiring decision.
        12. Resume information must not be sent to an external AI provider unless the company has explicitly enabled and approved that processing.
        13. Parsing alone does not approve, reject, shortlist, select, schedule, offer, join, or convert anyone.
    """,
    "keywords": ['resume parser', 'public resume preview', 'career page auto fill', 'parse cv before applying', 'upload resume', 'extract resume fields', 'pdf resume', 'docx resume', 'how the resume parser should be used'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment - Candidates',
    "title": 'How candidate profiles and applications are managed',
    "content": """
        Candidate and application workflow:
        1. A Candidate profile stores the person's core contact and professional information inside one tenant.
        2. Each job applied for creates a separate Application linked to that candidate and job opening.
        3. One candidate can apply for more than one job while each application keeps its own status, match result, interviews, offer, joining work, and history.
        4. HR reviews the resume, verifies candidate interest, checks duplicates, and records factual job-related screening notes.
        5. HR can move the application through Applied, Under Review, Shortlisted, Interview Scheduled, Interviewed, Selected, Rejected, or Withdrawn only through valid transitions.
        6. The indicative resume-match result belongs to the application, not the candidate profile, because suitability can differ by job.
        7. A Team Leader can view candidate applications only for jobs where they are the assigned hiring manager, panel member, or interviewer.
        8. A Team Leader must not see unrelated candidates and should receive redacted information that excludes unrestricted salary, home address, consent IP, raw parser text, sensitive joining documents, and verification results.
        9. A rejected or withdrawn application should retain its reason and activity history where policy requires it.
        10. Duplicate application checks prevent the same candidate from being added repeatedly to the same opening.
        11. Candidate statements and uploaded documents must not be silently changed; corrections should be explicit and auditable.
        12. Candidate selection must use job-related criteria and recorded human evidence, not unrelated personal characteristics or an automated score alone.
        13. Candidate data remains tenant-scoped and accessible only to permitted users.
    """,
    "keywords": ['candidate profile', 'candidate application', 'team leader assigned candidates', 'hiring manager candidate access', 'candidate redaction', 'application resume match', 'shortlist candidate', 'screening', 'candidate status', 'how candidate profiles and applications are managed'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment - Public Career Page',
    "title": 'How public resume preview and application submission work',
    "content": """
        Public Career Page application workflow:
        1. Open the company's Career Page and select a published job.
        2. Review the public job description, responsibilities, qualification, required skills, experience, employment type, location, and closing information.
        3. Choose Apply and select a supported resume.
        4. The Career Page temporarily uploads the resume for parsing and returns proposed application fields and an indicative job-match result.
        5. Resume preview does not save the resume, create a candidate, or create an application.
        6. The candidate reviews and corrects the extracted name, email, phone, location, designation, employer, experience, notice period, salary expectation, LinkedIn, portfolio, and other visible fields.
        7. Candidate-entered values should not be silently replaced by empty or lower-confidence parser values.
        8. The candidate reviews the match explanation and the mandatory human-review notice.
        9. The candidate accepts the required consent statement and submits the final application.
        10. Only final submission saves the resume and creates or links the tenant-scoped candidate and application.
        11. The success screen shows the application reference and may show the indicative match result, but it must not promise selection, interview, or employment.
        12. Public offer response and joining-document links remain separate secure token-based actions.
    """,
    "keywords": ['public career page', 'resume auto fill', 'resume preview before apply', 'career application', 'application reference', 'public job application', 'how public resume preview and application submission work'],
    "requires_live_data": False,
},
{
    "module": 'Recruitment - Resume Match',
    "title": 'How the indicative resume-match score should be interpreted',
    "content": """
        Resume-match guidance:
        1. The match result compares available job-related evidence with the requirements of one specific job opening.
        2. The current explainable components are required skills, required experience, required qualification, and role-related resume evidence where those requirements are available.
        3. The result can show an overall percentage, component scores, matched skills, missing or unverified skills, profile completeness, strengths, and manual-review notes.
        4. The result is stored on the Application because the same candidate may receive different results for different jobs.
        5. The score excludes protected or unrelated personal attributes such as age, gender, religion, caste, marital status, disability, photograph, and home address.
        6. A zero-year fresher profile must remain a valid experience value when the job accepts freshers.
        7. Experience above a configured maximum is not automatically treated as a negative match.
        8. Missing resume evidence may reduce confidence, but it does not prove the candidate lacks the skill or qualification.
        9. The score is decision support only. It cannot automatically shortlist, reject, select, approve, offer, or hire a candidate.
        10. HR and assigned hiring participants must review the resume, corrected application fields, interview evidence, and job requirements before deciding.
        11. Saya must not describe the score as an AI hiring decision, ranking guarantee, verified credential, or prediction of job performance.
        12. Saya must fetch live application data before quoting a specific candidate's current score, band, matched skills, or component values.
    """,
    "keywords": ['resume match score', 'job match percentage', 'skills score', 'experience score', 'qualification score', 'role evidence score', 'human review required', 'automatic hiring decision prohibited', 'how the indicative resume-match score should be interpreted'],
    "requires_live_data": True,
},
{
    "module": 'Recruitment - Interface Guidance',
    "title": 'How Recruitment alerts and page transitions should be understood',
    "content": """
        Recruitment interface guidance:
        1. The internal Recruitment module and public Career Page use visual transitions when changing sections or opening another public page.
        2. A progress line, brief page-change message, fade, or movement animation is interface feedback only; it does not confirm that a backend action succeeded.
        3. Success alerts can confirm completed actions such as request creation, request submission, final approval, job publication, screening updates, interview scheduling, offer actions, joining-document review, resume extraction, or public application submission.
        4. Warning alerts explain incomplete data, manual review, restricted access, or a non-blocking parser concern.
        5. Error alerts explain failed API actions, parsing failures, validation problems, upload failures, or insufficient permission.
        6. The user should read the alert message and verify the resulting status or record before continuing.
        7. Dismissing a toast removes only the message; it does not undo the completed action.
        8. Reduced-motion device preferences should minimize non-essential animation without removing status information.
        9. Saya must not treat a visual animation, button state, or toast alone as proof of a live record status when live backend confirmation is required.
    """,
    "keywords": ['recruitment alert message', 'recruitment toast', 'career page alert', 'page transition', 'progress line', 'resume extraction alert', 'recruitment interface guidance', 'how recruitment alerts and page transitions should be understood'],
    "requires_live_data": False,
},
    {
        "module": 'Recruitment - Interviews',
        "title": 'How to schedule interviews and collect feedback',
        "content": """
            Interview workflow:
            1. Open the candidate's application and choose Schedule Interview.
            2. Select the interview round, date, time, mode, location or meeting information, and assigned interviewer or interview panel.
            3. Send the invitation to the candidate and assigned interviewers using the enabled communication channel.
            4. When timing changes, reschedule inside the same interview record so the history is retained.
            5. After completion, each assigned interviewer submits their own structured feedback.
            6. Recommended evaluation areas include role knowledge, relevant experience, communication, problem solving, work approach, written evidence, and a final recommendation such as Strong Hire, Hire, Hold, or Reject.
            7. Feedback should include factual comments supporting the rating.
            8. Another user must not silently rewrite an interviewer's feedback; corrections should be made by the original submitter or recorded as an authorized revision.
            9. HR follows up on missing feedback before recording the final selection.
            10. Candidate resumes and personal details are shared only with users involved in the interview.
        """,
        "keywords": ['schedule interview', 'interview feedback', 'interview round', 'interviewer', 'reschedule interview', 'how to schedule interviews and collect feedback'],
        "requires_live_data": False,
    },
    {
        "module": 'Recruitment - Offers',
        "title": 'How salary approval, offer creation and candidate response work',
        "content": """
            Offer workflow:
            1. After selection, HR enters the proposed designation, department, reporting manager, location, employment type, salary, joining date, probation, and other permitted employment terms.
            2. Salary or offer details are sent through the configured approver route before any commitment is made to the candidate.
            3. HR prepares the offer from the tenant's approved template only after the required approval.
            4. Verify candidate name, designation, salary details, joining date, expiry date, and terms before sending.
            5. Offer statuses are Draft, Approval Pending, Approved where represented, Sent, Accepted, Declined, Expired, and Withdrawn.
            6. A Draft or Approval Pending offer cannot be sent through the official flow.
            7. The candidate responds through the secure offer-response link or permitted candidate portal action.
            8. An updated offer must preserve the previous version and obtain the required approval again when terms materially change.
            9. HR should not make an unofficial salary promise outside the approved process.
            10. Saya must use live offer context before stating whether a specific offer is approved, sent, accepted, declined, or expired.
        """,
        "keywords": ['salary approval', 'prepare offer', 'send offer', 'accept offer', 'decline offer', 'offer expiry', 'how salary approval, offer creation and candidate response work'],
        "requires_live_data": True,
    },
    {
        "module": 'Recruitment - Joining',
        "title": 'How pre-joining documents and background checks work',
        "content": """
            Pre-joining workflow:
            1. An Accepted offer starts the pre-joining process and issues the secure candidate joining access used by the current implementation.
            2. HR sends the tenant's required document checklist.
            3. The candidate uploads only the requested documents through the secure joining flow.
            4. HR reviews each document and marks it using the available result such as Received, Accepted, Rejected, or Needs Correction.
            5. Missing or incorrect items are returned with a clear correction message.
            6. Where company policy requires it, HR starts approved background, employment, education, identity, or reference checks after obtaining required consent.
            7. Verification results can be Clear, Pending, Clarification Required, or Not Clear according to the available workflow.
            8. Candidate documents, identity information, salary data, and verification results are confidential and tenant-scoped.
            9. The application becomes Ready to Join only when the configured required documents and checks are complete.
            10. Joining statuses include Documents Pending, Ready to Join, Joined, Did Not Join, and Joining Deferred.
        """,
        "keywords": ['joining documents', 'background check', 'reference check', 'ready to join', 'pre joining', 'document verification', 'how pre-joining documents and background checks work'],
        "requires_live_data": True,
    },
    {
        "module": 'Recruitment - Employee Conversion',
        "title": 'How to convert a joined candidate into an employee',
        "content": """
            Candidate-to-employee conversion workflow:
            1. Confirm that the official offer is Accepted, the final joining date is correct, and the application satisfies the configured Ready to Join conditions.
            2. Confirm that the person has actually reported for duty; do not mark Joined merely because the offer was accepted.
            3. Open the application and choose Convert to Employee.
            4. Review the approved information that will move into the employee record, including name, contact details, department, designation, location, reporting manager, employment type, joining date, probation, and permitted verified information.
            5. Confirm or generate the employee ID according to the tenant's employee sequence.
            6. The system creates the employee record and, where selected and permitted, the employee login account and onboarding tasks.
            7. Start or complete the connected salary setup, attendance, leave, asset, and onboarding processes using their respective modules and permissions.
            8. Validate the tenant's SaaS employee limit before account creation or activation when the subscription enforces a limit.
            9. Mark the recruitment application Joined only after successful conversion and actual reporting.
            10. The recruitment application and activity history remain linked for authorized future reference, and conversion should not create the same employee twice.
        """,
        "keywords": ['convert candidate', 'create employee from candidate', 'candidate joined', 'employee onboarding', 'recruitment conversion', 'how to convert a joined candidate into an employee'],
        "requires_live_data": True,
    },
{
    "module": 'Recruitment - Privacy',
    "title": 'How multi-company separation and candidate privacy work',
    "content": """
        Recruitment privacy rules:
        1. Every hiring request, opening, candidate, application, resume match, interview, feedback record, offer, document, check, setting, report, and activity entry belongs to one tenant/company.
        2. Company A must never see Company B's recruitment records through screens, direct links, searches, reports, exports, downloads, public tokens, or API requests.
        3. Tenant separation is enforced by backend queries and permission checks, not only by hiding UI controls.
        4. The same person may apply to different companies, but each tenant sees only the application and communication made to that tenant.
        5. A Team Leader sees candidate records only for assigned jobs and receives only the information necessary for hiring participation.
        6. Interviewers receive only the candidate and interview information required for their assigned work.
        7. Current or expected salary, home address, consent IP, raw parser text, identity documents, bank information, offer approval notes, and verification results require narrower access than ordinary screening information.
        8. Resume matching must exclude protected or unrelated personal attributes such as age, gender, religion, caste, marital status, disability, photograph, and home address.
        9. Collect only information needed for recruitment and joining, record consent where required, and follow the tenant's retention and deletion policy.
        10. Rejection and screening notes must remain factual, respectful, and related to the job.
        11. Public and candidate-access tokens must be treated as secrets and must not be exposed in logs, Saya responses, or unauthorized screens.
        12. Platform-level summaries should not expose private candidate details unless an explicit authorized support or compliance workflow permits it.
    """,
    "keywords": ['recruitment privacy', 'tenant isolation candidates', 'team leader candidate redaction', 'protected attributes resume score', 'candidate data protection', 'resume access', 'how multi-company separation and candidate privacy work'],
    "requires_live_data": False,
},
    {
        "module": 'Recruitment - Dashboard and Reports',
        "title": 'How Recruitment dashboard and reports should be used',
        "content": """
            Recruitment monitoring guidance:
            1. Use the dashboard for live tenant-scoped counts such as Open Vacancies, New Applications, Pending Screening, Interviews Today, Feedback Pending, Offers Awaiting Reply, Joining This Month, and Delayed Actions where available.
            2. Use the Open Vacancy report to review active vacancies, owner, age, target joining date, and progress.
            3. Use the Candidate Stage report to see how many applications are in each stage for each opening.
            4. Use the Interview report for scheduled rounds, completion, and missing feedback.
            5. Use the Offer report for approval, sent, accepted, declined, expired, and withdrawn results.
            6. Use the Joining report for expected dates, document readiness, actual joining, deferment, and did-not-join outcomes.
            7. Use Source, Rejection Reason, Delay, and Hiring Time reports to improve the recruitment process when those reports are enabled.
            8. Daily review should cover new applications, pending approvals, today's interviews, missing feedback, candidate messages, and offer responses.
            9. Weekly and monthly review should focus on delayed stages, source quality, offer acceptance, joining dropouts, access review, and old-record cleanup.
            10. Saya must fetch live data before quoting a tenant's current counts, candidates, vacancies, interviews, offers, or delays.
        """,
        "keywords": ['recruitment dashboard', 'recruitment report', 'open vacancies report', 'candidate stage report', 'hiring time', 'recruitment metrics', 'how recruitment dashboard and reports should be used'],
        "requires_live_data": True,
    },
{
    "module": 'Recruitment - Settings',
    "title": 'How company Recruitment settings and templates should be managed',
    "content": """
        Recruitment Settings guidance:
        1. Only an authorized tenant Admin or HR configuration user can change company Recruitment settings.
        2. Configure the tenant's final hiring approvers, salary or offer approvers, HR publishing access, interview rounds, feedback areas, offer templates, communication templates, required joining documents, background checks, rejection reasons, retention rules, and other controls actually supported by the live page.
        3. Final hiring authority should be granted through an approved role or explicit capability, not inferred only from designation text.
        4. Job publishing authority should remain separate from final requirement approval unless the same user is also an authorized HR publisher.
        5. Apply changes only to the current tenant and preserve existing historical recruitment records.
        6. Template and workflow changes should not silently rewrite an offer, feedback record, match result, or decision that was already completed.
        7. Verify permissions before enabling sensitive salary, address, identity, document, raw-parser, or verification access.
        8. Use a pilot vacancy to test the configured workflow from request approval through public resume preview, application, interviews, offer, joining, and employee conversion.
        9. Saya may explain configured options from live context but must not invent a setting key or claim that a setting was saved without API confirmation.
    """,
    "keywords": ['recruitment settings', 'final hiring approver', 'hr publisher permission', 'offer template', 'interview rounds settings', 'joining checklist', 'candidate privacy settings', 'how company recruitment settings and templates should be managed'],
    "requires_live_data": True,
},
    {
        "module": 'Training',
        "title": 'How training records and feedback are handled',
        "content": """
            Training guidance:
            1. Open Training if the module is enabled for the logged-in role and subscription.
            2. Authorized users create or review training records using the available page controls.
            3. Eligible employees view assigned training and submit feedback where supported.
            4. Training data remains tenant-scoped.
            5. Saya must not invent certification, attendance, assessment, or external-learning integrations not present in live context.
        """,
        "keywords": ['training', 'training plan', 'training feedback', 'how training records and feedback are handled'],
        "requires_live_data": False,
    },
    {
        "module": 'Expenses',
        "title": 'How the general Expenses module relates to payroll reimbursements',
        "content": """
            Expenses guidance:
            1. Open Expenses only when the module is enabled and visible for the user's role.
            2. Use the page's current claim and approval fields for general expense records.
            3. For the audited payroll-connected expense workflow, use Reimbursements, which follows Draft, HR Review, Finance Approval, payment mode, and paid-status rules.
            4. Saya should distinguish a generic Expenses record from a payroll reimbursement and should not assume they are the same backend collection.
        """,
        "keywords": ['expenses', 'expense claim', 'reimbursement difference', 'how the general expenses module relates to payroll reimbursements'],
        "requires_live_data": False,
    },
    {
        "module": 'Payroll',
        "title": 'How a Finance user should navigate the full payroll cycle',
        "content": """
            Finance payroll operating sequence:
            1. Confirm the payroll period and verify that salary structures and statutory configuration exist.
            2. Confirm HR has synchronized attendance/leave and completed the required HR Review stage.
            3. Open Payroll Runs and review the calculated employees, payable days, LWP, earnings, deductions, statutory values, reimbursements, loans, and warnings.
            4. Resolve calculation or bank-validation blockers instead of bypassing them.
            5. Perform Finance Approval only from the permitted current status.
            6. Lock the approved payroll when all checks are complete.
            7. Generate or verify the salary bank disbursement file and transfer information.
            8. Mark Disbursed only through the authorized workflow after payment execution.
            9. Use Payroll Reports for registers, statutory summaries, variance, trends, and audited exports.
            10. Employees receive official self-service payslips only after the payroll reaches the allowed Locked or Disbursed state.
        """,
        "keywords": ['finance payroll steps', 'run payroll', 'approve payroll', 'lock payroll', 'disburse salary', 'payroll', 'how a finance user should navigate the full payroll cycle'],
        "requires_live_data": True,
    },
    {
        "module": 'Payroll',
        "title": 'How an HR user prepares payroll for Finance',
        "content": """
            HR payroll preparation sequence:
            1. Verify employee records, joining/exit state, salary structures, leave, attendance, and LWP inputs.
            2. Synchronize payroll attendance for the selected period.
            3. Review payable days, warnings, paid leave, LWP, holidays, and attendance exceptions.
            4. Ensure payroll-connected reimbursements and other HR-reviewed items are correct.
            5. Calculate or recalculate Draft payroll when permitted.
            6. Complete HR Review only after validation passes.
            7. Send the run forward to Finance Approval.
            8. HR must not be told to perform Finance Approval, Lock, or Disbursement unless the authenticated user also has the required Finance/Admin permission.
        """,
        "keywords": ['hr payroll steps', 'hr review payroll', 'attendance sync', 'send to finance', 'payroll', 'how an hr user prepares payroll for finance'],
        "requires_live_data": True,
    },
    {
        "module": 'Payroll Configuration',
        "title": 'How salary structures are created and revised',
        "content": """
            Salary structure workflow:
            1. Open Payroll Configuration and locate salary structures/templates.
            2. Select or create the employee salary structure with effective period and applicable earning/deduction components.
            3. Configure Basic, HRA, Medical, Other earnings, employer contributions, employee deductions, and other supported components according to company policy.
            4. Save the structure as the current effective revision.
            5. When salary changes, create a revision with the correct effective date instead of rewriting an already-used historical snapshot.
            6. Payroll calculation selects the effective structure for the payroll period.
            7. If an employee-specific salary structure cannot load, verify employee ID, tenant ID, active/effective dates, and the salary-structure API response before changing UI logic.
        """,
        "keywords": ['salary structure', 'salary revision', 'effective date', 'employee salary', 'payroll configuration', 'how salary structures are created and revised'],
        "requires_live_data": True,
    },
    {
        "module": 'Payroll Configuration',
        "title": 'How PF, PT, TDS, ESI and LWP configuration affect payroll',
        "content": """
            Statutory and calculation configuration:
            1. Configure applicable PF, PT, TDS, ESI, LWP, and payroll-day policies from authorized Payroll Configuration controls.
            2. PF calculation uses the configured statutory rule and wage ceiling; do not guess the value when live rule context is unavailable.
            3. Professional Tax depends on the active state/rule and employee payroll context.
            4. TDS uses the effective Finance instruction and approved/locked tax-declaration context.
            5. ESI applies only where enabled and configured for the tenant/employee.
            6. LWP uses synchronized unpaid-leave/attendance data and the configured fixed-30-day or calendar-day policy.
            7. Payroll snapshots the effective rules used for each run so later rule changes do not silently rewrite official payroll history.
        """,
        "keywords": ['pf', 'professional tax', 'pt', 'tds', 'esi', 'lwp policy', 'payroll configuration', 'how pf, pt, tds, esi and lwp configuration affect payroll'],
        "requires_live_data": True,
    },
    {
        "module": 'Payroll Banking',
        "title": 'How employee bank verification and bank files work',
        "content": """
            Payroll banking workflow:
            1. The employee or authorized payroll user enters bank account details according to the available self-service/management flow.
            2. Authorized Finance/Admin users verify the bank record before disbursement use.
            3. Validate account holder, account number, IFSC, bank name, branch, and payment mode fields according to backend rules.
            4. Payroll calculation/disbursement uses a bank snapshot so later edits do not silently change an already-processed run.
            5. Generate the salary bank file only from an eligible approved/locked payroll state.
            6. Record export and transfer status through the connected disbursement workflow.
            7. Never expose another employee's bank details to an unauthorized user.
        """,
        "keywords": ['bank verification', 'ifsc', 'salary bank file', 'bank snapshot', 'payroll banking', 'how employee bank verification and bank files work'],
        "requires_live_data": True,
    },
    {
        "module": 'Payroll Reports',
        "title": 'Which payroll report should be used',
        "content": """
            Payroll report selection:
            1. Use Payroll Register for employee-wise earnings, deductions, and net pay.
            2. Use Payroll Summary for period-level totals and status.
            3. Use Statutory Summary for PF, PT, TDS, and other configured statutory values.
            4. Use Department Summary for department-level analysis.
            5. Use Period Variance to compare payroll periods.
            6. Use Payroll Trends for historical trend analysis.
            7. Use Employee Statement for a permitted employee-specific view; employee-capability users are limited to their own statement.
            8. Use audited CSV export only with the user's permitted tenant and filters.
        """,
        "keywords": ['payroll register', 'payroll summary', 'statutory report', 'variance', 'payroll trends', 'payroll reports', 'which payroll report should be used'],
        "requires_live_data": True,
    },
    {
        "module": 'Grievance',
        "title": 'How anonymous grievance privacy works',
        "content": """
            Anonymous grievance workflow:
            1. The requester opens Grievance and selects the anonymous option where available.
            2. Enter category, priority, subject, and complete details.
            3. Submit the grievance.
            4. HR/Admin can review and update status or resolution within the tenant.
            5. The frontend hides the employee identity for an anonymous grievance according to the current privacy behavior.
            6. Backend audit/security data must not be exposed by Saya merely because an HR user asks who submitted it.
            7. The requester tracks the outcome from Grievance or Application Status.
        """,
        "keywords": ['anonymous grievance', 'hide identity', 'grievance privacy', 'grievance', 'how anonymous grievance privacy works'],
        "requires_live_data": False,
    },
    {
        "module": 'My Profile',
        "title": 'How profile photo and self-service details work',
        "content": """
            My Profile workflow:
            1. Open My Profile.
            2. Review personal and employment details available to the logged-in user.
            3. Upload or update the profile photo using the supported control.
            4. The current integration maintains compatible photo aliases so the image can appear on profile, dashboard, directory, and related UI.
            5. Edit only fields permitted for self-service; HR-controlled employment fields remain restricted.
            6. Use the password section to change the current user's password directly after current-password verification.
        """,
        "keywords": ['my profile', 'profile photo', 'change photo', 'personal details', 'how profile photo and self-service details work'],
        "requires_live_data": False,
    },
]


def validate_workflow_knowledge():
    """Validate required fields and duplicate identities during tests/seeding."""
    required = {"module", "title", "content", "keywords", "requires_live_data"}
    seen = set()

    for index, item in enumerate(HRMS_WORKFLOWS, start=1):
        missing = required.difference(item)
        if missing:
            raise ValueError(f"Workflow {index} is missing fields: {sorted(missing)}")

        identity = (str(item["module"]).strip(), str(item["title"]).strip())
        if identity in seen:
            raise ValueError(f"Duplicate workflow identity: {identity}")
        seen.add(identity)

        if not str(item["content"]).strip():
            raise ValueError(f"Workflow {identity} has empty content")

    return {
        "knowledge_version": KNOWLEDGE_VERSION,
        "workflow_count": len(HRMS_WORKFLOWS),
        "module_count": len({item["module"] for item in HRMS_WORKFLOWS}),
    }


__all__ = ["HRMS_WORKFLOWS", "KNOWLEDGE_VERSION", "validate_workflow_knowledge"]