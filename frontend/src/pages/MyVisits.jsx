import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Filter,
  History,
  Loader2,
  MapPin,
  Navigation,
  NotebookPen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';

import {
  cancelFieldVisit,
  createFieldVisit,
  endFieldVisit,
  getFieldVisit,
  getMyFieldVisits,
  getTeamFieldVisits,
  markFieldVisitReached,
  rescheduleFieldVisit,
  startFieldVisit,
  updateFieldVisit,
  uploadFieldVisitPicture,
} from '../api/client';

const EMPTY_CREATE_FORM = {
  date: '',
  title: '',
  description: '',
};

const TEAM_ROLES = new Set([
  'admin',
  'hr',
  'hr_admin',
  'hr_manager',
  'manager',
  'team_leader',
  'reporting_officer',
  'ro',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_user') || '{}');
  } catch {
    return {};
  }
}

function getStoredEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function truthyValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return ['true', '1', 'yes', 'on'].includes(
    normalizeText(value).toLowerCase(),
  );
}

function userCanViewTeam(currentUser = {}) {
  const storedUser = getStoredUser();
  const storedEmployee = getStoredEmployee();

  const employee =
    currentUser.employee ||
    currentUser.employee_summary ||
    currentUser.employee_profile ||
    storedEmployee ||
    {};

  const roles = [
    currentUser.role,
    storedUser.role,
    employee.role,
    storedEmployee.role,
    ...(Array.isArray(currentUser.roles) ? currentUser.roles : []),
    ...(Array.isArray(storedUser.roles) ? storedUser.roles : []),
    ...(Array.isArray(employee.roles) ? employee.roles : []),
    ...(Array.isArray(storedEmployee.roles) ? storedEmployee.roles : []),
  ]
    .map(normalizeRole)
    .filter(Boolean);

  const hasTeamRole = roles.some((role) => TEAM_ROLES.has(role));

  const hasTeamCapability =
    truthyValue(currentUser.is_team_leader) ||
    truthyValue(currentUser.is_reporting_officer) ||
    truthyValue(employee.is_team_leader) ||
    truthyValue(employee.is_reporting_officer) ||
    truthyValue(storedUser.is_team_leader) ||
    truthyValue(storedUser.is_reporting_officer) ||
    truthyValue(storedEmployee.is_team_leader) ||
    truthyValue(storedEmployee.is_reporting_officer);

  return hasTeamRole || hasTeamCapability;
}

function todayIso() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return '—';

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getVisitId(visit) {
  return normalizeText(visit?._id || visit?.id);
}

