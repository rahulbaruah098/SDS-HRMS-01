from flask import Blueprint, jsonify, g
from app.extensions import get_db
from app.utils.auth import roles_required
from app.utils.serializers import clean_doc
reports_bp=Blueprint('reports',__name__)
@reports_bp.get('/summary')
@roles_required('super_admin','admin','hr_manager','hr','accounts_finance','manager')
def summary():
    db=get_db(); cs=['employees','attendance_logs','leave_requests','payroll_runs','payslips','job_openings','candidates','trainings','performance_reviews','expenses','assets','tickets','notifications','audit_logs']
    return jsonify({'counts':{c:db[c].count_documents({'tenant_id':g.tenant_id}) for c in cs}})
@reports_bp.get('/audit')
@roles_required('super_admin','admin','hr_manager')
def audits():
    db=get_db(); return jsonify({'items':clean_doc(list(db.audit_logs.find({'tenant_id':g.tenant_id}).sort('created_at',-1).limit(300)))})
