"""SDS-style PDF layouts based on the supplied two original LC bill formats.

Pure rendering; no Flask, database or user-context dependencies.
"""
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from base64 import b64encode
from html import escape

MODE_PUBLIC = "public_transport"

def _in_words(amount):
    # Indian numbering; supports the reimbursement scale without new packages.
    ones = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    tens = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
    def part(n):
        if n < 20: return ones[n]
        if n < 100: return tens[n//10] + (" " + ones[n%10] if n%10 else "")
        return ones[n//100] + " hundred" + (" " + part(n%100) if n%100 else "")
    n = int(Decimal(str(amount)))
    if n == 0: result = "zero"
    else:
        pieces = []
        for base, name in ((10000000, "crore"), (100000, "lakh"), (1000, "thousand"), (1, "")):
            chunk, n = divmod(n, base)
            if chunk:
                if base == 1:
                    pieces.append(part(chunk))
                else:
                    pieces.append(part(chunk) + " " + name)
        result = " ".join(pieces)
    paise = int(round((float(amount) - int(float(amount)))*100))
    return result.title() + " Rupees" + (" and " + part(paise).title() + " Paise" if paise else " Only")


def _pdf_html(bill):
    h = lambda v: escape(str(v if v is not None else ""))
    vehicle = bill["bill_type"] != MODE_PUBLIC
    month = f'{bill["month"]:02d}/{bill["year"]}'
    rows = []
    for line in bill["lines"]:
        if vehicle:
            rows.append("<tr>" + "".join(f"<td>{h(val)}</td>" for val in (
                line["date"], line["from_location"], line["to_location"], line["purpose"],
                line.get("start_km"), line.get("end_km"), line.get("distance_km"),
                line.get("rate"), f'{line["amount"]:.2f}')) + "</tr>")
        else:
            typ = line.get("transport_other") if line.get("transport_type") == "other" else (line.get("transport_type") or "").replace("_", " ").title()
            rows.append("<tr>" + "".join(f"<td>{h(val)}</td>" for val in (
                line["date"], line["from_location"], line["to_location"], typ,
                f'{line["amount"]:.2f}', line["purpose"], line.get("remarks"))) + "</tr>")
    heads = ("Date", "From", "To", "Purpose", "Initial", "Final", "KM Covered", "Rs/KM", "Amount Rs") if vehicle else ("Date", "From", "To", "Mode", "Fare Rs", "Purpose", "Remarks")
    table_head = "".join(f"<th>{h(col)}</th>" for col in heads)
    kind = "Two Wheeler / Four Wheeler" if vehicle else "Bus / Auto / Public Transport"
    vehicle_line = f'<b>Vehicle:</b> {h(", ".join(sorted({x.get("vehicle_number", "") for x in bill["lines"] if x.get("vehicle_number")})))}' if vehicle else ''
    total_kms = round(sum(float(x.get("distance_km") or 0) for x in bill["lines"]), 2)
    rate_text = ', '.join(sorted({f'Rs {x["rate"]}/km' for x in bill["lines"] if x.get("rate") is not None}))
    totals = (f'<p>Total Kms: <strong>{total_kms:g}</strong> &nbsp; Rate: {h(rate_text)}</p>' if vehicle else '')
    received = (f'<p>Received Rs: __________________ &nbsp;&nbsp; Date: __________________</p>'
                '<p>I certify that I incurred the above expenditure in the course of official work '
                'and have not claimed the amount elsewhere.</p>') if not vehicle else ''
    logo_dir = Path(__file__).resolve().parent.parent / "static"
    left_logo = b64encode((logo_dir / "lc_logo_sds.png").read_bytes()).decode("ascii")
    right_logo = b64encode((logo_dir / "lc_logo_sayanant.png").read_bytes()).decode("ascii")
    submitted = bill["created_at"].strftime("%d/%m/%Y") if isinstance(bill.get("created_at"), datetime) else ""
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
        @page {{ size: A4; margin: 17mm 12mm 20mm; @bottom-center {{content: "SDS, H. No-02, 2nd Floor, Bishnujyoti Nagar, Dharapur, Guwahati, Assam 781017"; font-size:8pt;}} }}
        body {{ font-family: "DejaVu Sans", Arial, sans-serif; color: #141414; font-size: 9pt; }}
        h1 {{ text-align:center; font-size:17pt; margin:2px; }} .subtitle {{text-align:center; margin:0 0 16px; font-size:10pt;}}
        .header {{ border-bottom:1px solid #333; padding-bottom:10px; }} .sds {{float:left;max-width:84px;max-height:53px;object-fit:contain;}}
        .rightlogo {{float:right;max-width:98px;max-height:54px;object-fit:contain;}}
        .meta {{margin:10px 0; display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;}}
        table {{border-collapse:collapse;width:100%;font-size:8pt;table-layout:fixed;}}
        th,td {{border:1px solid #333;padding:7px 3px;vertical-align:top;overflow-wrap:anywhere;}}
        th {{background:#f5f5f5;}} thead {{display:table-header-group;}} tr {{break-inside:avoid;}}
        .total {{font-weight:bold;text-align:right;border:1px solid #333;padding:8px}}
        .signatures {{display:flex;justify-content:space-between;margin-top:38px;break-inside:avoid;text-align:center}}
        .signatures div {{min-width:27%;border-top:1px solid #aaa;padding-top:7px}}
        .muted {{font-size:8pt;color:#444}} .footer-note {{break-inside:avoid}}
        </style></head><body>
        <div class="header"><img class="sds" alt="SDS" src="data:image/png;base64,{left_logo}"><img class="rightlogo" alt="SDS Sayanant" src="data:image/png;base64,{right_logo}">
        <h1>LOCAL CONVEYANCE BILL</h1><p class="subtitle">({h(kind)})</p></div>
        <div class="meta"><div><b>Name:</b> {h(bill['employee_name'])}</div><div><b>Designation:</b> {h(bill['designation'])}</div>
        <div><b>Month:</b> {h(month)}</div><div><b>Project:</b> {h(', '.join(sorted({x.get('project','') for x in bill['lines'] if x.get('project')})))}</div>
        <div><b>Location:</b> {h(bill['location'])}</div><div>{vehicle_line}</div></div>
        <div class="muted">LC Reference: {h(bill['reference'])} | Date of Submission: {h(submitted)}</div>
        <table><thead><tr>{table_head}</tr></thead><tbody>{''.join(rows)}</tbody></table>
        {totals}<p class="total">TOTAL AMOUNT: Rs {bill['total']:,.2f}</p>
        <p>Amount in words: <strong>{h(_in_words(bill['total']))}</strong></p>
        <div class="footer-note">{received}</div>
        <div class="signatures"><div>Claimant<br>Signature</div><div>Accountant<br>Signature</div><div>Team Leader<br>Signature</div></div>
        </body></html>'''



def render_lc_bill_pdf(bill):
    from weasyprint import HTML
    return HTML(string=_pdf_html(bill)).write_pdf()
