"""Bounded Decimal formula interpreter and interval arithmetic. No database I/O."""
import ast
import calendar
import re
from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, ROUND_FLOOR, ROUND_CEILING


class ComplianceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def number(value, minimum=None, maximum=Decimal('1000000000')):
    try:
        if isinstance(value, bool):
            raise ValueError()
        result = Decimal(str(value))
        if not result.is_finite() or abs(result) > maximum or (minimum is not None and result < minimum):
            raise ValueError()
        return result
    except (ValueError, InvalidOperation, TypeError):
        raise ComplianceError('A finite number in the permitted range is required.')


def money(value, rounding='two_decimals'):
    return number(value).quantize(Decimal('.01') if rounding == 'two_decimals' else Decimal('1'),
        rounding={'floor': ROUND_FLOOR, 'ceil': ROUND_CEILING}.get(rounding, ROUND_HALF_UP))


def day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        raise ComplianceError('Use a valid ISO date (YYYY-MM-DD).')


def month_days(period):
    if not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', str(period)):
        raise ComplianceError('Use a payroll month between 2000 and 2099 (YYYY-MM).')
    start = day(period + '-01')
    return [start + timedelta(days=i) for i in range(calendar.monthrange(start.year, start.month)[1])]


def clock(value):
    if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', str(value)):
        raise ComplianceError('Shift times must use HH:MM.')
    hour, minute = map(int, value.split(':'))
    return hour * 60 + minute


def union(intervals):
    result = []
    for a, b in sorted((int(a), int(b)) for a, b in intervals if b > a):
        if result and a <= result[-1][1]:
            result[-1][1] = max(result[-1][1], b)
        else:
            result.append([a, b])
    return result


def intersect(left, right):
    return union([[max(a, c), min(b, d)] for a, b in left for c, d in right if min(b, d) > max(a, c)])


def subtract(left, right):
    result = union(left)
    for c, d in union(right):
        result = [part for a, b in result for part in ([[a, b]] if d <= a or c >= b else
                  ([[a, c]] if a < c else []) + ([[d, b]] if d < b else []))]
    return result


def length(intervals):
    return sum(b - a for a, b in union(intervals))


def first_minutes(intervals, count):
    result = []
    for a, b in union(intervals):
        take = min(max(0, int(count)), b - a)
        if take:
            result.append([a, a + take])
            count -= take
    return result


def schedule_intervals(schedule):
    start, end = clock(schedule['start']), clock(schedule['end'])
    if end <= start:
        end += 1440
    breaks = []
    for item in schedule.get('breaks', []):
        a, b = clock(item['start']), clock(item['end'])
        if a < start:
            a += 1440
        if b <= a % 1440:
            b += 1440
        if b < a:
            b += 1440
        if not item.get('paid', False):
            breaks.append([a, b])
    result = subtract([[start, end]], breaks)
    if not result:
        raise ComplianceError('A shift must contain working minutes.')
    return result


_ALLOWED = (ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.UnaryOp,
            ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd, ast.Compare,
            ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq, ast.IfExp, ast.Call)
FUNCTIONS = {'min', 'max', 'abs'}


def parse_formula(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 500:
        raise ComplianceError('Formula length must be 1–500 characters.')
    try:
        tree = ast.parse(expression, mode='eval')
    except (SyntaxError, RecursionError):
        raise ComplianceError('Invalid formula syntax.')
    nodes = list(ast.walk(tree))
    if len(nodes) > 120:
        raise ComplianceError('Formula is too complex.')
    for node in nodes:
        if not isinstance(node, _ALLOWED):
            raise ComplianceError('Only arithmetic, comparisons, conditional expressions, min, max and abs are supported.')
        if isinstance(node, ast.Constant):
            number(node.value)
        if isinstance(node, ast.Name) and not re.fullmatch('[a-z][a-z0-9_]{0,59}', node.id):
            raise ComplianceError('Invalid formula reference.')
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or
                node.func.id not in FUNCTIONS or node.keywords or not 1 <= len(node.args) <= 8):
            raise ComplianceError('Unsupported formula function.')
    return tree, {n.id for n in nodes if isinstance(n, ast.Name)} - FUNCTIONS


