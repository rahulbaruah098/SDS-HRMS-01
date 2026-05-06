
from pymongo import MongoClient, ASCENDING
client=None
db=None

def init_db(app):
    global client, db
    client=MongoClient(app.config['MONGO_URI'])
    db=client.get_default_database()
    ensure_indexes(db)
    return db

def get_db():
    if db is None:
        raise RuntimeError('Database not initialized')
    return db

def ensure_indexes(database):
    database.tenants.create_index([('tenant_id',ASCENDING)], unique=True)
    database.tenants.create_index([('domain',ASCENDING)], sparse=True)
    database.users.create_index([('email',ASCENDING)], unique=True)
    database.users.create_index([('tenant_id',ASCENDING),('roles',ASCENDING)])
    database.employees.create_index([('tenant_id',ASCENDING),('emp_code',ASCENDING)], unique=True, sparse=True)
    database.attendance_logs.create_index([('tenant_id',ASCENDING),('employee_id',ASCENDING),('date',ASCENDING)], unique=True)
    for c in ['departments','designations','projects','states','leave_types','leave_requests','payroll_runs','payslips','job_openings','candidates','trainings','performance_reviews','expenses','assets','tickets','notifications','policies','documents','system_settings','audit_logs']:
        database[c].create_index([('tenant_id',ASCENDING),('created_at',ASCENDING)])
