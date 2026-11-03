"""Tenant-scoped Sprint attachment disk storage.

Step 44B.53G.4: storage service only. HTTP authentication,
authorization, attachment metadata, and database ownership
checks must be implemented at the API boundary.
"""

from pathlib import Path
from uuid import uuid4
import os
import re

from app.services.sprint_attachment_service import (
    SprintAttachmentError,
    safe_attachment_filename,
    safe_tenant_segment,
    validate_attachment_content,
    MAX_SPRINT_ATTACHMENT_BYTES,
)


_STORAGE_ID = re.compile(
    r"^[a-f0-9]{32}\.(pdf|png|jpg|jpeg|webp|doc|docx|xls|xlsx|txt|csv)$"
)


def _tenant_directory(root, tenant_id):
    tenant = safe_tenant_segment(tenant_id)
    base = Path(root).resolve(strict=True)

    if not base.is_dir():
        raise SprintAttachmentError("Invalid storage root")

    directory = base / tenant

    if directory.is_symlink():
        raise SprintAttachmentError(
            "Symbolic-link tenant directories are forbidden"
        )

    directory.mkdir(mode=0o700, exist_ok=True)

    resolved = directory.resolve(strict=True)

    if resolved.parent != base:
        raise SprintAttachmentError(
            "Tenant storage path escaped its root"
        )

    return directory


def save_sprint_attachment(root, tenant_id, filename, content):
    """Atomically save validated bytes in tenant-specific storage.

    Returns a storage ID and metadata. It deliberately does not
    create a database record or grant download permissions.
    """

    original_name = safe_attachment_filename(filename)

    if not isinstance(content, bytes):
        raise SprintAttachmentError("Invalid attachment bytes")

    validate_attachment_content(original_name, content)

    directory = _tenant_directory(root, tenant_id)

    extension = Path(original_name).suffix.lower()
    storage_id = uuid4().hex + extension

    final_path = directory / storage_id
    temporary_path = directory / (uuid4().hex + ".part")

    descriptor = None

    try:
        descriptor = os.open(
            str(temporary_path),
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )

        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())

        if final_path.exists() or final_path.is_symlink():
            raise SprintAttachmentError(
                "Attachment storage collision"
            )

        os.replace(str(temporary_path), str(final_path))

        return {
            "storage_id": storage_id,
            "original_filename": original_name,
            "size_bytes": len(content),
            "tenant_id": safe_tenant_segment(tenant_id),
        }

    finally:
        if descriptor is not None:
            os.close(descriptor)

        if temporary_path.exists():
            temporary_path.unlink()


def read_sprint_attachment(root, tenant_id, storage_id):
    """Read stored bytes after the API has authorized the request.

    The storage ID must originate from trusted tenant-scoped
    attachment metadata, never directly from client file paths.
    """

    if not isinstance(storage_id, str):
        raise SprintAttachmentError("Invalid storage identifier")

    if not _STORAGE_ID.fullmatch(storage_id):
        raise SprintAttachmentError("Invalid storage identifier")

    directory = _tenant_directory(root, tenant_id)
    path = directory / storage_id

    if path.is_symlink():
        raise SprintAttachmentError(
            "Symbolic-link attachments are forbidden"
        )

    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW

        descriptor = os.open(str(path), flags)

        with os.fdopen(descriptor, "rb") as handle:
            if not handle.seekable():
                raise SprintAttachmentError("Invalid attachment file")

            size = os.fstat(handle.fileno()).st_size

            if size < 1 or size > MAX_SPRINT_ATTACHMENT_BYTES:
                raise SprintAttachmentError(
                    "Stored attachment size is invalid"
                )

            data = handle.read(MAX_SPRINT_ATTACHMENT_BYTES + 1)

    except FileNotFoundError:
        raise SprintAttachmentError(
            "Attachment not found"
        ) from None

    if len(data) > MAX_SPRINT_ATTACHMENT_BYTES:
        raise SprintAttachmentError(
            "Stored attachment exceeds maximum size"
        )

    return data