def formula(expression, values):
    tree, references = parse_formula(expression)
    if references - values.keys():
        raise ComplianceError('Unknown formula references: ' + ', '.join(sorted(references - values.keys())))
    def visit(node, depth=0):
        if depth > 25:
            raise ComplianceError('Formula nesting limit exceeded.')
        def child(n):
            return visit(n, depth + 1)
        if isinstance(node, ast.Expression):
            result = child(node.body)
        elif isinstance(node, ast.Constant):
            result = number(node.value)
        elif isinstance(node, ast.Name):
            result = number(values[node.id])
        elif isinstance(node, ast.UnaryOp):
            result = child(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp):
            a, b = child(node.left), child(node.right)
            if isinstance(node.op, ast.Div) and b == 0:
                raise ComplianceError('Formula division by zero.')
            result = a + b if isinstance(node.op, ast.Add) else a - b if isinstance(node.op, ast.Sub) else a * b if isinstance(node.op, ast.Mult) else a / b
        elif isinstance(node, ast.Compare):
            a = child(node.left)
            ok = True
            for op, next_node in zip(node.ops, node.comparators):
                b = child(next_node)
                ok = ok and ({ast.Lt: a < b, ast.LtE: a <= b, ast.Gt: a > b, ast.GtE: a >= b,
                              ast.Eq: a == b, ast.NotEq: a != b}[type(op)])
                a = b
            result = Decimal(int(ok))
        elif isinstance(node, ast.IfExp):
            result = child(node.body if child(node.test) else node.orelse)
        elif isinstance(node, ast.Call):
            args = [child(a) for a in node.args]
            if node.func.id == 'abs' and len(args) != 1:
                raise ComplianceError('abs requires one argument.')
            result = {'min': min, 'max': max, 'abs': lambda a: abs(a)}[node.func.id](*args) if node.func.id == 'abs' else {'min': min, 'max': max}[node.func.id](args)
        else:
            raise ComplianceError('Unsupported formula.')
        return number(result)
    return visit(tree)


BASES = {'monthly_ctc', 'gross_salary', 'payable_gross_salary', 'basic', 'hra', 'medical_allowance',
         'other_allowances', 'required_minutes', 'accounted_minutes', 'shortage_minutes',
         'approved_minutes', 'working_days', 'payable_days', 'lwp_days', 'hours', 'minutes'}
CORE_EARNINGS = {'basic', 'hra', 'medical_allowance', 'other_allowances'}
RESERVED = (BASES - CORE_EARNINGS) | FUNCTIONS | {'pf_employee', 'pf_employer', 'esi_employee', 'esi_employer',
    'professional_tax', 'tds', 'lwp', 'attendance_compliance', 'salary_proration', 'advances'}


def component_expression(row):
    kind = row.get('calculation_type', 'fixed')
    basis = row.get('basis', 'gross_salary')
    amount = str(number(row.get('amount', 0), 0))
    if kind == 'fixed':
        return amount
    if kind in {'percentage', 'day', 'hour', 'minute'}:
        basis = {'day': 'payable_days', 'hour': 'hours', 'minute': 'minutes'}.get(kind, basis)
        return f'{basis} * {amount}' + (' / 100' if kind == 'percentage' else '')
    if kind == 'slab':
        expression = '0'
        slabs = row.get('slabs', [])
        if not isinstance(slabs, list) or not all(isinstance(s, dict) and 'up_to' in s and 'amount' in s for s in slabs):
            raise ComplianceError('Slabs require up_to and amount.')
        if len(slabs) > 30:
            raise ComplianceError('At most 30 slabs are allowed.')
        last = Decimal('-1')
        for slab in slabs:
            limit = number(slab['up_to'], 0)
            if limit <= last:
                raise ComplianceError('Slab limits must increase.')
            last = limit
        for slab in reversed(slabs):
            expression = f"({number(slab['amount'], 0)} if {basis} <= {number(slab['up_to'], 0)} else {expression})"
        return expression
    if kind in {'formula', 'conditional'}:
        return row.get('formula', '')
    raise ComplianceError('Unsupported calculation type.')


