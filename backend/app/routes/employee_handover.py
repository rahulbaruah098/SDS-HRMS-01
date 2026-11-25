"""HR/Admin handover preview and explicit team-succession appointments."""
from bson import ObjectId
from functools import wraps
import jwt
from flask import Blueprint, jsonify, request, g, current_app
from app.extensions import get_db
from app.utils.auth import (safe_object_id, find_employee_for_user,
    employee_login_is_alumni, build_effective_roles)
from app.services.handover_preview import preview

employee_handover_bp = Blueprint('employee_handover', __name__)
_ALLOWED = {'admin','hr_admin','hr_manager','hr'}


def _read_only_authenticated(fn):
    """Same access-token, active-user and alumni checks as current_user_required,
    but avoid its sync_effective_roles() user-record write on GET-like previews.
    """
    @wraps(fn)
    def inner(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or not auth[7:].strip():
            return jsonify({'message':'Missing token'}),401
        try:
            payload = jwt.decode(auth[7:].strip(), current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return jsonify({'message':'Token expired'}),401
        except jwt.InvalidTokenError:
            return jsonify({'message':'Invalid token'}),401
        if payload.get('token_type','access') != 'access':
            return jsonify({'message':'Invalid access token type'}),401
        uid = safe_object_id(payload.get('sub'))
        if uid is None:
            return jsonify({'message':'Invalid token user'}),401
        db = get_db()
        user = db.users.find_one({'_id':uid,'is_active':True})
        if user is None:
            return jsonify({'message':'User not found'}),401
        tenant = user.get('tenant_id')
        if not isinstance(tenant,str) or not tenant.strip():
            return jsonify({'message':'Company assignment is missing'}),403
        linked = find_employee_for_user(db,user)
        if employee_login_is_alumni(linked):
            return jsonify({'message':'This employee account is no longer active'}),401
        user['roles'] = build_effective_roles(user,linked)
        g.current_user = user
        g.tenant_id = tenant
        return fn(*args,**kwargs)
    return inner


@employee_handover_bp.route('/preview', methods=['POST'])
@_read_only_authenticated
def handover_preview():
    roles = set((g.current_user or {}).get('roles') or [])
    # super_admin is a platform-wide role, not a company HR authorization.
    if not roles.intersection(_ALLOWED):
        return jsonify({'message':'HR/Admin role required'}),403
    tenant = (g.current_user or {}).get('tenant_id')
    if not isinstance(tenant,str) or not tenant.strip():
        return jsonify({'message':'Company assignment is required'}),403
    body = request.get_json(silent=True)
    if not isinstance(body,dict):
        return jsonify({'message':'A JSON object is required'}),400
    first = body.get('departing_employee_id')
    second = body.get('replacement_employee_id')
    if not (isinstance(first,str) and isinstance(second,str) and ObjectId.is_valid(first) and ObjectId.is_valid(second)):
        return jsonify({'message':'Valid departing and replacement employee IDs are required'}),400
    if first.lower() == second.lower():
        return jsonify({'message':'Employees must differ'}),400
    db = get_db()
    projection = {'_id':1,'tenant_id':1,'is_alumni':1,'is_active':1,'active':1,'is_deleted':1,
        'status':1,'employment_status':1,'employee_status':1,'notice_status':1,
        'last_working_day':1,'last_working_date':1,'notice_start_date':1}
    departing = db.employees.find_one({'_id':ObjectId(first),'tenant_id':tenant,'is_deleted':{'$ne':True}},projection)
    replacement = db.employees.find_one({'_id':ObjectId(second),'tenant_id':tenant,'is_deleted':{'$ne':True}},projection)
    if departing is None or replacement is None:
        return jsonify({'message':'Employee not found in current company'}),404
    try:
        result = preview(db,tenant,departing,replacement)
    except ValueError as exc:
        return jsonify({'message':str(exc)}),409
    except Exception:
        current_app.logger.exception('Handover preview failed')
        return jsonify({'message':'Unable to generate handover preview'}),500
    return jsonify(result),200


@employee_handover_bp.get('/succession')
@_read_only_authenticated
def succession_list():
    from app.services import team_responsibility as r
    roles = set(g.current_user.get('roles') or [])
    if not roles.intersection(_ALLOWED) or roles.intersection({'super_admin', 'superadmin'}):
        return jsonify({'message': 'Tenant HR/Admin role required'}), 403
    db, tenant = get_db(), g.tenant_id
    rows = [r.describe(db, tenant, source) for source in r.sources(db, tenant)]
    candidates = [{'id': str(p['_id']), 'name': p.get('name') or p.get('employee_name') or 'Employee',
        'department': p.get('department', ''),
        'reporting_officer_id': str((r.resolve(db, tenant, p.get('reporting_officer_id')) or {}).get('_id') or '')}
        for p in db.employees.find({'tenant_id': tenant}) if r.capability(p, 'tl')]
    return jsonify({'items': rows, 'candidates': candidates})


@employee_handover_bp.post('/succession/appoint')
@_read_only_authenticated
def succession_appoint():
    from app.services import team_responsibility as r
    roles = set(g.current_user.get('roles') or [])
    if not roles.intersection(_ALLOWED) or roles.intersection({'super_admin', 'superadmin'}):
        return jsonify({'message': 'Tenant HR/Admin role required'}), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('confirmation') != 'ASSIGN' or type(data.get('version')) is not int:
        return jsonify({'message': 'Review the team and confirm ASSIGN with its current version'}), 400
    try:
        item = r.appoint(get_db(), g.tenant_id, data.get('team_id'), data.get('replacement_employee_id'),
                         data['version'], str(g.current_user['_id']))
        return jsonify({'item': item, 'message': 'Team responsibilities assigned'})
    except ValueError as exc:
        return jsonify({'message': str(exc)}), 409
