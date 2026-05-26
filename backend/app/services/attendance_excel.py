from calendar import monthrange
from copy import copy
from datetime import date, datetime, timedelta
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


GUIDELINE_ROWS = [
    ("Holiday", "H"),
    ("Casual Leave-", "CL"),
    ("Casual Leave Half Day-", "CLH"),
    ("Earned Leave", "EL"),
    ("Maternity Leave", "ML"),
    ("Paternity Leave", "PL"),
    ("Leave Without Pay", "LWP"),
    ("Compensatory Off", "CO"),
    ("Work From Home", "WFH"),
    ("Tour / Field Work", "T"),
    ("Present", "P"),
    ("Absent", "A"),
]

SUMMARY_COLUMNS = [
    ("CL Availed", "CL"),
    ("EL Availed", "EL"),
    ("LWP", "LWP"),
    ("Remarks", "remarks"),
]

BASE_COLUMNS = [
    "Sl No",
    "Name of Employee",
    "Designation",
    "Project",
    "Location",
    "Emp Code",
]


ORG_FULL_NAMES = {
    "SDS": "Sesta Development Services (SDS)",
    "SDSPL": "Sayanant Development Services Pvt. Ltd. (SDSPL)",
    "SDPL": "Sayanant Development Services Pvt. Ltd. (SDSPL)",
    "AVPL": "Ayanant Ventures Pvt. Ltd. (AVPL)",
    "SDF": "Sayanant Development Foundation (SDF)",
}


THIN_BORDER = Border(
    left=Side(style="thin", color="000000"),
    right=Side(style="thin", color="000000"),
    top=Side(style="thin", color="000000"),
    bottom=Side(style="thin", color="000000"),
)

TITLE_FILL = PatternFill("solid", fgColor="92D050")
SUBTITLE_FILL = PatternFill("solid", fgColor="C6E0B4")
HEADER_FILL = PatternFill("solid", fgColor="D9EAD3")
WEEKEND_FILL = PatternFill("solid", fgColor="E2F0D9")
HOLIDAY_FILL = PatternFill("solid", fgColor="FFE699")
ABSENT_FILL = PatternFill("solid", fgColor="F4CCCC")
LEAVE_FILL = PatternFill("solid", fgColor="DDEBF7")
PRESENT_FILL = PatternFill("solid", fgColor="FFFFFF")
SECTION_FILL = PatternFill("solid", fgColor="E2F0D9")


def normalize_text(value):
    return str(value or "").strip()


def parse_iso_date(value):
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    value = normalize_text(value)

    if not value:
        return None

    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def date_key(value):
    parsed = parse_iso_date(value)

    if not parsed:
        return ""

    return parsed.isoformat()


def month_dates(year, month):
    year = int(year)
    month = int(month)
    days = monthrange(year, month)[1]

    return [date(year, month, day) for day in range(1, days + 1)]


def week_dates(start_date, end_date=None):
    start = parse_iso_date(start_date)

    if not start:
        start = date.today()

    end = parse_iso_date(end_date)

    if not end:
        end = start + timedelta(days=6)

    if end < start:
        start, end = end, start

    dates = []
    current = start

    while current <= end:
        dates.append(current)
        current += timedelta(days=1)

    return dates


def day_dates(target_date):
    parsed = parse_iso_date(target_date) or date.today()
    return [parsed]


def build_period_dates(period="month", year=None, month=None, date_value=None, week_start=None, week_end=None):
    period = normalize_text(period).lower() or "month"

    if period == "day":
        return day_dates(date_value)

    if period == "week":
        return week_dates(week_start or date_value, week_end)

    today = date.today()
    return month_dates(year or today.year, month or today.month)


def month_name(dates):
    if not dates:
        return ""

    first = dates[0]
    return first.strftime("%B %Y")


def safe_sheet_title(value):
    title = normalize_text(value) or "Attendance"

    invalid_chars = ["\\", "/", "*", "[", "]", ":", "?"]

    for char in invalid_chars:
        title = title.replace(char, "-")

    return title[:31]


def employee_name(employee):
    return (
        normalize_text(employee.get("name"))
        or normalize_text(employee.get("employee_name"))
        or normalize_text(employee.get("full_name"))
        or normalize_text(employee.get("email"))
        or "Employee"
    )


