"""
Email service for YourComate HRMS SaaS workflows.

Used for:
- demo OTP email
- demo request confirmation
- demo approval with generated admin credentials
- demo rejection
- 15-day full-access trial reminders
- payment success confirmation

Important:
- This service never stores secrets.
- SMTP credentials come from Flask config / .env.
"""

import smtplib
import ssl
from email.message import EmailMessage
from html import escape
from urllib.parse import urlsplit, urlunsplit


class EmailServiceError(RuntimeError):
    def __init__(self, message, code="email_error", details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


def safe_str(value):
    return str(value or "").strip()


def get_config(config, key, default=None):
    if config is None:
        return default

    try:
        return config.get(key, default)
    except AttributeError:
        return getattr(config, key, default)


def configured_sender(config):
    sender_email = safe_str(get_config(config, "MAIL_DEFAULT_SENDER"))
    username = safe_str(get_config(config, "MAIL_USERNAME"))
    sender_name = safe_str(get_config(config, "MAIL_SENDER_NAME", "YourComate HRMS"))

    if not sender_email:
        sender_email = username

    if sender_name and sender_email:
        return f"{sender_name} <{sender_email}>"

    return sender_email


def smtp_ready(config):
    return bool(
        safe_str(get_config(config, "MAIL_SERVER"))
        and safe_str(get_config(config, "MAIL_PORT"))
        and safe_str(get_config(config, "MAIL_USERNAME"))
        and safe_str(get_config(config, "MAIL_PASSWORD"))
        and configured_sender(config)
    )


def send_email(config, to_email, subject, text_body, html_body=None, cc=None, bcc=None):
    """
    Sends an email through configured SMTP.

    Returns:
    {
      "ok": True/False,
      "message": "...",
      "to": "...",
      "subject": "..."
    }
    """

    to_email = safe_str(to_email)
    subject = safe_str(subject)

    if not to_email:
        return {
            "ok": False,
            "message": "Recipient email is missing.",
            "code": "missing_recipient",
        }

    if not smtp_ready(config):
        return {
            "ok": False,
            "message": "SMTP is not configured. Check MAIL_SERVER, MAIL_USERNAME, MAIL_PASSWORD and MAIL_DEFAULT_SENDER.",
            "code": "smtp_not_configured",
        }

    server = safe_str(get_config(config, "MAIL_SERVER"))
    port = int(get_config(config, "MAIL_PORT", 587))
    username = safe_str(get_config(config, "MAIL_USERNAME"))
    password = safe_str(get_config(config, "MAIL_PASSWORD"))
    use_tls = bool(get_config(config, "MAIL_USE_TLS", True))
    use_ssl = bool(get_config(config, "MAIL_USE_SSL", False))

    message = EmailMessage()
    message["From"] = configured_sender(config)
    message["To"] = to_email
    message["Subject"] = subject

    if cc:
        message["Cc"] = cc if isinstance(cc, str) else ", ".join(cc)

    if bcc:
        message["Bcc"] = bcc if isinstance(bcc, str) else ", ".join(bcc)

    message.set_content(text_body or "")

    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(server, port, context=context, timeout=30) as smtp:
                smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(server, port, timeout=30) as smtp:
                smtp.ehlo()

                if use_tls:
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()

                smtp.login(username, password)
                smtp.send_message(message)

        return {
            "ok": True,
            "message": "Email sent successfully.",
            "to": to_email,
            "subject": subject,
        }
    except Exception as exc:
        return {
            "ok": False,
            "message": str(exc),
            "code": "smtp_send_failed",
            "to": to_email,
            "subject": subject,
        }


def html_shell(title, body_html):
    return f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{escape(title)}</title>
      </head>
      <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
          <div style="background:#ffffff;border-radius:22px;border:1px solid #e2e8f0;box-shadow:0 18px 50px rgba(15,23,42,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:26px;color:#ffffff;">
              <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;">YourComate HRMS</p>
              <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">{escape(title)}</h1>
            </div>
            <div style="padding:28px;">
              {body_html}
            </div>
          </div>
          <p style="margin:16px 0 0;text-align:center;color:#64748b;font-size:12px;">
            This is an automated email from YourComate HRMS.
          </p>
        </div>
      </body>
    </html>
    """


def send_demo_otp_email(config, to_email, company_name, otp_code, expires_minutes=10):
    company_name = safe_str(company_name) or "your company"
    otp_code = safe_str(otp_code)
    expires_minutes = expires_minutes or 10

    subject = "YourComate HRMS demo verification OTP"

    text_body = f"""Dear {company_name},

Your OTP for YourComate HRMS demo registration is:

{otp_code}

This OTP is valid for {expires_minutes} minutes.

After verification, your request will be sent to Superadmin for approval.

Regards,
YourComate HRMS
"""

    html_body = html_shell(
        "Verify your demo request",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 18px;line-height:1.7;">Use the OTP below to verify your company email for YourComate HRMS demo registration.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:20px;text-align:center;margin:18px 0;">
          <p style="margin:0;color:#475569;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Verification OTP</p>
          <p style="margin:8px 0 0;font-size:36px;font-weight:900;color:#1d4ed8;letter-spacing:0.18em;">{escape(otp_code)}</p>
        </div>
        <p style="margin:0;line-height:1.7;color:#475569;">This OTP is valid for <strong>{expires_minutes} minutes</strong>. After OTP verification, your request will be reviewed by Superadmin.</p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_demo_request_received_email(config, to_email, company_name):
    company_name = safe_str(company_name) or "your company"
    subject = "YourComate HRMS demo request received"

    text_body = f"""Dear {company_name},

Your YourComate HRMS demo request has been received and your company email has been verified.

Your request is now waiting for Superadmin approval.

After approval, you will receive company admin login credentials.

Demo trial details:
- 15 days free trial
- Full HRMS access during trial
- Payment/subscription required after trial expiry

Regards,
YourComate HRMS
"""

    html_body = html_shell(
        "Demo request received",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your YourComate HRMS demo request has been received and your company email has been verified.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#166534;font-weight:800;">Current Status: Pending Superadmin Approval</p>
          <p style="margin:8px 0 0;color:#475569;line-height:1.6;">After approval, you will receive your generated company admin login credentials.</p>
        </div>
        <ul style="margin:0;padding-left:20px;color:#334155;line-height:1.8;">
          <li><strong>15 days</strong> free trial</li>
          <li><strong>Full HRMS access</strong> during trial</li>
          <li>Payment/subscription required after trial expiry</li>
        </ul>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_demo_approval_email(config, to_email, company_name, admin_email, admin_password, login_url=None, trial_end_date=None):
    company_name = safe_str(company_name) or "your company"
    admin_email = safe_str(admin_email)
    admin_password = safe_str(admin_password)
    login_url = safe_str(login_url) or safe_str(get_config(config, "FRONTEND_BASE_URL", "")) or "YourComate HRMS login page"

    subject = "YourComate HRMS demo approved - admin login details"

    trial_line = ""
    if trial_end_date:
        trial_line = f"\nTrial End Date: {trial_end_date}\n"

    text_body = f"""Dear {company_name},

Your YourComate HRMS demo request has been approved.

Your company admin login has been created.

Login URL: {login_url}
Admin Email: {admin_email}
Temporary Password: {admin_password}
{trial_line}
Trial details:
- 15 days free trial
- Full HRMS access during the trial
- After 15 days, payment/subscription is required to continue using HRMS
- Once payment is completed, your demo company becomes an official registered company

Please login and change your password after first access.

Regards,
YourComate HRMS
"""

    trial_html = ""
    if trial_end_date:
        trial_html = f"""
        <p style="margin:8px 0 0;color:#475569;">Trial End Date: <strong>{escape(str(trial_end_date))}</strong></p>
        """

    html_body = html_shell(
        "Demo approved",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your YourComate HRMS demo request has been approved. Your company admin login has been created.</p>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0 0 10px;color:#1e3a8a;font-weight:900;">Admin Login Details</p>
          <p style="margin:0 0 8px;color:#334155;">Login URL: <strong>{escape(login_url)}</strong></p>
          <p style="margin:0 0 8px;color:#334155;">Admin Email: <strong>{escape(admin_email)}</strong></p>
          <p style="margin:0;color:#334155;">Temporary Password: <strong>{escape(admin_password)}</strong></p>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#0f172a;font-weight:900;">Trial Details</p>
          <ul style="margin:10px 0 0;padding-left:20px;color:#334155;line-height:1.8;">
            <li><strong>15 days</strong> free trial</li>
            <li><strong>Full HRMS access</strong> during trial</li>
            <li>After 15 days, payment/subscription is required to continue</li>
            <li>After payment, the demo company becomes an official registered company</li>
          </ul>
          {trial_html}
        </div>

        <p style="margin:0;line-height:1.7;color:#475569;">Please login and change your password after first access.</p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_demo_rejection_email(config, to_email, company_name, rejection_reason=None):
    company_name = safe_str(company_name) or "your company"
    rejection_reason = safe_str(rejection_reason) or "The request could not be approved at this time."

    subject = "YourComate HRMS demo request update"

    text_body = f"""Dear {company_name},

Your YourComate HRMS demo request was reviewed by Superadmin and could not be approved at this time.

Reason:
{rejection_reason}

You may contact the YourComate HRMS team for more details.

Regards,
YourComate HRMS
"""

    html_body = html_shell(
        "Demo request update",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your YourComate HRMS demo request was reviewed by Superadmin and could not be approved at this time.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-weight:900;">Reason</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">{escape(rejection_reason)}</p>
        </div>
        <p style="margin:0;line-height:1.7;color:#475569;">You may contact the YourComate HRMS team for more details.</p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_trial_reminder_email(config, to_email, company_name, days_left, trial_end_date=None, billing_url=None):
    company_name = safe_str(company_name) or "your company"
    days_left = int(days_left or 0)
    billing_url = safe_str(billing_url) or safe_str(get_config(config, "FRONTEND_BASE_URL", "")) or "YourComate HRMS billing page"

    if days_left <= 0:
        subject = "YourComate HRMS trial has ended"
        headline = "Your trial has ended"
        urgency = "Your 15-day full-access trial has ended. Please complete payment/subscription to continue using HRMS."
    elif days_left == 1:
        subject = "YourComate HRMS trial ends tomorrow"
        headline = "Your trial ends tomorrow"
        urgency = "Your 15-day full-access trial ends tomorrow. Please complete payment/subscription to avoid access interruption."
    else:
        subject = f"YourComate HRMS trial ends in {days_left} days"
        headline = f"Your trial ends in {days_left} days"
        urgency = f"Your 15-day full-access trial ends in {days_left} days. Please complete payment/subscription to continue without interruption."

    trial_line = ""
    if trial_end_date:
        trial_line = f"\nTrial End Date: {trial_end_date}\n"

    text_body = f"""Dear {company_name},

{urgency}
{trial_line}
Billing/Upgrade URL: {billing_url}

After payment, your demo company will become an official registered company and your selected plan employee limit will apply.

Regards,
YourComate HRMS
"""

    html_body = html_shell(
        headline,
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">{escape(urgency)}</p>

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#9a3412;font-weight:900;">Action Required</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Complete payment/subscription to continue using YourComate HRMS after trial expiry.</p>
          {"<p style='margin:8px 0 0;color:#475569;'>Trial End Date: <strong>" + escape(str(trial_end_date)) + "</strong></p>" if trial_end_date else ""}
        </div>

        <p style="margin:0 0 18px;line-height:1.7;color:#475569;">After payment, your demo company will become an official registered company and the selected plan employee limit will apply.</p>

        <p style="margin:0;">
          <a href="{escape(billing_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:800;">Open Billing Page</a>
        </p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def format_amount_text(amount=None, currency="INR"):
    currency = safe_str(currency) or "INR"

    if amount in [None, ""]:
        return "As per quotation"

    try:
        number = float(amount)
        if number.is_integer():
            number = int(number)
        return f"{currency} {number}"
    except (TypeError, ValueError):
        return f"{currency} {amount}"


def format_employee_limit_text(employee_limit=None):
    if employee_limit in [None, "", "unlimited", "Unlimited", 0, "0"]:
        return "Unlimited employees"

    return f"Up to {employee_limit} employees"


def format_interval_text(interval=None):
    normalized = safe_str(interval or "monthly").lower().replace("_", " ").replace("-", " ")

    if normalized in ["annual", "annually"]:
        normalized = "yearly"

    return normalized.title()


def format_date_text(value):
    if value in [None, ""]:
        return ""

    try:
        return value.strftime("%d %B %Y")
    except AttributeError:
        return safe_str(value)


def resolve_billing_url(config, billing_url=None):
    """
    Returns a usable client Billing page URL.

    This also fixes the common configuration where FRONTEND_BASE_URL contains
    only the application origin, for example https://hrms.example.com. In that
    case the configured BILLING_PAGE_PATH is appended automatically.
    """

    candidate = safe_str(billing_url)
    base_url = safe_str(
        get_config(config, "FRONTEND_BASE_URL")
        or get_config(config, "PUBLIC_FRONTEND_URL")
        or get_config(config, "APP_FRONTEND_URL")
    )
    billing_path = safe_str(get_config(config, "BILLING_PAGE_PATH", "/billing")) or "/billing"

    if not candidate:
        candidate = base_url

    if not candidate:
        return billing_path

    if candidate.startswith(("http://", "https://")):
        parsed = urlsplit(candidate)
        current_path = (parsed.path or "").rstrip("/")
        expected_path = "/" + billing_path.strip("/")

        if not current_path:
            parsed = parsed._replace(path=expected_path)
            return urlunsplit(parsed)

        if current_path == expected_path or current_path.endswith(expected_path):
            return candidate.rstrip("/")

        return candidate.rstrip("/")

    if candidate in {"/", ""}:
        return billing_path

    return candidate


def send_payment_success_email(
    config,
    to_email,
    company_name,
    plan_name=None,
    amount=None,
    currency="INR",
    employee_limit=None,
    billing_interval=None,
    next_due_date=None,
    billing_url=None,
    invoice_number=None,
):
    """Sends Essential/Growth payment and activation confirmation."""

    company_name = safe_str(company_name) or "your company"
    plan_name = safe_str(plan_name) or "YourComate HRMS Subscription"
    amount_text = format_amount_text(amount, currency)
    employee_text = format_employee_limit_text(employee_limit)
    interval_text = format_interval_text(billing_interval) if billing_interval else ""
    due_text = format_date_text(next_due_date)
    invoice_number = safe_str(invoice_number)
    billing_url = resolve_billing_url(config, billing_url)

    subject = "YourComate HRMS subscription activated"

    details = [
        f"Plan: {plan_name}",
        f"Employee Limit: {employee_text}",
        f"Amount Paid: {amount_text}",
    ]

    if interval_text:
        details.append(f"Billing Interval: {interval_text}")

    if due_text:
        details.append(f"Next Renewal Date: {due_text}")

    if invoice_number:
        details.append(f"Invoice Number: {invoice_number}")

    text_body = f"""Dear {company_name},

Your YourComate HRMS payment has been verified successfully and your subscription is active.

{chr(10).join(details)}

Your invoice and complete payment history are available from Billing & Subscription.
Essential/Growth renewals use the latest active plan price configured by Superadmin at the time of renewal.

Billing Panel: {billing_url}

Regards,
YourComate HRMS
"""

    optional_rows = ""
    if interval_text:
        optional_rows += f'<p style="margin:8px 0 0;color:#334155;">Billing Interval: <strong>{escape(interval_text)}</strong></p>'
    if due_text:
        optional_rows += f'<p style="margin:8px 0 0;color:#334155;">Next Renewal Date: <strong>{escape(due_text)}</strong></p>'
    if invoice_number:
        optional_rows += f'<p style="margin:8px 0 0;color:#334155;">Invoice Number: <strong>{escape(invoice_number)}</strong></p>'

    html_body = html_shell(
        "Subscription activated",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your YourComate HRMS payment has been verified successfully and your subscription is active.</p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#166534;font-weight:900;">Subscription Active</p>
          <p style="margin:8px 0 0;color:#334155;">Plan: <strong>{escape(plan_name)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Employee Limit: <strong>{escape(employee_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Amount Paid: <strong>{escape(amount_text)}</strong></p>
          {optional_rows}
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#1e3a8a;font-weight:900;">Billing Information</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Your invoice, payment status and previous payment history are available from Billing &amp; Subscription.</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Essential/Growth renewals use the latest active plan price configured by Superadmin at renewal time.</p>
        </div>

        <p style="margin:0;">
          <a href="{escape(billing_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:900;">Open Billing &amp; Subscription</a>
        </p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_premium_quotation_email(
    config,
    to_email,
    company_name,
    quotation_reference=None,
    quoted_amount=None,
    currency="INR",
    billing_interval="monthly",
    employee_limit=None,
    payment_due_date=None,
    payment_link=None,
    quotation_valid_until=None,
    sales_note=None,
    billing_url=None,
):
    """Sends a released Premium custom quotation to the company email."""

    company_name = safe_str(company_name) or "your company"
    quotation_reference = safe_str(quotation_reference) or "Premium quotation"
    amount_text = format_amount_text(quoted_amount, currency)
    employee_text = format_employee_limit_text(employee_limit)
    interval_text = format_interval_text(billing_interval)
    due_text = format_date_text(payment_due_date)
    valid_text = format_date_text(quotation_valid_until)
    payment_link = safe_str(payment_link)
    billing_url = resolve_billing_url(config, billing_url)
    sales_note = safe_str(sales_note)

    subject = f"Premium quotation ready - {quotation_reference}"

    due_line = f"\nPayment Due Date: {due_text}" if due_text else ""
    valid_line = f"\nQuotation Valid Until: {valid_text}" if valid_text else ""
    payment_line = f"\nPayment Link: {payment_link}" if payment_link else ""

    text_body = f"""Dear {company_name},

Your Premium custom quotation for YourComate HRMS has been released to your client Billing panel.

Status: Payment Pending
Quotation Reference: {quotation_reference}
Quoted Recurring Amount: {amount_text}
Billing Interval: {interval_text}
Employee Limit: {employee_text}{due_line}{valid_line}{payment_line}

Open Billing & Subscription: {billing_url}

Important:
- Razorpay payment is available only after this quotation has been released.
- The amount shown above becomes your recurring {interval_text.lower()} Premium renewal amount.
- Superadmin may revise the amount later, but a revision becomes payable only after it is sent to your client panel.
- Premium activates after payment verification.

{("Sales Note: " + sales_note) if sales_note else ""}

Regards,
YourComate HRMS
"""

    payment_button_html = ""
    if payment_link:
        payment_button_html = f"""
        <p style="margin:0 0 12px;">
          <a href="{escape(payment_link)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:900;">Open Payment Link</a>
        </p>
        """

    optional_rows = ""
    if due_text:
        optional_rows += f'<p style="margin:8px 0 0;color:#334155;">Payment Due Date: <strong>{escape(due_text)}</strong></p>'
    if valid_text:
        optional_rows += f'<p style="margin:8px 0 0;color:#334155;">Quotation Valid Until: <strong>{escape(valid_text)}</strong></p>'

    sales_note_html = ""
    if sales_note:
        sales_note_html = f"""
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#0f172a;font-weight:900;">Sales Note</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">{escape(sales_note)}</p>
        </div>
        """

    html_body = html_shell(
        "Premium quotation ready",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your Premium custom quotation has been released to your company Billing panel.</p>

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#9a3412;font-weight:900;">Action Required: Payment Pending</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Review the quotation and complete payment before the due date to activate Premium.</p>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#1e3a8a;font-weight:900;">Quotation Details</p>
          <p style="margin:8px 0 0;color:#334155;">Quotation Reference: <strong>{escape(quotation_reference)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Quoted Recurring Amount: <strong>{escape(amount_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Billing Interval: <strong>{escape(interval_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Employee Limit: <strong>{escape(employee_text)}</strong></p>
          {optional_rows}
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#0f172a;font-weight:900;">Premium Payment and Renewal</p>
          <ul style="margin:10px 0 0;padding-left:20px;color:#334155;line-height:1.8;">
            <li>Razorpay payment is available only after this quotation is released.</li>
            <li>The quoted amount becomes your recurring {escape(interval_text.lower())} renewal amount.</li>
            <li>A later revision becomes payable only after Superadmin sends it to your client panel.</li>
            <li>Premium activates automatically after payment verification.</li>
          </ul>
        </div>

        {sales_note_html}
        {payment_button_html}
        <p style="margin:0;">
          <a href="{escape(billing_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:900;">Open Billing &amp; Subscription</a>
        </p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)


def send_premium_activation_email(
    config,
    to_email,
    company_name,
    amount=None,
    currency="INR",
    billing_interval="monthly",
    employee_limit=None,
    next_due_date=None,
    billing_url=None,
):
    """Sends Premium activation confirmation after verified payment."""

    company_name = safe_str(company_name) or "your company"
    amount_text = format_amount_text(amount, currency)
    employee_text = format_employee_limit_text(employee_limit)
    interval_text = format_interval_text(billing_interval)
    due_text = format_date_text(next_due_date)
    billing_url = resolve_billing_url(config, billing_url)

    due_line = f"\nNext Renewal Date: {due_text}" if due_text else ""
    subject = "YourComate HRMS Premium subscription activated"

    text_body = f"""Dear {company_name},

Your Premium subscription has been activated successfully.

Status: Active
Plan: Premium
Recurring Amount: {amount_text}
Billing Interval: {interval_text}
Employee Limit: {employee_text}{due_line}
Renewal Price Source: Custom quotation

Your invoice, payment status and payment history are available from Billing & Subscription.
Upgrade and payment actions remain hidden while the subscription is active and return when renewal is due.

Billing Panel: {billing_url}

Regards,
YourComate HRMS
"""

    due_row = ""
    if due_text:
        due_row = f'<p style="margin:8px 0 0;color:#334155;">Next Renewal Date: <strong>{escape(due_text)}</strong></p>'

    html_body = html_shell(
        "Premium subscription activated",
        f"""
        <p style="margin:0 0 12px;line-height:1.7;">Dear <strong>{escape(company_name)}</strong>,</p>
        <p style="margin:0 0 16px;line-height:1.7;">Your Premium subscription has been activated successfully.</p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#166534;font-weight:900;">Premium Subscription Active</p>
          <p style="margin:8px 0 0;color:#334155;">Recurring Amount: <strong>{escape(amount_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Billing Interval: <strong>{escape(interval_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Employee Limit: <strong>{escape(employee_text)}</strong></p>
          <p style="margin:8px 0 0;color:#334155;">Renewal Price Source: <strong>Custom quotation</strong></p>
          {due_row}
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:18px;margin:18px 0;">
          <p style="margin:0;color:#1e3a8a;font-weight:900;">Invoice and Renewal Status</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Your invoice, payment status and previous payments are available from Billing &amp; Subscription.</p>
          <p style="margin:8px 0 0;color:#334155;line-height:1.7;">Payment and upgrade actions remain hidden while Premium is active and return when renewal is due.</p>
        </div>

        <p style="margin:0;">
          <a href="{escape(billing_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:900;">Open Billing &amp; Subscription</a>
        </p>
        """,
    )

    return send_email(config, to_email, subject, text_body, html_body)