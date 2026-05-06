from flask import Blueprint, request, jsonify, g
from datetime import datetime, date, time
from bson import ObjectId
from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc
attendance_bp=Blueprint('attendance',__name__); LATE_CUTOFF=time(9,45)
def emp(db): return db.employees.find_one({'tenant_id':g.tenant_id,'user_id':str(g.current_user['_id'])})
@attendance_bp.post('/check-in')
@current_user_required
def check_in():
    db=get_db(); e=emp(db)
    if not e: return jsonify({'message':'Employee profile not found'}),404
    data=request.get_json(silent=True) or {}; mode=data.get('mode','office'); late_reason=(data.get('late_reason') or '').strip(); field_location=(data.get('field_location') or '').strip(); now=datetime.now(); today=now.date().isoformat(); is_late=now.time()>LATE_CUTOFF
    if is_late and not late_reason: return jsonify({'message':'Late reason is required after 09:45 AM'}),400
    if mode=='field' and not field_location: return jsonify({'message':'Field location is required for field mode'}),400
    old=db.attendance_logs.find_one({'tenant_id':g.tenant_id,'employee_id':str(e['_id']),'date':today})
    if old and old.get('check_in'): return jsonify({'message':'Already checked in today','attendance':clean_doc(old)}),409
    doc={'tenant_id':g.tenant_id,'employee_id':str(e['_id']),'employee_name':e.get('name'),'department':e.get('department'),'date':today,'check_in':now,'check_out':None,'mode':mode,'field_location':field_location,'late_reason':late_reason,'status':'late' if is_late else 'present','verified_by_ro':False,'timeline':[{'type':'check_in','time':now,'note':mode.title()+' mode'}],'created_at':now,'updated_at':now}
    db.attendance_logs.insert_one(doc); audit('check_in','attendance_logs',doc.get('_id'),{'mode':mode,'late':is_late}); return jsonify({'message':'Check-in successful','attendance':clean_doc(doc)})
@attendance_bp.post('/check-out')
@current_user_required
def check_out():
    db=get_db(); e=emp(db); now=datetime.now(); today=now.date().isoformat()
    if not e: return jsonify({'message':'Employee profile not found'}),404
    rec=db.attendance_logs.find_one({'tenant_id':g.tenant_id,'employee_id':str(e['_id']),'date':today})
    if not rec: return jsonify({'message':'Please check in first'}),400
    if rec.get('check_out'): return jsonify({'message':'Already checked out','attendance':clean_doc(rec)}),409
    db.attendance_logs.update_one({'_id':rec['_id']},{'$set':{'check_out':now,'updated_at':now},'$push':{'timeline':{'type':'check_out','time':now,'note':'Day closed'}}}); return jsonify({'message':'Check-out successful','attendance':clean_doc(db.attendance_logs.find_one({'_id':rec['_id']}))})
@attendance_bp.get('/my')
@current_user_required
def my():
    db=get_db(); e=emp(db); q={'tenant_id':g.tenant_id,'employee_id':str(e['_id'])} if e else {'_id':'none'}; return jsonify({'items':clean_doc(list(db.attendance_logs.find(q).sort('date',-1).limit(60)))})
@attendance_bp.get('/report')
@roles_required('super_admin','admin','hr_manager','hr','manager')
def report():
    db=get_db(); return jsonify({'items':clean_doc(list(db.attendance_logs.find({'tenant_id':g.tenant_id}).sort('date',-1).limit(300)))})
@attendance_bp.patch('/<attendance_id>/verify')
@roles_required('super_admin','admin','hr_manager','hr','manager')
def verify(attendance_id):
    db=get_db(); db.attendance_logs.update_one({'_id':ObjectId(attendance_id),'tenant_id':g.tenant_id},{'$set':{'verified_by_ro':True,'verified_at':datetime.utcnow(),'verified_by':str(g.current_user['_id'])}}); audit('verify','attendance_logs',attendance_id); return jsonify({'message':'Attendance verified'})
