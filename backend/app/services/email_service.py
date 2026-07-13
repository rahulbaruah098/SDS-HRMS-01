import smtplib
from email.message import EmailMessage
from html import escape
from urllib.parse import urljoin

from flask import current_app


class EmailSendError(RuntimeError):
    """Raised when SMTP email sending fails."""


DEFAULT_TEXT_FOOTER = "\n\nRegards,\nYourComate HRMS Team"


def _config(name, default=None):
    return current_app.config.get(name, default)


def _sender_value():
    sender_email = _config("MAIL_DEFAULT_SENDER") or _config("MAIL_USERNAME")
    sender_name = _config("MAIL_SENDER_NAME", "YourComate HRMS")

    if sender_name and sender_email:
        return f"{sender_name} <{sender_email}>"

    return sender_email or "no-reply@yourcomate.com"


def _frontend_url(path=""):
    base_url = (_config("FRONTEND_BASE_URL", "") or "").rstrip("/") + "/"
    clean_path = str(path or "").lstrip("/")

    if not clean_path:
        return base_url.rstrip("/")

    return urljoin(base_url, clean_path)


def is_email_configured():
    """
    Returns True only when SMTP username and password are configured.
    This keeps local development from crashing when mail credentials are missing.
    """

    return bool(_config("MAIL_USERNAME") and _config("MAIL_PASSWORD"))


def send_email(to, subject, text_body, html_body=None, reply_to=None):
    """
    Sends a plain text / optional HTML email using SMTP settings from Config.

    Returns:
        dict: {"ok": bool, "message": str}
    """

    recipient = str(to or "").strip()
    subject = str(subject or "").strip()

    if not recipient:
        return {"ok": False, "message": "Recipient email is required."}

    if not subject:
        return {"ok": False, "message": "Email subject is required."}

    if not is_email_configured():
        return {
            "ok": False,
            "message": "SMTP email is not configured. Please set MAIL_USERNAME and MAIL_PASSWORD.",
        }

    message = EmailMessage()
    message["From"] = _sender_value()
    message["To"] = recipient
    message["Subject"] = subject

    if reply_to:
        message["Reply-To"] = str(reply_to).strip()

    message.set_content(str(text_body or "") + DEFAULT_TEXT_FOOTER)

    if html_body:
        message.add_alternative(str(html_body), subtype="html")

    server = _config("MAIL_SERVER", "smtp.gmail.com")
    port = int(_config("MAIL_PORT", 587) or 587)
    use_tls = bool(_config("MAIL_USE_TLS", True))
    use_ssl = bool(_config("MAIL_USE_SSL", False))
    username = _config("MAIL_USERNAME")
    password = _config("MAIL_PASSWORD")

    try:
        if use_ssl:
            smtp = smtplib.SMTP_SSL(server, port, timeout=30)
        else:
            smtp = smtplib.SMTP(server, port, timeout=30)

        with smtp:
            smtp.ehlo()

            if use_tls and not use_ssl:
                smtp.starttls()
                smtp.ehlo()

            smtp.login(username, password)
            smtp.send_message(message)

        return {"ok": True, "message": "Email sent successfully."}

    except Exception as exc:
        return {"ok": False, "message": f"Failed to send email: {exc}"}


def _html_shell(title, body_html):
    safe_title = escape(str(title or "YourComate HRMS"))

    return f"""
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
        <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
          <div style="background:#ffffff;border:1px solid #e7ecf5;border-radius:18px;overflow:hidden;">
            <div style="background:#0f3d91;color:#ffffff;padding:20px 24px;">
              <h2 style="margin:0;font-size:22px;line-height:1.35;">{safe_title}</h2>
            </div>
            <div style="padding:24px;font-size:15px;line-height:1.65;">
              {body_html}
            </div>
            <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;">
              This is an automated email from YourComate HRMS. Please do not share your login credentials with anyone.
            </div>
          </div>
        </div>
      </body>
    </html>
    """


def send_demo_otp_email(company_email, company_name, otp_code, expiry_minutes=None):
    expiry = expiry_minutes or _config("DEMO_OTP_EXPIRY_MINUTES", 10)
    safe_company = escape(company_name or "there")
    safe_otp = escape(str(otp_code or ""))

    subject = "YourComate HRMS Demo Registration OTP"

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        f"Your OTP for YourComate HRMS demo registration is: {otp_code}\n\n"
        f"This OTP is valid for {expiry} minutes.\n"
        "If you did not request this demo registration, please ignore this email."
    )

    html_body = _html_shell(
        "YourComate HRMS Demo Registration OTP",
        f"""
        <p>Dear {safe_company},</p>
        <p>Your OTP for YourComate HRMS demo registration is:</p>
        <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#0f3d91;background:#eef4ff;border-radius:14px;padding:14px 18px;text-align:center;margin:18px 0;">
          {safe_otp}
        </div>
        <p>This OTP is valid for <strong>{escape(str(expiry))} minutes</strong>.</p>
        <p>If you did not request this demo registration, please ignore this email.</p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)


def send_demo_request_received_email(company_email, company_name):
    subject = "YourComate HRMS Demo Request Received"

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        "Your demo registration request has been received successfully.\n"
        "Your request will now be reviewed by the Platform Superadmin.\n"
        "Once approved, your admin login email and password will be sent to this registered company email."
    )

    html_body = _html_shell(
        "Demo Request Received",
        f"""
        <p>Dear {escape(company_name or 'User')},</p>
        <p>Your demo registration request has been received successfully.</p>
        <p>Your request will now be reviewed by the <strong>Platform Superadmin</strong>.</p>
        <p>Once approved, your admin login email and password will be sent to this registered company email.</p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)