def employee_code(employee):
    return (
        normalize_text(employee.get("emp_code"))
        or normalize_text(employee.get("employee_code"))
        or normalize_text(employee.get("employee_id"))
        or normalize_text(employee.get("code"))
    )


def employee_designation(employee):
    return (
        normalize_text(employee.get("designation"))
        or normalize_text(employee.get("designation_name"))
        or normalize_text(employee.get("title"))
    )


def employee_project(employee):
    return (
        normalize_text(employee.get("project"))
        or normalize_text(employee.get("project_name"))
        or normalize_text(employee.get("department"))
        or "0"
    )


def employee_location(employee):
    return (
        normalize_text(employee.get("location"))
        or normalize_text(employee.get("branch"))
        or normalize_text(employee.get("state"))
        or normalize_text(employee.get("office_state"))
        or ""
    )


def employee_joining_date(employee):
    return parse_iso_date(
        employee.get("joining_date")
        or employee.get("date_of_joining")
        or employee.get("doj")
    )


def employee_last_working_date(employee):
    return parse_iso_date(
        employee.get("last_working_date")
        or employee.get("resignation_date")
    )


def employee_identifier_values(employee):
    values = []

    for key in [
        "_id",
        "id",
        "employee_id",
        "employee_code",
        "emp_code",
        "code",
        "user_id",
        "email",
        "official_email",
    ]:
        value = normalize_text(employee.get(key))

        if value and value not in values:
            values.append(value)

    return values


def attendance_employee_identifier(row):
    return normalize_text(
        row.get("employee_id")
        or row.get("employee_ref_id")
        or row.get("employee_code")
        or row.get("emp_code")
        or row.get("user_id")
        or row.get("email")
    )


def attendance_status_code(row):
    status = normalize_text(row.get("status")).lower()
    mode = normalize_text(row.get("mode")).lower()

    if mode in {"wfh", "work_from_home", "work from home"}:
        return "WFH"

    if mode in {"field", "tour", "travel", "official_tour", "official tour"}:
        return "T"

    if status in {"present", "checked_in", "checked-out", "checked_out", "verified", "approved"}:
        return "P"

    if row.get("check_in") or row.get("check_in_time") or row.get("checked_in_at"):
        return "P"

    return ""


def leave_status_code(row):
    status = normalize_text(row.get("status")).lower()
    approval_stage = normalize_text(row.get("approval_stage")).lower()

    if status not in {"approved", "accepted"} and approval_stage != "approved":
        return ""

    leave_type = normalize_text(
        row.get("leave_type")
        or row.get("leave_type_label")
        or row.get("type")
    ).upper()

    half_day = str(row.get("half_day") or row.get("is_half_day") or "").lower() in {
        "true",
        "1",
        "yes",
        "on",
    }

    if leave_type in {"CL", "CASUAL", "CASUAL LEAVE", "CASUAL_LEAVE"}:
        return "CLH" if half_day else "CL"

    if leave_type in {"EL", "EARNED", "EARNED LEAVE", "EARNED_LEAVE"}:
        return "EL"

    if leave_type in {"LWP", "LEAVE WITHOUT PAY", "LOSS OF PAY"}:
        return "LWP"

    if leave_type in {"ML", "MATERNITY", "MATERNITY LEAVE"}:
        return "ML"

    if leave_type in {"PL", "PATERNITY", "PATERNITY LEAVE"}:
        return "PL"

    if leave_type in {"CO", "COMP OFF", "COMP-OFF", "COMPOFF"}:
        return "CO"

    return leave_type or "L"


def leave_date_range(row):
    start = parse_iso_date(
        row.get("from_date")
        or row.get("start_date")
        or row.get("date")
    )

    end = parse_iso_date(
        row.get("to_date")
        or row.get("upto_date")
        or row.get("end_date")
        or row.get("date")
    )

    if not start and end:
        start = end

    if not end and start:
        end = start

    return start, end


def build_attendance_lookup(attendance_logs):
    lookup = {}

    for row in attendance_logs or []:
        emp_key = attendance_employee_identifier(row)
        day_key = date_key(row.get("date") or row.get("attendance_date") or row.get("created_at"))

        if not emp_key or not day_key:
            continue

        code = attendance_status_code(row)

        if not code:
            continue

        lookup[(emp_key, day_key)] = code

    return lookup


