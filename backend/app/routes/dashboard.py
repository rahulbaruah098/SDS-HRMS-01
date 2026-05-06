from flask import Blueprint, jsonify, g
from datetime import date
from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc
dashboard_bp=Blueprint('dashboard',__name__)

@dashboard_bp.get('/superadmin')
@current_user_required
def superadmin_dashboard():
    db=get_db(); roles=set(g.current_user.get('roles',[]))
    if 'super_admin' not in roles:
        return jsonify({'message':'Forbidden'}),403
    tenants=list(db.tenants.find({}).sort('created_at',-1).limit(8))
    stats={
        'Companies':db.tenants.count_documents({}),
        'Active Companies':db.tenants.count_documents({'status':'active'}),
        'Total Users':db.users.count_documents({}),
        'Active Users':db.users.count_documents({'is_active':True}),
        'Total Employees':db.employees.count_documents({'status':{'$ne':'Inactive'}}),
        'Total Attendance Logs':db.attendance_logs.count_documents({}),
        'Open Tickets':db.tickets.count_documents({'status':{'$in':['open','in_progress']}}),
        'Pending Leaves':db.leave_requests.count_documents({'status':'pending'}),
        'Payroll Runs':db.payroll_runs.count_documents({}),
        'Audit Logs':db.audit_logs.count_documents({})
    }
    tenant_summary=[]
    for t in tenants:
        tid=t.get('tenant_id')
        tenant_summary.append({
            'tenant_id':tid,
            'name':t.get('name'),
            'status':t.get('status'),
            'users':db.users.count_documents({'tenant_id':tid}),
            'employees':db.employees.count_documents({'tenant_id':tid}),
            'open_tickets':db.tickets.count_documents({'tenant_id':tid,'status':{'$in':['open','in_progress']}})
        })
    return jsonify({'stats':stats,'tenants':clean_doc(tenant_summary),'recent_users':clean_doc(list(db.users.find({}).sort('created_at',-1).limit(8))),'recent_audit':clean_doc(list(db.audit_logs.find({}).sort('created_at',-1).limit(8)))})

def cnt(db,c,extra=None):
    q={'tenant_id':g.tenant_id}; q.update(extra or {}); return db[c].count_documents(q)
@dashboard_bp.get('/admin')
@current_user_required
def admin_dashboard():
    db=get_db(); today=date.today().isoformat(); total=cnt(db,'employees',{'status':{'$ne':'Inactive'}}); checked=cnt(db,'attendance_logs',{'date':today})
    stats={'Total Employees':total,'Present Today':cnt(db,'attendance_logs',{'date':today,'status':{'$in':['present','late']}}),'Late Today':cnt(db,'attendance_logs',{'date':today,'status':'late'}),'Absent Today':max(0,total-checked),'On Leave':cnt(db,'leave_requests',{'status':'approved'}),'Pending Leaves':cnt(db,'leave_requests',{'status':'pending'}),'Open Tickets':cnt(db,'tickets',{'status':{'$in':['open','in_progress']}}),'Pending Expenses':cnt(db,'expenses',{'status':'pending'}),'Candidates':cnt(db,'candidates'),'Assets Assigned':cnt(db,'assets',{'status':'assigned'})}
    return jsonify({'stats':stats,'departments':clean_doc(list(db.departments.find({'tenant_id':g.tenant_id}).sort('name',1))),'recent_attendance':clean_doc(list(db.attendance_logs.find({'tenant_id':g.tenant_id}).sort('created_at',-1).limit(8))),'pending':clean_doc({'leave_requests':list(db.leave_requests.find({'tenant_id':g.tenant_id,'status':'pending'}).limit(5)),'expenses':list(db.expenses.find({'tenant_id':g.tenant_id,'status':'pending'}).limit(5)),'tickets':list(db.tickets.find({'tenant_id':g.tenant_id,'status':'open'}).limit(5))})})


@dashboard_bp.get('/employee')
@current_user_required
def employee_dashboard():
    db = get_db()
    roles = set(g.current_user.get('roles', []))

    emp = db.employees.find_one({
        'tenant_id': g.tenant_id,
        'user_id': str(g.current_user['_id'])
    })

    emp_id = str(emp['_id']) if emp else '__none__'
    today = date.today().isoformat()

    team_members = []
    if 'team_leader' in roles and emp:
        team_members = list(db.employees.find({
            'tenant_id': g.tenant_id,
            'team_leader_id': emp_id,
            'status': {'$ne': 'Inactive'}
        }).sort('name', 1))

    reporting_members = []
    if 'reporting_officer' in roles and emp:
        reporting_members = list(db.employees.find({
            'tenant_id': g.tenant_id,
            'reporting_officer_id': emp_id,
            'status': {'$ne': 'Inactive'}
        }).sort('name', 1))

    my_reviews = list(db.performance_reviews.find({
        'tenant_id': g.tenant_id,
        'employee_id': emp_id
    }).sort('created_at', -1).limit(10))

    return jsonify({
        'employee': clean_doc(emp),
        'roles': list(roles),
        'is_team_leader': 'team_leader' in roles,
        'is_reporting_officer': 'reporting_officer' in roles,
        'team_members': clean_doc(team_members),
        'reporting_members': clean_doc(reporting_members),
        'my_performance_reviews': clean_doc(my_reviews),
        'today_attendance': clean_doc(db.attendance_logs.find_one({
            'tenant_id': g.tenant_id,
            'employee_id': emp_id,
            'date': today
        })),
        'leaves': clean_doc(list(db.leave_requests.find({
            'tenant_id': g.tenant_id,
            'employee_id': emp_id
        }).sort('created_at', -1).limit(5))),
        'tickets': clean_doc(list(db.tickets.find({
            'tenant_id': g.tenant_id,
            'raised_by': emp_id
        }).sort('created_at', -1).limit(5))),
        'notifications': clean_doc(list(db.notifications.find({
            'tenant_id': g.tenant_id,
            'user_id': str(g.current_user['_id'])
        }).sort('created_at', -1).limit(8)))
    })