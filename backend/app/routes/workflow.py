from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from app.extensions import get_db
from app.utils.auth import roles_required, current_user_required, audit
workflow_bp=Blueprint('workflow',__name__)
@workflow_bp.patch('/leave_requests/<req_id>/decision')
@roles_required('super_admin','admin','hr_manager','hr','manager')
def leave_decision(req_id):
    db=get_db(); data=request.get_json(silent=True) or {}; status=data.get('status')
    if status not in ['approved','rejected']: return jsonify({'message':'status must be approved or rejected'}),400
    db.leave_requests.update_one({'_id':ObjectId(req_id),'tenant_id':g.tenant_id},{'$set':{'status':status,'decision_reason':data.get('reason',''),'approved_by':str(g.current_user['_id']),'updated_at':datetime.utcnow()}}); audit(status,'leave_requests',req_id,data)
    return jsonify({'message':f'Leave {status}'})
@workflow_bp.patch('/expenses/<expense_id>/decision')
@roles_required('super_admin','admin','accounts_finance','manager')
def expense_decision(expense_id):
    db=get_db(); data=request.get_json(silent=True) or {}; status=data.get('status')
    if status not in ['approved','rejected','paid']: return jsonify({'message':'Invalid expense status'}),400
    db.expenses.update_one({'_id':ObjectId(expense_id),'tenant_id':g.tenant_id},{'$set':{'status':status,'decision_note':data.get('note',''),'approved_by':str(g.current_user['_id']),'updated_at':datetime.utcnow()}}); audit(status,'expenses',expense_id,data)
    return jsonify({'message':f'Expense {status}'})
@workflow_bp.patch('/tickets/<ticket_id>/status')
@current_user_required
def ticket_status(ticket_id):
    db=get_db(); data=request.get_json(silent=True) or {}; status=data.get('status','in_progress'); comment=data.get('comment','')
    update={'$set':{'status':status,'updated_at':datetime.utcnow()}}
    if comment: update['$push']={'comments':{'by':str(g.current_user['_id']),'comment':comment,'created_at':datetime.utcnow()}}
    db.tickets.update_one({'_id':ObjectId(ticket_id),'tenant_id':g.tenant_id},update); audit('ticket_status','tickets',ticket_id,data)
    return jsonify({'message':'Ticket updated'})
@workflow_bp.post('/payroll/run')
@roles_required('super_admin','admin','accounts_finance')
def payroll_run():
    db=get_db(); data=request.get_json(silent=True) or {}; month=data.get('month')
    if not month: return jsonify({'message':'month is required, format YYYY-MM'}),400
    employees=list(db.employees.find({'tenant_id':g.tenant_id,'status':{'$ne':'Inactive'}})); gross_total=0
    for emp in employees:
        gross=float(emp.get('salary',30000)); deductions=float(data.get('standard_deduction',0)); net=gross-deductions; gross_total+=gross
        db.payslips.update_one({'tenant_id':g.tenant_id,'employee_id':str(emp['_id']),'month':month},{'$set':{'tenant_id':g.tenant_id,'employee_id':str(emp['_id']),'employee_name':emp.get('name'),'month':month,'gross':gross,'deductions':deductions,'net_pay':net,'status':'generated','updated_at':datetime.utcnow()},'$setOnInsert':{'created_at':datetime.utcnow()}},upsert=True)
    run={'tenant_id':g.tenant_id,'month':month,'employee_count':len(employees),'gross_total':gross_total,'status':'processed','created_at':datetime.utcnow(),'created_by':str(g.current_user['_id'])}; res=db.payroll_runs.insert_one(run); audit('payroll_run','payroll_runs',res.inserted_id,run)
    return jsonify({'message':'Payroll processed','run':str(res.inserted_id)})

@workflow_bp.post('/performance/reviews')
@roles_required('super_admin', 'admin', 'hr_manager', 'hr', 'team_leader', 'reporting_officer')
def create_performance_review():
    db = get_db()
    data = request.get_json(silent=True) or {}

    employee_id = data.get('employee_id')
    rating = data.get('rating')
    comments = data.get('comments', '')
    cycle = data.get('cycle') or datetime.utcnow().strftime('%B %Y')

    if not employee_id:
        return jsonify({'message': 'employee_id is required'}), 400

    try:
        rating = float(rating)
    except Exception:
        return jsonify({'message': 'rating must be a number'}), 400

    if rating < 1 or rating > 5:
        return jsonify({'message': 'rating must be between 1 and 5'}), 400

    employee = db.employees.find_one({
        '_id': ObjectId(employee_id),
        'tenant_id': g.tenant_id
    })

    if not employee:
        return jsonify({'message': 'Employee not found'}), 404

    roles = set(g.current_user.get('roles', []))
    reviewer_emp = db.employees.find_one({
        'tenant_id': g.tenant_id,
        'user_id': str(g.current_user['_id'])
    })
    reviewer_emp_id = str(reviewer_emp['_id']) if reviewer_emp else ''

    # Team leader can review only their assigned team members
    if 'team_leader' in roles and not roles.intersection({'super_admin', 'admin', 'hr_manager', 'hr'}):
        if employee.get('team_leader_id') != reviewer_emp_id:
            return jsonify({'message': 'You can review only your assigned team members'}), 403

    # Reporting officer can review only employees assigned to them
    if 'reporting_officer' in roles and not roles.intersection({'super_admin', 'admin', 'hr_manager', 'hr'}):
        if employee.get('reporting_officer_id') != reviewer_emp_id:
            return jsonify({'message': 'You can review only employees assigned to you'}), 403

    review = {
        'tenant_id': g.tenant_id,
        'employee_id': employee_id,
        'employee_name': employee.get('name'),
        'cycle': cycle,
        'rating': rating,
        'comments': comments,
        'reviewer_id': str(g.current_user['_id']),
        'reviewer_employee_id': reviewer_emp_id,
        'reviewer_name': g.current_user.get('name') or g.current_user.get('email'),
        'reviewer_role': ','.join(g.current_user.get('roles', [])),
        'visibility': ['md', 'hr', 'employee_self'],
        'status': 'submitted',
        'created_at': datetime.utcnow(),
        'created_by': str(g.current_user['_id'])
    }

    res = db.performance_reviews.insert_one(review)
    audit('create_performance_review', 'performance_reviews', res.inserted_id, review)

    return jsonify({
        'message': 'Performance review submitted',
        'item': str(res.inserted_id)
    }), 201