def build_leave_lookup(leave_requests):
    lookup = {}

    for row in leave_requests or []:
        code = leave_status_code(row)

        if not code:
            continue

        emp_key = attendance_employee_identifier(row)
        start, end = leave_date_range(row)

        if not emp_key or not start or not end:
            continue

        current = start

        while current <= end:
            lookup[(emp_key, current.isoformat())] = code
            current += timedelta(days=1)

    return lookup


def build_holiday_lookup(holidays):
    lookup = {}

    for row in holidays or []:
        day_key = date_key(row.get("date") or row.get("holiday_date"))

        if not day_key:
            continue

        lookup[day_key] = normalize_text(row.get("title") or row.get("name") or "Holiday")

    return lookup


def code_for_employee_date(employee, target_date, attendance_lookup, leave_lookup, holiday_lookup):
    target_key = target_date.isoformat()

    joining_date = employee_joining_date(employee)
    last_working_date = employee_last_working_date(employee)

    if joining_date and target_date < joining_date:
        return ""

    if last_working_date and target_date > last_working_date:
        return ""

    for identifier in employee_identifier_values(employee):
        leave_code = leave_lookup.get((identifier, target_key))

        if leave_code:
            return leave_code

    for identifier in employee_identifier_values(employee):
        attendance_code = attendance_lookup.get((identifier, target_key))

        if attendance_code:
            return attendance_code

    if target_key in holiday_lookup:
        return "H"

    if target_date.weekday() == 6:
        return ""

    return "A"


def count_code(row_codes, target_code):
    return sum(1 for code in row_codes if normalize_text(code).upper() == target_code)


def apply_cell_style(cell, fill=None, bold=False, size=11, align="center", vertical="center"):
    cell.font = Font(name="Calibri", size=size, bold=bold, color="000000")
    cell.alignment = Alignment(horizontal=align, vertical=vertical, wrap_text=True)
    cell.border = THIN_BORDER

    if fill:
        cell.fill = fill


def style_status_cell(cell, value):
    code = normalize_text(value).upper()

    if code == "P":
        fill = PRESENT_FILL
    elif code in {"CL", "CLH", "EL", "ML", "PL", "LWP", "CO"}:
        fill = LEAVE_FILL
    elif code == "H":
        fill = HOLIDAY_FILL
    elif code == "A":
        fill = ABSENT_FILL
    elif code in {"WFH", "T"}:
        fill = WEEKEND_FILL
    else:
        fill = PRESENT_FILL

    apply_cell_style(cell, fill=fill)


def create_guidelines_sheet(wb):
    ws = wb.active
    ws.title = "Guidelines"

    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 28
    ws.column_dimensions["C"].width = 12

    ws["B3"] = "Attendance Code Guidelines"
    ws["B3"].font = Font(name="Calibri", size=14, bold=True)
    ws["B3"].fill = TITLE_FILL
    ws["B3"].alignment = Alignment(horizontal="center")
    ws["B3"].border = THIN_BORDER
    ws.merge_cells("B3:C3")

    start_row = 4

    for index, (label, code) in enumerate(GUIDELINE_ROWS, start=start_row):
        ws.cell(index, 2).value = label
        ws.cell(index, 3).value = code
        apply_cell_style(ws.cell(index, 2), align="left")
        apply_cell_style(ws.cell(index, 3), bold=True)

    return ws