def component_order(components):
    if len(components) > 80:
        raise ComplianceError('At most 80 dynamic components are allowed.')
    by_code, dependencies = {}, {}
    for component in components:
        if not isinstance(component, dict):
            raise ComplianceError('Every component must be an object.')
        code = component.get('code', '')
        if not re.fullmatch('[a-z][a-z0-9_]{0,59}', code) or code in RESERVED or code in by_code:
            raise ComplianceError('Duplicate, reserved or invalid component code: ' + str(code))
        if component.get('category') not in {'earning', 'deduction', 'employer_contribution', 'information'}:
            raise ComplianceError('Invalid component category.')
        if code in CORE_EARNINGS and (component.get('category') != 'earning' or not component.get('enabled', True)):
            raise ComplianceError('Core earning overrides must remain active earnings.')
        if component.get('statutory'):
            raise ComplianceError('Statutory components must use the existing statutory configuration.')
        if component.get('attendance_related'):
            raise ComplianceError('Attendance deductions must use the reviewed compliance allocation, not a custom component.')
        component['sequence'] = int(number(component.get('sequence', 100), 0, Decimal('10000')))
        if not isinstance(component.get('eligibility', {}), dict):
            raise ComplianceError('Component eligibility must be an object.')
        for field, options in component.get('eligibility', {}).items():
            if not isinstance(options, list) or not all(isinstance(v, str) for v in options):
                raise ComplianceError('Eligibility scopes must be lists of identifiers.')
        for field in ('effective_from', 'effective_to'):
            if component.get(field):
                component[field] = day(component[field]).isoformat()
        if component.get('rounding', 'two_decimals') not in {'two_decimals', 'nearest_rupee', 'floor', 'ceil'}:
            raise ComplianceError('Invalid rounding rule.')
        expression = component_expression(component)
        _, refs = parse_formula(expression)
        if component.get('condition'):
            refs |= parse_formula(component['condition'])[1]
        if component.get('category') == 'deduction' and (refs & {'required_minutes', 'accounted_minutes', 'shortage_minutes', 'approved_minutes', 'working_days', 'payable_days', 'lwp_days', 'hours', 'minutes'}):
            raise ComplianceError('Time-based custom deductions require reviewed compliance allocations; use Attendance Compliance.')
        by_code[code], dependencies[code] = component, refs
        for key in ('minimum', 'maximum'):
            if component.get(key) not in (None, ''):
                number(component[key], 0)
        if component.get('minimum') not in (None, '') and component.get('maximum') not in (None, '') and number(component['minimum']) > number(component['maximum']):
            raise ComplianceError('Component minimum exceeds maximum.')
    order, pending = [], dict(dependencies)
    while pending:
        available = sorted(code for code, refs in pending.items() if refs <= (BASES - set(by_code)) | set(order))
        if not available:
            raise ComplianceError('Unknown reference or circular component dependency: ' + ', '.join(sorted(pending)))
        for code in available:
            order.append(code)
            del pending[code]
    return [by_code[code] for code in order]


def calculate_components(components, values, employee, period):
    values = {k: number(v) for k, v in values.items()}
    result = []
    for row in component_order(components):
        enabled = row.get('enabled', True) and row.get('effective_from', '2000-01-01') <= period + '-01' and row.get('effective_to', '2099-12-31') >= period + '-01'
        for field in ('employee_id', 'department', 'designation', 'state', 'location', 'salary_structure_id'):
            allowed = row.get('eligibility', {}).get(field, [])
            actual = str(employee.get('_id')) if field == 'employee_id' else str(employee.get(field, ''))
            if allowed and actual not in allowed:
                enabled = False
        expression = component_expression(row)
        enabled = enabled and (not row.get('condition') or bool(formula(row['condition'], values)))
        amount = formula(expression, values) if enabled else Decimal('0')
        if amount < 0:
            raise ComplianceError('Negative dynamic component: ' + row['code'])
        if enabled and row.get('minimum') not in (None, ''):
            amount = max(amount, number(row['minimum'], 0))
        if row.get('maximum') not in (None, ''):
            amount = min(amount, number(row['maximum'], 0))
        amount = money(amount, row.get('rounding', 'two_decimals'))
        values[row['code']] = amount
        result.append({**deepcopy(row), 'amount': float(amount), 'expression': expression,
                       'resolved_inputs': {k: str(values[k]) for k in sorted(parse_formula(expression)[1])},
                       'label': row.get('name', row['code']), 'source': 'dynamic_payroll'})
    return sorted(result, key=lambda r: (r.get('sequence', 100), r['code']))
