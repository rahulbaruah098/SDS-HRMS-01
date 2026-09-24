import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Filter,
  LayoutGrid,
  MapPin,
  Maximize2,
  RefreshCcw,
  Search,
  Table2,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import {
  roles,
  isHRUser,
  isTeamLeader,
  isReportingOfficer,
} from '../utils/authHelpers';
import AttendanceWidget from '../components/AttendanceWidget';
import Table from '../components/Table';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const ATTENDANCE_NOTICE_HIDE_MS = 3600;

const HOLIDAY_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const EMPTY_REPORT_FILTERS = {
  employee_id: '',
  employee_name: '',
  department: '',
  organisation: '',
  state: '',
  mode: '',
  status: '',
  date_from: '',
  date_to: '',
};

const EMPTY_HOLIDAY_FORM = {
  state: 'Assam(HO)',
  date: '',
  title: '',
  message: '',
};

const EMPTY_HOLIDAY_WORK_FILTERS = {
  status: '',
  date: '',
};

const EMPTY_TEAM_FIELD_FILTERS = {
  start: '',
  end: '',
};

const EMPTY_COMPOFF_FORM = {
  compoff_id: '',
  claim_date: '',
  reason: '',
};

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function formatDate(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function fieldPhotoValue(row = {}) {
  return (
    row.field_photo ||
    row.field_photo_url ||
    row.photo_url ||
    row.proof_photo ||
    row.photo ||
    row.check_in_photo ||
    ''
  );
}

function normalizeImageSrc(value = '') {
  const photo = String(value || '').trim();

  if (!photo) {
    return '';
  }

  if (
    photo.startsWith('data:image/') ||
    photo.startsWith('http://') ||
    photo.startsWith('https://') ||
    photo.startsWith('/uploads/')
  ) {
    return photo;
  }

  if (photo.startsWith('uploads/')) {
    return `/${photo}`;
  }

  // If backend stored only raw base64 without data:image prefix
  if (photo.length > 100 && !photo.includes(' ')) {
    return `data:image/jpeg;base64,${photo}`;
  }

  return photo;
}


function openImagePreview(photoSrc = '') {
  if (!photoSrc) {
    return;
  }

  const win = window.open('', '_blank');

  if (!win) {
    return;
  }

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Field Attendance Photo</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #111827;
            font-family: Arial, sans-serif;
          }

          img {
            max-width: 96vw;
            max-height: 96vh;
            object-fit: contain;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 20px 60px rgba(0,0,0,.45);
          }
        </style>
      </head>
      <body>
        <img src="${photoSrc}" alt="Field Attendance Photo" />
      </body>
    </html>
  `);

  win.document.close();
}

function FieldPhotoPreview({ row }) {
  const photoSrc = normalizeImageSrc(fieldPhotoValue(row));

  if (!photoSrc) {
    return <span>—</span>;
  }

  return (
    <div className="field-photo-preview">
      <img
        src={photoSrc}
        alt="Field attendance"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />

      <button
        type="button"
        className="field-photo-open-button"
        onClick={() => openImagePreview(photoSrc)}
      >
        Open Photo
      </button>
    </div>
  );
}


function modeLabel(mode) {
  if (mode === 'wfh') return 'Work From Home';
  if (mode === 'field') return 'Field';
  if (mode === 'office') return 'Office';
  return mode || '—';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


function cleanText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function attendanceStatusClass(value) {
  const normalized = String(value || '').toLowerCase();

  if (normalized.includes('late')) return 'is-late';
  if (normalized.includes('holiday')) return 'is-holiday';
  if (normalized.includes('early')) return 'is-warning';
  if (normalized.includes('present')) return 'is-present';
  if (normalized.includes('absent')) return 'is-absent';

  return 'is-neutral';
}

function locationText(location) {
  if (!location || typeof location !== 'object') {
    return '—';
  }

  const latitude = location.latitude;
  const longitude = location.longitude;

  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return cleanText(location.address || location.location_address);
  }

  const accuracy = location.accuracy
    ? ` • ±${Math.round(Number(location.accuracy))}m`
    : '';

  const address = cleanText(location.address || location.location_address, '');

  return address
    ? `${address} • ${latitude}, ${longitude}${accuracy}`
    : `${latitude}, ${longitude}${accuracy}`;
}

function locationMapUrl(location) {
  if (!location || typeof location !== 'object') {
    return '';
  }

  const latitude = location.latitude;
  const longitude = location.longitude;

  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return '';
  }

  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function requestLiveStatus(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';

  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function normalizeAttendanceRows(rows = []) {
  return rows.map((row) => {
    const organisation =
      row.organisation ||
      row.organization ||
      row.organisation_name ||
      row.organization_name ||
      row.organisation_code ||
      row.organization_code ||
      '';

    return {
      employee_name: row.employee_name || '—',
      employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      organisation: organisation || '—',
      organisation_code: row.organisation_code || row.organization_code || '',
      state: row.state || '—',
      date: formatDate(row.date),
      raw_date: row.date || '',
      mode: modeLabel(row.mode),
      raw_mode: row.mode || '',
      status: statusLabel(row.status),
      raw_status: row.status || '',
      check_in: formatDateTime(row.check_in),
      check_out: formatDateTime(row.check_out),
      check_in_location: row.check_in_location || null,
      check_out_location: row.check_out_location || null,
      check_in_location_text: locationText(row.check_in_location),
      check_out_location_text: locationText(row.check_out_location),
      check_in_map_url: locationMapUrl(row.check_in_location),
      check_out_map_url: locationMapUrl(row.check_out_location),
field_location: row.field_location || row.work_location || '—',
field_photo:
  row.field_photo ||
  row.field_photo_url ||
  row.photo_url ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
field_photo_url:
  row.field_photo_url ||
  row.field_photo ||
  row.photo_url ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
photo_url:
  row.photo_url ||
  row.field_photo_url ||
  row.field_photo ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
late_reason: row.late_reason || '—',
      early_checkout_reason: row.early_checkout_reason || '—',
      holiday: row.holiday_title || '—',
      verified: row.verified_by_ro ? 'Yes' : 'No',
      _id: row._id,
      verified_by_ro: row.verified_by_ro,
    };
  });
}

function normalizeHolidayWorkRequestRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || '—',
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    date: formatDate(row.date),
    raw_date: row.date || '',
    holiday: row.holiday_title || '—',
    holiday_type: statusLabel(row.holiday_type),
    reason: row.reason || '—',
    work_location: row.work_location || row.field_location || '—',
    proof_photo: row.proof_photo || '',
    location_text: locationText(row.location),
    map_url: locationMapUrl(row.location),
    current_stage: requestLiveStatus(row),
    status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.approved_by_name || row.rejected_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.approved_at || row.rejected_at),
    _id: row._id,
    raw_status: row.status,
    raw_stage: row.approval_stage,
  }));
}

function normalizeHolidayRows(rows = []) {
  return rows.map((row) => ({
    state: row.state || '—',
    date: formatDate(row.date),
    title: row.title || '—',
    message: row.message || '—',
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
    _id: row._id,
  }));
}

function normalizeCompOffRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
    _id: row._id,
    raw_status: row.status,
  }));
}


function AttendanceInlineMessage({
  message,
  onClose,
  className = '',
}) {
  if (!message?.text) return null;

  return (
    <div
      className={`attendance-inline-feedback ${message.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <span className="attendance-inline-feedback-icon">
        {message.loading ? (
          <RefreshCcw size={15} className="attendance-inline-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="attendance-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="attendance-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}


function AttendanceReportList({
  rows = [],
  loading = false,
  selectedIds = [],
  onToggleSelection,
  bulkVerifying = false,
}) {
  if (loading) {
    return (
      <div className="attendance-record-list">
        {[1, 2, 3].map((item) => (
          <div key={item} className="attendance-record-card is-loading">
            <div className="attendance-skeleton-line wide" />
            <div className="attendance-skeleton-line" />
            <div className="attendance-skeleton-grid">
              <span />
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="attendance-empty-state">
        <CalendarDays size={34} />
        <strong>No attendance records found</strong>
        <span>Today’s attendance will appear here. Use filters to view past records.</span>
      </div>
    );
  }

  return (
    <div className="attendance-record-list">
      {rows.map((row) => (
        <article
          key={row._id || `${row.employee_id}-${row.raw_date}`}
          className={`attendance-record-card${selectedIds.includes(row._id) ? ' is-selected' : ''}`}
        >
          <div className="attendance-record-top">
            <label
              className={`attendance-record-select${!row._id || row.verified_by_ro ? ' is-disabled' : ''}`}
              title={!row._id ? 'This generated row has no attendance record to verify' : undefined}
            >
              <input
                type="checkbox"
                checked={Boolean(row._id && selectedIds.includes(row._id))}
                disabled={!row._id || row.verified_by_ro || bulkVerifying}
                onChange={() => row._id && onToggleSelection?.(row._id)}
                aria-label={`Select ${cleanText(row.employee_name)} attendance`}
              />
              <span>Select</span>
            </label>

            <div className="attendance-employee-block">
              <div className="attendance-avatar">
                <UserRound size={18} />
              </div>

              <div>
                <h4>{cleanText(row.employee_name)}</h4>
                <p>
                  {cleanText(row.employee_id)}
                  {' • '}
                  {cleanText(row.designation)}
                </p>
              </div>
            </div>

            <span className={`attendance-status-pill ${attendanceStatusClass(row.status)}`}>
              {cleanText(row.status)}
            </span>
          </div>

          <div className="attendance-meta-grid">
            <div>
              <span>Date</span>
              <strong>{cleanText(row.date)}</strong>
            </div>

            <div>
              <span>Mode</span>
              <strong>{cleanText(row.mode)}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{cleanText(row.department)}</strong>
            </div>

            <div>
              <span>Organisation</span>
              <strong>{cleanText(row.organisation)}</strong>
            </div>

            <div>
              <span>State</span>
              <strong>{cleanText(row.state)}</strong>
            </div>

            <div>
              <span>Verified</span>
              <strong>{cleanText(row.verified)}</strong>
            </div>
          </div>

          <div className="attendance-time-grid">
            <div>
              <span>Check In</span>
              <strong>{cleanText(row.check_in)}</strong>
            </div>

            <div>
              <span>Check Out</span>
              <strong>{cleanText(row.check_out)}</strong>
            </div>

            <div>
              <span>Late Reason</span>
              <strong>{cleanText(row.late_reason)}</strong>
            </div>

            <div>
              <span>Early Checkout Reason</span>
              <strong>{cleanText(row.early_checkout_reason)}</strong>
            </div>
          </div>

          <div className="attendance-location-grid">
            <div className="attendance-location-box">
              <MapPin size={16} />
              <div>
                <span>Check-in Location</span>
                <strong>{cleanText(row.check_in_location_text)}</strong>

                {row.check_in_map_url && (
                  <a href={row.check_in_map_url} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                )}
              </div>
            </div>

            <div className="attendance-location-box">
              <MapPin size={16} />
              <div>
                <span>Check-out Location</span>
                <strong>{cleanText(row.check_out_location_text)}</strong>

                {row.check_out_map_url && (
                  <a href={row.check_out_map_url} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="attendance-record-footer">
            {String(row.raw_mode || '').toLowerCase() === 'field' && (
              <div>
                <span>Field Location</span>
                <strong>{cleanText(row.field_location)}</strong>

                <FieldPhotoPreview row={row} />
              </div>
            )}

            <div className="attendance-record-action">
              {row.action}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}



function AttendanceReportTable({
  rows = [],
  loading = false,
  expanded = false,
  selectedIds = [],
  onToggleSelection,
  bulkVerifying = false,
}) {
  const scrollRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
  });

  function stopTableDrag(event) {
    const scroller = scrollRef.current;
    const pointerId = dragStateRef.current.pointerId;

    dragStateRef.current.active = false;
    dragStateRef.current.pointerId = null;
    scroller?.classList.remove('is-dragging');

    if (
      scroller &&
      pointerId !== null &&
      scroller.hasPointerCapture?.(pointerId)
    ) {
      try {
        scroller.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }

    if (event?.currentTarget) {
      event.currentTarget.classList.remove('is-dragging');
    }
  }

  function startTableDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const interactiveTarget = event.target.closest?.(
      'a, button, input, select, textarea, label, [role="button"]',
    );

    if (interactiveTarget) return;

    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;

    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
    };

    scroller.classList.add('is-dragging');

    try {
      scroller.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; scrolling still works without it.
    }

    if (event.pointerType === 'mouse') {
      event.preventDefault();
    }
  }

  function moveTableDrag(event) {
    const scroller = scrollRef.current;
    const dragState = dragStateRef.current;

    if (
      !scroller ||
      !dragState.active ||
      dragState.pointerId !== event.pointerId
    ) {
      return;
    }

    const distance = event.clientX - dragState.startX;

    if (Math.abs(distance) > 2) {
      event.preventDefault();
      scroller.scrollLeft = dragState.startScrollLeft - distance;
    }
  }

  if (loading) {
    return (
      <div
        className={`attendance-report-table-shell is-loading${expanded ? ' is-expanded' : ''}`}
        aria-hidden="true"
      >
        <div className="attendance-report-table-loading-head" />
        {[1, 2, 3, 4].map((item) => (
          <div className="attendance-report-table-loading-row" key={item}>
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={`${item}-${index}`} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="attendance-empty-state">
        <CalendarDays size={34} />
        <strong>No attendance records found</strong>
        <span>Today’s attendance will appear here. Use filters to view past records.</span>
      </div>
    );
  }

  return (
    <div className={`attendance-report-table-shell${expanded ? ' is-expanded' : ''}`}>
      <div
        ref={scrollRef}
        className="attendance-report-table-scroll"
        onPointerDown={startTableDrag}
        onPointerMove={moveTableDrag}
        onPointerUp={stopTableDrag}
        onPointerCancel={stopTableDrag}
        onLostPointerCapture={stopTableDrag}
        onDragStart={(event) => event.preventDefault()}
        aria-label="Attendance table. Swipe or drag left and right to view more columns."
      >
        <table className="attendance-report-table">
          <thead>
            <tr>
              <th className="attendance-table-select-head">Select</th>
              <th>Employee</th>
              <th>Employee ID</th>
              <th>Date</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Organisation</th>
              <th>State</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Check-in Location</th>
              <th>Check-out Location</th>
              <th>Late Reason</th>
              <th>Early Checkout Reason</th>
              <th>Verified</th>
              <th>Field Details</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row._id || `${row.employee_id}-${row.raw_date}`}
                className={selectedIds.includes(row._id) ? 'is-selected' : ''}
              >
                <td className="attendance-table-select-cell">
                  <input
                    type="checkbox"
                    checked={Boolean(row._id && selectedIds.includes(row._id))}
                    disabled={!row._id || row.verified_by_ro || bulkVerifying}
                    onChange={() => row._id && onToggleSelection?.(row._id)}
                    aria-label={`Select ${cleanText(row.employee_name)} attendance`}
                    title={!row._id ? 'This generated row has no attendance record to verify' : undefined}
                  />
                </td>
                <td className="attendance-table-employee-cell">
                  <span className="attendance-table-employee">
                    <span className="attendance-table-avatar" aria-hidden="true">
                      <UserRound size={15} />
                    </span>
                    <strong>{cleanText(row.employee_name)}</strong>
                  </span>
                </td>
                <td>{cleanText(row.employee_id)}</td>
                <td>{cleanText(row.date)}</td>
                <td>
                  <span className={`attendance-status-pill ${attendanceStatusClass(row.status)}`}>
                    {cleanText(row.status)}
                  </span>
                </td>
                <td>{cleanText(row.mode)}</td>
                <td>{cleanText(row.department)}</td>
                <td>{cleanText(row.designation)}</td>
                <td>{cleanText(row.organisation)}</td>
                <td>{cleanText(row.state)}</td>
                <td>{cleanText(row.check_in)}</td>
                <td>{cleanText(row.check_out)}</td>
                <td className="attendance-table-location-cell">
                  <span>{cleanText(row.check_in_location_text)}</span>
                  {row.check_in_map_url && (
                    <a href={row.check_in_map_url} target="_blank" rel="noreferrer">Open map</a>
                  )}
                </td>
                <td className="attendance-table-location-cell">
                  <span>{cleanText(row.check_out_location_text)}</span>
                  {row.check_out_map_url && (
                    <a href={row.check_out_map_url} target="_blank" rel="noreferrer">Open map</a>
                  )}
                </td>
                <td className="attendance-table-wrap-cell">{cleanText(row.late_reason)}</td>
                <td className="attendance-table-wrap-cell">{cleanText(row.early_checkout_reason)}</td>
                <td>{cleanText(row.verified)}</td>
                <td className="attendance-table-field-cell">
                  {String(row.raw_mode || '').toLowerCase() === 'field' ? (
                    <>
                      <span>{cleanText(row.field_location)}</span>
                      <FieldPhotoPreview row={row} />
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="attendance-table-action-cell">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function AttendanceBulkVerifyControls({
  rows = [],
  selectedIds = [],
  onToggleAll,
  onVerifySelected,
  onVerifyAll,
  bulkVerifying = false,
  feedbackMessage = null,
  onFeedbackClose = () => {},
}) {
  const verifiableRows = rows.filter((row) => row?._id && !row.verified_by_ro);
  const verifiableIds = verifiableRows.map((row) => row._id);
  const selectedVerifiableCount = selectedIds.filter((id) => verifiableIds.includes(id)).length;
  const allSelected =
    verifiableIds.length > 0 &&
    verifiableIds.every((id) => selectedIds.includes(id));

  return (
    <div className="attendance-bulk-verify-stack">
      <div className="attendance-bulk-verify-toolbar">
        <label className="attendance-select-all-control">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!verifiableIds.length || bulkVerifying}
            onChange={() => onToggleAll?.(verifiableIds, !allSelected)}
          />
          <span>
            Select All
            {selectedVerifiableCount > 0 ? ` (${selectedVerifiableCount})` : ''}
          </span>
        </label>

        <div className="attendance-bulk-verify-actions">
          <button
            type="button"
            className="secondary"
            onClick={onVerifySelected}
            disabled={!selectedVerifiableCount || bulkVerifying}
          >
            {bulkVerifying ? 'Verifying...' : `Verify Selected${selectedVerifiableCount ? ` (${selectedVerifiableCount})` : ''}`}
          </button>

          <button
            type="button"
            className="primary"
            onClick={onVerifyAll}
            disabled={!verifiableIds.length || bulkVerifying}
          >
            {bulkVerifying ? 'Verifying...' : `Verify All (${verifiableIds.length})`}
          </button>
        </div>
      </div>

      <AttendanceInlineMessage
        message={feedbackMessage}
        onClose={onFeedbackClose}
      />
    </div>
  );
}

function getSaasTenant(user = {}) {
  return user.tenant || user.company || {};
}

function getSaasSubscription(user = {}) {
  return user.subscription || user.saas_subscription || {};
}

function getSaasPlanType(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasStatus(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.status ||
      tenant.status ||
      user.subscription_status ||
      user.status ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasTrialEndDate(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return (
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
  );
}

function getSaasCompanyName(user = {}) {
  const tenant = getSaasTenant(user);

  return (
    user.company_name ||
    tenant.company_name ||
    tenant.name ||
    'Your company'
  );
}

function formatSaasDate(value) {
  if (!value) {
    return 'Not available';
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function getSaasDaysLeft(user = {}) {
  const endDate = getSaasTrialEndDate(user);

  if (!endDate) {
    return null;
  }

  const date = new Date(endDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diff = date.getTime() - Date.now();

  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function Attendance({ user = {}, setPage } = {}) {
  const alerts = useCustomAlert();

  const [myAttendance, setMyAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [holidayWorkRequests, setHolidayWorkRequests] = useState([]);
  const [myHolidayWorkRequests, setMyHolidayWorkRequests] = useState([]);
  const [teamFieldAttendance, setTeamFieldAttendance] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [myCompOffs, setMyCompOffs] = useState([]);

  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [decidingHolidayWorkId, setDecidingHolidayWorkId] = useState('');
  const [loadingTeamField, setLoadingTeamField] = useState(false);
  const [verifyingId, setVerifyingId] = useState('');
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState([]);
  const [bulkVerifying, setBulkVerifying] = useState(false);
  const [claimingCompOff, setClaimingCompOff] = useState(false);

  const pageRef = useRef(null);
  const [filters, setFilters] = useState({ ...EMPTY_REPORT_FILTERS });
  const [reportViewMode, setReportViewMode] = useState('cards');
  const [isReportTableExpanded, setIsReportTableExpanded] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ ...EMPTY_HOLIDAY_FORM });
  const [holidayWorkFilters, setHolidayWorkFilters] = useState({
    ...EMPTY_HOLIDAY_WORK_FILTERS,
  });

  const [teamFieldFilters, setTeamFieldFilters] = useState({
    ...EMPTY_TEAM_FIELD_FILTERS,
  });
  const [compOffForm, setCompOffForm] = useState({ ...EMPTY_COMPOFF_FORM });
  const [activeSection, setActiveSection] = useState('attendance');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  const userRoles = roles();
  const saasPlanType = getSaasPlanType(user);
  const saasStatus = getSaasStatus(user);
  const isDemoTenant = saasPlanType === 'demo';
  const isExpiredOrSuspendedTenant = saasStatus === 'expired' || saasStatus === 'suspended';
  const saasDaysLeft = getSaasDaysLeft(user);
  const saasTrialEndDate = getSaasTrialEndDate(user);
  const saasCompanyName = getSaasCompanyName(user);

  const openBillingPage = () => {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    try {
      window.history.pushState({}, '', '/billing');
    } catch {
      // Ignore browser history errors.
    }
  };

  const canViewReport =
    isHRUser() ||
    isTeamLeader() ||
    isReportingOfficer() ||
    userRoles.some((role) =>
      [
        'super_admin',
        'admin',
        'hr_admin',
        'hr_manager',
        'hr',
        'finance',
        'accounts_finance',
      ].includes(role),
    );

  const isHrAdminAttendanceView = userRoles.some((role) =>
    [
      'super_admin',
      'admin',
      'hr_admin',
      'hr_manager',
      'hr',
      'finance',
      'accounts_finance',
    ].includes(role),
  );

  const showEmployeeSelfAttendancePanel = !isHrAdminAttendanceView;

  const canManageHoliday = userRoles.some((role) =>
    [
      'super_admin',
      'admin',
      'hr_admin',
      'hr_manager',
      'hr',
      'finance',
      'accounts_finance',
    ].includes(role),
  );

  const hasActiveReportFilters = useMemo(() => {
    return Object.values(filters).some((value) => String(value || '').trim());
  }, [filters]);


  const reportSummary = useMemo(() => {
    const total = report.length;

    return {
      total,
      present: report.filter((row) => String(row.raw_status || row.status || '').toLowerCase().includes('present')).length,
      late: report.filter((row) => String(row.raw_status || row.status || '').toLowerCase().includes('late')).length,
      verified: report.filter((row) => row.verified_by_ro).length,
    };
  }, [report]);

  function clearInlineFeedback(scope) {
    if (!scope) return;

    const timer = feedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scope)) {
        return current;
      }

      const next = { ...current };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(
    scope,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scope) return;

    const timer = feedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => ({
      ...current,
      [scope]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scope] = window.setTimeout(() => {
        setInlineFeedback((current) => {
          const next = { ...current };
          delete next[scope];
          return next;
        });

        delete feedbackTimersRef.current[scope];
      }, ATTENDANCE_NOTICE_HIDE_MS);
    }
  }

  async function loadMyAttendance() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyAttendance([]);
      return;
    }

    const data = await api('/attendance/my');
    setMyAttendance(normalizeAttendanceRows(data.items || []));
  }

  async function loadReport(
    nextFilters = filters,
    { showLoader = true } = {},
  ) {
    if (!canViewReport) return;

    if (showLoader) {
      setLoadingReport(true);
    }

    try {
      const data = await api(`/attendance/report${buildQuery(nextFilters)}`);
      setReport(normalizeAttendanceRows(data.items || []));
    } finally {
      if (showLoader) {
        setLoadingReport(false);
      }
    }
  }

  async function loadHolidayWorkRequests(nextFilters = holidayWorkFilters) {
    if (!canViewReport) return;

    const data = await api(`/attendance/holiday-work-requests${buildQuery(nextFilters)}`);
    setHolidayWorkRequests(normalizeHolidayWorkRequestRows(data.items || []));
  }

  async function loadMyHolidayWorkRequests() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyHolidayWorkRequests([]);
      return;
    }

    const data = await api('/attendance/my-holiday-work-requests');
    setMyHolidayWorkRequests(normalizeHolidayWorkRequestRows(data.items || []));
  }

  async function loadTeamFieldAttendance(
    nextFilters = teamFieldFilters,
    { showLoader = true } = {},
  ) {
    if (!canViewReport) return;

    if (showLoader) {
      setLoadingTeamField(true);
    }

    try {
      const data = await api(`/attendance/team-field-attendance${buildQuery(nextFilters)}`);
      setTeamFieldAttendance(normalizeAttendanceRows(data.items || []));
    } finally {
      if (showLoader) {
        setLoadingTeamField(false);
      }
    }
  }

  async function loadHolidays() {
    if (!canManageHoliday) return;

    const data = await api('/attendance/holidays');
    setHolidays(normalizeHolidayRows(data.items || []));
  }

  async function loadMyCompOffs() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyCompOffs([]);
      return;
    }

    const data = await api('/attendance/compoffs');
    setMyCompOffs(normalizeCompOffRows(data.items || []));
  }

async function refreshAttendance({
  showLoader = true,
  feedbackScope = '',
} = {}) {
  setLoadingPage(true);

  if (feedbackScope) {
    showInlineFeedback(
      feedbackScope,
      'info',
      'Refreshing attendance, holiday work and comp-off data...',
      'Refreshing',
      { loading: true },
    );
  }

  try {
    await Promise.all([
      loadMyAttendance(),
      loadMyHolidayWorkRequests(),
      loadMyCompOffs(),
      canViewReport
        ? loadReport(filters, { showLoader })
        : Promise.resolve(),
      canViewReport
        ? loadHolidayWorkRequests(holidayWorkFilters)
        : Promise.resolve(),
      canViewReport
        ? loadTeamFieldAttendance(teamFieldFilters, { showLoader })
        : Promise.resolve(),
      canManageHoliday ? loadHolidays() : Promise.resolve(),
    ]);

    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'success',
        'Attendance data is up to date.',
        'Refresh Complete',
      );
    }

    return true;
  } catch (error) {
    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to refresh attendance data',
        'Refresh Failed',
      );
    } else {
      alerts.error(
        error.message || 'Unable to refresh attendance data',
        'Refresh Failed',
      );
    }

    return false;
  } finally {
    setLoadingPage(false);
  }
}

  useEffect(() => {
    refreshAttendance({ showLoader: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.attendance-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setInlineFeedback({});
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const availableIds = new Set(
      report
        .filter((row) => row?._id && !row.verified_by_ro)
        .map((row) => row._id),
    );

    setSelectedAttendanceIds((current) =>
      current.filter((id) => availableIds.has(id)),
    );
  }, [report]);

  useEffect(() => {
    if (!isReportTableExpanded) return undefined;

    const pageElement = pageRef.current;
    const backgroundElement = pageElement?.closest('#root, #app') || pageElement;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const hadInert = backgroundElement?.hasAttribute('inert') || false;
    const previousAriaHidden = backgroundElement?.getAttribute('aria-hidden');

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    if (backgroundElement) {
      backgroundElement.setAttribute('inert', '');
      backgroundElement.setAttribute('aria-hidden', 'true');
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsReportTableExpanded(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);

      if (backgroundElement) {
        if (!hadInert) {
          backgroundElement.removeAttribute('inert');
        }

        if (previousAriaHidden === null) {
          backgroundElement.removeAttribute('aria-hidden');
        } else {
          backgroundElement.setAttribute('aria-hidden', previousAriaHidden);
        }
      }

      window.removeEventListener('keydown', handleEscape);
    };
  }, [isReportTableExpanded]);

  async function searchReport(event) {
    event.preventDefault();

    showInlineFeedback(
      'report-filter',
      'info',
      'Searching attendance records with the selected filters...',
      'Searching',
      { loading: true },
    );

    try {
      await loadReport(filters, { showLoader: false });

      showInlineFeedback(
        'report-filter',
        'success',
        'Attendance records updated for the selected filters.',
        'Search Complete',
      );
    } catch (error) {
      showInlineFeedback(
        'report-filter',
        'error',
        error.message || 'Unable to load attendance report',
        'Report Load Failed',
      );
    }
  }

  async function clearReportFilters(
    feedbackScope = 'report-filter',
  ) {
    const cleared = { ...EMPTY_REPORT_FILTERS };

    showInlineFeedback(
      feedbackScope,
      'info',
      'Clearing attendance filters and restoring the default records...',
      'Clearing Filters',
      { loading: true },
    );

    try {
      setFilters(cleared);
      await loadReport(cleared, { showLoader: false });

      showInlineFeedback(
        feedbackScope,
        'success',
        'Attendance filters have been cleared.',
        'Filters Cleared',
      );
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to clear report filters',
        'Clear Failed',
      );
    }
  }

  async function verifyAttendance(row) {
    const attendanceId = row?._id;
    const feedbackScope = `attendance-${attendanceId || 'missing'}`;

    if (!attendanceId) {
      showInlineFeedback(
        feedbackScope,
        'error',
        'Attendance id not found.',
        'Missing Attendance ID',
      );
      return;
    }

    const verifyPopupScrollY = window.scrollY;
    const verifyPopupPreviousBodyOverflow = document.body.style.overflow;
    const verifyPopupPreviousBodyPosition = document.body.style.position;
    const verifyPopupPreviousBodyTop = document.body.style.top;
    const verifyPopupPreviousBodyWidth = document.body.style.width;
    const verifyPopupPreviousHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${verifyPopupScrollY}px`;
    document.body.style.width = '100%';

    let ok;

    try {
      ok = await alerts.confirm('Verify this attendance record?', {
        title: 'Verify Attendance',
        confirmText: 'Yes, Verify',
        cancelText: 'Cancel',
        type: 'warning',
      });
    } finally {
      document.documentElement.style.overflow = verifyPopupPreviousHtmlOverflow;
      document.body.style.overflow = verifyPopupPreviousBodyOverflow;
      document.body.style.position = verifyPopupPreviousBodyPosition;
      document.body.style.top = verifyPopupPreviousBodyTop;
      document.body.style.width = verifyPopupPreviousBodyWidth;
      window.scrollTo(0, verifyPopupScrollY);
    }

    if (!ok) {
      showInlineFeedback(
        feedbackScope,
        'info',
        'Attendance verification was cancelled.',
        'No Changes Made',
      );
      return;
    }

    try {
      setVerifyingId(attendanceId);

      showInlineFeedback(
        feedbackScope,
        'info',
        'Verifying this attendance record...',
        'Verifying Attendance',
        { loading: true },
      );

      const data = await api(`/attendance/${attendanceId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      setReport((current) =>
        current.map((item) =>
          item._id === attendanceId
            ? {
                ...item,
                verified_by_ro: true,
                verified: 'Yes',
              }
            : item,
        ),
      );

      showInlineFeedback(
        feedbackScope,
        'success',
        data.message || 'Attendance verified successfully.',
        'Attendance Verified',
      );

      loadReport(filters, { showLoader: false }).catch(() => {
        // The verified state is already shown locally; a later refresh can resync.
      });
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to verify attendance',
        'Verification Failed',
      );
    } finally {
      setVerifyingId('');
    }
  }


  function toggleAttendanceSelection(attendanceId) {
    if (!attendanceId) return;

    setSelectedAttendanceIds((current) =>
      current.includes(attendanceId)
        ? current.filter((id) => id !== attendanceId)
        : [...current, attendanceId],
    );
  }

  function toggleAllAttendanceSelection(verifiableIds = [], shouldSelect = true) {
    setSelectedAttendanceIds((current) => {
      if (!shouldSelect) {
        return current.filter((id) => !verifiableIds.includes(id));
      }

      return Array.from(new Set([...current, ...verifiableIds]));
    });
  }

  async function verifyAttendanceBatch(
    attendanceIds = [],
    mode = 'selected',
  ) {
    const feedbackScope = 'bulk-verify';
    const uniqueIds = Array.from(new Set(attendanceIds.filter(Boolean)));

    if (!uniqueIds.length) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        mode === 'all'
          ? 'There are no unverified attendance records available to verify.'
          : 'Select at least one attendance record first.',
        mode === 'all' ? 'Nothing to Verify' : 'No Records Selected',
      );
      return;
    }

    const verifyPopupScrollY = window.scrollY;
    const verifyPopupPreviousBodyOverflow = document.body.style.overflow;
    const verifyPopupPreviousBodyPosition = document.body.style.position;
    const verifyPopupPreviousBodyTop = document.body.style.top;
    const verifyPopupPreviousBodyWidth = document.body.style.width;
    const verifyPopupPreviousHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${verifyPopupScrollY}px`;
    document.body.style.width = '100%';

    let ok;

    try {
      ok = await alerts.confirm(
        mode === 'all'
          ? `Verify all ${uniqueIds.length} available attendance records?`
          : `Verify ${uniqueIds.length} selected attendance record${uniqueIds.length === 1 ? '' : 's'}?`,
        {
          title:
            mode === 'all'
              ? 'Verify All Attendance'
              : 'Verify Selected Attendance',
          confirmText:
            mode === 'all'
              ? 'Yes, Verify All'
              : 'Yes, Verify Selected',
          cancelText: 'Cancel',
          type: 'warning',
        },
      );
    } finally {
      document.documentElement.style.overflow = verifyPopupPreviousHtmlOverflow;
      document.body.style.overflow = verifyPopupPreviousBodyOverflow;
      document.body.style.position = verifyPopupPreviousBodyPosition;
      document.body.style.top = verifyPopupPreviousBodyTop;
      document.body.style.width = verifyPopupPreviousBodyWidth;
      window.scrollTo(0, verifyPopupScrollY);
    }

    if (!ok) {
      showInlineFeedback(
        feedbackScope,
        'info',
        'Bulk attendance verification was cancelled.',
        'No Changes Made',
      );
      return;
    }

    try {
      setBulkVerifying(true);

      showInlineFeedback(
        feedbackScope,
        'info',
        `Verifying ${uniqueIds.length} attendance record${uniqueIds.length === 1 ? '' : 's'}...`,
        mode === 'all'
          ? 'Verifying All Attendance'
          : 'Verifying Selected Attendance',
        { loading: true },
      );

      let verifiedCount = 0;
      const failedIds = [];

      for (const attendanceId of uniqueIds) {
        try {
          await api(`/attendance/${attendanceId}/verify`, {
            method: 'PATCH',
            body: JSON.stringify({}),
          });
          verifiedCount += 1;
        } catch {
          failedIds.push(attendanceId);
        }
      }

      const failedSet = new Set(failedIds);

      setReport((current) =>
        current.map((item) =>
          uniqueIds.includes(item._id) && !failedSet.has(item._id)
            ? {
                ...item,
                verified_by_ro: true,
                verified: 'Yes',
              }
            : item,
        ),
      );

      setSelectedAttendanceIds((current) =>
        current.filter((id) => failedSet.has(id)),
      );

      if (failedIds.length) {
        showInlineFeedback(
          feedbackScope,
          'warning',
          `${verifiedCount} attendance record${verifiedCount === 1 ? '' : 's'} verified. ${failedIds.length} could not be verified.`,
          'Verification Partially Completed',
        );
      } else {
        showInlineFeedback(
          feedbackScope,
          'success',
          `${verifiedCount} attendance record${verifiedCount === 1 ? '' : 's'} verified successfully.`,
          mode === 'all'
            ? 'All Attendance Verified'
            : 'Selected Attendance Verified',
        );
      }

      loadReport(filters, { showLoader: false }).catch(() => {
        // The verified rows are already shown locally; a later refresh can resync.
      });
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to verify the selected attendance records.',
        'Verification Failed',
      );
    } finally {
      setBulkVerifying(false);
    }
  }

  async function verifySelectedAttendance() {
    const currentVerifiableIds = report
      .filter((row) => row?._id && !row.verified_by_ro)
      .map((row) => row._id);

    await verifyAttendanceBatch(
      selectedAttendanceIds.filter((id) => currentVerifiableIds.includes(id)),
      'selected',
    );
  }

  async function verifyAllAttendance() {
    const allVerifiableIds = report
      .filter((row) => row?._id && !row.verified_by_ro)
      .map((row) => row._id);

    await verifyAttendanceBatch(allVerifiableIds, 'all');
  }

async function createHoliday(event) {
  event.preventDefault();

  const feedbackScope = 'holiday-create';

  if (!holidayForm.date || !holidayForm.title.trim()) {
    showInlineFeedback(
      feedbackScope,
      'warning',
      'Holiday date and title are required.',
      'Missing Holiday Details',
    );
    return;
  }

  try {
    setSavingHoliday(true);

    showInlineFeedback(
      feedbackScope,
      'info',
      'Adding the holiday to the state-wise calendar...',
      'Adding Holiday',
      { loading: true },
    );

    const data = await api('/attendance/holidays', {
      method: 'POST',
      body: JSON.stringify(holidayForm),
    });

    setHolidayForm({ ...EMPTY_HOLIDAY_FORM });

    showInlineFeedback(
      feedbackScope,
      'success',
      data.message || 'Holiday added successfully.',
      'Holiday Added',
    );

    await loadHolidays();
  } catch (error) {
    showInlineFeedback(
      feedbackScope,
      'error',
      error.message || 'Unable to add holiday',
      'Holiday Save Failed',
    );
  } finally {
    setSavingHoliday(false);
  }
}


async function decideHolidayWorkRequest(row, status) {
  const requestId = row?._id;
  const feedbackScope = `holiday-work-${requestId || 'missing'}`;

  if (!requestId) {
    showInlineFeedback(
      feedbackScope,
      'error',
      'Request id not found.',
      'Missing Request ID',
    );
    return;
  }

  const decisionText = statusLabel(status);
  const isReject = String(status || '').toLowerCase() === 'rejected';

  const ok = await alerts.confirm(
    `${decisionText} this holiday work request?`,
    {
      title: `${decisionText} Holiday Work`,
      confirmText: `Yes, ${decisionText}`,
      cancelText: 'Cancel',
      type: 'warning',
      danger: isReject,
    },
  );

  if (!ok) {
    showInlineFeedback(
      feedbackScope,
      'info',
      `Holiday work ${decisionText.toLowerCase()} action was cancelled.`,
      'No Changes Made',
    );
    return;
  }

  try {
    setDecidingHolidayWorkId(requestId);

    showInlineFeedback(
      feedbackScope,
      'info',
      `${decisionText} holiday work request...`,
      `${decisionText} Holiday Work`,
      { loading: true },
    );

    const data = await api(
      `/attendance/holiday-work-requests/${requestId}/decision`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    );

    setHolidayWorkRequests((current) =>
      current.map((item) =>
        item._id === requestId
          ? {
              ...item,
              raw_status: status,
              status: statusLabel(status),
              current_stage: statusLabel(status),
            }
          : item,
      ),
    );

    showInlineFeedback(
      feedbackScope,
      'success',
      data.message || `Holiday work request ${status}.`,
      isReject ? 'Holiday Work Rejected' : 'Holiday Work Approved',
    );

    Promise.all([
      loadHolidayWorkRequests(holidayWorkFilters),
      loadMyHolidayWorkRequests(),
      loadReport(filters, { showLoader: false }),
      loadTeamFieldAttendance(teamFieldFilters, { showLoader: false }),
    ]).catch(() => {
      // The decision is already shown locally; a later refresh can resync.
    });
  } catch (error) {
    showInlineFeedback(
      feedbackScope,
      'error',
      error.message || 'Unable to update holiday work request',
      'Update Failed',
    );
  } finally {
    setDecidingHolidayWorkId('');
  }
}

async function searchHolidayWorkRequests(event) {
  event.preventDefault();

  showInlineFeedback(
    'holiday-filter',
    'info',
    'Searching holiday work requests...',
    'Searching',
    { loading: true },
  );

  try {
    await loadHolidayWorkRequests(holidayWorkFilters);

    showInlineFeedback(
      'holiday-filter',
      'success',
      'Holiday work request results are up to date.',
      'Search Complete',
    );
  } catch (error) {
    showInlineFeedback(
      'holiday-filter',
      'error',
      error.message || 'Unable to load holiday work requests',
      'Holiday Requests Load Failed',
    );
  }
}

async function clearHolidayWorkFilters() {
  const cleared = { ...EMPTY_HOLIDAY_WORK_FILTERS };

  showInlineFeedback(
    'holiday-filter',
    'info',
    'Clearing holiday work request filters...',
    'Clearing Filters',
    { loading: true },
  );

  try {
    setHolidayWorkFilters(cleared);
    await loadHolidayWorkRequests(cleared);

    showInlineFeedback(
      'holiday-filter',
      'success',
      'Holiday work request filters have been cleared.',
      'Filters Cleared',
    );
  } catch (error) {
    showInlineFeedback(
      'holiday-filter',
      'error',
      error.message || 'Unable to clear holiday work request filters',
      'Clear Failed',
    );
  }
}

async function searchTeamFieldAttendance(event) {
  event.preventDefault();

  showInlineFeedback(
    'field-filter',
    'info',
    'Searching team field attendance...',
    'Searching',
    { loading: true },
  );

  try {
    await loadTeamFieldAttendance(teamFieldFilters, {
      showLoader: false,
    });

    showInlineFeedback(
      'field-filter',
      'success',
      'Team field attendance results are up to date.',
      'Search Complete',
    );
  } catch (error) {
    showInlineFeedback(
      'field-filter',
      'error',
      error.message || 'Unable to load team field attendance',
      'Field Attendance Load Failed',
    );
  }
}

async function clearTeamFieldFilters() {
  const cleared = { ...EMPTY_TEAM_FIELD_FILTERS };

  showInlineFeedback(
    'field-filter',
    'info',
    'Clearing team field attendance filters...',
    'Clearing Filters',
    { loading: true },
  );

  try {
    setTeamFieldFilters(cleared);
    await loadTeamFieldAttendance(cleared, {
      showLoader: false,
    });

    showInlineFeedback(
      'field-filter',
      'success',
      'Team field attendance filters have been cleared.',
      'Filters Cleared',
    );
  } catch (error) {
    showInlineFeedback(
      'field-filter',
      'error',
      error.message || 'Unable to clear team field attendance filters',
      'Clear Failed',
    );
  }
}

async function claimCompOff(event) {
  event.preventDefault();

  const feedbackScope = 'compoff-claim';

  if (!compOffForm.compoff_id || !compOffForm.claim_date) {
    showInlineFeedback(
      feedbackScope,
      'warning',
      'Select comp-off and claim date.',
      'Missing Comp-Off Details',
    );
    return;
  }

  try {
    setClaimingCompOff(true);

    showInlineFeedback(
      feedbackScope,
      'info',
      'Submitting the comp-off claim...',
      'Submitting Claim',
      { loading: true },
    );

    const data = await api(
      `/attendance/compoffs/${compOffForm.compoff_id}/claim`,
      {
        method: 'POST',
        body: JSON.stringify({
          claim_date: compOffForm.claim_date,
          reason: compOffForm.reason,
        }),
      },
    );

    setCompOffForm({ ...EMPTY_COMPOFF_FORM });

    showInlineFeedback(
      feedbackScope,
      'success',
      data.message || 'Comp-off claim submitted successfully.',
      'Comp-Off Claim Submitted',
    );

    await loadMyCompOffs();
  } catch (error) {
    showInlineFeedback(
      feedbackScope,
      'error',
      error.message || 'Unable to claim comp-off',
      'Comp-Off Claim Failed',
    );
  } finally {
    setClaimingCompOff(false);
  }
}


  const reportRows = report.map((row) => {
    const feedbackScope = `attendance-${row._id || 'missing'}`;

    return {
      ...row,
      action: (
        <div className="attendance-row-action-stack">
          {row.verified_by_ro ? (
            <span className="attendance-verified-label">Verified</span>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => verifyAttendance(row)}
              disabled={
                verifyingId === row._id ||
                bulkVerifying ||
                !row._id
              }
            >
              {verifyingId === row._id ? 'Verifying...' : 'Verify'}
            </button>
          )}

          <AttendanceInlineMessage
            message={inlineFeedback[feedbackScope]}
            onClose={() => clearInlineFeedback(feedbackScope)}
            className="attendance-row-feedback"
          />
        </div>
      ),
    };
  });

  const pendingHolidayWorkRequestCount = holidayWorkRequests.filter(
    (row) => row.raw_status === 'pending',
  ).length;

  const holidayWorkRequestRows = holidayWorkRequests.map((row) => {
    const feedbackScope = `holiday-work-${row._id || 'missing'}`;

    return {
      ...row,
      proof: row.proof_photo ? (
        <a href={row.proof_photo} target="_blank" rel="noreferrer">
          View photo
        </a>
      ) : (
        '—'
      ),
      map: row.map_url ? (
        <a href={row.map_url} target="_blank" rel="noreferrer">
          Open map
        </a>
      ) : (
        '—'
      ),
      action: (
        <div className="attendance-row-action-stack">
          {row.raw_status === 'pending' ? (
            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  decideHolidayWorkRequest(row, 'approved')
                }
                disabled={decidingHolidayWorkId === row._id}
              >
                {decidingHolidayWorkId === row._id
                  ? 'Approving...'
                  : 'Approve'}
              </button>

              <button
                type="button"
                className="danger"
                onClick={() =>
                  decideHolidayWorkRequest(row, 'rejected')
                }
                disabled={decidingHolidayWorkId === row._id}
              >
                {decidingHolidayWorkId === row._id
                  ? 'Rejecting...'
                  : 'Reject'}
              </button>
            </div>
          ) : (
            <span>{statusLabel(row.raw_status)}</span>
          )}

          <AttendanceInlineMessage
            message={inlineFeedback[feedbackScope]}
            onClose={() => clearInlineFeedback(feedbackScope)}
            className="attendance-row-feedback"
          />
        </div>
      ),
    };
  });

  const myHolidayWorkRequestRows = myHolidayWorkRequests.map((row) => ({
    ...row,
    proof: row.proof_photo ? (
      <a href={row.proof_photo} target="_blank" rel="noreferrer">
        View photo
      </a>
    ) : (
      '—'
    ),
    map: row.map_url ? (
      <a href={row.map_url} target="_blank" rel="noreferrer">
        Open map
      </a>
    ) : (
      '—'
    ),
  }));

const teamFieldRows = teamFieldAttendance.map((row) => ({
  ...row,
  field_photo_link: <FieldPhotoPreview row={row} />,
  check_in_map: row.check_in_map_url ? (
      <a href={row.check_in_map_url} target="_blank" rel="noreferrer">
        Open map
      </a>
    ) : (
      '—'
    ),
  }));

  const availableCompOffs = myCompOffs.filter(
    (item) => item.raw_status === 'available',
  );

return (
  <div ref={pageRef} className="page-grid attendance-page">
    <style>{`
      .attendance-page {
        --at-ink: #101a3a;
        --at-copy: #5d6d8d;
        --at-violet: #4d77dd;
        --at-violet-deep: #4767b4;
        --at-blue: #4d77dd;
        --at-cyan: #2eb2b9;
        --at-teal: #2eb2b9;
        --at-yellow: #d8ff43;
        --at-line: rgba(16, 26, 58, .14);
        display: grid;
        gap: clamp(18px, 2vw, 26px);
        color: var(--at-ink);
      }

      .attendance-page,
      .attendance-page > *,
      .attendance-page .panel,
      .attendance-page .attendance-page-hero {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }

      .attendance-page img,
      .attendance-page input,
      .attendance-page select,
      .attendance-page textarea,
      .attendance-page button {
        max-width: 100%;
        box-sizing: border-box;
      }

      .attendance-page .attendance-page-hero {
        position: relative;
        isolation: isolate;
        overflow: hidden;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(360px, .78fr);
        gap: clamp(20px, 3vw, 38px);
        align-items: start;
        min-height: 280px;
        padding: clamp(24px, 3vw, 40px);
        border: 1px solid rgba(154, 164, 205, .58);
        border-radius: clamp(28px, 2.7vw, 40px);
        background:
          linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
        box-shadow: 0 22px 46px rgba(70, 92, 140, .10);
      }

      .attendance-page::before,
      .attendance-page::after,
      .attendance-page .attendance-page-hero::before,
      .attendance-page .attendance-page-hero::after,
      .attendance-page .panel::before,
      .attendance-page .panel::after,
      .attendance-page .attendance-card::before,
      .attendance-page .attendance-card::after,
      .attendance-page .attendance-pro-card::before,
      .attendance-page .attendance-pro-card::after,
      .attendance-page .attendance-summary-card::before,
      .attendance-page .attendance-summary-card::after {
        content: none !important;
        display: none !important;
      }

      .attendance-page-kicker,
      .attendance-section-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: max-content;
        max-width: 100%;
        border-radius: 999px;
        color: #fff;
        background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        font-size: 9px;
        font-weight: 950;
        line-height: 1;
        letter-spacing: .12em;
        text-transform: uppercase;
      }

      .attendance-page-kicker {
        margin-bottom: 15px;
        padding: 9px 13px;
      }

      .attendance-section-kicker {
        margin-bottom: 10px;
        padding: 7px 10px;
      }

      .attendance-page .attendance-page-hero h1 {
        max-width: 760px;
        margin: 0;
        color: var(--at-ink);
        font-family: var(--yc-display, Georgia, "Times New Roman", serif);
        font-size: clamp(44px, 5.3vw, 78px);
        font-weight: 760;
        line-height: .93;
        letter-spacing: -.06em;
      }

      .attendance-page .attendance-page-hero h1 em {
        color: var(--at-violet);
        font-family: Georgia, "Times New Roman", serif;
        font-weight: 500;
      }

      .attendance-page .attendance-page-hero p {
        max-width: 720px;
        margin: 17px 0 0;
        color: var(--at-copy);
        font-size: clamp(13px, 1vw, 16px);
        line-height: 1.68;
      }

      .attendance-page .hero-actions {
        margin-top: 20px;
      }

      .attendance-page .hero-actions .secondary {
        min-height: 46px;
        padding-inline: 16px;
        border: 1px solid rgba(77,119,221,.20);
        border-radius: 14px;
        color: #4767b4;
        background: rgba(255,255,255,.92);
        box-shadow: 0 10px 22px rgba(70,92,140,.08);
      }

      .attendance-page .hero-actions .secondary:hover {
        transform: translateY(-1px);
        border-color: rgba(46,178,185,.42);
        box-shadow: 0 12px 24px rgba(70,92,140,.10);
      }

      .attendance-page .attendance-card,
      .attendance-page .attendance-pro-card {
        align-self: start;
        border: 1px solid rgba(171,181,211,.68);
        border-radius: 28px;
        background:
          linear-gradient(145deg, #f7fbff 0%, #faf7ff 52%, #fffaf0 100%);
        box-shadow: 0 20px 38px rgba(34,38,110,.08);
      }

      .attendance-page .panel {
        min-width: 0;
        padding: clamp(20px, 2vw, 28px);
        border: 1px solid rgba(171,181,211,.70);
        border-radius: clamp(24px, 2.2vw, 34px);
        background: #fff;
        box-shadow: 0 20px 38px rgba(34,38,110,.08);
        transition:
          box-shadow 180ms ease,
          border-color 180ms ease;
      }

      .attendance-page .panel:hover {
        border-color: rgba(77,119,221,.28);
        box-shadow: 0 22px 42px rgba(34,38,110,.10);
      }

      .attendance-page .panel h3,
      .attendance-page .attendance-report-header h3 {
        margin: 0;
        color: var(--at-ink);
        font-family: var(--yc-display, Georgia, "Times New Roman", serif);
        font-size: clamp(26px, 2.4vw, 39px);
        font-weight: 760;
        line-height: .98;
        letter-spacing: -.045em;
      }

      .attendance-page .panel p,
      .attendance-page .attendance-report-header p {
        color: var(--at-copy);
        line-height: 1.6;
      }

      .attendance-page-dual {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: clamp(16px, 2vw, 24px);
        align-items: stretch;
        min-width: 0;
      }

      .attendance-page-dual > .panel {
        height: 100%;
      }

      .attendance-page .toolbar {
        align-items: flex-start;
        gap: 16px;
      }

      .attendance-page .employee-role-pill {
        border: 1px solid rgba(65,55,161,.14);
        border-radius: 999px;
        color: #4767b4;
        background: rgba(255,255,255,.92);
        box-shadow: 0 8px 18px rgba(70,92,140,.07);
        font-size: 10px;
        font-weight: 900;
      }

      .attendance-page .attendance-summary-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin: 18px 0;
      }

      .attendance-page .attendance-summary-card {
        min-height: 112px;
        padding: 17px;
        border: 1px solid rgba(171,181,211,.66);
        border-radius: 22px;
        background: #edf6ff;
        box-shadow: 0 16px 30px rgba(34,38,110,.07);
      }

      .attendance-page .attendance-summary-card:nth-child(2) {
        background: #eaf8f4;
      }

      .attendance-page .attendance-summary-card:nth-child(3) {
        background: #fff4d5;
      }

      .attendance-page .attendance-summary-card:nth-child(4) {
        background: #f1efff;
      }

      .attendance-page .attendance-summary-card span {
        display: block;
        color: #5d6785;
        font-size: 9px;
        font-weight: 950;
        letter-spacing: .10em;
        text-transform: uppercase;
      }

      .attendance-page .attendance-summary-card strong {
        display: block;
        margin-top: 9px;
        color: var(--at-ink);
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(30px, 2.8vw, 44px);
      }

      .attendance-section-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        width: 100%;
        padding: 12px;
        border: 1px solid rgba(171,181,211,.62);
        border-radius: 22px;
        background: #fff;
        box-shadow: 0 16px 28px rgba(34,38,110,.08);
      }

      .attendance-section-tab {
        min-width: 0;
        min-height: 62px;
        padding: 11px 14px;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        border: 1px solid rgba(77,119,221,.22);
        border-radius: 16px;
        color: #4767b4;
        background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
        text-align: left;
        font: inherit;
        cursor: pointer;
        transition:
          transform 180ms ease,
          border-color 180ms ease,
          background 180ms ease;
      }

      .attendance-section-tab:hover {
        transform: translateY(-1px);
        border-color: rgba(46,178,185,.42);
      }

      .attendance-section-tab.is-active {
        border-color: transparent;
        color: #fff;
        background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        box-shadow: 0 8px 18px rgba(77,119,221,.17);
      }

      .attendance-section-tab-copy {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .attendance-section-tab-copy strong {
        font-size: 12px;
        font-weight: 950;
        line-height: 1.2;
      }

      .attendance-section-tab-copy small {
        color: currentColor;
        font-size: 9px;
        font-weight: 700;
        line-height: 1.35;
        opacity: .78;
      }

      .attendance-section-tab-count {
        min-width: 28px;
        height: 28px;
        padding: 0 7px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        color: #4767b4;
        background: #fff;
        font-size: 9px;
        font-weight: 950;
        white-space: nowrap;
      }

      .attendance-action-stack,
      .attendance-widget-stack,
      .attendance-bulk-verify-stack,
      .attendance-row-action-stack {
        display: grid;
        gap: 9px;
        min-width: 0;
      }

      .attendance-action-stack {
        width: 100%;
      }

      .attendance-widget-stack {
        width: 100%;
        align-self: start;
      }

      .attendance-report-action-stack {
        width: min(360px, 100%);
      }

      .attendance-row-action-stack {
        min-width: 170px;
        max-width: 280px;
      }

      .attendance-verified-label {
        color: #047857;
        font-size: 11px;
        font-weight: 900;
      }

      .attendance-inline-feedback {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 9px;
        align-items: start;
        width: 100%;
        min-width: 0;
        padding: 10px 11px;
        border: 1px solid rgba(102,88,220,.18);
        border-radius: 12px;
        color: #4767b4;
        background: #f1efff;
        font-size: 10px;
        line-height: 1.45;
      }

      .attendance-inline-feedback.success {
        border-color: rgba(4,120,87,.18);
        color: #047857;
        background: #eaf8f4;
      }

      .attendance-inline-feedback.warning {
        border-color: rgba(154,104,23,.18);
        color: #9a6817;
        background: #fff4d5;
      }

      .attendance-inline-feedback.error {
        border-color: rgba(162,52,77,.18);
        color: #a2344d;
        background: #fff0f2;
      }

      .attendance-inline-feedback-icon {
        width: 22px;
        height: 22px;
        display: inline-grid;
        place-items: center;
      }

      .attendance-inline-feedback-copy {
        min-width: 0;
      }

      .attendance-inline-feedback-copy strong,
      .attendance-inline-feedback-copy span {
        display: block;
        overflow-wrap: anywhere;
      }

      .attendance-inline-feedback-copy strong {
        margin-bottom: 2px;
        font-weight: 950;
      }

      .attendance-inline-feedback-copy span {
        font-weight: 750;
      }

      .attendance-inline-feedback-close {
        width: 24px;
        min-width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        display: inline-grid;
        place-items: center;
        color: currentColor;
        background: rgba(255,255,255,.58);
        font: inherit;
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
      }

      .attendance-inline-feedback-close:hover {
        background: #fff;
      }

      .attendance-row-feedback {
        padding: 8px 9px;
        font-size: 9px;
      }

      .attendance-inline-spin {
        animation: attendanceSpin .82s linear infinite;
      }

      .attendance-page .attendance-filter-card,
      .attendance-page .dynamic-form {
        margin-top: 18px;
        padding: 17px;
        border: 1px solid rgba(162,169,196,.50);
        border-radius: 20px;
        background: rgba(255,255,255,.94);
        box-shadow: 0 12px 26px rgba(34,38,110,.06);
      }

      .attendance-page .attendance-filter-title {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--at-ink);
      }

      .attendance-page .attendance-filter-title span {
        color: var(--at-copy);
      }

      .attendance-page .attendance-filter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 13px;
        min-width: 0;
      }

      .attendance-page .attendance-filter-grid label,
      .attendance-page .dynamic-form label {
        color: #303b5b;
        font-size: 11px;
        font-weight: 900;
      }

      .attendance-page .attendance-filter-grid input,
      .attendance-page .attendance-filter-grid select,
      .attendance-page .dynamic-form input,
      .attendance-page .dynamic-form select,
      .attendance-page .dynamic-form textarea {
        min-height: 48px;
        border: 1px solid rgba(151,161,197,.58);
        border-radius: 15px;
        color: var(--at-ink);
        background: rgba(255,255,255,.93);
      }

      .attendance-page .attendance-filter-grid input:focus,
      .attendance-page .attendance-filter-grid select:focus,
      .attendance-page .dynamic-form input:focus,
      .attendance-page .dynamic-form select:focus,
      .attendance-page .dynamic-form textarea:focus {
        border-color: rgba(98,84,218,.65);
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
      }

      .attendance-page .primary,
      .attendance-page .secondary,
      .attendance-page .danger {
        border-radius: 15px;
        font-weight: 900;
        transition:
          transform 190ms cubic-bezier(.22,1,.36,1),
          box-shadow 190ms ease,
          filter 190ms ease;
      }

      .attendance-page .primary {
        color: #fff;
        background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        box-shadow: 0 10px 22px rgba(77,119,221,.18);
      }

      .attendance-page .secondary {
        border-color: rgba(77,119,221,.18);
        color: #4767b4;
        background: #fff;
        box-shadow: 0 8px 18px rgba(70,92,140,.06);
      }

      .attendance-page .primary:hover,
      .attendance-page .secondary:hover,
      .attendance-page .danger:hover {
        transform: translateY(-1px);
      }

      .attendance-report-display-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 14px;
        min-width: 0;
        flex-wrap: wrap;
      }

      .attendance-table-expand-button,
      .attendance-table-fullscreen-close {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 13px;
        border: 1px solid rgba(65,55,161,.18);
        border-radius: 13px;
        color: #4767b4;
        background: rgba(255,255,255,.92);
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
        font-size: 10px;
        font-weight: 900;
        cursor: pointer;
        transition:
          transform 190ms cubic-bezier(.22,1,.36,1),
          box-shadow 190ms ease;
      }

      .attendance-table-expand-button:hover,
      .attendance-table-fullscreen-close:hover {
        transform: translateY(-2px);
      }

      .attendance-table-expand-button:disabled {
        opacity: .55;
        cursor: not-allowed;
        transform: none;
      }

      .attendance-report-view-toggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px;
        border: 1px solid rgba(151,161,197,.48);
        border-radius: 15px;
        background: rgba(255,255,255,.84);
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
      }

      .attendance-report-view-toggle button {
        min-height: 38px;
        padding: 8px 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 0;
        border-radius: 11px;
        color: #5d6785;
        background: transparent;
        font-size: 10px;
        font-weight: 900;
        cursor: pointer;
      }

      .attendance-report-view-toggle button.is-active {
        color: #fff;
        background: linear-gradient(135deg, #4767b4, #5669d9);
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
      }

      .attendance-bulk-verify-toolbar {
        width: 100%;
        min-width: 0;
        margin-top: 12px;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        border: 1px solid rgba(151,161,197,.44);
        border-radius: 15px;
        background: rgba(255,255,255,.78);
      }

      .attendance-select-all-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--at-copy);
        font-size: 10px;
        font-weight: 900;
        cursor: pointer;
      }

      .attendance-bulk-verify-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }

      .attendance-bulk-verify-actions .primary,
      .attendance-bulk-verify-actions .secondary {
        min-height: 38px;
        padding: 8px 12px;
        font-size: 10px;
      }

      .attendance-table-select-head,
      .attendance-table-select-cell {
        width: 74px;
        min-width: 74px !important;
        text-align: center;
      }

      .attendance-report-table tbody tr.is-selected td {
        background: rgba(102,88,220,.045);
      }

      .attendance-report-table-shell {
        width: 100%;
        min-width: 0;
        margin-top: 10px;
        overflow: hidden;
        border: 1px solid rgba(171,181,211,.60);
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
      }

      .attendance-report-table-scroll {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        cursor: grab;
        scrollbar-width: thin;
        scrollbar-color: rgba(98,84,218,.34) transparent;
      }

      .attendance-report-table-scroll.is-dragging {
        cursor: grabbing;
        user-select: none;
      }

      .attendance-report-table-scroll a,
      .attendance-report-table-scroll button,
      .attendance-report-table-scroll input,
      .attendance-report-table-scroll select,
      .attendance-report-table-scroll textarea {
        cursor: pointer;
      }

      .attendance-report-table-scroll::-webkit-scrollbar {
        height: 8px;
      }

      .attendance-report-table-scroll::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(98,84,218,.34);
      }

      .attendance-report-table {
        width: 100%;
        min-width: 1680px;
        border-collapse: separate;
        border-spacing: 0;
        color: var(--at-ink);
        font-size: 10px;
      }

      .attendance-report-table th,
      .attendance-report-table td {
        padding: 12px 13px;
        vertical-align: top;
        border-bottom: 1px solid rgba(171,181,211,.34);
        border-right: 1px solid rgba(171,181,211,.22);
        background: #fff;
        text-align: left;
      }

      .attendance-report-table th {
        position: sticky;
        top: 0;
        z-index: 2;
        color: #536381;
        background: linear-gradient(180deg, #f8f8ff, #f2f7fb);
        font-size: 8px;
        font-weight: 950;
        letter-spacing: .06em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .attendance-report-table th:last-child,
      .attendance-report-table td:last-child {
        border-right: 0;
      }

      .attendance-report-table tbody tr:last-child td {
        border-bottom: 0;
      }

      .attendance-report-table tbody tr:hover td {
        background: #fafaff;
      }

      .attendance-report-table td {
        line-height: 1.45;
        white-space: nowrap;
      }

      .attendance-table-employee-cell {
        min-width: 190px;
      }

      .attendance-table-employee {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }

      .attendance-table-avatar {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        color: #fff;
        background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
      }

      .attendance-table-employee strong {
        max-width: 145px;
        overflow: hidden;
        color: var(--at-ink);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .attendance-table-location-cell {
        min-width: 220px;
        max-width: 290px;
        white-space: normal !important;
      }

      .attendance-table-location-cell span {
        display: block;
        color: var(--at-copy);
        overflow-wrap: anywhere;
      }

      .attendance-table-location-cell a {
        display: inline-block;
        margin-top: 5px;
        color: var(--at-violet);
        font-weight: 900;
      }

      .attendance-table-wrap-cell {
        min-width: 180px;
        max-width: 250px;
        white-space: normal !important;
        overflow-wrap: anywhere;
      }

      .attendance-table-field-cell {
        min-width: 220px;
        white-space: normal !important;
      }

      .attendance-table-field-cell > span {
        display: block;
        margin-bottom: 7px;
        color: var(--at-copy);
      }

      .attendance-table-field-cell .field-photo-preview {
        max-width: 150px;
      }

      .attendance-table-field-cell .field-photo-preview img {
        width: 120px;
        height: 80px;
        border-radius: 12px;
      }

      .attendance-table-action-cell {
        min-width: 110px;
      }

      .attendance-table-action-cell .secondary {
        min-height: 36px;
        padding: 7px 10px;
      }

      .attendance-report-table-shell.is-loading {
        padding: 12px;
      }

      .attendance-report-table-loading-head {
        height: 42px;
        border-radius: 11px;
        background: linear-gradient(90deg, #f1f4fb, #f8f9fd, #f1f4fb);
      }

      .attendance-report-table-loading-row {
        display: grid;
        grid-template-columns: repeat(8, minmax(90px, 1fr));
        gap: 8px;
        margin-top: 8px;
      }

      .attendance-report-table-loading-row span {
        height: 34px;
        border-radius: 9px;
        background: #f4f6fb;
      }

      .attendance-record-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
        align-items: stretch;
        gap: clamp(16px, 1.8vw, 24px);
        margin-top: 10px;
        min-width: 0;
      }

      .attendance-record-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid rgba(151,161,197,.52);
        border-radius: 22px;
        padding: 16px;
        background: transparent;
        box-shadow: none;
        transition:
          border-color 180ms ease,
          box-shadow 180ms ease;
      }

      .attendance-record-card:hover {
        transform: none;
        border-color: rgba(98,84,218,.42);
        box-shadow: none;
      }

      .attendance-record-card.is-selected {
        border-color: rgba(82,69,190,.78);
        box-shadow: 0 0 0 3px rgba(102,88,220,.08);
      }

      .attendance-record-select {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        color: var(--at-copy);
        font-size: 9px;
        font-weight: 900;
        cursor: pointer;
      }

      .attendance-record-select.is-disabled {
        opacity: .45;
        cursor: not-allowed;
      }

      .attendance-record-select input,
      .attendance-table-select-cell input,
      .attendance-select-all-control input {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: var(--at-violet);
        cursor: pointer;
      }

      .attendance-record-select input:disabled,
      .attendance-table-select-cell input:disabled,
      .attendance-select-all-control input:disabled {
        cursor: not-allowed;
      }

      .attendance-record-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .attendance-employee-block {
        display: flex;
        align-items: center;
        gap: 11px;
        flex: 1 1 220px;
        min-width: 0;
      }

      .attendance-employee-block > div:last-child {
        min-width: 0;
      }

      .attendance-record-card h4,
      .attendance-record-card p,
      .attendance-record-card strong,
      .attendance-location-box strong {
        overflow-wrap: anywhere;
      }

      .attendance-meta-grid,
      .attendance-time-grid,
      .attendance-location-grid {
        display: grid;
        min-width: 0;
        gap: 10px;
        margin-top: 10px;
      }

      .attendance-meta-grid,
      .attendance-time-grid,
      .attendance-location-grid {
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
      }

      .attendance-meta-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 14px;
      }

      .attendance-time-grid,
      .attendance-location-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .attendance-meta-grid > div,
      .attendance-time-grid > div,
      .attendance-location-box {
        min-width: 0;
        padding: 12px;
      }

      .attendance-meta-grid span,
      .attendance-time-grid span,
      .attendance-location-box span,
      .attendance-record-footer span {
        display: block;
        margin-bottom: 5px;
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .attendance-location-box {
        display: flex;
        align-items: flex-start;
        gap: 9px;
      }

      .attendance-location-box > div {
        min-width: 0;
      }

      .attendance-record-footer {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
        margin-top: auto;
        padding-top: 12px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .attendance-record-footer > div {
        min-width: 0;
      }

      .attendance-record-action {
        margin-left: auto;
        flex: 0 0 auto;
      }

      .attendance-avatar {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        color: #fff;
        background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
      }

      .attendance-record-card h4 {
        margin: 0;
      }

      .attendance-record-card p {
        margin: 4px 0 0;
      }

      .attendance-status-pill {
        min-height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
        flex: 0 0 auto;
      }

      .attendance-meta-grid > div,
      .attendance-time-grid > div,
      .attendance-location-box {
        border: 1px solid rgba(162,169,196,.45);
        border-radius: 16px;
        background: #fff;
        box-shadow: none;
      }

      .attendance-record-card h4 {
        color: var(--at-ink);
      }

      .attendance-record-card p,
      .attendance-record-card span {
        color: var(--at-copy);
      }

      .attendance-location-box a,
      .field-photo-open-button {
        color: var(--at-violet);
      }

      .field-photo-preview {
        display: grid;
        gap: 8px;
        max-width: 240px;
        margin-top: 8px;
      }

      .field-photo-preview img {
        width: 190px;
        height: 126px;
        object-fit: cover;
        border: 1px solid rgba(171,181,211,.72);
        border-radius: 17px;
        background: #f8fafc;
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
        display: block;
      }

      .field-photo-open-button {
        border: 0;
        background: transparent;
        font-weight: 900;
        font-size: 12px;
        text-decoration: underline;
        cursor: pointer;
        padding: 0;
        text-align: left;
      }

      .attendance-empty-state {
        border: 1px dashed rgba(98,84,218,.34);
        border-radius: 24px;
        background: linear-gradient(145deg, #f8f7ff, #effbf8);
      }

      .attendance-page .table-wrap {
        margin-top: 16px;
        border: 1px solid rgba(171,181,211,.56);
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 10px 22px rgba(34,38,110,.07);
      }

      .attendance-page th {
        color: #536381;
        background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
      }

      .attendance-page tr:hover td {
        background: #fafaff;
      }


      .attendance-table-fullscreen-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        width: 100vw;
        height: 100dvh;
        min-height: 100vh;
        padding: 0;
        background: rgba(10, 16, 38, .72);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
        box-sizing: border-box;
      }

      .attendance-table-fullscreen {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 0;
        border-radius: 0;
        background: #f8fbff;
        box-shadow: none;
      }

      .attendance-table-fullscreen-header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 13px 15px;
        border-bottom: 1px solid rgba(171,181,211,.52);
        background: #fff;
      }

      .attendance-table-fullscreen-title {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .attendance-table-fullscreen-title > div {
        min-width: 0;
      }

      .attendance-table-fullscreen-title strong,
      .attendance-table-fullscreen-title span {
        display: block;
      }

      .attendance-table-fullscreen-title strong {
        color: var(--at-ink);
        font-size: 14px;
      }

      .attendance-table-fullscreen-title span {
        margin-top: 2px;
        color: var(--at-copy);
        font-size: 10px;
      }

      .attendance-table-fullscreen > .attendance-bulk-verify-toolbar {
        flex: 0 0 auto;
        width: auto;
        margin: 10px 12px;
      }

      .attendance-table-fullscreen .attendance-report-table-shell {
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }

      .attendance-table-fullscreen .attendance-report-table-scroll {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        touch-action: pan-x pan-y;
      }

      .attendance-table-fullscreen .attendance-report-table {
        width: 100%;
      }

      .attendance-page .attendance-saas-panel {
        background: linear-gradient(145deg, #edf6ff, #f5f3ff);
        box-shadow: 0 18px 30px rgba(44,75,116,.10);
      }

      .attendance-page .attendance-saas-panel.expired {
        background: linear-gradient(145deg, #fff4d5, #fffaf0);
        box-shadow: 0 18px 30px rgba(116,75,44,.10);
      }

      .attendance-saas-layout {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      @keyframes attendanceSpin {
        to { transform: rotate(360deg); }
      }

      @media (max-width: 1180px) {
        .attendance-page .attendance-page-hero {
          grid-template-columns: 1fr;
        }

        .attendance-page .attendance-page-hero > .attendance-card,
        .attendance-page .attendance-page-hero > .attendance-pro-card {
          width: 100%;
        }
      }

      @media (max-width: 900px) {
        .attendance-page-dual {
          grid-template-columns: 1fr;
        }

        .attendance-section-tabs {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .attendance-page .attendance-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .attendance-record-list {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        .attendance-page {
          gap: 18px;
        }

        .attendance-page .attendance-page-hero {
          min-height: 0;
          padding: 20px;
          border-radius: 26px;
          box-shadow: 0 18px 30px rgba(34,38,110,.10);
        }

        .attendance-page .attendance-page-hero h1 {
          font-size: clamp(36px, 10vw, 52px);
        }

        .attendance-page .hero-actions .secondary {
          width: 100%;
          justify-content: center;
        }

        .attendance-page .panel {
          padding: 18px;
          border-radius: 24px;
          box-shadow: 0 18px 30px rgba(34,38,110,.10);
        }

        .attendance-section-tabs {
          grid-template-columns: 1fr;
        }

        .attendance-page .attendance-filter-grid,
        .attendance-page .dynamic-form {
          grid-template-columns: 1fr;
        }

        .attendance-page .attendance-filter-actions {
          flex-direction: column;
        }

        .attendance-page .attendance-filter-actions button {
          width: 100%;
        }

        .attendance-report-action-stack,
        .attendance-report-actions {
          width: 100%;
        }

        .attendance-report-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }

        .attendance-row-action-stack {
          min-width: 150px;
          max-width: 240px;
        }

        .attendance-report-display-toolbar {
          align-items: stretch;
          flex-direction: column;
        }

        .attendance-report-view-toggle,
        .attendance-table-expand-button {
          width: 100%;
        }

        .attendance-report-view-toggle button {
          flex: 1 1 0;
          min-width: 0;
        }

        .attendance-report-table-shell {
          border-radius: 16px;
        }

        .attendance-report-table {
          min-width: 1320px;
          font-size: 9px;
        }

        .attendance-report-table th,
        .attendance-report-table td {
          padding: 10px;
        }

        .attendance-record-card {
          padding: 13px;
          border-radius: 18px;
          box-shadow: none;
        }

        .attendance-record-top,
        .attendance-record-footer {
          align-items: flex-start;
          gap: 12px;
        }

        .attendance-meta-grid,
        .attendance-time-grid,
        .attendance-location-grid {
          grid-template-columns: 1fr;
        }

        .field-photo-preview img {
          width: 100%;
          max-width: 240px;
          height: 140px;
        }
      }

      @media (max-width: 560px) {
        .attendance-meta-grid,
        .attendance-time-grid,
        .attendance-location-grid {
          grid-template-columns: 1fr;
        }

        .attendance-record-top,
        .attendance-record-footer {
          flex-direction: column;
          align-items: stretch;
        }

        .attendance-bulk-verify-toolbar {
          align-items: stretch;
        }

        .attendance-bulk-verify-actions {
          width: 100%;
        }

        .attendance-bulk-verify-actions .primary,
        .attendance-bulk-verify-actions .secondary {
          flex: 1 1 150px;
        }

        .attendance-record-action {
          width: 100%;
          margin-left: 0;
        }

        .attendance-record-action .secondary,
        .attendance-record-action button {
          width: 100%;
        }

        .attendance-table-fullscreen-header {
          padding: 10px 11px;
        }

        .attendance-table-fullscreen-close {
          min-height: 38px;
          padding: 8px 10px;
        }
      }

      @media (max-width: 430px) {
        .attendance-page .attendance-summary-grid {
          grid-template-columns: 1fr;
        }

        .attendance-page .attendance-page-hero {
          padding: 16px;
        }

        .attendance-page .attendance-page-hero h1 {
          font-size: clamp(32px, 11vw, 44px);
        }

        .attendance-page .panel {
          padding: 15px;
          border-radius: 21px;
        }

        .attendance-page .toolbar {
          flex-direction: column;
        }

        .attendance-page .employee-role-pill {
          align-self: flex-start;
        }

        .attendance-report-view-toggle {
          padding: 4px;
          border-radius: 13px;
        }

        .attendance-report-view-toggle button {
          min-height: 36px;
          padding: 7px 9px;
          font-size: 9px;
        }

        .attendance-report-table {
          min-width: 1180px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .attendance-page *,
        .attendance-page *::before,
        .attendance-page *::after {
          animation: none !important;
          transition: none !important;
        }
      }
    `}</style>
      <section className="hero compact attendance-page-hero">
        <div>
          <span className="attendance-page-kicker">
            <Sparkles size={13} />
            {isHrAdminAttendanceView ? 'HR Attendance Control' : 'Office + WFH + Field'}
          </span>
          <h1>
            Attendance, <em>connected.</em>
          </h1>
          <p>
            {isHrAdminAttendanceView
              ? 'Monitor daily attendance records, field locations, employee photos, holiday work approvals, and comp-off records from one HR control panel.'
              : 'Mark Office, WFH, or Field attendance directly. Field attendance captures visit place, photo, and location. Holiday work requires approval before attendance and creates claimable comp-off after checkout.'}
          </p>

          <div className="hero-actions attendance-action-stack">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                refreshAttendance({
                  showLoader: false,
                  feedbackScope: 'refresh',
                })
              }
              disabled={loadingPage}
            >
              <RefreshCcw
                size={16}
                className={loadingPage ? 'attendance-inline-spin' : ''}
              />
              {loadingPage ? 'Refreshing...' : 'Refresh'}
            </button>

            <AttendanceInlineMessage
              message={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>
        </div>

        {showEmployeeSelfAttendancePanel && (
          <div className="attendance-widget-stack">
            <AttendanceWidget
              onSuccess={() => {
                showInlineFeedback(
                  'attendance-widget',
                  'success',
                  'Attendance was updated successfully. Latest records are syncing in the background.',
                  'Attendance Updated',
                );

                refreshAttendance({ showLoader: false });
              }}
            />

            <AttendanceInlineMessage
              message={inlineFeedback['attendance-widget']}
              onClose={() => clearInlineFeedback('attendance-widget')}
            />
          </div>
        )}
      </section>

      {(isDemoTenant || isExpiredOrSuspendedTenant) ? (
        <section
          className={`panel attendance-saas-panel ${isExpiredOrSuspendedTenant ? 'expired' : ''}`}
        >
          <div className="attendance-saas-layout">
            <div>
              <span className="kicker">
                {isExpiredOrSuspendedTenant ? 'Demo Subscription Expired' : 'YourComate 15-Day Full Access Trial'}
              </span>
              <h3 style={{ margin: '6px 0 8px' }}>
                {isExpiredOrSuspendedTenant
                  ? 'Attendance is locked until subscription upgrade'
                  : 'Attendance is included in your demo plan'}
              </h3>
              <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
                {saasCompanyName} is currently on the demo plan. Trial access includes
                all HRMS modules only. Trial end date:{' '}
                <strong>{formatSaasDate(saasTrialEndDate)}</strong>
                {saasDaysLeft !== null && !isExpiredOrSuspendedTenant ? (
                  <> · <strong>{saasDaysLeft}</strong> day(s) left</>
                ) : null}
              </p>
            </div>

            <button
              type="button"
              className="primary"
              onClick={openBillingPage}
            >
              Upgrade Plan
            </button>
          </div>
        </section>
      ) : null}

      <nav
        className="attendance-section-tabs"
        aria-label="Attendance sections"
      >
        <button
          type="button"
          className={`attendance-section-tab ${
            activeSection === 'attendance' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('attendance')}
          aria-pressed={activeSection === 'attendance'}
        >
          <CalendarDays size={18} />
          <span className="attendance-section-tab-copy">
            <strong>Attendance Records</strong>
            <small>Personal records, reports and verification</small>
          </span>
          <span className="attendance-section-tab-count">
            {canViewReport ? report.length : myAttendance.length}
          </span>
        </button>

        <button
          type="button"
          className={`attendance-section-tab ${
            activeSection === 'holiday' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('holiday')}
          aria-pressed={activeSection === 'holiday'}
        >
          <ShieldCheck size={18} />
          <span className="attendance-section-tab-copy">
            <strong>Holiday Work</strong>
            <small>Requests, approvals, comp-off rules and holidays</small>
          </span>
          <span className="attendance-section-tab-count">
            {myHolidayWorkRequests.length +
              holidayWorkRequests.length +
              holidays.length}
          </span>
        </button>

        {canViewReport ? (
          <button
            type="button"
            className={`attendance-section-tab ${
              activeSection === 'field' ? 'is-active' : ''
            }`}
            onClick={() => setActiveSection('field')}
            aria-pressed={activeSection === 'field'}
          >
            <MapPin size={18} />
            <span className="attendance-section-tab-copy">
              <strong>Field Attendance</strong>
              <small>Team field records, locations and photos</small>
            </span>
            <span className="attendance-section-tab-count">
              {teamFieldAttendance.length}
            </span>
          </button>
        ) : null}
      </nav>

      {showEmployeeSelfAttendancePanel && activeSection === 'holiday' && (
        <section className="two-col attendance-page-dual">
          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Holiday Work Requests</h3>
                <p>
                  Holiday attendance is allowed only after approval. After approved
                  holiday attendance and checkout, one comp-off credit will be created.
                </p>
              </div>
            </div>

            <Table rows={myHolidayWorkRequestRows} maxColumns={12} />
          </div>

          <div className="panel">
            <h3>Holiday Work Rule</h3>
            <p>
              For Sunday, second Saturday, fourth Saturday, and HR-created holidays,
              you must raise a holiday work request first. Approval will go to your
              Team Leader, then Reporting Officer, or HR fallback.
            </p>
            <p>
              Comp-off can be claimed from the next working day and only within
              7 working days. After that, the credit expires automatically.
            </p>
          </div>
        </section>
      )}

      {showEmployeeSelfAttendancePanel && activeSection === 'attendance' && (
      <section className="two-col attendance-page-dual">
        <div className="panel attendance-page-panel">
          <span className="attendance-section-kicker">Personal Records</span>
          <h3>My Attendance</h3>
          <Table rows={myAttendance} maxColumns={10} />
        </div>

        <div className="panel attendance-page-panel">
          <span className="attendance-section-kicker">Earned Benefit</span>
          <h3>My Comp-Off Credits</h3>
          <p>
            Comp-off is available only after approved holiday work attendance and
            checkout. It can be claimed from the next working day within 7 working days.
          </p>

          <form className="dynamic-form" onSubmit={claimCompOff}>
            <label>
              Available Comp-Off
              <select
                value={compOffForm.compoff_id}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    compoff_id: e.target.value,
                  })
                }
                disabled={claimingCompOff}
              >
                <option value="">Select comp-off</option>
                {availableCompOffs.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.earned_date} — valid until {item.valid_until}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Claim Date
              <input
                type="date"
                value={compOffForm.claim_date}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    claim_date: e.target.value,
                  })
                }
                disabled={claimingCompOff}
              />
            </label>

            <label>
              Reason
              <input
                value={compOffForm.reason}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    reason: e.target.value,
                  })
                }
                placeholder="Optional reason"
                disabled={claimingCompOff}
              />
            </label>

            <div className="attendance-action-stack">
              <button
                type="submit"
                className="primary"
                disabled={claimingCompOff || !availableCompOffs.length}
              >
                {claimingCompOff ? 'Claiming...' : 'Claim Comp-Off'}
              </button>

              <AttendanceInlineMessage
                message={inlineFeedback['compoff-claim']}
                onClose={() => clearInlineFeedback('compoff-claim')}
              />
            </div>
          </form>

          <Table rows={myCompOffs} maxColumns={10} />
        </div>
      </section>
      )}

      {canViewReport && activeSection === 'attendance' && (
        <section className="panel attendance-report-panel">
          <div className="attendance-report-header">
            <div>
              <span className="attendance-section-kicker">Daily Attendance</span>
              <h3>Today’s Attendance Records</h3>
              <p>
                Showing daily attendance by default. Past records will appear only after selecting a date or date range.
              </p>
            </div>

            {hasActiveReportFilters && (
              <div className="attendance-action-stack attendance-report-action-stack">
                <div className="attendance-report-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      clearReportFilters('report-header-clear')
                    }
                    disabled={loadingReport}
                  >
                    <X size={16} />
                    Clear Filters
                  </button>
                </div>

                <AttendanceInlineMessage
                  message={inlineFeedback['report-header-clear']}
                  onClose={() =>
                    clearInlineFeedback('report-header-clear')
                  }
                />
              </div>
            )}
          </div>

          <div className="attendance-summary-grid">
            <div className="attendance-summary-card">
              <span>Total Records</span>
              <strong>{reportSummary.total}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Present</span>
              <strong>{reportSummary.present}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Late</span>
              <strong>{reportSummary.late}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Verified</span>
              <strong>{reportSummary.verified}</strong>
            </div>
          </div>

          <form className="attendance-filter-card" onSubmit={searchReport}>
            <div className="attendance-filter-title">
              <Filter size={16} />
              <strong>Filter attendance</strong>
              <span>Use filters only when you need specific employee or past records.</span>
            </div>

            <div className="attendance-filter-grid">
              <label>
                Employee Name
                <input
                  value={filters.employee_name}
                  onChange={(e) =>
                    setFilters({ ...filters, employee_name: e.target.value })
                  }
                  placeholder="Search by name, email or code"
                />
              </label>

              <label>
                Employee ID
                <input
                  value={filters.employee_id}
                  onChange={(e) =>
                    setFilters({ ...filters, employee_id: e.target.value })
                  }
                  placeholder="Employee ID"
                />
              </label>

              <label>
                Organisation / Entity
                <div className="input-with-icon">
                  <Building2 size={16} />
                  <input
                    value={filters.organisation}
                    onChange={(e) =>
                      setFilters({ ...filters, organisation: e.target.value })
                    }
                    placeholder="SDS / AVPL / SDF"
                  />
                </div>
              </label>

              <label>
                State
                <input
                  value={filters.state}
                  onChange={(e) =>
                    setFilters({ ...filters, state: e.target.value })
                  }
                  placeholder="State"
                />
              </label>

              <label>
                Department
                <input
                  value={filters.department}
                  onChange={(e) =>
                    setFilters({ ...filters, department: e.target.value })
                  }
                  placeholder="Department"
                />
              </label>

              <label>
                Mode
                <select
                  value={filters.mode}
                  onChange={(e) =>
                    setFilters({ ...filters, mode: e.target.value })
                  }
                >
                  <option value="">All Modes</option>
                  <option value="office">Office</option>
                  <option value="wfh">Work From Home</option>
                  <option value="field">Field</option>
                </select>
              </label>

              <label>
                Status
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value })
                  }
                >
                  <option value="">All Status</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="early_checkout">Early Checkout</option>
                  <option value="holiday_work">Holiday Work</option>
                </select>
              </label>

              <label>
                Date From
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) =>
                    setFilters({ ...filters, date_from: e.target.value })
                  }
                />
              </label>

              <label>
                Date To
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) =>
                    setFilters({ ...filters, date_to: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="attendance-action-stack">
              <div className="attendance-filter-actions">
                <button type="submit" className="primary" disabled={loadingReport}>
                  <Search size={16} />
                  {loadingReport ? 'Searching...' : 'Search Records'}
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => clearReportFilters('report-filter')}
                  disabled={loadingReport}
                >
                  Clear
                </button>
              </div>

              <AttendanceInlineMessage
                message={inlineFeedback['report-filter']}
                onClose={() => clearInlineFeedback('report-filter')}
              />
            </div>
          </form>

          <div className="attendance-report-display-toolbar">
            <div className="attendance-report-view-toggle" role="group" aria-label="Attendance record view">
              <button
                type="button"
                className={reportViewMode === 'cards' ? 'is-active' : ''}
                aria-pressed={reportViewMode === 'cards'}
                onClick={() => {
                  setReportViewMode('cards');
                  setIsReportTableExpanded(false);
                }}
              >
                <LayoutGrid size={15} />
                Card View
              </button>

              <button
                type="button"
                className={reportViewMode === 'table' ? 'is-active' : ''}
                aria-pressed={reportViewMode === 'table'}
                onClick={() => setReportViewMode('table')}
              >
                <Table2 size={15} />
                Table View
              </button>
            </div>

            {reportViewMode === 'table' && (
              <button
                type="button"
                className="attendance-table-expand-button"
                onClick={() => setIsReportTableExpanded(true)}
                disabled={loadingReport || !reportRows.length}
              >
                <Maximize2 size={15} />
                Expand Table
              </button>
            )}
          </div>

          <AttendanceBulkVerifyControls
            rows={reportRows}
            selectedIds={selectedAttendanceIds}
            onToggleAll={toggleAllAttendanceSelection}
            onVerifySelected={verifySelectedAttendance}
            onVerifyAll={verifyAllAttendance}
            bulkVerifying={bulkVerifying}
            feedbackMessage={inlineFeedback['bulk-verify']}
            onFeedbackClose={() => clearInlineFeedback('bulk-verify')}
          />

          {reportViewMode === 'table' ? (
            <AttendanceReportTable
              rows={reportRows}
              loading={loadingReport}
              selectedIds={selectedAttendanceIds}
              onToggleSelection={toggleAttendanceSelection}
              bulkVerifying={bulkVerifying}
            />
          ) : (
            <AttendanceReportList
              rows={reportRows}
              loading={loadingReport}
              selectedIds={selectedAttendanceIds}
              onToggleSelection={toggleAttendanceSelection}
              bulkVerifying={bulkVerifying}
            />
          )}
        </section>
      )}

      {canViewReport && activeSection === 'holiday' && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <span className="attendance-section-kicker">Approval Queue</span>
              <h3>Holiday Work Approval Requests</h3>
              <p>
                Approve holiday work before the employee can mark attendance on a
                holiday. Access follows Team Leader, Reporting Officer, and HR scope.
              </p>
            </div>

            <span className="employee-role-pill">
              Pending Requests: {pendingHolidayWorkRequestCount}
            </span>
          </div>

              <form
                className="attendance-filter-card"
                onSubmit={searchHolidayWorkRequests}
              >
            <div className="attendance-filter-grid">
              <label>
                Status
                <select
                  value={holidayWorkFilters.status}
                  onChange={(e) =>
                    setHolidayWorkFilters({
                      ...holidayWorkFilters,
                      status: e.target.value,
                    })
                  }
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <label>
                Date
                <input
                  type="date"
                  value={holidayWorkFilters.date}
                  onChange={(e) =>
                    setHolidayWorkFilters({
                      ...holidayWorkFilters,
                      date: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="attendance-action-stack">
              <div className="attendance-filter-actions">
                <button type="submit" className="primary">
                  Search Holiday Requests
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={clearHolidayWorkFilters}
                >
                  Clear
                </button>
              </div>

              <AttendanceInlineMessage
                message={inlineFeedback['holiday-filter']}
                onClose={() => clearInlineFeedback('holiday-filter')}
              />
            </div>
          </form>

          <Table rows={holidayWorkRequestRows} maxColumns={14} />
        </section>
      )}

      {canViewReport && activeSection === 'field' && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <span className="attendance-section-kicker">Field Operations</span>
              <h3>Team Field Attendance</h3>
              <p>
                Team Leaders can see their mapped team members. Reporting Officers
                can see their mapped employees. HR/Admin can see all field attendance.
              </p>
            </div>

            <span className="employee-role-pill">
              Field Records: {teamFieldAttendance.length}
            </span>
          </div>

                <form
                  className="attendance-filter-card"
                  onSubmit={searchTeamFieldAttendance}
                >
            <div className="attendance-filter-grid">
              <label>
                Date From
                <input
                  type="date"
                  value={teamFieldFilters.start}
                  onChange={(e) =>
                    setTeamFieldFilters({
                      ...teamFieldFilters,
                      start: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Date To
                <input
                  type="date"
                  value={teamFieldFilters.end}
                  onChange={(e) =>
                    setTeamFieldFilters({
                      ...teamFieldFilters,
                      end: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="attendance-action-stack">
              <div className="attendance-filter-actions">
                <button type="submit" className="primary" disabled={loadingTeamField}>
                  {loadingTeamField ? 'Loading...' : 'Search Field Attendance'}
                </button>

                <button
                  type="button"
                  className="secondary"
                  disabled={loadingTeamField}
                  onClick={clearTeamFieldFilters}
                >
                  Clear
                </button>
              </div>

              <AttendanceInlineMessage
                message={inlineFeedback['field-filter']}
                onClose={() => clearInlineFeedback('field-filter')}
              />
            </div>
          </form>

          <Table rows={teamFieldRows} maxColumns={14} />
        </section>
      )}


      {canManageHoliday && activeSection === 'holiday' && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <span className="attendance-section-kicker">Holiday Administration</span>
              <h3>State-wise Holiday Calendar</h3>
              <p>
                Add holidays for Assam(HO), Manipur, Mizoram and Arunachal
                Pradesh. Holiday message will show on dashboard and attendance.
              </p>
            </div>
          </div>

          <form className="dynamic-form" onSubmit={createHoliday}>
            <label>
              State
              <select
                value={holidayForm.state}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, state: e.target.value })
                }
                disabled={savingHoliday}
              >
                {HOLIDAY_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={holidayForm.date}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, date: e.target.value })
                }
                disabled={savingHoliday}
              />
            </label>

            <label>
              Holiday Title
              <input
                value={holidayForm.title}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, title: e.target.value })
                }
                placeholder="Example: Bohag Bihu"
                disabled={savingHoliday}
              />
            </label>

            <label>
              Message
              <textarea
                value={holidayForm.message}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, message: e.target.value })
                }
                placeholder="Holiday message for employees"
                disabled={savingHoliday}
              />
            </label>

            <div className="attendance-action-stack">
              <button type="submit" className="primary" disabled={savingHoliday}>
                {savingHoliday ? 'Adding...' : 'Add Holiday'}
              </button>

              <AttendanceInlineMessage
                message={inlineFeedback['holiday-create']}
                onClose={() => clearInlineFeedback('holiday-create')}
              />
            </div>
          </form>

          <Table rows={holidays} maxColumns={8} />
        </section>
      )}

      {isReportTableExpanded &&
        reportViewMode === 'table' &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="attendance-page attendance-table-fullscreen-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded attendance table"
          >
            <div className="attendance-table-fullscreen">
              <div className="attendance-table-fullscreen-header">
                <div className="attendance-table-fullscreen-title">
                  <Table2 size={18} />
                  <div>
                    <strong>Attendance Table</strong>
                    <span>{reportRows.length} record{reportRows.length === 1 ? '' : 's'} • swipe or drag left and right</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="attendance-table-fullscreen-close"
                  onClick={() => setIsReportTableExpanded(false)}
                  aria-label="Close expanded attendance table"
                  autoFocus
                >
                  <X size={17} />
                  Close
                </button>
              </div>

              <AttendanceBulkVerifyControls
                rows={reportRows}
                selectedIds={selectedAttendanceIds}
                onToggleAll={toggleAllAttendanceSelection}
                onVerifySelected={verifySelectedAttendance}
                onVerifyAll={verifyAllAttendance}
                bulkVerifying={bulkVerifying}
                feedbackMessage={inlineFeedback['bulk-verify']}
                onFeedbackClose={() => clearInlineFeedback('bulk-verify')}
              />

              <AttendanceReportTable
                rows={reportRows}
                loading={loadingReport}
                expanded
                selectedIds={selectedAttendanceIds}
                onToggleSelection={toggleAttendanceSelection}
                bulkVerifying={bulkVerifying}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
