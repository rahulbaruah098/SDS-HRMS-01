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
        "module": "Payroll",
        "title": "Complete monthly payroll workflow",
        "content": """
Complete monthly payroll workflow in SDS HRMS:
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
"""
    },
    {
        "module": "Payroll Roles",
        "title": "Payroll access and restrictions for every login role",
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
"""
    },
    {
        "module": "Payroll Configuration",
        "title": "Salary structure and statutory configuration workflow",
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
"""
    },
    {
        "module": "Payroll Attendance",
        "title": "Attendance synchronization and payroll calculation rules",
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
"""
    },
    {
        "module": "Payroll Runs",
        "title": "Payroll approval, lock and disbursement restrictions",
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
"""
    },
    {
        "module": "Payroll Banking",
        "title": "Employee bank details and salary disbursement workflow",
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
"""
    },
    {
        "module": "Loans & Advances",
        "title": "Complete payroll loan and advance workflow",
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
"""
    },
    {
        "module": "Reimbursements",
        "title": "Complete payroll reimbursement workflow",
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
"""
    },
    {
        "module": "Tax Declarations & TDS",
        "title": "Complete tax declaration and TDS workflow",
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
"""
    },
    {
        "module": "Payroll Reports",
        "title": "Payroll reports and data-access restrictions",
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
"""
    },
    {
        "module": "Payslips",
        "title": "Payslip release, download and privacy rules",
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
"""
    },
    {
        "module": "Payroll Security",
        "title": "Payroll tenant isolation, validation and immutability",
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
5. Every authenticated user can change their own password by entering the current password, new password and confirmation.
6. The password changes directly after verification and does not require a Super Admin request or approval.
7. Some employment profile fields may remain editable only by HR/Admin.
"""
    },
    {
        "module": "Password Change",
        "title": "How users change their own password",
        "content": """
Direct password change workflow:
1. The logged-in user opens My Profile.
2. The user enters their current password, new password and new-password confirmation.
3. The backend verifies the current password and confirms that the new values match.
4. The new password must meet the configured minimum-length requirement and cannot be the same as the current password.
5. On success, the logged-in user's password is changed immediately without a Super Admin approval request.
6. A user can change only their own password through this workflow.
7. Super Admin password reset capability in User Control remains a separate administrative recovery function.
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