import os
from dotenv import load_dotenv


load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-key")

    MONGO_URI = os.getenv(
        "MONGO_URI",
        "mongodb://localhost:27017/sds_hrms_full",
    )

    DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "sds")

    JSON_SORT_KEYS = False

    MAX_CONTENT_LENGTH = int(
        os.getenv("MAX_CONTENT_LENGTH", 16 * 1024 * 1024)
    )

    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

    FRONTEND_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]