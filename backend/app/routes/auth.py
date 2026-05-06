from flask import Blueprint, request, jsonify, g
from werkzeug.security import check_password_hash
from app.extensions import get_db
from app.utils.auth import issue_token, current_user_required, audit
from app.utils.serializers import clean_doc
auth_bp=Blueprint('auth',__name__)
@auth_bp.post('/login')
def login():
    db=get_db(); data=request.get_json(silent=True) or {}
    email=(data.get('email') or '').strip().lower(); password=data.get('password') or ''
    if not email or not password: return jsonify({'message':'Email and password are required'}),400
    user=db.users.find_one({'email':email,'is_active':True})
    if not user or not check_password_hash(user.get('password_hash',''),password): return jsonify({'message':'Invalid email or password'}),401
    token=issue_token(user); emp=db.employees.find_one({'user_id':str(user['_id'])})
    audit('login','users',user['_id'],{'email':email})
    return jsonify({'token':token,'user':clean_doc(user),'employee':clean_doc(emp)})
@auth_bp.get('/me')
@current_user_required
def me():
    db=get_db(); emp=db.employees.find_one({'user_id':str(g.current_user['_id'])})
    return jsonify({'user':clean_doc(g.current_user),'employee':clean_doc(emp)})