def create_attendance_sheet(
    wb,
    employees,
    attendance_logs,
    leave_requests,
    holidays,
    dates,
    organisation_name="",
    organisation_code="",
    state_name="",
    period_label="",
):
    sheet_title = safe_sheet_title(organisation_code or organisation_name or "Attendance")
    ws = wb.create_sheet(sheet_title)

    date_count = len(dates)
    first_day_col = 7
    last_day_col = first_day_col + date_count - 1
    summary_start_col = last_day_col + 1
    final_col = summary_start_col + len(SUMMARY_COLUMNS) - 1

    final_col_letter = get_column_letter(final_col)

    display_org_name = (
        ORG_FULL_NAMES.get(normalize_text(organisation_code).upper())
        or normalize_text(organisation_name)
        or normalize_text(organisation_code)
        or "Organisation"
    )

    period_title = period_label or f"Attendance Record for the Month of {month_name(dates)}"
    if organisation_code:
        period_title = f"{period_title} ({organisation_code})"

    location_title = state_name or "All Locations"

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=final_col)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=final_col)
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=final_col)

    ws["A1"] = display_org_name
    ws["A2"] = period_title
    ws["A3"] = location_title

    apply_cell_style(ws["A1"], fill=TITLE_FILL, bold=True, size=14)
    apply_cell_style(ws["A2"], fill=SUBTITLE_FILL, bold=True, size=12)
    apply_cell_style(ws["A3"], fill=SUBTITLE_FILL, bold=True, size=12)

    for row in [1, 2, 3]:
        for col in range(1, final_col + 1):
            cell = ws.cell(row, col)
            cell.border = THIN_BORDER
            if row == 1:
                cell.fill = TITLE_FILL
            else:
                cell.fill = SUBTITLE_FILL

    for index, header in enumerate(BASE_COLUMNS, start=1):
        ws.cell(4, index).value = header
        ws.merge_cells(start_row=4, start_column=index, end_row=5, end_column=index)
        apply_cell_style(ws.cell(4, index), fill=HEADER_FILL, bold=True)

    for offset, current_date in enumerate(dates):
        col = first_day_col + offset
        ws.cell(4, col).value = current_date.day
        ws.cell(5, col).value = current_date.strftime("%a").upper()

        header_fill = WEEKEND_FILL if current_date.weekday() == 6 else HEADER_FILL
        apply_cell_style(ws.cell(4, col), fill=header_fill, bold=True)
        apply_cell_style(ws.cell(5, col), fill=header_fill, bold=True)

    for offset, (label, _) in enumerate(SUMMARY_COLUMNS):
        col = summary_start_col + offset
        ws.cell(4, col).value = label
        ws.merge_cells(start_row=4, start_column=col, end_row=5, end_column=col)
        apply_cell_style(ws.cell(4, col), fill=HEADER_FILL, bold=True)

    attendance_lookup = build_attendance_lookup(attendance_logs)
    leave_lookup = build_leave_lookup(leave_requests)
    holiday_lookup = build_holiday_lookup(holidays)

    sorted_employees = sorted(
        employees or [],
        key=lambda item: (
            normalize_text(item.get("state") or item.get("branch") or item.get("location")).lower(),
            employee_name(item).lower(),
        ),
    )

    start_row = 6

    for row_offset, employee in enumerate(sorted_employees):
        row = start_row + row_offset

        ws.cell(row, 1).value = row_offset + 1
        ws.cell(row, 2).value = employee_name(employee)
        ws.cell(row, 3).value = employee_designation(employee)
        ws.cell(row, 4).value = employee_project(employee)
        ws.cell(row, 5).value = employee_location(employee)
        ws.cell(row, 6).value = employee_code(employee)

        for col in range(1, 7):
            apply_cell_style(ws.cell(row, col), align="left" if col in {2, 3, 4, 5} else "center")

        row_codes = []

        for offset, current_date in enumerate(dates):
            col = first_day_col + offset
            code = code_for_employee_date(
                employee,
                current_date,
                attendance_lookup,
                leave_lookup,
                holiday_lookup,
            )
            row_codes.append(code)
            ws.cell(row, col).value = code
            style_status_cell(ws.cell(row, col), code)

        ws.cell(row, summary_start_col).value = count_code(row_codes, "CL") + (count_code(row_codes, "CLH") * 0.5)
        ws.cell(row, summary_start_col + 1).value = count_code(row_codes, "EL")
        ws.cell(row, summary_start_col + 2).value = count_code(row_codes, "LWP")
        ws.cell(row, summary_start_col + 3).value = normalize_text(employee.get("remarks") or "")

        for col in range(summary_start_col, final_col + 1):
            apply_cell_style(ws.cell(row, col))

    if not sorted_employees:
        ws.cell(start_row, 1).value = "No employees found for selected filters."
        ws.merge_cells(start_row=start_row, start_column=1, end_row=start_row, end_column=final_col)
        apply_cell_style(ws.cell(start_row, 1), align="center", bold=True)

    total_row = start_row + max(len(sorted_employees), 1) + 1
    ws.cell(total_row, 1).value = "Prepared By"
    ws.cell(total_row, 4).value = "Checked By"
    ws.cell(total_row, 7).value = "Approved By"

    for col in range(1, final_col + 1):
        apply_cell_style(ws.cell(total_row, col), fill=SECTION_FILL, bold=col in {1, 4, 7})

    column_widths = {
        1: 8,
        2: 28,
        3: 24,
        4: 18,
        5: 20,
        6: 14,
    }

    for col, width in column_widths.items():
        ws.column_dimensions[get_column_letter(col)].width = width

    for col in range(first_day_col, summary_start_col):
        ws.column_dimensions[get_column_letter(col)].width = 5

    ws.column_dimensions[get_column_letter(summary_start_col)].width = 12
    ws.column_dimensions[get_column_letter(summary_start_col + 1)].width = 12
    ws.column_dimensions[get_column_letter(summary_start_col + 2)].width = 10
    ws.column_dimensions[get_column_letter(summary_start_col + 3)].width = 24

    for row in range(1, total_row + 1):
        ws.row_dimensions[row].height = 22

    ws.row_dimensions[1].height = 26
    ws.row_dimensions[2].height = 24
    ws.row_dimensions[3].height = 22

    ws.freeze_panes = "G6"
    ws.auto_filter.ref = f"A5:{final_col_letter}{total_row - 2}"

    page_setup = ws.page_setup
    page_setup.orientation = "landscape"
    page_setup.fitToWidth = 1
    page_setup.fitToHeight = 0

    ws.sheet_properties.pageSetUpPr.fitToPage = True

    return ws