function statusLabel(status) {
  const normalized = normalizeRole(status);
  const labels = {
    scheduled: 'Scheduled',
    started: 'Started',
    reached: 'Reached',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  return labels[normalized] || normalizeText(status) || 'Scheduled';
}

function statusTone(status) {
  const normalized = normalizeRole(status);

  if (normalized === 'completed') return 'success';
  if (normalized === 'cancelled') return 'danger';
  if (normalized === 'reached') return 'purple';
  if (normalized === 'started') return 'warning';
  return 'info';
}

function latestLocation(visit) {
  return visit?.end_location || visit?.reached_location || visit?.start_location || null;
}

function locationMapUrl(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';

  const offset = 0.008;
  const left = longitude - offset;
  const bottom = latitude - offset;
  const right = longitude + offset;
  const top = latitude + offset;

  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

function readError(error, fallback) {
  return normalizeText(error?.message) || fallback;
}

function resolveVisitPictureUrl(value) {
  const rawUrl = normalizeText(value);
  if (!rawUrl) return '';
  if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }

  const apiBase = normalizeText(import.meta.env.VITE_API_BASE).replace(/\/+$/, '');
  if (!apiBase) return rawUrl;

  try {
    const apiUrl = new URL(apiBase, window.location.origin);
    return `${apiUrl.origin}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
  } catch {
    return rawUrl;
  }
}

function captureCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location services are not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Please allow location access and try again.'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'Your current location could not be determined.'
              : error.code === error.TIMEOUT
                ? 'Location request timed out. Please try again.'
                : 'Unable to capture your current location.';

        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      },
    );
  });
}

function VisitStatusBadge({ status }) {
  return (
    <span className={`mv-status mv-status--${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function EmptyState({ tab, scope }) {
  return (
    <div className="mv-empty">
      <div className="mv-empty__icon">
        {tab === 'history' ? <History size={28} /> : <MapPin size={28} />}
      </div>
      <h3>{tab === 'history' ? 'No visit history found' : 'No active visits found'}</h3>
      <p>
        {scope === 'team'
          ? 'No team visits match the selected filters.'
          : tab === 'history'
            ? 'Completed and cancelled visits will appear here.'
            : 'Create a visit to start planning your field work.'}
      </p>
    </div>
  );
}

function VisitCard({ visit, onOpen }) {
  return (
    <button type="button" className="mv-card" onClick={() => onOpen(visit)}>
      <div className="mv-card__top">
        <div className="mv-card__icon">
          <MapPin size={21} />
        </div>
        <VisitStatusBadge status={visit.status} />
      </div>

      <div className="mv-card__body">
        <h3>{visit.title || 'Untitled visit'}</h3>
        <p>{visit.description || 'No description added.'}</p>
      </div>

      <div className="mv-card__meta">
        <span>
          <CalendarDays size={16} />
          {formatDate(visit.scheduled_date)}
        </span>
        {visit.employee_name ? (
          <span>
            <UserRound size={16} />
            {visit.employee_name}
          </span>
        ) : null}
        {visit.department ? (
          <span>
            <Users size={16} />
            {visit.department}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export default function MyVisits({ user = {} }) {
  const canViewTeam = useMemo(
    () => userCanViewTeam(user),
    [user],
  );
  const [tab, setTab] = useState('active');
  const [scope, setScope] = useState('mine');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE_FORM, date: todayIso() });
  const [creating, setCreating] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [showReschedule, setShowReschedule] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [picturePreview, setPicturePreview] = useState('');
  const [selectedPicture, setSelectedPicture] = useState(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
const [filters, setFilters] = useState({
  employee_name: '',
  date: '',
  department: '',
});

  const loadVisits = useCallback(
    async ({ quiet = false } = {}) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);

      setError('');

      try {
        const params = {
          tab,
          ...(scope === 'team'
            ? {
                employee_name: normalizeText(filters.employee_name),
                date: normalizeText(filters.date),
                department: normalizeText(filters.department),
              }
            : {}),
        };

        const response =
          scope === 'team'
            ? await getTeamFieldVisits(params)
            : await getMyFieldVisits(params);

        setItems(Array.isArray(response?.items) ? response.items : []);
      } catch (loadError) {
        setItems([]);
        setError(readError(loadError, 'Unable to load visits.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters.date, filters.department, filters.employee_name, scope, tab],
  );

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  useEffect(() => {
    if (!message) return undefined;

    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function handleCreate(event) {
    event.preventDefault();
    setCreating(true);
    setError('');

    try {
      const response = await createFieldVisit({
        date: createForm.date,
        title: normalizeText(createForm.title),
        description: normalizeText(createForm.description),
      });

      setShowCreate(false);
      setCreateForm({ ...EMPTY_CREATE_FORM, date: todayIso() });
      setMessage(response?.message || 'Visit created successfully.');
      setTab('active');
      setScope('mine');
      await loadVisits();
    } catch (createError) {
      setError(readError(createError, 'Unable to create visit.'));
    } finally {
      setCreating(false);
    }
  }

  async function openVisit(visit) {
    const visitId = getVisitId(visit);
    if (!visitId) return;

    setSelectedVisit(visit);
    setVisitNotes(visit.visit_notes || '');
    setRescheduleDate(visit.scheduled_date || '');
    setPicturePreview('');
    setSelectedPicture(null);
    setDetailLoading(true);
    setError('');

    try {
      const response = await getFieldVisit(visitId);
      const item = response?.item || visit;
      setSelectedVisit(item);
      setVisitNotes(item.visit_notes || '');
      setRescheduleDate(item.scheduled_date || '');
    } catch (detailError) {
      setError(readError(detailError, 'Unable to load visit details.'));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedVisit(null);
    setShowReschedule(false);
    setShowCancel(false);
    setCancelReason('');
    setPicturePreview('');
    setSelectedPicture(null);
  }

  async function refreshSelectedVisit(visitId) {
    const response = await getFieldVisit(visitId);
    const item = response?.item;

    if (item) {
      setSelectedVisit(item);
      setVisitNotes(item.visit_notes || '');
      setRescheduleDate(item.scheduled_date || '');
    }

    return item;
  }

  async function saveNotes() {
    const visitId = getVisitId(selectedVisit);
    if (!visitId) return;

    setSavingNotes(true);
    setError('');

    try {
      const response = await updateFieldVisit(visitId, {
        visit_notes: visitNotes,
      });

      setSelectedVisit(response?.item || selectedVisit);
      setMessage(response?.message || 'Visit notes saved.');
      await loadVisits({ quiet: true });
    } catch (notesError) {
      setError(readError(notesError, 'Unable to save visit notes.'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleReschedule(event) {
    event.preventDefault();
    const visitId = getVisitId(selectedVisit);
    if (!visitId) return;

    setActionLoading('reschedule');
    setError('');

    try {
      const response = await rescheduleFieldVisit(visitId, { date: rescheduleDate });
      setSelectedVisit(response?.item || selectedVisit);
      setShowReschedule(false);
      setMessage(response?.message || 'Visit rescheduled successfully.');
      await loadVisits({ quiet: true });
    } catch (rescheduleError) {
      setError(readError(rescheduleError, 'Unable to reschedule visit.'));
    } finally {
      setActionLoading('');
    }
  }

  async function handleCancel(event) {
    event.preventDefault();
    const visitId = getVisitId(selectedVisit);
    if (!visitId) return;

    setActionLoading('cancel');
    setError('');

    try {
      const response = await cancelFieldVisit(visitId, { reason: cancelReason });
      setSelectedVisit(response?.item || selectedVisit);
      setShowCancel(false);
      setCancelReason('');
      setMessage(response?.message || 'Visit cancelled successfully.');
      await loadVisits({ quiet: true });
    } catch (cancelError) {
      setError(readError(cancelError, 'Unable to cancel visit.'));
    } finally {
      setActionLoading('');
    }
  }

  async function runLocationAction(action) {
    const visitId = getVisitId(selectedVisit);
    if (!visitId) return;

    setActionLoading(action);
    setError('');

    try {
      const location = await captureCurrentLocation();
      let response;

      if (action === 'start') response = await startFieldVisit(visitId, location);
      else if (action === 'reached') response = await markFieldVisitReached(visitId, location);
      else response = await endFieldVisit(visitId, location);

      setSelectedVisit(response?.item || selectedVisit);
      setMessage(response?.message || 'Visit updated successfully.');
      await refreshSelectedVisit(visitId);
      await loadVisits({ quiet: true });
    } catch (actionError) {
      setError(readError(actionError, 'Unable to update visit progress.'));
    } finally {
      setActionLoading('');
    }
  }

  function handlePictureSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      event.target.value = '';
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('The selected image must be smaller than 8 MB.');
      event.target.value = '';
      return;
    }

    setSelectedPicture(file);
    const reader = new FileReader();
    reader.onload = () => setPicturePreview(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  async function handlePictureUpload() {
    const visitId = getVisitId(selectedVisit);
    if (!visitId || !selectedPicture) return;

    setUploadingPicture(true);
    setError('');

    try {
      const response = await uploadFieldVisitPicture(visitId, selectedPicture);
      setSelectedVisit(response?.item || selectedVisit);
      setPicturePreview('');
      setSelectedPicture(null);
      setMessage(response?.message || 'Visit picture uploaded successfully.');
      await refreshSelectedVisit(visitId);
      await loadVisits({ quiet: true });
    } catch (uploadError) {
      setError(readError(uploadError, 'Unable to upload visit picture.'));
    } finally {
      setUploadingPicture(false);
    }
  }

  const selectedStatus = normalizeRole(selectedVisit?.status);
  const isHistoryVisit = selectedStatus === 'completed' || selectedStatus === 'cancelled';
  const isOwnScope = scope === 'mine';
  const mapLocation = latestLocation(selectedVisit);
  const mapUrl = locationMapUrl(mapLocation);

  return (
    <div className="mv-page">
      <style>{`
        .mv-page {
          --mv-ink: #172033;
          --mv-muted: #6b7280;
          --mv-line: #e6e8ef;
          --mv-panel: #ffffff;
          --mv-soft: #f7f8fc;
          --mv-primary: #6558d8;
          --mv-primary-dark: #5143c6;
          min-height: 100%;
          color: var(--mv-ink);
        }

        .mv-page * { box-sizing: border-box; }

        .mv-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 20px;
        }

        .mv-header h1 {
          margin: 0;
          font-size: clamp(25px, 3vw, 34px);
          line-height: 1.15;
          letter-spacing: -0.03em;
        }

        .mv-header p {
          margin: 7px 0 0;
          color: var(--mv-muted);
          font-size: 14px;
        }

        .mv-button {
          border: 0;
          border-radius: 12px;
          min-height: 42px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: transform 160ms ease, background 160ms ease, opacity 160ms ease;
        }

        .mv-button:hover:not(:disabled) { transform: translateY(-1px); }
        .mv-button:disabled { cursor: not-allowed; opacity: 0.6; }
        .mv-button--primary { background: var(--mv-primary); color: #fff; }
        .mv-button--primary:hover:not(:disabled) { background: var(--mv-primary-dark); }
        .mv-button--secondary { background: #f0effb; color: var(--mv-primary-dark); }
        .mv-button--ghost { background: #fff; color: #3d4658; border: 1px solid var(--mv-line); }
        .mv-button--danger { background: #fff0f1; color: #c92a3a; }
        .mv-button--success { background: #16835f; color: #fff; }
        .mv-button--warning { background: #da7b12; color: #fff; }
        .mv-button--full { width: 100%; }

        .mv-toolbar {
          background: var(--mv-panel);
          border: 1px solid var(--mv-line);
          border-radius: 16px;
          padding: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
          box-shadow: 0 8px 30px rgba(42, 51, 82, 0.05);
        }

        .mv-tabs,
        .mv-scope {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .mv-tab {
          border: 0;
          background: transparent;
          color: #5c6578;
          border-radius: 10px;
          padding: 10px 14px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }

        .mv-tab.is-active {
          background: #eeecff;
          color: var(--mv-primary-dark);
        }

        .mv-scope .mv-tab {
          border: 1px solid var(--mv-line);
          padding: 8px 12px;
        }

        .mv-scope .mv-tab.is-active {
          border-color: #cfc9ff;
        }

        .mv-filters {
          display: grid;
          grid-template-columns: minmax(180px, 1.1fr) minmax(150px, 0.8fr) minmax(180px, 1fr) auto;
          gap: 10px;
          background: var(--mv-panel);
          border: 1px solid var(--mv-line);
          border-radius: 16px;
          padding: 14px;
          margin-bottom: 16px;
        }

        .mv-field { display: grid; gap: 7px; }
        .mv-field label { font-size: 12px; font-weight: 800; color: #566074; }
        .mv-input-wrap { position: relative; }
        .mv-input-wrap > svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #8a91a2;
          pointer-events: none;
        }

        .mv-input,
        .mv-textarea {
          width: 100%;
          border: 1px solid #dfe2ea;
          border-radius: 11px;
          background: #fff;
          color: var(--mv-ink);
          font: inherit;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .mv-input { min-height: 42px; padding: 0 12px; }
        .mv-input.has-icon { padding-left: 38px; }
        .mv-textarea { min-height: 110px; resize: vertical; padding: 12px; }
        .mv-input:focus,
        .mv-textarea:focus {
          border-color: #9389eb;
          box-shadow: 0 0 0 3px rgba(101, 88, 216, 0.12);
        }

        .mv-filter-actions {
          display: flex;
          align-items: end;
          gap: 8px;
        }

        .mv-alert {
          margin-bottom: 14px;
          border-radius: 12px;
          padding: 11px 14px;
          font-size: 14px;
          font-weight: 600;
        }

        .mv-alert--error { background: #fff0f1; color: #a91f31; border: 1px solid #ffd1d7; }
        .mv-alert--success { background: #edf9f4; color: #12664b; border: 1px solid #c8ecdd; }

        .mv-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .mv-card {
          appearance: none;
          border: 1px solid var(--mv-line);
          background: var(--mv-panel);
          border-radius: 17px;
          padding: 16px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          box-shadow: 0 8px 28px rgba(42, 51, 82, 0.055);
          transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        }

        .mv-card:hover {
          transform: translateY(-2px);
          border-color: #cfc9f4;
          box-shadow: 0 12px 32px rgba(54, 46, 122, 0.1);
        }

        .mv-card__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .mv-card__icon,
        .mv-empty__icon {
          width: 42px;
          height: 42px;
          border-radius: 13px;
          display: grid;
          place-items: center;
          background: #efedff;
          color: var(--mv-primary-dark);
        }

        .mv-status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 800;
        }

        .mv-status--info { background: #ebf4ff; color: #2064a7; }
        .mv-status--warning { background: #fff3dd; color: #9a5b08; }
        .mv-status--purple { background: #efeaff; color: #6244b8; }
        .mv-status--success { background: #e7f8f0; color: #137252; }
        .mv-status--danger { background: #ffebee; color: #b3293c; }

        .mv-card__body h3 { margin: 0 0 7px; font-size: 17px; }
        .mv-card__body p {
          margin: 0;
          color: var(--mv-muted);
          font-size: 13px;
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: 40px;
        }

        .mv-card__meta {
          margin-top: 15px;
          padding-top: 13px;
          border-top: 1px solid #eff0f4;
          display: grid;
          gap: 7px;
        }

        .mv-card__meta span {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #5d6678;
          font-size: 12px;
        }

        .mv-empty,
        .mv-loading {
          min-height: 310px;
          border: 1px dashed #d5d8e2;
          border-radius: 18px;
          background: #fafbfe;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px;
        }

        .mv-empty h3 { margin: 14px 0 7px; }
        .mv-empty p { margin: 0; color: var(--mv-muted); max-width: 430px; }
        .mv-loading { color: var(--mv-muted); gap: 10px; }
        .mv-spin { animation: mv-spin 850ms linear infinite; }
        @keyframes mv-spin { to { transform: rotate(360deg); } }

        .mv-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(18, 23, 36, 0.48);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .mv-modal {
          width: min(620px, 100%);
          max-height: calc(100vh - 36px);
          overflow: auto;
          background: #fff;
          border-radius: 20px;
          box-shadow: 0 30px 90px rgba(18, 23, 36, 0.26);
        }

        .mv-modal--detail { width: min(900px, 100%); }

        .mv-modal__head {
          position: sticky;
          top: 0;
          z-index: 3;
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--mv-line);
          padding: 17px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .mv-modal__head h2 { margin: 0; font-size: 20px; }
        .mv-modal__head p { margin: 4px 0 0; color: var(--mv-muted); font-size: 13px; }

        .mv-icon-button {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          border: 1px solid var(--mv-line);
          background: #fff;
          color: #4b5567;
          display: grid;
          place-items: center;
          cursor: pointer;
        }

        .mv-modal__body { padding: 20px; }
        .mv-form { display: grid; gap: 16px; }
        .mv-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .mv-form__actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 2px; }

        .mv-detail-summary {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .mv-detail-summary h2 { margin: 0 0 7px; font-size: 24px; }
        .mv-detail-summary p { margin: 0; color: var(--mv-muted); line-height: 1.55; }

        .mv-detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          margin-top: 13px;
        }

        .mv-detail-meta span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #596276;
          font-size: 13px;
        }

        .mv-section {
          border: 1px solid var(--mv-line);
          border-radius: 16px;
          padding: 16px;
          margin-top: 14px;
        }

        .mv-section__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .mv-section__title {
          display: flex;
          align-items: center;
          gap: 9px;
          font-weight: 800;
        }

        .mv-map {
          min-height: 310px;
          border-radius: 13px;
          overflow: hidden;
          background: #eff1f7;
          border: 1px solid #e3e5ec;
        }

        .mv-map iframe { width: 100%; height: 310px; border: 0; display: block; }
        .mv-map__empty {
          min-height: 310px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 25px;
          color: var(--mv-muted);
        }

        .mv-location-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .mv-location-card {
          background: var(--mv-soft);
          border-radius: 12px;
          padding: 12px;
        }

        .mv-location-card strong { display: block; font-size: 12px; margin-bottom: 5px; }
        .mv-location-card span { display: block; color: var(--mv-muted); font-size: 11px; line-height: 1.45; }

        .mv-picture-picker {
          border: 1px dashed #cfd3df;
          border-radius: 13px;
          min-height: 125px;
          display: grid;
          place-items: center;
          overflow: hidden;
          position: relative;
          background: #fafbfe;
        }

        .mv-picture-picker input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .mv-picture-picker__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          color: var(--mv-muted);
          font-size: 13px;
          padding: 20px;
          text-align: center;
        }

        .mv-picture-preview { width: 100%; max-height: 320px; object-fit: cover; display: block; }
        .mv-picture-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 10px; }
        .mv-picture-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
        .mv-picture-item { border: 1px solid var(--mv-line); border-radius: 12px; overflow: hidden; background: var(--mv-soft); }
        .mv-picture-item img { width: 100%; height: 145px; object-fit: cover; display: block; }
        .mv-picture-item span { display: block; padding: 8px 9px; font-size: 11px; color: var(--mv-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mv-note-hint { margin: 8px 0 0; font-size: 11px; color: #8a91a0; }

        .mv-actions-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }

        .mv-progress-action { margin-top: 14px; }
        .mv-progress-action .mv-button { min-height: 52px; font-size: 15px; }

        .mv-inline-form {
          margin-top: 12px;
          background: var(--mv-soft);
          border-radius: 13px;
          padding: 13px;
          display: grid;
          gap: 10px;
        }

        .mv-timeline {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .mv-timeline__item {
          border-left: 3px solid #d8d5f7;
          padding: 8px 10px;
          background: #fafafe;
          border-radius: 0 10px 10px 0;
        }

        .mv-timeline__item strong { display: block; font-size: 12px; }
        .mv-timeline__item span { display: block; margin-top: 4px; font-size: 11px; color: var(--mv-muted); }

        @media (max-width: 980px) {
          .mv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .mv-filters { grid-template-columns: 1fr 1fr; }
          .mv-filter-actions { align-items: stretch; }
        }

        @media (max-width: 680px) {
          .mv-header { align-items: stretch; flex-direction: column; }
          .mv-header .mv-button { width: 100%; }
          .mv-toolbar { align-items: stretch; flex-direction: column; }
          .mv-grid,
          .mv-picture-grid,
          .mv-filters,
          .mv-form__row,
          .mv-location-grid,
          .mv-timeline,
          .mv-actions-grid { grid-template-columns: 1fr; }
          .mv-filter-actions { display: grid; grid-template-columns: 1fr auto; }
          .mv-overlay { padding: 0; align-items: flex-end; }
          .mv-modal { width: 100%; max-height: 94vh; border-radius: 20px 20px 0 0; }
          .mv-modal__body { padding: 16px; }
          .mv-detail-summary { flex-direction: column; }
        }
      `}</style>

      <div className="mv-header">
        <div>
          <h1>My Visit</h1>
          <p>Schedule, track and complete your field visits with GPS checkpoints.</p>
        </div>
        <button type="button" className="mv-button mv-button--primary" onClick={() => setShowCreate(true)}>
          <Plus size={18} />
          Create Visit
        </button>
      </div>

      <div className="mv-toolbar">
        <div className="mv-tabs">
          <button
            type="button"
            className={`mv-tab ${tab === 'active' ? 'is-active' : ''}`}
            onClick={() => setTab('active')}
          >
            <MapPin size={17} />
            My Visits
          </button>
          <button
            type="button"
            className={`mv-tab ${tab === 'history' ? 'is-active' : ''}`}
            onClick={() => setTab('history')}
          >
            <History size={17} />
            History
          </button>
        </div>

        {canViewTeam ? (
          <div className="mv-scope">
            <button
              type="button"
              className={`mv-tab ${scope === 'mine' ? 'is-active' : ''}`}
              onClick={() => setScope('mine')}
            >
              <UserRound size={16} />
              My visits
            </button>
            <button
              type="button"
              className={`mv-tab ${scope === 'team' ? 'is-active' : ''}`}
              onClick={() => setScope('team')}
            >
              <Users size={16} />
              Team visits
            </button>
          </div>
        ) : null}
      </div>

      {scope === 'team' ? (
        <div className="mv-filters">
                    <div className="mv-field">
                    <label htmlFor="mv-employee-filter">Employee name</label>
                    <div className="mv-input-wrap">
                        <Search size={16} />
                        <input
                        id="mv-employee-filter"
                        className="mv-input has-icon"
                        value={filters.employee_name}
                        onChange={(event) =>
                            setFilters((current) => ({
                            ...current,
                            employee_name: event.target.value,
                            }))
                        }
                        placeholder="Search employee name"
                        />
                    </div>
                    </div>

          <div className="mv-field">
            <label htmlFor="mv-date-filter">Visit date</label>
            <input
              id="mv-date-filter"
              type="date"
              className="mv-input"
              value={filters.date}
              onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </div>

          <div className="mv-field">
            <label htmlFor="mv-department-filter">Department</label>
            <div className="mv-input-wrap">
              <Filter size={16} />
              <input
                id="mv-department-filter"
                className="mv-input has-icon"
                value={filters.department}
                onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}
                placeholder="Enter department"
              />
            </div>
          </div>

          <div className="mv-filter-actions">
            <button type="button" className="mv-button mv-button--primary" onClick={() => loadVisits()}>
              Apply
            </button>
            <button
              type="button"
              className="mv-button mv-button--ghost"
              aria-label="Reset filters"
              onClick={() =>
                setFilters({
                    employee_name: '',
                    date: '',
                    department: '',
                })
                }
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mv-alert mv-alert--error">{error}</div> : null}
      {message ? <div className="mv-alert mv-alert--success">{message}</div> : null}

      {loading ? (
        <div className="mv-loading">
          <Loader2 className="mv-spin" size={26} />
          Loading visits...
        </div>
      ) : items.length ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              type="button"
              className="mv-button mv-button--ghost"
              onClick={() => loadVisits({ quiet: true })}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'mv-spin' : ''} size={16} />
              Refresh
            </button>
          </div>
          <div className="mv-grid">
            {items.map((visit) => (
              <VisitCard key={getVisitId(visit)} visit={visit} onOpen={openVisit} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState tab={tab} scope={scope} />
      )}

      {showCreate ? (
        <div className="mv-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}>
          <div className="mv-modal" role="dialog" aria-modal="true" aria-labelledby="mv-create-title">
            <div className="mv-modal__head">
              <div>
                <h2 id="mv-create-title">Create Visit</h2>
                <p>Add the basic visit details. Description is optional.</p>
              </div>
              <button type="button" className="mv-icon-button" onClick={() => setShowCreate(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <form className="mv-modal__body mv-form" onSubmit={handleCreate}>
              <div className="mv-field">
                <label htmlFor="mv-create-date">Visit date</label>
                <input
                  id="mv-create-date"
                  type="date"
                  min={todayIso()}
                  className="mv-input"
                  value={createForm.date}
                  onChange={(event) => setCreateForm((current) => ({ ...current, date: event.target.value }))}
                  required
                />
              </div>

              <div className="mv-field">
                <label htmlFor="mv-create-title-input">Visit title</label>
                <input
                  id="mv-create-title-input"
                  className="mv-input"
                  value={createForm.title}
                  onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Enter visit title"
                  maxLength={160}
                  required
                />
              </div>

              <div className="mv-field">
                <label htmlFor="mv-create-description">Description (optional)</label>
                <textarea
                  id="mv-create-description"
                  className="mv-textarea"
                  value={createForm.description}
                  onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Add visit purpose or details"
                  maxLength={1500}
                />
              </div>

              <div className="mv-form__actions">
                <button type="button" className="mv-button mv-button--ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="mv-button mv-button--primary" disabled={creating}>
                  {creating ? <Loader2 className="mv-spin" size={17} /> : <Plus size={17} />}
                  Create Visit
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedVisit ? (
        <div className="mv-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetail()}>
          <div className="mv-modal mv-modal--detail" role="dialog" aria-modal="true" aria-labelledby="mv-detail-title">
            <div className="mv-modal__head">
              <button type="button" className="mv-icon-button" onClick={closeDetail} aria-label="Back">
                <ChevronLeft size={20} />
              </button>
              <div style={{ flex: 1 }}>
                <h2 id="mv-detail-title">Visit Details</h2>
                <p>Track visit progress and save visit information.</p>
              </div>
              <button type="button" className="mv-icon-button" onClick={closeDetail} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="mv-modal__body">
              {detailLoading ? (
                <div className="mv-loading">
                  <Loader2 className="mv-spin" size={26} />
                  Loading visit details...
                </div>
              ) : (
                <>
                  <div className="mv-detail-summary">
                    <div>
                      <h2>{selectedVisit.title || 'Untitled visit'}</h2>
                      <p>{selectedVisit.description || 'No description added.'}</p>
                      <div className="mv-detail-meta">
                        <span><CalendarDays size={16} /> {formatDate(selectedVisit.scheduled_date)}</span>
                        {selectedVisit.employee_name ? <span><UserRound size={16} /> {selectedVisit.employee_name}</span> : null}
                        {selectedVisit.department ? <span><Users size={16} /> {selectedVisit.department}</span> : null}
                      </div>
                    </div>
                    <VisitStatusBadge status={selectedVisit.status} />
                  </div>

                  <div className="mv-section">
                    <div className="mv-section__head">
                      <div className="mv-section__title"><MapPin size={18} /> Visit map</div>
                    </div>
                    <div className="mv-map">
                      {mapUrl ? (
                        <iframe title="Visit location map" src={mapUrl} loading="lazy" />
                      ) : (
                        <div className="mv-map__empty">
                          <MapPin size={34} />
                          <strong style={{ marginTop: 10 }}>Location not captured yet</strong>
                          <span style={{ marginTop: 5 }}>The map will appear after the visit is started.</span>
                        </div>
                      )}
                    </div>

                    <div className="mv-location-grid">
                      <div className="mv-location-card">
                        <strong>Start location</strong>
                        <span>{selectedVisit.start_location ? `${selectedVisit.start_location.latitude}, ${selectedVisit.start_location.longitude}` : 'Not captured'}</span>
                        <span>{formatDateTime(selectedVisit.started_at)}</span>
                      </div>
                      <div className="mv-location-card">
                        <strong>Reached location</strong>
                        <span>{selectedVisit.reached_location ? `${selectedVisit.reached_location.latitude}, ${selectedVisit.reached_location.longitude}` : 'Not captured'}</span>
                        <span>{formatDateTime(selectedVisit.reached_at)}</span>
                      </div>
                      <div className="mv-location-card">
                        <strong>End location</strong>
                        <span>{selectedVisit.end_location ? `${selectedVisit.end_location.latitude}, ${selectedVisit.end_location.longitude}` : 'Not captured'}</span>
                        <span>{formatDateTime(selectedVisit.ended_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mv-section">
                    <div className="mv-section__head">
                      <div className="mv-section__title"><Camera size={18} /> Visit pictures (optional)</div>
                    </div>

                    {Array.isArray(selectedVisit.pictures) && selectedVisit.pictures.length ? (
                      <div className="mv-picture-grid">
                        {selectedVisit.pictures.map((picture, index) => {
                          const pictureUrl = resolveVisitPictureUrl(picture?.url);
                          return pictureUrl ? (
                            <div className="mv-picture-item" key={picture?.id || picture?.url || index}>
                              <img src={pictureUrl} alt={`Visit ${index + 1}`} loading="lazy" />
                              <span>{picture?.original_name || `Visit picture ${index + 1}`}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    ) : null}

                    {isOwnScope && !isHistoryVisit ? (
                      <>
                        <label className="mv-picture-picker">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            onChange={handlePictureSelection}
                            disabled={uploadingPicture}
                          />
                          {picturePreview ? (
                            <img className="mv-picture-preview" src={picturePreview} alt="Selected visit" />
                          ) : (
                            <span className="mv-picture-picker__content">
                              <Camera size={27} />
                              <strong>Select or capture a picture</strong>
                              <span>JPG, PNG or WEBP up to 8 MB</span>
                            </span>
                          )}
                        </label>

                        {selectedPicture ? (
                          <div className="mv-picture-actions">
                            <button
                              type="button"
                              className="mv-button mv-button--ghost"
                              onClick={() => {
                                setSelectedPicture(null);
                                setPicturePreview('');
                              }}
                              disabled={uploadingPicture}
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              className="mv-button mv-button--primary"
                              onClick={handlePictureUpload}
                              disabled={uploadingPicture}
                            >
                              {uploadingPicture ? <Loader2 className="mv-spin" size={16} /> : <Camera size={16} />}
                              Upload Picture
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <div className="mv-section">
                    <div className="mv-section__head">
                      <div className="mv-section__title"><NotebookPen size={18} /> Visit notes</div>
                    </div>
                    <textarea
                      className="mv-textarea"
                      value={visitNotes}
                      onChange={(event) => setVisitNotes(event.target.value)}
                      placeholder="Add observations, outcomes or follow-up notes"
                      disabled={!isOwnScope || isHistoryVisit}
                      maxLength={4000}
                    />
                    {isOwnScope && !isHistoryVisit ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <button type="button" className="mv-button mv-button--secondary" onClick={saveNotes} disabled={savingNotes}>
                          {savingNotes ? <Loader2 className="mv-spin" size={16} /> : <NotebookPen size={16} />}
                          Save Notes
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {selectedVisit.started_at || selectedVisit.reached_at || selectedVisit.ended_at ? (
                    <div className="mv-section">
                      <div className="mv-section__head">
                        <div className="mv-section__title"><Clock3 size={18} /> Visit timeline</div>
                      </div>
                      <div className="mv-timeline">
                        <div className="mv-timeline__item"><strong>Started</strong><span>{formatDateTime(selectedVisit.started_at)}</span></div>
                        <div className="mv-timeline__item"><strong>Reached</strong><span>{formatDateTime(selectedVisit.reached_at)}</span></div>
                        <div className="mv-timeline__item"><strong>Completed</strong><span>{formatDateTime(selectedVisit.ended_at)}</span></div>
                      </div>
                    </div>
                  ) : null}

                  {isOwnScope && !isHistoryVisit ? (
                    <>
                      <div className="mv-actions-grid">
                        <button
                          type="button"
                          className="mv-button mv-button--secondary"
                          disabled={selectedStatus !== 'scheduled'}
                          onClick={() => setShowReschedule((current) => !current)}
                        >
                          <CalendarDays size={17} />
                          Reschedule
                        </button>
                        <button
                          type="button"
                          className="mv-button mv-button--danger"
                          onClick={() => setShowCancel((current) => !current)}
                        >
                          <Trash2 size={17} />
                          Cancel Visit
                        </button>
                      </div>

                      {showReschedule ? (
                        <form className="mv-inline-form" onSubmit={handleReschedule}>
                          <div className="mv-field">
                            <label htmlFor="mv-reschedule-date">New visit date</label>
                            <input
                              id="mv-reschedule-date"
                              type="date"
                              min={todayIso()}
                              className="mv-input"
                              value={rescheduleDate}
                              onChange={(event) => setRescheduleDate(event.target.value)}
                              required
                            />
                          </div>
                          <button type="submit" className="mv-button mv-button--primary" disabled={actionLoading === 'reschedule'}>
                            {actionLoading === 'reschedule' ? <Loader2 className="mv-spin" size={16} /> : <CalendarDays size={16} />}
                            Confirm Reschedule
                          </button>
                        </form>
                      ) : null}

                      {showCancel ? (
                        <form className="mv-inline-form" onSubmit={handleCancel}>
                          <div className="mv-field">
                            <label htmlFor="mv-cancel-reason">Cancellation reason (optional)</label>
                            <textarea
                              id="mv-cancel-reason"
                              className="mv-textarea"
                              value={cancelReason}
                              onChange={(event) => setCancelReason(event.target.value)}
                              placeholder="Add a reason"
                            />
                          </div>
                          <button type="submit" className="mv-button mv-button--danger" disabled={actionLoading === 'cancel'}>
                            {actionLoading === 'cancel' ? <Loader2 className="mv-spin" size={16} /> : <Trash2 size={16} />}
                            Confirm Cancellation
                          </button>
                        </form>
                      ) : null}

                      <div className="mv-progress-action">
                        {selectedStatus === 'scheduled' ? (
                          <button type="button" className="mv-button mv-button--primary mv-button--full" onClick={() => runLocationAction('start')} disabled={Boolean(actionLoading)}>
                            {actionLoading === 'start' ? <Loader2 className="mv-spin" size={19} /> : <Navigation size={19} />}
                            Start Visit
                          </button>
                        ) : null}

                        {selectedStatus === 'started' ? (
                          <button type="button" className="mv-button mv-button--warning mv-button--full" onClick={() => runLocationAction('reached')} disabled={Boolean(actionLoading)}>
                            {actionLoading === 'reached' ? <Loader2 className="mv-spin" size={19} /> : <MapPin size={19} />}
                            Reached
                          </button>
                        ) : null}

                        {selectedStatus === 'reached' ? (
                          <button type="button" className="mv-button mv-button--success mv-button--full" onClick={() => runLocationAction('end')} disabled={Boolean(actionLoading)}>
                            {actionLoading === 'end' ? <Loader2 className="mv-spin" size={19} /> : <Square size={18} />}
                            End Visit
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {selectedStatus === 'completed' ? (
                    <div className="mv-alert mv-alert--success" style={{ marginTop: 14, marginBottom: 0 }}>
                      <CheckCircle2 size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />
                      This visit was completed on {formatDateTime(selectedVisit.ended_at)}.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}