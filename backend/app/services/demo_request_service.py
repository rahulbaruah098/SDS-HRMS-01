import re
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from werkzeug.security import generate_password_hash


LEGAL_SUFFIX_WORDS = {
    "private",
    "pvt",
    "limited",
    "ltd",
    "llp",
    "opc",
    "company",
    "co",
    "inc",
    "incorporated",
    "corporation",
    "corp",
    "india",
}

DEFAULT_DEMO_MODULES = [
    "attendance",
    "apply_leave",
    "projects",
]


class DemoRequestError(RuntimeError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def normalize_email(value):
    return safe_str(value).lower()


def normalize_phone(value):
    return re.sub(r"\s+", "", safe_str(value))


def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_config_value(config, key, default=None):
    if not config:
        return default

    try:
        return config.get(key, default)
    except AttributeError:
        return getattr(config, key, default)


def normalize_module_list(value):
    if not value:
        return list(DEFAULT_DEMO_MODULES)

    if isinstance(value, str):
        parts = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        return list(DEFAULT_DEMO_MODULES)

    modules = []

    for item in parts:
        module = (
            safe_str(item)
            .lower()
            .replace(" ", "_")
            .replace("-", "_")
        )

        if module and module not in modules:
            modules.append(module)

    return modules or list(DEFAULT_DEMO_MODULES)


def tokenize_company_name(company_name):
    text = safe_str(company_name).lower()
    text = text.replace("&", " and ")
    tokens = re.findall(r"[a-z0-9]+", text)

    return [token for token in tokens if token]


def generate_company_initials(company_name):
    """
    Converts a company name into a short login prefix.

    Example:
    Rahul Baruah Private Limited -> rbpvt
    Generated email later becomes rbpvt@yourcomate.com
    Generated password later becomes rbpvt@1234
    """

    tokens = tokenize_company_name(company_name)

    if not tokens:
        return "company"

    has_private = any(token in {"private", "pvt"} for token in tokens)
    has_limited = any(token in {"limited", "ltd"} for token in tokens)
    has_llp = "llp" in tokens
    has_opc = "opc" in tokens

    business_tokens = [
        token
        for token in tokens
        if token not in LEGAL_SUFFIX_WORDS
    ]

    if not business_tokens:
        business_tokens = [
            token
            for token in tokens
            if token not in {"private", "pvt", "limited", "ltd"}
        ]

    if not business_tokens:
        business_tokens = tokens[:2]

    initials = "".join(token[0] for token in business_tokens[:4] if token)

    suffix = ""

    if has_private:
        suffix = "pvt"
    elif has_llp:
        suffix = "llp"
    elif has_opc:
        suffix = "opc"
    elif has_limited:
        suffix = "ltd"

    prefix = f"{initials}{suffix}" if suffix else initials
    prefix = re.sub(r"[^a-z0-9]", "", prefix.lower())

    return prefix or "company"


def make_unique_prefix(db, base_prefix):
    base_prefix = re.sub(r"[^a-z0-9]", "", safe_str(base_prefix).lower()) or "company"
    prefix = base_prefix
    counter = 2

    while True:
        email_regex = f"^{re.escape(prefix)}@"
        existing_tenant = db.tenants.find_one({"tenant_id": prefix})
        existing_user = db.users.find_one({
            "email": {"$regex": email_regex, "$options": "i"},
            "is_deleted": {"$ne": True},
        })

        if not existing_tenant and not existing_user:
            return prefix

        prefix = f"{base_prefix}{counter}"
        counter += 1


def generate_admin_credentials(db, company_name, config=None):
    domain = safe_str(
        get_config_value(config, "AUTO_ADMIN_EMAIL_DOMAIN", "yourcomate.com")
    ) or "yourcomate.com"
    password_suffix = safe_str(
        get_config_value(config, "GENERATED_ADMIN_PASSWORD_SUFFIX", "@1234")
    ) or "@1234"

    base_prefix = generate_company_initials(company_name)
    prefix = make_unique_prefix(db, base_prefix)

    return {
        "login_prefix": prefix,
        "admin_email": f"{prefix}@{domain}",
        "admin_password": f"{prefix}{password_suffix}",
    }


def make_unique_tenant_id(db, base_prefix):
    base_prefix = re.sub(r"[^a-z0-9-]", "", safe_str(base_prefix).lower()) or "company"
    tenant_id = base_prefix
    counter = 2

    while db.tenants.find_one({"tenant_id": tenant_id}):
        tenant_id = f"{base_prefix}{counter}"
        counter += 1

    return tenant_id


def build_demo_request_document(data, otp_payload=None):
    data = data or {}
    otp_payload = otp_payload or {}

    company_name = safe_str(data.get("company_name") or data.get("name"))
    company_email = normalize_email(data.get("company_email") or data.get("email"))
    company_phone = normalize_phone(data.get("company_phone") or data.get("phone"))
    contact_person_name = safe_str(
        data.get("contact_person_name")
        or data.get("contact_name")
        or data.get("admin_name")
    )
    contact_person_phone = normalize_phone(
        data.get("contact_person_phone")
        or data.get("admin_phone")
        or company_phone
    )

    if not company_name:
        raise DemoRequestError("Company name is required.")

    if not company_email:
        raise DemoRequestError("Company email is required.")

    if not contact_person_name:
        raise DemoRequestError("Contact person name is required.")

    created_at = now_utc()

    return {
        "company_name": company_name,
        "company_email": company_email,
        "company_phone": company_phone,
        "company_address": safe_str(data.get("company_address") or data.get("address")),
        "company_type": safe_str(data.get("company_type")),
        "contact_person_name": contact_person_name,
        "contact_person_phone": contact_person_phone,
        "requested_employee_count": to_int(data.get("requested_employee_count"), 0),
        "message": safe_str(data.get("message") or data.get("purpose")),
        "status": "otp_pending",
        "otp_verified": False,
        "approval_status": "not_submitted",
        "generated_admin_email": "",
        "generated_admin_password_masked": "",
        "tenant_id": "",
        "trial_start_date": None,
        "trial_end_date": None,
        "created_at": created_at,
        "updated_at": created_at,
        "is_deleted": False,
        **otp_payload,
    }


def demo_request_public_filter(email=None, request_id=None):
    query = {"is_deleted": {"$ne": True}}

    if request_id:
        object_id = as_object_id(request_id)
        if object_id:
            query["_id"] = object_id
        else:
            query["request_id"] = safe_str(request_id)

    if email:
        query["company_email"] = normalize_email(email)

    return query


def as_object_id(value):
    try:
        text = safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def find_demo_request(db, request_id=None, email=None):
    query = demo_request_public_filter(email=email, request_id=request_id)
    return db.demo_requests.find_one(query)


def ensure_demo_request_can_be_approved(demo_request):
    if not demo_request:
        raise DemoRequestError("Demo request not found.", 404)

    if demo_request.get("is_deleted") is True:
        raise DemoRequestError("Demo request not found.", 404)

    if demo_request.get("status") == "approved":
        raise DemoRequestError("This demo request is already approved.", 409)

    if demo_request.get("status") == "rejected":
        raise DemoRequestError("This demo request has already been rejected.", 409)

    if demo_request.get("otp_verified") is not True:
        raise DemoRequestError("Company email OTP is not verified yet.", 400)

    if demo_request.get("status") not in {"pending", "otp_verified"}:
        raise DemoRequestError("Only pending verified demo requests can be approved.", 400)


def ensure_demo_request_can_be_rejected(demo_request):
    if not demo_request:
        raise DemoRequestError("Demo request not found.", 404)

    if demo_request.get("status") == "approved":
        raise DemoRequestError("Approved demo request cannot be rejected.", 409)

    if demo_request.get("status") == "rejected":
        raise DemoRequestError("This demo request is already rejected.", 409)


def build_tenant_document(demo_request, tenant_id, credentials, approved_by, config=None):
    trial_days = to_int(get_config_value(config, "DEMO_DURATION_DAYS", 30), 30)
    employee_limit = to_int(get_config_value(config, "DEMO_EMPLOYEE_LIMIT", 10), 10)
    allowed_modules = normalize_module_list(
        get_config_value(config, "DEMO_ALLOWED_MODULES", DEFAULT_DEMO_MODULES)
    )

    trial_start = now_utc()
    trial_end = trial_start + timedelta(days=trial_days)

    return {
        "tenant_id": tenant_id,
        "tenant_code": tenant_id.upper(),
        "name": demo_request.get("company_name"),
        "company_name": demo_request.get("company_name"),
        "domain": f"{tenant_id}.{get_config_value(config, 'YOURCOMATE_DOMAIN', 'yourcomate.com')}",
        "contact_email": demo_request.get("company_email"),
        "contact_phone": demo_request.get("company_phone"),
        "address": demo_request.get("company_address", ""),
        "status": "active",
        "plan": "Demo",
        "plan_type": "demo",
        "subscription_status": "demo",
        "trial_status": "active",
        "trial_start_date": trial_start,
        "trial_end_date": trial_end,
        "demo_duration_days": trial_days,
        "employee_limit": employee_limit,
        "allowed_modules": allowed_modules,
        "is_sds_company": False,
        "is_lifetime": False,
        "is_demo_company": True,
        "demo_request_id": str(demo_request.get("_id")),
        "generated_admin_email": credentials["admin_email"],
        "created_at": trial_start,
        "created_by": safe_str(approved_by),
        "updated_at": trial_start,
        "is_deleted": False,
    }


def build_admin_user_document(demo_request, tenant_id, credentials, approved_by):
    admin_name = safe_str(demo_request.get("contact_person_name")) or f"{demo_request.get('company_name')} Admin"
    created_at = now_utc()

    return {
        "tenant_id": tenant_id,
        "name": admin_name,
        "full_name": admin_name,
        "email": credentials["admin_email"],
        "username": credentials["admin_email"],
        "password_hash": generate_password_hash(credentials["admin_password"]),
        "role": "admin",
        "roles": ["admin", "hr_manager"],
        "is_active": True,
        "status": "active",
        "is_deleted": False,
        "is_demo_admin": True,
        "created_at": created_at,
        "created_by": safe_str(approved_by),
        "updated_at": created_at,
    }


def build_admin_employee_document(demo_request, tenant_id, user_id, credentials, approved_by):
    admin_name = safe_str(demo_request.get("contact_person_name")) or f"{demo_request.get('company_name')} Admin"
    created_at = now_utc()
    emp_code = f"{tenant_id.upper()}-ADMIN"

    return {
        "tenant_id": tenant_id,
        "user_id": safe_str(user_id),
        "emp_code": emp_code,
        "employee_id": emp_code,
        "name": admin_name,
        "employee_name": admin_name,
        "email": credentials["admin_email"],
        "phone": demo_request.get("contact_person_phone") or demo_request.get("company_phone") or "",
        "country": "India",
        "joining_date": created_at.date().isoformat(),
        "date_of_birth": "",
        "blood_group": "",
        "gross_salary": "",
        "branch": "Assam(HO)",
        "department": "HR & Admin",
        "designation": "Manager",
        "role": "Employee",
        "shift": "General",
        "gender": "",
        "job_type": "Regular",
        "project": "Administration",
        "state": "Assam(HO)",
        "status": "Active",
        "salary": 0,
        "is_team_leader": "false",
        "is_reporting_officer": "true",
        "is_it_support_head": "false",
        "is_it_support_member": "false",
        "team_leader_id": "",
        "team_leader_name": "",
        "reporting_officer_id": "",
        "reporting_officer_name": "",
        "is_demo_admin": True,
        "created_at": created_at,
        "updated_at": created_at,
        "created_by": safe_str(approved_by),
        "is_deleted": False,
    }


def build_demo_subscription_document(demo_request, tenant_id, config=None):
    trial_days = to_int(get_config_value(config, "DEMO_DURATION_DAYS", 30), 30)
    started_at = now_utc()
    ends_at = started_at + timedelta(days=trial_days)

    return {
        "tenant_id": tenant_id,
        "company_name": demo_request.get("company_name"),
        "plan_name": "Demo",
        "plan_type": "demo",
        "status": "active",
        "amount": 0,
        "currency": get_config_value(config, "RAZORPAY_CURRENCY", "INR"),
        "started_at": started_at,
        "ends_at": ends_at,
        "demo_request_id": str(demo_request.get("_id")),
        "created_at": started_at,
        "updated_at": started_at,
        "is_deleted": False,
    }


def approve_demo_request(db, demo_request_id, approved_by, config=None):
    demo_request = find_demo_request(db, request_id=demo_request_id)
    ensure_demo_request_can_be_approved(demo_request)

    credentials = generate_admin_credentials(
        db,
        demo_request.get("company_name"),
        config=config,
    )
    tenant_id = make_unique_tenant_id(db, credentials["login_prefix"])

    if db.users.find_one({"email": credentials["admin_email"], "is_deleted": {"$ne": True}}):
        raise DemoRequestError("Generated admin email already exists. Please retry approval.", 409)

    tenant_doc = build_tenant_document(
        demo_request,
        tenant_id,
        credentials,
        approved_by,
        config=config,
    )
    tenant_result = db.tenants.insert_one(tenant_doc)

    user_doc = build_admin_user_document(
        demo_request,
        tenant_id,
        credentials,
        approved_by,
    )
    user_result = db.users.insert_one(user_doc)

    employee_doc = build_admin_employee_document(
        demo_request,
        tenant_id,
        user_result.inserted_id,
        credentials,
        approved_by,
    )
    employee_result = db.employees.insert_one(employee_doc)

    db.users.update_one(
        {"_id": user_result.inserted_id},
        {
            "$set": {
                "employee_id": str(employee_result.inserted_id),
                "employee_ref_id": str(employee_result.inserted_id),
                "emp_code": employee_doc["emp_code"],
                "department": employee_doc["department"],
                "designation": employee_doc["designation"],
                "updated_at": now_utc(),
            }
        },
    )

    subscription_doc = build_demo_subscription_document(
        demo_request,
        tenant_id,
        config=config,
    )
    subscription_result = db.subscriptions.insert_one(subscription_doc)

    db.demo_requests.update_one(
        {"_id": demo_request["_id"]},
        {
            "$set": {
                "status": "approved",
                "approval_status": "approved",
                "approved_at": now_utc(),
                "approved_by": safe_str(approved_by),
                "tenant_id": tenant_id,
                "tenant_object_id": str(tenant_result.inserted_id),
                "admin_user_id": str(user_result.inserted_id),
                "admin_employee_id": str(employee_result.inserted_id),
                "subscription_id": str(subscription_result.inserted_id),
                "generated_admin_email": credentials["admin_email"],
                "generated_admin_password_masked": "********",
                "trial_start_date": tenant_doc["trial_start_date"],
                "trial_end_date": tenant_doc["trial_end_date"],
                "updated_at": now_utc(),
            }
        },
    )

    return {
        "tenant": tenant_doc,
        "tenant_id": tenant_id,
        "admin_user_id": str(user_result.inserted_id),
        "admin_employee_id": str(employee_result.inserted_id),
        "subscription_id": str(subscription_result.inserted_id),
        "admin_email": credentials["admin_email"],
        "admin_password": credentials["admin_password"],
        "trial_start_date": tenant_doc["trial_start_date"],
        "trial_end_date": tenant_doc["trial_end_date"],
        "employee_limit": tenant_doc["employee_limit"],
        "allowed_modules": tenant_doc["allowed_modules"],
    }


def reject_demo_request(db, demo_request_id, rejected_by, reason=""):
    demo_request = find_demo_request(db, request_id=demo_request_id)
    ensure_demo_request_can_be_rejected(demo_request)

    reason = safe_str(reason) or "Your demo request could not be approved at this time."

    db.demo_requests.update_one(
        {"_id": demo_request["_id"]},
        {
            "$set": {
                "status": "rejected",
                "approval_status": "rejected",
                "rejected_at": now_utc(),
                "rejected_by": safe_str(rejected_by),
                "rejection_reason": reason,
                "updated_at": now_utc(),
            }
        },
    )

    return {
        "company_name": demo_request.get("company_name"),
        "company_email": demo_request.get("company_email"),
        "reason": reason,
    }