def build_attendance_workbook(
    employees=None,
    attendance_logs=None,
    leave_requests=None,
    holidays=None,
    period="month",
    year=None,
    month=None,
    date_value=None,
    week_start=None,
    week_end=None,
    organisation_name="",
    organisation_code="",
    state_name="",
):
    dates = build_period_dates(
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
    )

    wb = Workbook()
    create_guidelines_sheet(wb)

    period_label = ""

    period_key = normalize_text(period).lower()

    if period_key == "day":
        period_label = f"Attendance Record for {dates[0].strftime('%d %B %Y')}"
    elif period_key == "week":
        period_label = f"Attendance Record from {dates[0].strftime('%d %B %Y')} to {dates[-1].strftime('%d %B %Y')}"
    else:
        period_label = f"Attendance Record for the Month of {month_name(dates)}"

    create_attendance_sheet(
        wb=wb,
        employees=employees or [],
        attendance_logs=attendance_logs or [],
        leave_requests=leave_requests or [],
        holidays=holidays or [],
        dates=dates,
        organisation_name=organisation_name,
        organisation_code=organisation_code,
        state_name=state_name,
        period_label=period_label,
    )

    return wb


def workbook_to_bytes(workbook):
    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)
    return stream


def build_attendance_excel_file(
    employees=None,
    attendance_logs=None,
    leave_requests=None,
    holidays=None,
    period="month",
    year=None,
    month=None,
    date_value=None,
    week_start=None,
    week_end=None,
    organisation_name="",
    organisation_code="",
    state_name="",
):
    workbook = build_attendance_workbook(
        employees=employees,
        attendance_logs=attendance_logs,
        leave_requests=leave_requests,
        holidays=holidays,
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
        organisation_name=organisation_name,
        organisation_code=organisation_code,
        state_name=state_name,
    )

    return workbook_to_bytes(workbook)


def build_attendance_excel_filename(
    organisation_code="",
    organisation_name="",
    state_name="",
    period="month",
    year=None,
    month=None,
    date_value=None,
    week_start=None,
    week_end=None,
):
    dates = build_period_dates(
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
    )

    org_part = (
        normalize_text(organisation_code)
        or normalize_text(organisation_name)
        or "Organisation"
    )

    state_part = normalize_text(state_name) or "AllStates"

    period_key = normalize_text(period).lower()

    if period_key == "day":
        period_part = dates[0].strftime("%d_%b_%Y")
    elif period_key == "week":
        period_part = f"{dates[0].strftime('%d_%b_%Y')}_to_{dates[-1].strftime('%d_%b_%Y')}"
    else:
        period_part = dates[0].strftime("%B_%Y")

    filename = f"{org_part}_{state_part}_Attendance_{period_part}.xlsx"

    for char in [" ", "/", "\\", ":", "*", "?", '"', "<", ">", "|", "(", ")"]:
        filename = filename.replace(char, "_")

    while "__" in filename:
        filename = filename.replace("__", "_")

    return filename