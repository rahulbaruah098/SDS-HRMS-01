import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Users,
  X,
  XCircle,
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

const VISIT_NOTICE_HIDE_MS = 3600;
const VISIT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

function visitMatchesSearch(visit = {}, search = '') {
  const term = normalizeText(search).toLowerCase();

  if (!term) return true;

  return [
    visit.title,
    visit.description,
    visit.employee_name,
    visit.department,
    visit.visit_notes,
    statusLabel(visit.status),
    visit.scheduled_date,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .join(' ')
    .includes(term);
}

function visitPageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function VisitInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div className={`mv-inline-feedback ${message.type || 'info'}`} role="status">
      <span className="mv-inline-feedback__icon">
        {message.loading ? (
          <Loader2 size={15} className="mv-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="mv-inline-feedback__copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="mv-inline-feedback__close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function VisitPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="mv-pagination">
      <div className="mv-pagination__copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>visits</span>
      </div>

      <div className="mv-pagination__controls">
        <label className="mv-page-size">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Visits per page"
          >
            {VISIT_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="mv-page-button mv-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="mv-page-numbers" aria-label="Pagination">
          {visitPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`mv-page-number ${item === safePage ? 'is-active' : ''}`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="mv-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="mv-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="mv-page-button mv-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
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
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});
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

  const clearFeedback = useCallback((scopeKey) => {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }, []);

  const showFeedback = useCallback(
    (scopeKey, type, text, title = '', options = {}) => {
      if (!scopeKey) return;

      const existingTimer = feedbackTimersRef.current[scopeKey];

      if (existingTimer) {
        window.clearTimeout(existingTimer);
        delete feedbackTimersRef.current[scopeKey];
      }

      setFeedbackMap((current) => ({
        ...current,
        [scopeKey]: {
          type,
          text,
          title,
          loading: Boolean(options.loading),
        },
      }));

      if (!options.loading) {
        feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
          setFeedbackMap((current) => {
            const next = { ...current };
            delete next[scopeKey];
            return next;
          });

          delete feedbackTimersRef.current[scopeKey];
        }, VISIT_NOTICE_HIDE_MS);
      }
    },
    [],
  );

  const loadVisits = useCallback(
    async ({ quiet = false, feedbackScope = '' } = {}) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);

      setError('');

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'info',
          'Refreshing visit records...',
          'Refreshing',
          { loading: true },
        );
      }

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

        if (feedbackScope) {
          showFeedback(
            feedbackScope,
            'success',
            'Visit records are up to date.',
            'Refresh Complete',
          );
        }
      } catch (loadError) {
        setItems([]);

        const errorMessage = readError(loadError, 'Unable to load visits.');

        if (feedbackScope) {
          showFeedback(
            feedbackScope,
            'error',
            errorMessage,
            'Refresh Failed',
          );
        } else {
          setError(errorMessage);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      filters.date,
      filters.department,
      filters.employee_name,
      scope,
      tab,
      showFeedback,
    ],
  );

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  useEffect(() => {
    setPage(1);
  }, [tab, scope, searchInput, filters.employee_name, filters.date, filters.department]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
    setPage((current) => Math.min(current, pageCount));
  }, [items.length, pageSize]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.mv-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const modalOpen = showCreate || Boolean(selectedVisit);

    if (!modalOpen || typeof document === 'undefined') {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;

    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    const blockBackgroundScroll = (event) => {
      const modalSurface = event.target?.closest?.('.mv-modal');

      if (modalSurface) return;
      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (selectedVisit && !actionLoading && !savingNotes && !uploadingPicture) {
        closeDetail();
        return;
      }

      if (showCreate && !creating) {
        setShowCreate(false);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, {
      passive: false,
    });
    document.addEventListener('touchmove', blockBackgroundScroll, {
      passive: false,
    });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [
    actionLoading,
    creating,
    savingNotes,
    selectedVisit,
    showCreate,
    uploadingPicture,
  ]);

  async function handleCreate(event) {
    event.preventDefault();
    setCreating(true);
    setError('');

    showFeedback(
      'create-modal',
      'info',
      'Creating the field visit...',
      'Creating Visit',
      { loading: true },
    );

    try {
      const response = await createFieldVisit({
        date: createForm.date,
        title: normalizeText(createForm.title),
        description: normalizeText(createForm.description),
      });

      setShowCreate(false);
      setCreateForm({ ...EMPTY_CREATE_FORM, date: todayIso() });
      clearFeedback('create-modal');
      showFeedback(
        'hero-create',
        'success',
        response?.message || 'Visit created successfully.',
        'Visit Created',
      );
      setTab('active');
      setScope('mine');
      await loadVisits();
    } catch (createError) {
      showFeedback(
        'create-modal',
        'error',
        readError(createError, 'Unable to create visit.'),
        'Create Failed',
      );
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
      showFeedback(
        'detail',
        'error',
        readError(detailError, 'Unable to load visit details.'),
        'Visit Load Failed',
      );
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

    showFeedback(
      'notes',
      'info',
      'Saving visit notes...',
      'Saving Notes',
      { loading: true },
    );

    try {
      const response = await updateFieldVisit(visitId, {
        visit_notes: visitNotes,
      });

      setSelectedVisit(response?.item || selectedVisit);
      showFeedback(
        'notes',
        'success',
        response?.message || 'Visit notes saved.',
        'Notes Saved',
      );
      await loadVisits({ quiet: true });
    } catch (notesError) {
      showFeedback(
        'notes',
        'error',
        readError(notesError, 'Unable to save visit notes.'),
        'Save Failed',
      );
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

    showFeedback(
      'reschedule',
      'info',
      'Rescheduling the visit...',
      'Updating Visit Date',
      { loading: true },
    );

    try {
      const response = await rescheduleFieldVisit(visitId, { date: rescheduleDate });
      setSelectedVisit(response?.item || selectedVisit);
      setShowReschedule(false);
      showFeedback(
        'reschedule',
        'success',
        response?.message || 'Visit rescheduled successfully.',
        'Visit Rescheduled',
      );
      await loadVisits({ quiet: true });
    } catch (rescheduleError) {
      showFeedback(
        'reschedule',
        'error',
        readError(rescheduleError, 'Unable to reschedule visit.'),
        'Reschedule Failed',
      );
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

    showFeedback(
      'cancel',
      'info',
      'Cancelling the visit...',
      'Cancelling Visit',
      { loading: true },
    );

    try {
      const response = await cancelFieldVisit(visitId, { reason: cancelReason });
      setSelectedVisit(response?.item || selectedVisit);
      setShowCancel(false);
      setCancelReason('');
      showFeedback(
        'cancel',
        'success',
        response?.message || 'Visit cancelled successfully.',
        'Visit Cancelled',
      );
      await loadVisits({ quiet: true });
    } catch (cancelError) {
      showFeedback(
        'cancel',
        'error',
        readError(cancelError, 'Unable to cancel visit.'),
        'Cancellation Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  async function runLocationAction(action) {
    const visitId = getVisitId(selectedVisit);
    if (!visitId) return;

    setActionLoading(action);
    setError('');

    const actionTitle =
      action === 'start'
        ? 'Starting Visit'
        : action === 'reached'
          ? 'Marking Arrival'
          : 'Completing Visit';

    showFeedback(
      'progress',
      'info',
      'Capturing your current GPS location...',
      actionTitle,
      { loading: true },
    );

    try {
      const location = await captureCurrentLocation();
      let response;

      if (action === 'start') response = await startFieldVisit(visitId, location);
      else if (action === 'reached') response = await markFieldVisitReached(visitId, location);
      else response = await endFieldVisit(visitId, location);

      setSelectedVisit(response?.item || selectedVisit);
      showFeedback(
        'progress',
        'success',
        response?.message || 'Visit updated successfully.',
        'Visit Progress Updated',
      );
      await refreshSelectedVisit(visitId);
      await loadVisits({ quiet: true });
    } catch (actionError) {
      showFeedback(
        'progress',
        'error',
        readError(actionError, 'Unable to update visit progress.'),
        'Visit Update Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function handlePictureSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showFeedback(
        'picture',
        'warning',
        'Please select a valid image file.',
        'Invalid Picture',
      );
      event.target.value = '';
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showFeedback(
        'picture',
        'warning',
        'The selected image must be smaller than 8 MB.',
        'Picture Too Large',
      );
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

    showFeedback(
      'picture',
      'info',
      'Uploading the selected visit picture...',
      'Uploading Picture',
      { loading: true },
    );

    try {
      const response = await uploadFieldVisitPicture(visitId, selectedPicture);
      setSelectedVisit(response?.item || selectedVisit);
      setPicturePreview('');
      setSelectedPicture(null);
      showFeedback(
        'picture',
        'success',
        response?.message || 'Visit picture uploaded successfully.',
        'Picture Uploaded',
      );
      await refreshSelectedVisit(visitId);
      await loadVisits({ quiet: true });
    } catch (uploadError) {
      showFeedback(
        'picture',
        'error',
        readError(uploadError, 'Unable to upload visit picture.'),
        'Upload Failed',
      );
    } finally {
      setUploadingPicture(false);
    }
  }

  const selectedStatus = normalizeRole(selectedVisit?.status);
  const isHistoryVisit = selectedStatus === 'completed' || selectedStatus === 'cancelled';
  const isOwnScope = scope === 'mine';
  const mapLocation = latestLocation(selectedVisit);
  const mapUrl = locationMapUrl(mapLocation);

  const scheduledCount = items.filter(
    (visit) => normalizeRole(visit?.status) === 'scheduled',
  ).length;

  const inProgressCount = items.filter((visit) =>
    ['started', 'reached'].includes(normalizeRole(visit?.status)),
  ).length;

  const closedCount = items.filter((visit) =>
    ['completed', 'cancelled'].includes(normalizeRole(visit?.status)),
  ).length;

  const visibleItems = useMemo(
    () => items.filter((visit) => visitMatchesSearch(visit, searchInput)),
    [items, searchInput],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(visibleItems.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedItems = visibleItems.slice(pageStart, pageStart + pageSize);

  return (
    <div className="mv-page">
      <style>{`
        .mv-page {
          --mv-ink: #101a3a;
          --mv-muted: #5d6d8d;
          --mv-line: rgba(16, 26, 58, .14);
          --mv-panel: #ffffff;
          --mv-primary: #4d77dd;
          --mv-primary-dark: #575092;
          --mv-blue: #4d77dd;
          --mv-cyan: #2eb2b9;
          --mv-teal: #2eb2b9;
          min-height: 100%;
          width: 100%;
          min-width: 0;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          color: var(--mv-ink);
          background: transparent;
        }

        .mv-page,
        .mv-page * {
          box-sizing: border-box;
        }

        .mv-page > *,
        .mv-page section,
        .mv-page article,
        .mv-page form,
        .mv-page nav,
        .mv-page label {
          min-width: 0;
          max-width: 100%;
        }

        .mv-page::before,
        .mv-page::after,
        .mv-page .mv-hero::before,
        .mv-page .mv-hero::after,
        .mv-page .mv-kpi::before,
        .mv-page .mv-kpi::after {
          content: none;
          display: none;
          background: none;
        }

        .mv-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 310px);
          gap: clamp(20px, 3vw, 38px);
          align-items: center;
          min-height: 240px;
          margin: 0;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154,164,205,.58);
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
          box-shadow: 0 22px 46px rgba(70,92,140,.10);
        }

        .mv-hero__copy {
          min-width: 0;
          max-width: 900px;
        }

        .mv-hero__actions {
          width: 100%;
          display: grid;
          gap: 9px;
          justify-items: stretch;
        }

        .mv-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 15px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.18);
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .mv-header h1 {
          max-width: 900px;
          margin: 0;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .mv-header h1 em {
          color: var(--mv-primary);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .mv-header p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--mv-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .mv-button {
          min-height: 46px;
          padding: 10px 16px;
          border: 1px solid transparent;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
          touch-action: manipulation;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            filter 180ms ease,
            border-color 180ms ease;
        }

        .mv-button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .mv-button:disabled {
          cursor: not-allowed;
          opacity: .58;
          transform: none;
        }

        .mv-button--primary {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77,119,221,.18);
        }

        .mv-button--secondary {
          color: #40348d;
          border-color: rgba(98,84,218,.16);
          background: #f1efff;
        }

        .mv-button--ghost {
          color: #4767b4;
          border-color: rgba(77,119,221,.18);
          background: #fff;
        }

        .mv-button--danger {
          color: #a2344d;
          border-color: rgba(216,77,104,.18);
          background: #fff0f2;
        }

        .mv-button--success {
          color: #fff;
          background: linear-gradient(135deg, #16835f, #2eb2b9);
        }

        .mv-button--warning {
          color: #fff;
          background: linear-gradient(135deg, #da7b12, #f5b94f);
        }

        .mv-button--full {
          width: 100%;
        }

        .mv-create-button {
          width: 100%;
          min-height: 50px;
          white-space: nowrap;
        }

        .mv-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .mv-kpi {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34,38,110,.07);
        }

        .mv-kpi:nth-child(2) {
          background: #eaf8f4;
        }

        .mv-kpi:nth-child(3) {
          background: #fff4d5;
        }

        .mv-kpi:nth-child(4) {
          background: #f1efff;
        }

        .mv-kpi span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .mv-kpi strong {
          display: block;
          margin-top: 8px;
          color: var(--mv-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .mv-kpi small {
          display: block;
          margin-top: 7px;
          color: var(--mv-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .mv-directory {
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #fff;
          box-shadow: 0 22px 42px rgba(34,38,110,.09);
        }

        .mv-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin: 0;
          padding: clamp(16px, 2vw, 22px);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .mv-tabs,
        .mv-scope {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .mv-tab {
          min-height: 42px;
          padding: 9px 13px;
          border: 1px solid rgba(77,119,221,.20);
          border-radius: 13px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: none;
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .mv-tab:hover {
          transform: translateY(-1px);
          border-color: rgba(46,178,185,.42);
        }

        .mv-tab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.17);
        }

        .mv-directory-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: end;
          padding: 16px clamp(16px, 2vw, 22px);
          background: linear-gradient(
            145deg,
            rgba(237,248,255,.44),
            rgba(248,241,255,.30)
          );
        }

        .mv-search-wrap,
        .mv-input-wrap {
          position: relative;
        }

        .mv-search-wrap > svg,
        .mv-input-wrap > svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--mv-primary);
          pointer-events: none;
        }

        .mv-search-wrap input {
          width: 100%;
          min-height: 46px;
          padding: 0 13px 0 38px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 14px;
          outline: 0;
          color: var(--mv-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-size: 13px;
        }

        .mv-filters {
          display: grid;
          grid-template-columns: minmax(180px, 1.1fr) minmax(150px, .8fr) minmax(180px, 1fr) auto;
          gap: 12px;
          margin: 0;
          padding: 16px clamp(16px, 2vw, 22px);
          border-top: 1px solid rgba(65,55,161,.07);
          background: #fff;
        }

        .mv-field {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .mv-field label {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .mv-input,
        .mv-textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 14px;
          color: var(--mv-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          outline: none;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease;
        }

        .mv-input {
          min-height: 46px;
          padding: 0 13px;
        }

        .mv-input.has-icon {
          padding-left: 38px;
        }

        .mv-textarea {
          min-height: 112px;
          padding: 13px;
          resize: vertical;
        }

        .mv-search-wrap input:focus,
        .mv-input:focus,
        .mv-textarea:focus,
        .mv-page-size select:focus {
          border-color: rgba(77,119,221,.65);
          box-shadow: 0 0 0 4px rgba(77,119,221,.09);
        }

        .mv-filter-actions {
          display: flex;
          align-items: end;
          gap: 8px;
        }

        .mv-directory-feedback {
          padding: 0 clamp(16px, 2vw, 22px) 14px;
        }

        .mv-list-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 16px clamp(16px, 2vw, 22px);
          border-top: 1px solid rgba(65,55,161,.08);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .mv-list-head h2 {
          margin: 0;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.2vw, 34px);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .mv-list-head p {
          margin: 7px 0 0;
          color: var(--mv-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .mv-refresh-stack {
          width: min(250px, 100%);
          display: grid;
          gap: 8px;
        }

        .mv-alert {
          margin: 0;
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 12px;
          font-weight: 800;
        }

        .mv-alert--error {
          color: #a91f31;
          background: #fff0f2;
          border: 1px solid rgba(216,77,104,.28);
        }

        .mv-alert--success {
          color: #12664b;
          background: #eaf8f4;
          border: 1px solid rgba(52,201,196,.36);
        }

        .mv-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          line-height: 1.45;
        }

        .mv-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
        }

        .mv-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
        }

        .mv-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
        }

        .mv-inline-feedback__icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .mv-inline-feedback__copy {
          min-width: 0;
        }

        .mv-inline-feedback__copy strong,
        .mv-inline-feedback__copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .mv-inline-feedback__copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .mv-inline-feedback__copy span {
          font-weight: 750;
        }

        .mv-inline-feedback__close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          padding: 0;
          display: inline-grid;
          place-items: center;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.58);
          font: inherit;
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }

        .mv-inline-feedback__close:hover {
          background: #fff;
        }

        .mv-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          padding: clamp(16px, 2vw, 22px);
        }

        .mv-card {
          appearance: none;
          min-width: 0;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.68);
          border-radius: 20px;
          color: inherit;
          background: #fff;
          box-shadow: 0 14px 28px rgba(34,38,110,.07);
          text-align: left;
          cursor: pointer;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease;
        }

        .mv-card:nth-child(3n + 1) {
          background: #f7fbff;
        }

        .mv-card:nth-child(3n + 2) {
          background: #f4fbf8;
        }

        .mv-card:nth-child(3n + 3) {
          background: #f8f7ff;
        }

        .mv-card:hover {
          transform: translateY(-2px);
          border-color: rgba(77,119,221,.28);
          box-shadow: 0 18px 34px rgba(34,38,110,.10);
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
          width: 44px;
          height: 44px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.16);
        }

        .mv-status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 10px;
          font-weight: 950;
          white-space: nowrap;
        }

        .mv-status--info {
          background: #edf6ff;
          color: #245da8;
        }

        .mv-status--warning {
          background: #fff4d5;
          color: #9a6817;
        }

        .mv-status--purple {
          background: #f1efff;
          color: #40348d;
        }

        .mv-status--success {
          background: #eaf8f4;
          color: #047857;
        }

        .mv-status--danger {
          background: #fff0f2;
          color: #a2344d;
        }

        .mv-card__body h3 {
          margin: 0 0 7px;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(19px, 1.8vw, 26px);
          font-weight: 760;
          letter-spacing: -.035em;
        }

        .mv-card__body p {
          min-height: 40px;
          margin: 0;
          display: -webkit-box;
          overflow: hidden;
          color: var(--mv-muted);
          font-size: 13px;
          line-height: 1.55;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .mv-card__meta {
          margin-top: 15px;
          padding-top: 13px;
          display: grid;
          gap: 8px;
          border-top: 1px solid rgba(171,181,211,.48);
        }

        .mv-card__meta span {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--mv-muted);
          font-size: 12px;
          font-weight: 750;
        }

        .mv-empty,
        .mv-loading {
          min-height: 240px;
          margin: clamp(16px, 2vw, 22px);
          padding: 28px;
          border: 1px dashed rgba(77,119,221,.30);
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--mv-muted);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
        }

        .mv-empty h3 {
          margin: 4px 0 0;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 23px;
        }

        .mv-empty p {
          max-width: 430px;
          margin: 0;
          line-height: 1.55;
        }

        .mv-spin {
          animation: mv-spin 850ms linear infinite;
        }

        @keyframes mv-spin {
          to { transform: rotate(360deg); }
        }

        .mv-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px clamp(16px, 2vw, 22px);
          border-top: 1px solid rgba(65,55,161,.08);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .mv-pagination__copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--mv-muted);
          font-size: 10px;
          font-weight: 850;
        }

        .mv-pagination__copy strong {
          color: var(--mv-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .mv-pagination__controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .mv-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--mv-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .mv-page-size select {
          min-width: 78px;
          min-height: 38px;
          padding: 0 28px 0 10px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 11px;
          outline: 0;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
        }

        .mv-page-button,
        .mv-page-number {
          border: 1px solid rgba(77,119,221,.18);
          color: #4767b4;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .mv-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .mv-page-nav {
          min-width: 78px;
        }

        .mv-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .mv-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .mv-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .mv-page-button:hover:not(:disabled),
        .mv-page-number:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46,178,185,.42);
        }

        .mv-page-button:disabled,
        .mv-page-number:disabled {
          opacity: .5;
          cursor: not-allowed;
          transform: none;
        }

        .mv-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .mv-page-indicator {
          min-width: 82px;
          color: var(--mv-muted);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .mv-overlay {
          position: fixed;
          inset: 0;
          z-index: 10000;
          width: 100vw;
          height: 100dvh;
          padding:
            max(14px, env(safe-area-inset-top))
            max(14px, env(safe-area-inset-right))
            max(14px, env(safe-area-inset-bottom))
            max(14px, env(safe-area-inset-left));
          display: grid;
          place-items: center;
          overflow: hidden;
          background: rgba(15,23,42,.48);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .mv-modal {
          width: min(640px, 100%);
          max-height: calc(100dvh - 28px);
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid rgba(255,255,255,.56);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9,16,35,.28);
          -webkit-overflow-scrolling: touch;
        }

        .mv-modal--detail {
          width: min(930px, 100%);
        }

        .mv-modal__head {
          position: sticky;
          top: 0;
          z-index: 4;
          padding: 18px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border-bottom: 1px solid rgba(65,55,161,.10);
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
        }

        .mv-modal__head h2 {
          margin: 0;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 25px;
          font-weight: 760;
          letter-spacing: -.035em;
        }

        .mv-modal__head p {
          margin: 4px 0 0;
          color: var(--mv-muted);
          font-size: 13px;
        }

        .mv-icon-button {
          width: 40px;
          min-width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 13px;
          display: grid;
          place-items: center;
          color: #40348d;
          background: #fff;
          cursor: pointer;
        }

        .mv-modal__body {
          padding: 20px;
        }

        .mv-form {
          display: grid;
          gap: 16px;
        }

        .mv-form__row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .mv-form__actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 2px;
        }

        .mv-action-stack {
          display: grid;
          gap: 8px;
          width: 100%;
        }

        .mv-detail-summary {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .mv-detail-summary h2 {
          margin: 0 0 7px;
          color: var(--mv-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(28px, 3vw, 42px);
          font-weight: 760;
          letter-spacing: -.045em;
        }

        .mv-detail-summary p {
          margin: 0;
          color: var(--mv-muted);
          line-height: 1.58;
        }

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
          color: var(--mv-muted);
          font-size: 13px;
          font-weight: 750;
        }

        .mv-section {
          margin-top: 15px;
          padding: 17px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 10px 24px rgba(34,38,110,.06);
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
          color: var(--mv-ink);
          font-weight: 900;
        }

        .mv-section__title svg {
          color: var(--mv-primary);
        }

        .mv-map {
          min-height: 310px;
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 17px;
          background: #eff1f7;
        }

        .mv-map iframe {
          width: 100%;
          height: 310px;
          border: 0;
          display: block;
        }

        .mv-map__empty {
          min-height: 310px;
          padding: 25px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--mv-muted);
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          text-align: center;
        }

        .mv-location-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .mv-location-card {
          padding: 12px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 15px;
          background: #edf6ff;
        }

        .mv-location-card:nth-child(2) {
          background: #fff4d5;
        }

        .mv-location-card:nth-child(3) {
          background: #eaf8f4;
        }

        .mv-location-card strong {
          display: block;
          margin-bottom: 5px;
          color: var(--mv-ink);
          font-size: 12px;
        }

        .mv-location-card span {
          display: block;
          color: var(--mv-muted);
          font-size: 11px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .mv-picture-picker {
          position: relative;
          min-height: 130px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 1px dashed rgba(77,119,221,.32);
          border-radius: 17px;
          background: linear-gradient(145deg, #f8fbff, #f7f4ff);
        }

        .mv-picture-picker input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .mv-picture-picker__content {
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          color: var(--mv-muted);
          font-size: 13px;
          text-align: center;
        }

        .mv-picture-picker__content svg {
          color: var(--mv-primary);
        }

        .mv-picture-preview {
          width: 100%;
          max-height: 320px;
          display: block;
          object-fit: cover;
        }

        .mv-picture-actions {
          margin-top: 10px;
          display: flex;
          justify-content: flex-end;
          gap: 9px;
        }

        .mv-picture-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }

        .mv-picture-item {
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 15px;
          background: #fff;
        }

        .mv-picture-item img {
          width: 100%;
          height: 145px;
          display: block;
          object-fit: cover;
        }

        .mv-picture-item span {
          display: block;
          padding: 8px 9px;
          overflow: hidden;
          color: var(--mv-muted);
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mv-actions-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }

        .mv-progress-action {
          margin-top: 14px;
        }

        .mv-progress-action .mv-button {
          min-height: 50px;
          font-size: 14px;
        }

        .mv-inline-form {
          margin-top: 12px;
          padding: 14px;
          display: grid;
          gap: 10px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 17px;
          background: #f8fbff;
        }

        .mv-timeline {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .mv-timeline__item {
          padding: 10px 11px;
          border-left: 3px solid #4d77dd;
          border-radius: 0 13px 13px 0;
          background: #f1efff;
        }

        .mv-timeline__item:nth-child(2) {
          border-left-color: #da7b12;
          background: #fff4d5;
        }

        .mv-timeline__item:nth-child(3) {
          border-left-color: #16835f;
          background: #eaf8f4;
        }

        .mv-timeline__item strong {
          display: block;
          color: var(--mv-ink);
          font-size: 12px;
        }

        .mv-timeline__item span {
          display: block;
          margin-top: 4px;
          color: var(--mv-muted);
          font-size: 11px;
        }

        @media (max-width: 1180px) {
          .mv-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .mv-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .mv-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .mv-filter-actions {
            align-items: stretch;
          }

          .mv-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .mv-pagination__controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 820px) {
          .mv-hero {
            grid-template-columns: 1fr;
          }

          .mv-hero__actions {
            width: min(360px, 100%);
          }

          .mv-toolbar,
          .mv-list-head {
            align-items: stretch;
            flex-direction: column;
          }

          .mv-directory-controls {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 680px) {
          .mv-page {
            gap: 15px;
          }

          .mv-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34,38,110,.09);
          }

          .mv-header h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .mv-kpi-grid,
          .mv-grid,
          .mv-picture-grid,
          .mv-filters,
          .mv-form__row,
          .mv-location-grid,
          .mv-timeline,
          .mv-actions-grid {
            grid-template-columns: 1fr;
          }

          .mv-toolbar {
            padding: 13px;
          }

          .mv-tabs,
          .mv-scope {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .mv-tab {
            width: 100%;
          }

          .mv-filters {
            padding: 14px;
          }

          .mv-filter-actions {
            display: grid;
            grid-template-columns: 1fr auto;
          }

          .mv-refresh-stack,
          .mv-refresh-stack .mv-button {
            width: 100%;
          }

          .mv-pagination {
            padding: 12px;
          }

          .mv-pagination__controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .mv-page-size,
          .mv-page-numbers,
          .mv-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .mv-page-size {
            justify-content: space-between;
          }

          .mv-page-size select {
            flex: 1 1 auto;
          }

          .mv-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .mv-page-nav {
            width: 100%;
          }

          .mv-overlay {
            align-items: stretch;
            padding: 0;
          }

          .mv-modal,
          .mv-modal--detail {
            width: 100%;
            max-width: 100%;
            height: 100dvh;
            max-height: 100dvh;
            margin: 0;
            border-radius: 0;
            box-shadow: none;
          }

          .mv-modal__body {
            padding: 16px;
          }

          .mv-detail-summary {
            flex-direction: column;
          }

          .mv-form__actions,
          .mv-picture-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .mv-form__actions .mv-button,
          .mv-picture-actions .mv-button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .mv-hero {
            padding: 16px;
          }

          .mv-header h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .mv-tabs,
          .mv-scope {
            grid-template-columns: 1fr;
          }

          .mv-card,
          .mv-section {
            padding: 15px;
          }

          .mv-card__top {
            align-items: flex-start;
          }

          .mv-status {
            align-self: flex-start;
          }

          .mv-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (orientation: landscape) and (max-height: 600px) {
          .mv-modal,
          .mv-modal--detail {
            max-height: 100dvh;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .mv-page *,
          .mv-page *::before,
          .mv-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="mv-header mv-hero">
        <div className="mv-hero__copy">
          <span className="mv-eyebrow">
            <Sparkles size={13} />
            Field Visit Workspace
          </span>
          <h1>
            Visits that stay <em>connected.</em>
          </h1>
          <p>
            Schedule, track and complete field visits with GPS checkpoints,
            visit notes, photos, timelines and team visibility from one
            YourComate workspace.
          </p>
        </div>

        <div className="mv-hero__actions">
          <button
            type="button"
            className="mv-button mv-button--primary mv-create-button"
            onClick={() => {
              clearFeedback('create-modal');
              setShowCreate(true);
            }}
          >
            <Plus size={18} />
            Create Visit
          </button>

          <VisitInlineMessage
            message={feedbackMap['hero-create']}
            onClose={() => clearFeedback('hero-create')}
          />
        </div>
      </section>

      <section className="mv-kpi-grid" aria-label="Visit summary">
        <article className="mv-kpi">
          <span>Visits in current view</span>
          <strong>{items.length.toLocaleString('en-IN')}</strong>
          <small>
            {scope === 'team' ? 'Team visit records' : 'Your visit records'}
          </small>
        </article>

        <article className="mv-kpi">
          <span>Scheduled</span>
          <strong>{scheduledCount.toLocaleString('en-IN')}</strong>
          <small>Visits waiting to be started</small>
        </article>

        <article className="mv-kpi">
          <span>In progress</span>
          <strong>{inProgressCount.toLocaleString('en-IN')}</strong>
          <small>Started or reached visits</small>
        </article>

        <article className="mv-kpi">
          <span>Closed</span>
          <strong>{closedCount.toLocaleString('en-IN')}</strong>
          <small>Completed or cancelled visits</small>
        </article>
      </section>

      <section className="mv-directory">
        <div className="mv-toolbar">
          <div className="mv-tabs">
            <button
              type="button"
              className={`mv-tab ${tab === 'active' ? 'is-active' : ''}`}
              onClick={() => setTab('active')}
            >
              <MapPin size={17} />
              Active Visits
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
                My Visits
              </button>

              <button
                type="button"
                className={`mv-tab ${scope === 'team' ? 'is-active' : ''}`}
                onClick={() => setScope('team')}
              >
                <Users size={16} />
                Team Visits
              </button>
            </div>
          ) : null}
        </div>

        <div className="mv-directory-controls">
          <div className="mv-search-wrap">
            <Search size={17} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search visit, employee, department, status..."
              aria-label="Search visits"
            />
          </div>

          <span className="mv-status mv-status--info">
            {scope === 'team' ? 'Team scope' : 'My scope'} ·{' '}
            {tab === 'history' ? 'History' : 'Active'}
          </span>
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
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
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
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      department: event.target.value,
                    }))
                  }
                  placeholder="Enter department"
                />
              </div>
            </div>

            <div className="mv-filter-actions">
              <button
                type="button"
                className="mv-button mv-button--primary"
                onClick={() =>
                  loadVisits({
                    feedbackScope: 'filters',
                  })
                }
              >
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

        {feedbackMap.filters ? (
          <div className="mv-directory-feedback">
            <VisitInlineMessage
              message={feedbackMap.filters}
              onClose={() => clearFeedback('filters')}
            />
          </div>
        ) : null}

        {error ? (
          <div className="mv-directory-feedback">
            <div className="mv-alert mv-alert--error">{error}</div>
          </div>
        ) : null}

        <div className="mv-list-head">
          <div>
            <h2>{tab === 'history' ? 'Visit History' : 'Visit Directory'}</h2>
            <p>
              {scope === 'team'
                ? 'Review mapped employee visits in the selected team scope.'
                : 'Review and manage the visits available in your current scope.'}
            </p>
          </div>

          <div className="mv-refresh-stack">
            <button
              type="button"
              className="mv-button mv-button--ghost"
              onClick={() =>
                loadVisits({
                  quiet: true,
                  feedbackScope: 'refresh',
                })
              }
              disabled={refreshing}
            >
              <RefreshCw
                className={refreshing ? 'mv-spin' : ''}
                size={16}
              />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <VisitInlineMessage
              message={feedbackMap.refresh}
              onClose={() => clearFeedback('refresh')}
            />
          </div>
        </div>

        <VisitPagination
          total={visibleItems.length}
          page={safePage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPage(1);
            setPageSize(value);
          }}
        />

        {loading ? (
          <div className="mv-loading">
            <Loader2 className="mv-spin" size={26} />
            Loading visits...
          </div>
        ) : visibleItems.length ? (
          <div className="mv-grid">
            {pagedItems.map((visit) => (
              <VisitCard
                key={getVisitId(visit)}
                visit={visit}
                onOpen={openVisit}
              />
            ))}
          </div>
        ) : (
          <EmptyState tab={tab} scope={scope} />
        )}
      </section>

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

              <div className="mv-action-stack">
                <div className="mv-form__actions">
                  <button
                    type="button"
                    className="mv-button mv-button--ghost"
                    onClick={() => setShowCreate(false)}
                    disabled={creating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="mv-button mv-button--primary"
                    disabled={creating}
                  >
                    {creating ? <Loader2 className="mv-spin" size={17} /> : <Plus size={17} />}
                    {creating ? 'Creating...' : 'Create Visit'}
                  </button>
                </div>

                <VisitInlineMessage
                  message={feedbackMap['create-modal']}
                  onClose={() => clearFeedback('create-modal')}
                />
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
              <VisitInlineMessage
                message={feedbackMap.detail}
                onClose={() => clearFeedback('detail')}
              />

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

                        <VisitInlineMessage
                          message={feedbackMap.picture}
                          onClose={() => clearFeedback('picture')}
                        />
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
                      <div className="mv-action-stack" style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="mv-button mv-button--secondary"
                            onClick={saveNotes}
                            disabled={savingNotes}
                          >
                            {savingNotes ? <Loader2 className="mv-spin" size={16} /> : <NotebookPen size={16} />}
                            {savingNotes ? 'Saving...' : 'Save Notes'}
                          </button>
                        </div>

                        <VisitInlineMessage
                          message={feedbackMap.notes}
                          onClose={() => clearFeedback('notes')}
                        />
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
                            {actionLoading === 'reschedule' ? 'Rescheduling...' : 'Confirm Reschedule'}
                          </button>

                          <VisitInlineMessage
                            message={feedbackMap.reschedule}
                            onClose={() => clearFeedback('reschedule')}
                          />
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
                            {actionLoading === 'cancel' ? 'Cancelling...' : 'Confirm Cancellation'}
                          </button>

                          <VisitInlineMessage
                            message={feedbackMap.cancel}
                            onClose={() => clearFeedback('cancel')}
                          />
                        </form>
                      ) : null}

                      <div className="mv-progress-action mv-action-stack">
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
                            {actionLoading === 'end' ? 'Ending Visit...' : 'End Visit'}
                          </button>
                        ) : null}

                        <VisitInlineMessage
                          message={feedbackMap.progress}
                          onClose={() => clearFeedback('progress')}
                        />
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