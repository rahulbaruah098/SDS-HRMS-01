"""Secure attachment validation for Sprint Planning.

Step 44B.53G.2: foundation only. No upload endpoint is
registered by this module.
"""

from pathlib import Path
from uuid import uuid4
import re

from werkzeug.utils import secure_filename


class SprintAttachmentError(ValueError):
    pass


MAX_SPRINT_ATTACHMENT_BYTES = 10 * 1024 * 1024

ALLOWED_SPRINT_EXTENSIONS = frozenset({
    ".pdf", ".png", ".jpg", ".jpeg", ".webp",
    ".doc", ".docx", ".xls", ".xlsx",
    ".txt", ".csv",
})


def safe_attachment_filename(filename):
    if not isinstance(filename, str):
        raise SprintAttachmentError("A filename is required")

    original = filename.strip()

    if not original or original in (".", ".."):
        raise SprintAttachmentError("A valid filename is required")

    if (
        "/" in original
        or "\\\\" in original
        or "\\x00" in original
    ):
        raise SprintAttachmentError(
            "File paths are not permitted as filenames"
        )

    name = secure_filename(original)

    if not name:
        raise SprintAttachmentError("Invalid filename")

    extension = Path(name).suffix.lower()

    if extension not in ALLOWED_SPRINT_EXTENSIONS:
        raise SprintAttachmentError(
            "This file type is not permitted"
        )

    return name


def validate_attachment_size(size):
    if isinstance(size, bool) or not isinstance(size, int):
        raise SprintAttachmentError("Invalid file size")

    if size <= 0:
        raise SprintAttachmentError("Empty files are not permitted")

    if size > MAX_SPRINT_ATTACHMENT_BYTES:
        raise SprintAttachmentError(
            "File exceeds the 10 MB attachment limit"
        )

    return size


def safe_tenant_segment(tenant_id):
    if not isinstance(tenant_id, str):
        raise SprintAttachmentError("Invalid tenant")

    tenant = tenant_id.strip()

    if not tenant or not re.fullmatch(
        r"[A-Za-z0-9_-]{1,80}", tenant
    ):
        raise SprintAttachmentError(
            "Invalid tenant storage identifier"
        )

    return tenant.lower()


def build_attachment_storage_path(root, tenant_id, filename):
    """Construct a non-user-controlled randomized storage name."""

    tenant = safe_tenant_segment(tenant_id)
    original = safe_attachment_filename(filename)

    extension = Path(original).suffix.lower()
    storage_name = uuid4().hex + extension

    base = Path(root).resolve()
    candidate = (base / tenant / storage_name).resolve()

    if not candidate.is_relative_to(base):
        raise SprintAttachmentError(
            "Invalid attachment storage path"
        )

    return candidate


def validate_attachment_content(filename, content):
    """Basic signature checks; full antivirus scanning is separate."""

    safe_attachment_filename(filename)

    if not isinstance(content, bytes):
        raise SprintAttachmentError("Invalid file content")

    validate_attachment_size(len(content))

    extension = Path(filename).suffix.lower()

    signatures = {
        ".pdf": (b"%PDF-",),
        ".png": (b"\\x89PNG\\r\\n\\x1a\\n",),
        ".jpg": (b"\\xff\\xd8\\xff",),
        ".jpeg": (b"\\xff\\xd8\\xff",),
        ".webp": (b"RIFF",),
        ".docx": (b"PK\\x03\\x04",),
        ".xlsx": (b"PK\\x03\\x04",),
        ".doc": (b"\\xd0\\xcf\\x11\\xe0",),
        ".xls": (b"\\xd0\\xcf\\x11\\xe0", b"PK\\x03\\x04"),
    }

    expected = signatures.get(extension)

    if expected and not any(
        content.startswith(prefix) for prefix in expected
    ):
        raise SprintAttachmentError(
            "File content does not match its extension"
        )

    if extension == ".webp" and content[8:12] != b"WEBP":
        raise SprintAttachmentError("Invalid WebP content")

    return True
