import os
from dotenv import load_dotenv
load_dotenv()
class Config:
    SECRET_KEY=os.getenv('SECRET_KEY','dev-secret-key')
    JWT_SECRET_KEY=os.getenv('JWT_SECRET_KEY','dev-jwt-secret-key')
    MONGO_URI=os.getenv('MONGO_URI','mongodb://localhost:27017/sds_hrms_full')
    DEFAULT_TENANT_ID=os.getenv('DEFAULT_TENANT_ID','sds')
