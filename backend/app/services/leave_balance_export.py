"""Minimal styled XLSX builder using the standard library (no added dependencies)."""
from datetime import datetime
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape


def _cell(value, ref, style=0):
    attr = f' s="{style}"' if style else ''
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{attr}><v>{value}</v></c>'
    safe = escape(str(value if value is not None else ""), {'"': '&quot;'})
    return f'<c r="{ref}" t="inlineStr"{attr}><is><t>{safe}</t></is></c>'


def _column(index):
    out = ''
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def _sheet(title, notes, headers, rows):
    width = len(headers)
    pieces = [f'<row r="1">{_cell(title,"A1",1)}</row>']
    pieces.append(f'<row r="2">{_cell(notes,"A2",3)}</row>')
    pieces.append('<row r="4">'+''.join(_cell(h,f'{_column(i)}4',2) for i,h in enumerate(headers,1))+'</row>')
    for row_index, values in enumerate(rows,5):
        style = 4 if row_index % 2 == 0 else 0
        pieces.append(f'<row r="{row_index}">' + ''.join(_cell(v,f'{_column(i)}{row_index}',style) for i,v in enumerate(values,1)) + '</row>')
    last = max(4, len(rows)+4)
    cols = ''.join(f'<col min="{i}" max="{i}" width="{max(13,min(30,len(str(h))+8))}" customWidth="1"/>' for i,h in enumerate(headers,1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            f'<cols>{cols}</cols><sheetData>{"".join(pieces)}</sheetData>'
            f'<autoFilter ref="A4:{_column(width)}{last}"/>'
            '</worksheet>')


def build_leave_balance_workbook(snapshot, activity, period, start, end, tenant):
    scope = f'{start.isoformat()} to {end.isoformat()}' if start and end else 'Current'
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    snapshot_note = f'CURRENT snapshot as of {timestamp}. Not a historical balance for {scope}. Tenant: {tenant}.'
    activity_note = f'Leave requests overlapping {scope}; includes pending/rejected. Days are full-request totals, NOT prorated to period.'
    sheets = [
        _sheet('Current Leave Balances', snapshot_note,
               ['Employee Name','Employee ID','Department','Designation','Type','Opening','Credited','Used','Available'],snapshot),
        _sheet('Period Leave Requests', activity_note,
               ['Employee Name','Employee ID','Department','From','To','Type','Status','Request Days','Deducted'],activity),
    ]
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font>'
              '<font><b/><sz val="16"/><color rgb="FF1F3861"/></font>'
              '<font><b/><color rgb="FFFFFFFF"/></font></fonts>'
              '<fills count="4"><fill><patternFill patternType="none"/></fill>'
              '<fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF365BBA"/></patternFill></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5FB"/></patternFill></fill></fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="5"><xf fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf fontId="1" fillId="0" borderId="0" xfId="0"/>'
              '<xf fontId="2" fillId="2" borderId="0" xfId="0"/>'
              '<xf fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf fontId="0" fillId="3" borderId="0" xfId="0"/></cellXfs></styleSheet>')
    content_types = ('<?xml version="1.0" encoding="UTF-8"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                     '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                     '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                     '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                     '</Types>')
    workbook = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Current Balances" sheetId="1" r:id="rId1"/>'
                '<sheet name="Period Requests" sheetId="2" r:id="rId2"/></sheets></workbook>')
    output=BytesIO()
    with ZipFile(output,'w',ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',content_types)
        z.writestr('_rels/.rels',"""<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""")
        z.writestr('xl/workbook.xml',workbook)
        z.writestr('xl/_rels/workbook.xml.rels',"""<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>""")
        z.writestr('xl/styles.xml',styles)
        for i,sheet in enumerate(sheets,1): z.writestr(f'xl/worksheets/sheet{i}.xml',sheet)
    return output.getvalue()
