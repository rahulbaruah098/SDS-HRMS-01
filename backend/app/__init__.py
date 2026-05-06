from flask import Flask, jsonify
from flask_cors import CORS
from .config import Config
from .extensions import init_db
from .routes.auth import auth_bp
from .routes.dashboard import dashboard_bp
from .routes.attendance import attendance_bp
from .routes.crud import crud_bp
from .routes.workflow import workflow_bp
from .routes.reports import reports_bp
from .routes.superadmin import superadmin_bp
from .routes.password_requests import password_requests_bp

def create_app():
    app=Flask(__name__); app.config.from_object(Config)
    CORS(app,resources={r'/*':{'origins':['http://127.0.0.1:5173','http://localhost:5173','*']}},allow_headers=['Content-Type','Authorization'],methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'])
    init_db(app)
    app.register_blueprint(auth_bp,url_prefix='/api/v1/auth')
    app.register_blueprint(dashboard_bp,url_prefix='/api/v1/dashboard')
    app.register_blueprint(attendance_bp,url_prefix='/api/v1/attendance')
    app.register_blueprint(crud_bp,url_prefix='/api/v1')
    app.register_blueprint(workflow_bp,url_prefix='/api/v1')
    app.register_blueprint(reports_bp,url_prefix='/api/v1/reports')
    app.register_blueprint(superadmin_bp,url_prefix='/api/v1/superadmin')
    app.register_blueprint(password_requests_bp,url_prefix='/api/v1')
    @app.get('/')
    def root(): return jsonify({'ok':True,'message':'SDS HRMS API','frontend':'Run React Vite on port 5173'})
    @app.get('/api/v1/health')
    def health(): return jsonify({'ok':True,'service':'SDS HRMS API','stack':'React Vite + Flask + MongoDB'})
    return app