def send_demo_approval_email(
    company_email,
    company_name,
    admin_email,
    admin_password,
    trial_end_date=None,
):
    login_url = _frontend_url("login")
    safe_company = escape(company_name or "User")
    safe_admin_email = escape(admin_email or "")
    safe_admin_password = escape(admin_password or "")
    safe_trial_end_date = escape(str(trial_end_date or "30 days from approval date"))

    subject = "YourComate HRMS Demo Approved - Admin Login Details"

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        "Your YourComate HRMS demo request has been approved.\n\n"
        f"Login URL: {login_url}\n"
        f"Admin Email: {admin_email}\n"
        f"Password: {admin_password}\n\n"
        f"Your demo is valid until: {trial_end_date or '30 days from approval date'}\n\n"
        "Demo access includes Attendance, Apply Leave, and Projects modules for up to 10 employees.\n"
        "Please change your password after first login."
    )

    html_body = _html_shell(
        "Demo Approved - Admin Login Details",
        f"""
        <p>Dear {safe_company},</p>
        <p>Your <strong>YourComate HRMS</strong> demo request has been approved.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:18px 0;">
          <p style="margin:0 0 8px;"><strong>Login URL:</strong> <a href="{escape(login_url)}">{escape(login_url)}</a></p>
          <p style="margin:0 0 8px;"><strong>Admin Email:</strong> {safe_admin_email}</p>
          <p style="margin:0;"><strong>Password:</strong> {safe_admin_password}</p>
        </div>
        <p><strong>Demo validity:</strong> {safe_trial_end_date}</p>
        <p>Your demo access includes Attendance, Apply Leave, and Projects modules for up to 10 employees.</p>
        <p>Please change your password after first login.</p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)


def send_demo_rejection_email(company_email, company_name, reason=None):
    subject = "YourComate HRMS Demo Request Update"
    clean_reason = str(reason or "The request could not be approved at this time.").strip()

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        "Thank you for applying for a YourComate HRMS demo.\n"
        f"Status: Not approved\n"
        f"Reason: {clean_reason}"
    )

    html_body = _html_shell(
        "Demo Request Update",
        f"""
        <p>Dear {escape(company_name or 'User')},</p>
        <p>Thank you for applying for a YourComate HRMS demo.</p>
        <p><strong>Status:</strong> Not approved</p>
        <p><strong>Reason:</strong> {escape(clean_reason)}</p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)


def send_trial_reminder_email(company_email, company_name, days_left, billing_path=None):
    billing_url = _frontend_url(billing_path or _config("BILLING_PAGE_PATH", "/billing"))
    days_left_int = int(days_left or 0)

    if days_left_int <= 0:
        subject = "YourComate HRMS Demo Has Expired"
        headline = "Your demo has expired"
        message = "Your demo period has ended. Please subscribe to continue using YourComate HRMS."
    elif days_left_int == 1:
        subject = "YourComate HRMS Demo Expires Tomorrow"
        headline = "Your demo expires tomorrow"
        message = "Your demo will expire tomorrow. Please subscribe to avoid interruption."
    else:
        subject = f"YourComate HRMS Demo Expires in {days_left_int} Days"
        headline = f"Your demo expires in {days_left_int} days"
        message = "Please subscribe before expiry to continue using YourComate HRMS without interruption."

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        f"{message}\n\n"
        f"Upgrade / Billing URL: {billing_url}"
    )

    html_body = _html_shell(
        headline,
        f"""
        <p>Dear {escape(company_name or 'User')},</p>
        <p>{escape(message)}</p>
        <p style="margin:22px 0;">
          <a href="{escape(billing_url)}" style="background:#0f3d91;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block;">
            Upgrade / Subscribe
          </a>
        </p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)


def send_payment_success_email(company_email, company_name, plan_name, amount, subscription_end_date=None):
    subject = "YourComate HRMS Subscription Activated"

    text_body = (
        f"Dear {company_name or 'User'},\n\n"
        "Your payment has been received successfully and your subscription is now active.\n\n"
        f"Plan: {plan_name}\n"
        f"Amount: {amount}\n"
        f"Subscription End Date: {subscription_end_date or 'As per selected plan'}"
    )

    html_body = _html_shell(
        "Subscription Activated",
        f"""
        <p>Dear {escape(company_name or 'User')},</p>
        <p>Your payment has been received successfully and your subscription is now active.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:18px 0;">
          <p style="margin:0 0 8px;"><strong>Plan:</strong> {escape(str(plan_name or 'Full HRMS'))}</p>
          <p style="margin:0 0 8px;"><strong>Amount:</strong> {escape(str(amount or ''))}</p>
          <p style="margin:0;"><strong>Subscription End Date:</strong> {escape(str(subscription_end_date or 'As per selected plan'))}</p>
        </div>
        <p>You can now continue using YourComate HRMS.</p>
        """,
    )

    return send_email(company_email, subject, text_body, html_body)
