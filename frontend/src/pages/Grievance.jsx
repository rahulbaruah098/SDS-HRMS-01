import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  EyeOff,
  FileText,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react';

import {
  createGrievance,
  getGrievanceOptions,
  getGrievanceProfile,
  getGrievances,
  getMyGrievances,
  updateGrievanceStatus,
} from '../api/client';

import {
  GRIEVANCE_PRIORITY_OPTIONS,
  GRIEVANCE_STATUS_OPTIONS,
  GRIEVANCE_TYPE_OPTIONS,
  HR_ROLES,
  hasAnyRole,
  effectiveRoleList,
} from '../data/modules';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const emptyForm = {
  grievance_type: 'workplace_issue',
  priority: 'medium',
  subject: '',
  description: '',
  is_anonymous: false,
};

const emptyStatusForm = {
  status: 'under_review',
  hr_remarks: '',
  resolution_note: '',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDate(value) {
  if (!value) return '—';

  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function statusClass(status = '') {
  const key = String(status || '').toLowerCase();

  if (key === 'resolved') return 'success';
  if (key === 'rejected') return 'danger';
  if (key === 'under_review') return 'warning';
  return 'info';
}

function priorityClass(priority = '') {
  const key = String(priority || '').toLowerCase();

  if (key === 'critical') return 'danger';
  if (key === 'high') return 'warning';
  if (key === 'medium') return 'info';
  return 'muted';
}

function optionLabel(options = [], value = '') {
  const found = options.find((item) => item.value === value);
  return found?.label || String(value || '').replaceAll('_', ' ') || '—';
}

function isHrUser(user = {}) {
  return hasAnyRole(effectiveRoleList(user), HR_ROLES);
}

function buildProfileRows(profile = {}) {
  return [
    ['Employee Name', profile.name],
    ['Employee Code', profile.emp_code],
    ['Department', profile.department],
    ['Designation', profile.designation],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Team Leader', profile.team_leader_name],
    ['Reporting Officer', profile.reporting_officer_name],
  ];
}

export default function Grievance({ user }) {
  const alerts = useCustomAlert();
  const canManage = useMemo(() => isHrUser(user), [user]);

  const [profile, setProfile] = useState({});
  const [options, setOptions] = useState({
    types: GRIEVANCE_TYPE_OPTIONS,
    priorities: GRIEVANCE_PRIORITY_OPTIONS,
    statuses: GRIEVANCE_STATUS_OPTIONS,
  });

  const [form, setForm] = useState(emptyForm);
  const [statusForm, setStatusForm] = useState(emptyStatusForm);
  const [selectedGrievance, setSelectedGrievance] = useState(null);

  const [myItems, setMyItems] = useState([]);
  const [manageItems, setManageItems] = useState([]);

  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    grievance_type: '',
    search: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('raise');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(6);

  const visibleItems = canManage ? manageItems : myItems;
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / itemsPerPage));
  const paginatedItems = useMemo(() => {
    const safePage = Math.min(Math.max(currentPage, 1), totalPages);
    const startIndex = (safePage - 1) * itemsPerPage;
    return visibleItems.slice(startIndex, startIndex + itemsPerPage);
  }, [visibleItems, currentPage, totalPages]);

  const stats = useMemo(() => {
    const rows = visibleItems || [];

    return {
      total: rows.length,
      pending: rows.filter((item) => item.status === 'pending').length,
      underReview: rows.filter((item) => item.status === 'under_review').length,
      resolved: rows.filter((item) => item.status === 'resolved').length,
      anonymous: rows.filter((item) => item.is_anonymous).length,
    };
  }, [visibleItems]);

  function updateForm(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function loadData() {
    setLoading(true);

    try {
      const [profileRes, optionsRes, myRes, manageRes] = await Promise.all([
        getGrievanceProfile(),
        getGrievanceOptions(),
        getMyGrievances(),
        canManage ? getGrievances(filters) : Promise.resolve({ grievances: [] }),
      ]);

      setProfile(profileRes.profile || {});
      setOptions({
        types: optionsRes.types?.length ? optionsRes.types : GRIEVANCE_TYPE_OPTIONS,
        priorities: optionsRes.priorities?.length
          ? optionsRes.priorities
          : GRIEVANCE_PRIORITY_OPTIONS,
        statuses: optionsRes.statuses?.length
          ? optionsRes.statuses
          : GRIEVANCE_STATUS_OPTIONS,
      });

      setMyItems(myRes.grievances || []);
      setManageItems(manageRes.grievances || []);
    } catch (err) {
      alerts.error(err.message || 'Unable to load grievance data.', 'Grievance Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadManageList() {
    if (!canManage) return;

    setLoading(true);

    try {
      const data = await getGrievances(filters);
      setManageItems(data.grievances || []);
      setCurrentPage(1);
    } catch (err) {
      alerts.error(err.message || 'Unable to load HR grievance list.', 'Grievance List Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!normalizeText(form.subject)) {
      alerts.warning('Subject is required.', 'Missing Subject');
      return;
    }

    if (!normalizeText(form.description)) {
      alerts.warning('Description is required.', 'Missing Description');
      return;
    }

    setSaving(true);

    try {
      await createGrievance({
        grievance_type: form.grievance_type,
        priority: form.priority,
        subject: normalizeText(form.subject),
        description: normalizeText(form.description),
        is_anonymous: Boolean(form.is_anonymous),
      });

      setForm(emptyForm);
      alerts.success('Grievance submitted successfully.', 'Grievance Submitted');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to submit grievance.', 'Submission Failed');
    } finally {
      setSaving(false);
    }
  }

  function openStatusPanel(item) {
    setSelectedGrievance(item);
    setStatusForm({
      status: item.status === 'pending' ? 'under_review' : item.status || 'under_review',
      hr_remarks: item.hr_remarks || '',
      resolution_note: item.resolution_note || '',
    });
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();

    if (!selectedGrievance?._id && !selectedGrievance?.id) {
      alerts.warning('Please select a grievance first.', 'No Grievance Selected');
      return;
    }

    setStatusSaving(true);

    try {
      await updateGrievanceStatus(selectedGrievance._id || selectedGrievance.id, statusForm);
      setSelectedGrievance(null);
      setStatusForm(emptyStatusForm);
      alerts.success('Grievance status updated successfully.', 'Status Updated');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to update grievance status.', 'Status Update Failed');
    } finally {
      setStatusSaving(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const profileRows = buildProfileRows(profile);

  return (
    <div className="grievance-page">
      <style>{`
        .grievance-page {
          --gr-ink: #101a3a;
          --gr-copy: #5d6d8d;
          --gr-violet: #6658dc;
          --gr-violet-deep: #40348d;
          --gr-blue: #3766db;
          --gr-cyan: #18b5c8;
          --gr-teal: #34c9c4;
          --gr-yellow: #d8ff43;
          --gr-danger: #d84d68;
          --gr-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          min-width: 0;
          color: var(--gr-ink);
        }

        .grievance-page * {
          box-sizing: border-box;
        }

        .grievance-page,
        .grievance-page > *,
        .grievance-page .panel,
        .grievance-page .grievance-hero,
        .grievance-page .ticket-card,
        .grievance-page .profile-prefill-card,
        .grievance-page .filter-bar,
        .grievance-page .drawer-summary {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .grievance-page img,
        .grievance-page input,
        .grievance-page select,
        .grievance-page textarea,
        .grievance-page button {
          max-width: 100%;
          box-sizing: border-box;
        }

        .grievance-page::before,
        .grievance-page::after,
        .grievance-page .panel::before,
        .grievance-page .panel::after,
        .grievance-page .mini-stat-card::before,
        .grievance-page .mini-stat-card::after,
        .grievance-page .ticket-card::before,
        .grievance-page .ticket-card::after,
        .grievance-page .profile-prefill-card::before,
        .grievance-page .profile-prefill-card::after {
          content: none !important;
          display: none !important;
        }

        .grievance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .grievance-eyebrow,
        .grievance-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .grievance-eyebrow {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .grievance-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .grievance-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--gr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .grievance-hero h1 em {
          color: var(--gr-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .grievance-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--gr-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .grievance-hero-actions {
          position: relative;
          z-index: 1;
        }

        .ghost-btn,
        .grievance-page .primary,
        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 15px;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            filter 190ms ease,
            opacity 190ms ease;
        }

        .ghost-btn:hover:not(:disabled),
        .grievance-page .primary:hover:not(:disabled),
        .icon-btn:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .ghost-btn:disabled,
        .grievance-page .primary:disabled {
          opacity: .58;
          cursor: not-allowed;
        }

        .ghost-btn {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: rgba(255,255,255,.92);
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .grievance-refresh-btn {
          min-height: 54px;
          padding-inline: 18px;
          box-shadow:
            6px 7px 0 #b9d7ff,
            0 14px 25px rgba(44,75,116,.10);
        }

        .grievance-refresh-btn svg:first-child {
          animation: grievance-refresh-idle 4.2s linear infinite;
        }

        .grievance-page .primary {
          min-height: 48px;
          padding: 10px 17px;
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36,74,128,.16);
        }

        .grievance-submit-btn {
          width: fit-content;
          min-width: 0;
          min-height: 40px;
          justify-self: start;
          padding: 8px 14px;
          border-radius: 12px;
          font-size: 11px;
          box-shadow:
            3px 4px 0 #a9d6f5,
            0 10px 18px rgba(36,74,128,.13);
        }

        .grievance-submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow:
            4px 5px 0 #a9d6f5,
            0 13px 22px rgba(36,74,128,.16);
        }

        .grievance-stats {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
        }

        .grievance-section-toggle {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 8px;
          border: 1px solid rgba(171,181,211,.54);
          border-radius: 20px;
          background: rgba(255,255,255,.86);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .grievance-section-toggle button {
          min-width: 0;
          min-height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border: 0;
          border-radius: 14px;
          color: #5d6785;
          background: transparent;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            background 180ms ease,
            color 180ms ease,
            box-shadow 180ms ease;
        }

        .grievance-section-toggle button:hover {
          transform: translateY(-1px);
        }

        .grievance-section-toggle button.is-active {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #5669d9);
          box-shadow: 3px 4px 0 rgba(185,215,255,.78);
        }

        .grievance-toggle-panel {
          width: 100%;
          min-width: 0;
        }

        .mini-stat-card {
          min-width: 0;
          min-height: 118px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34,38,110,.09);
          transition: transform 190ms ease;
        }

        .mini-stat-card:nth-child(2) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34,38,110,.09);
        }

        .mini-stat-card:nth-child(3) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34,38,110,.09);
        }

        .mini-stat-card:nth-child(4) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34,38,110,.09);
        }

        .mini-stat-card:nth-child(5) {
          background: #fff0f2;
          box-shadow:
            7px 9px 0 #f2c2cc,
            0 18px 30px rgba(34,38,110,.09);
        }

        .mini-stat-card:hover {
          transform: translateY(-4px);
        }

        .mini-stat-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .mini-stat-card strong {
          display: block;
          margin-top: 10px;
          color: var(--gr-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 3vw, 43px);
          line-height: 1;
        }

        .grievance-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 22px;
          align-items: start;
          min-width: 0;
        }

        .grievance-page .panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .grievance-page .panel:hover {
          border-color: rgba(102,88,220,.28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34,38,110,.14);
        }

        .section-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .section-heading > div {
          min-width: 0;
          flex: 1 1 auto;
        }

        .section-heading > svg {
          width: 26px;
          height: 26px;
          padding: 4px;
          flex: 0 0 26px;
          margin-top: 0;
          margin-left: auto;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 8px;
          color: var(--gr-violet);
          background: rgba(255,255,255,.92);
          box-shadow: 2px 3px 0 rgba(52,43,120,.08);
          animation: grievance-icon-float 3.2s ease-in-out infinite;
        }

        .section-heading h2,
        .drawer-header h2 {
          margin: 0;
          color: var(--gr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .section-heading p {
          margin: 8px 0 0;
          color: var(--gr-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .profile-prefill-card {
          padding: 16px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 22px;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          box-shadow: 5px 6px 0 #c9c0ff;
          margin-bottom: 18px;
        }

        .profile-prefill-title {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 13px;
          color: #40348d;
          font-weight: 900;
        }

        .profile-prefill-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .profile-prefill-grid > div {
          min-width: 0;
          padding: 11px;
          border: 1px solid rgba(171,181,211,.42);
          border-radius: 15px;
          background: rgba(255,255,255,.84);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .profile-prefill-grid span,
        .ticket-meta-grid span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .profile-prefill-grid strong,
        .ticket-meta-grid strong {
          display: block;
          margin-top: 6px;
          color: var(--gr-ink);
          overflow-wrap: anywhere;
          font-size: 13px;
        }

        .modern-form {
          display: grid;
          gap: 15px;
        }

        .modern-form label {
          display: grid;
          gap: 8px;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .modern-form select,
        .modern-form input,
        .modern-form textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: 0;
          color: var(--gr-ink);
          background: rgba(255,255,255,.94);
          font: inherit;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .modern-form select,
        .modern-form input {
          min-height: 47px;
          padding: 0 13px;
        }

        .modern-form textarea {
          padding: 13px;
          resize: vertical;
        }

        .modern-form select:focus,
        .modern-form input:focus,
        .modern-form textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .form-row.two {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .checkbox-card {
          grid-template-columns: auto minmax(0, 1fr) auto !important;
          align-items: center;
          padding: 14px;
          border: 1px solid rgba(102,88,220,.22);
          border-radius: 18px;
          color: #40348d !important;
          background: linear-gradient(145deg, #f1efff, #eef9ff);
          box-shadow: 4px 5px 0 #c9c0ff;
          cursor: pointer;
        }

        .checkbox-card input {
          width: 19px;
          height: 19px;
          min-height: 0;
          accent-color: #6658dc;
        }

        .checkbox-card strong {
          display: block;
          color: var(--gr-ink);
          font-size: 13px;
        }

        .checkbox-card small {
          display: block;
          margin-top: 4px;
          color: var(--gr-copy);
          line-height: 1.45;
        }

        .filter-bar {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 9px;
          align-items: center;
          margin-bottom: 17px;
          padding: 12px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 20px;
          background: linear-gradient(145deg, #f8fbff, #f7f4ff);
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .filter-label {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #40348d;
          font-weight: 900;
        }

        .filter-bar select,
        .filter-bar input {
          width: 100%;
          min-height: 42px;
          padding: 0 11px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 13px;
          color: var(--gr-ink);
          background: #fff;
        }

        .ticket-list {
          display: grid;
          gap: 15px;
        }

        .ticket-card {
          padding: 17px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 5px 6px 0 rgba(52,43,120,.08);
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            border-color 190ms ease;
        }

        .ticket-card:nth-child(3n + 1) {
          background: linear-gradient(145deg, #edf6ff, #ffffff);
          box-shadow: 5px 6px 0 #b9d7ff;
        }

        .ticket-card:nth-child(3n + 2) {
          background: linear-gradient(145deg, #eaf8f4, #ffffff);
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .ticket-card:nth-child(3n + 3) {
          background: linear-gradient(145deg, #f1efff, #ffffff);
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .ticket-card:hover {
          transform: translateY(-3px);
          border-color: rgba(102,88,220,.28);
        }

        .ticket-topline {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .ticket-topline > div:first-child strong {
          display: block;
          color: #40348d;
          font-size: 12px;
        }

        .ticket-topline > div:first-child span {
          display: block;
          margin-top: 4px;
          color: var(--gr-copy);
          font-size: 11px;
        }

        .ticket-badges {
          display: flex;
          gap: 7px;
          flex-wrap: wrap;
        }

        .pill {
          display: inline-flex;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          text-transform: capitalize;
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
        }

        .pill.success {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .pill.danger {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .pill.warning {
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 2px 3px 0 #ffe0a5;
        }

        .pill.info {
          color: #245da8;
          background: #edf6ff;
          box-shadow: 2px 3px 0 #b9d7ff;
        }

        .pill.muted {
          color: #475569;
          background: #f1f5f9;
          box-shadow: 2px 3px 0 #dbe1e8;
        }

        .ticket-card h3 {
          margin: 14px 0 7px;
          color: var(--gr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 22px;
          font-weight: 760;
          letter-spacing: -.03em;
        }

        .ticket-card > p {
          margin: 0;
          color: var(--gr-copy);
          line-height: 1.58;
        }

        .ticket-meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 9px;
          margin-top: 14px;
        }

        .ticket-meta-grid > div {
          min-width: 0;
          padding: 11px;
          border: 1px solid rgba(171,181,211,.44);
          border-radius: 15px;
          background: rgba(255,255,255,.84);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .anonymous-note {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 13px;
          padding: 12px;
          border: 1px solid rgba(216,77,104,.24);
          border-radius: 16px;
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
          font-weight: 850;
        }

        .ticket-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 14px;
        }

        .grievance-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid rgba(171,181,211,.42);
          flex-wrap: wrap;
        }

        .grievance-pagination-info {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--gr-copy);
          font-size: 11px;
          font-weight: 800;
          flex-wrap: wrap;
        }

        .grievance-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }

        .grievance-page-size select {
          min-height: 36px;
          padding: 0 28px 0 9px;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 10px;
          color: #40348d;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .grievance-pagination-controls {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }

        .grievance-pagination-controls button {
          min-width: 38px;
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 11px;
          color: #40348d;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 170ms ease,
            background 170ms ease,
            color 170ms ease,
            opacity 170ms ease;
        }

        .grievance-pagination-controls button:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .grievance-pagination-controls button.is-active {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #5669d9);
        }

        .grievance-pagination-controls button:disabled {
          opacity: .45;
          cursor: not-allowed;
        }

        .empty-state {
          min-height: 220px;
          padding: 28px;
          display: grid;
          place-items: center;
          align-content: center;
          text-align: center;
          border: 1px dashed rgba(102,88,220,.34);
          border-radius: 20px;
          color: var(--gr-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .empty-state svg {
          margin-bottom: 10px;
          color: var(--gr-violet);
        }

        .empty-state p {
          margin: 0;
          font-weight: 800;
        }

        .drawer-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2200;
          display: flex;
          justify-content: flex-end;
          background: rgba(14,22,42,.56);
          backdrop-filter: blur(7px);
        }

        .side-drawer {
          width: min(520px, 100%);
          height: 100%;
          overflow-y: auto;
          padding: 24px;
          background: #fff;
          box-shadow: -18px 0 60px rgba(9,16,35,.22);
          animation: grievance-drawer-enter .22s ease-out;
        }

        .drawer-header {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          align-items: flex-start;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(171,181,211,.46);
        }

        .drawer-header .eyebrow {
          display: inline-flex;
          margin-bottom: 8px;
          padding: 7px 10px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 3px 4px 0 #18b5c8;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .09em;
        }

        .icon-btn {
          width: 40px;
          height: 40px;
          border: 1px solid rgba(102,88,220,.18);
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
          font-size: 22px;
        }

        .drawer-summary {
          margin: 18px 0;
          padding: 17px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 20px;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .drawer-summary > strong {
          color: #40348d;
          font-size: 12px;
        }

        .drawer-summary h3 {
          margin: 8px 0 6px;
          color: var(--gr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 22px;
          font-weight: 760;
        }

        .drawer-summary p {
          margin: 0;
          color: var(--gr-copy);
          line-height: 1.58;
        }

        .spin {
          animation: grievance-spin .85s linear infinite;
        }

        @keyframes grievance-refresh-idle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes grievance-icon-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        @keyframes grievance-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes grievance-drawer-enter {
          from { transform: translateX(30px); opacity: .75; }
          to { transform: translateX(0); opacity: 1; }
        }

        @media (max-width: 980px) {
          .grievance-hero {
            grid-template-columns: 1fr;
          }

          .grievance-hero-actions,
          .grievance-refresh-btn {
            width: 100%;
          }

          .grievance-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .profile-prefill-grid,
          .form-row.two {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 1180px) {
          .grievance-stats {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .grievance-grid {
            grid-template-columns: 1fr;
          }

          .filter-bar {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .filter-label {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 760px) {
          .grievance-page {
            gap: 18px;
          }

          .ticket-list {
            display: flex;
            gap: 14px;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            touch-action: pan-x pan-y;
            padding: 2px 2px 10px;
            scrollbar-width: none;
          }

          .ticket-list::-webkit-scrollbar {
            display: none;
          }

          .ticket-card {
            flex: 0 0 min(88%, 390px);
            scroll-snap-align: start;
            scroll-snap-stop: always;
          }

          .grievance-pagination {
            align-items: stretch;
          }

          .grievance-pagination-info {
            width: 100%;
          }

          .grievance-pagination-controls {
            width: 100%;
          }

          .grievance-pagination-controls button {
            flex: 1 1 38px;
          }

          .grievance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34,38,110,.10);
          }

          .grievance-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .grievance-refresh-btn {
            width: 100%;
          }

          .grievance-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .grievance-page .panel {
            padding: 18px;
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34,38,110,.09);
          }

          .form-row.two,
          .profile-prefill-grid,
          .ticket-meta-grid,
          .filter-bar {
            grid-template-columns: 1fr;
          }

          .filter-label {
            grid-column: auto;
          }

          .filter-bar .ghost-btn {
            width: 100%;
          }

          .ticket-topline {
            align-items: stretch;
            flex-direction: column;
          }

          .section-heading {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
          }

          .ticket-actions .ghost-btn {
            width: 100%;
          }

          .side-drawer {
            width: 100%;
            padding: 19px;
          }
        }

        @media (max-width: 560px) {
          .grievance-submit-btn {
            width: auto;
            max-width: 100%;
            min-height: 40px;
            padding: 8px 13px;
          }

          .grievance-section-toggle {
            grid-template-columns: 1fr;
          }

          .grievance-section-toggle button {
            width: 100%;
          }

          .grievance-stats {
            grid-template-columns: 1fr;
          }

          .ticket-badges {
            width: 100%;
          }

          .pill {
            max-width: 100%;
            white-space: normal;
            text-align: center;
          }

          .side-drawer {
            width: 100%;
            max-width: 100%;
            padding: 16px;
          }
        }

        @media (max-width: 430px) {
          .grievance-hero {
            padding: 16px;
          }

          .grievance-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .grievance-stats {
            grid-template-columns: 1fr;
          }

          .grievance-page .panel {
            padding: 15px;
          }

          .checkbox-card {
            grid-template-columns: auto minmax(0, 1fr) !important;
          }

          .checkbox-card > svg {
            grid-column: 2;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .grievance-page *,
          .grievance-page *::before,
          .grievance-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      <section className="grievance-hero">
        <div>
          <span className="eyebrow grievance-eyebrow">
            <Sparkles size={13} />
            Employee Support Desk
          </span>
          <h1>
            Grievances, <em>handled with clarity.</em>
          </h1>
          <p>
            Submit workplace grievances with proper tracking. Use anonymous mode
            when identity should be hidden from the HR review panel.
          </p>
        </div>

        <div className="grievance-hero-actions">
          <button type="button" className="ghost-btn grievance-refresh-btn" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
            <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      <section className="grievance-stats">
        <div className="mini-stat-card">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Pending</span>
          <strong>{stats.pending}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Under Review</span>
          <strong>{stats.underReview}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Resolved</span>
          <strong>{stats.resolved}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Anonymous</span>
          <strong>{stats.anonymous}</strong>
        </div>
      </section>

      <div className="grievance-section-toggle" role="tablist" aria-label="Grievance sections">
        <button
          type="button"
          className={activeSection === 'raise' ? 'is-active' : ''}
          onClick={() => setActiveSection('raise')}
          role="tab"
          aria-selected={activeSection === 'raise'}
        >
          <MessageSquare size={17} />
          Raise a Grievance
        </button>

        <button
          type="button"
          className={activeSection === 'list' ? 'is-active' : ''}
          onClick={() => {
            setActiveSection('list');
            setCurrentPage(1);
          }}
          role="tab"
          aria-selected={activeSection === 'list'}
        >
          <FileText size={17} />
          {canManage ? 'HR Grievance Inbox' : 'My Grievances'}
        </button>
      </div>

      <div className="grievance-grid">
        {activeSection === 'raise' ? (
        <section className="panel grievance-form-panel grievance-toggle-panel">
          <div className="section-heading">
            <div>
              <span className="grievance-section-kicker">New Submission</span>
              <h2>Raise a Grievance</h2>
              <p>Your employee details are pre-filled automatically.</p>
            </div>
          </div>

          <div className="profile-prefill-card">
            <div className="profile-prefill-title">
              <UserRound size={18} />
              <span>Prefilled Employee Details</span>
            </div>

            <div className="profile-prefill-grid">
              {profileRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value || '—'}</strong>
                </div>
              ))}
            </div>
          </div>

          <form className="modern-form" onSubmit={handleSubmit}>
            <div className="form-row two">
              <label>
                <span>Grievance Type</span>
                <select
                  value={form.grievance_type}
                  onChange={(event) => updateForm('grievance_type', event.target.value)}
                >
                  {options.types.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Priority</span>
                <select
                  value={form.priority}
                  onChange={(event) => updateForm('priority', event.target.value)}
                >
                  {options.priorities.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>Subject</span>
              <input
                type="text"
                value={form.subject}
                onChange={(event) => updateForm('subject', event.target.value)}
                placeholder="Briefly describe the issue"
              />
            </label>

            <label>
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                placeholder="Write the full grievance details"
                rows={6}
              />
            </label>

            <label className="checkbox-card">
              <input
                type="checkbox"
                checked={form.is_anonymous}
                onChange={(event) => updateForm('is_anonymous', event.target.checked)}
              />
              <span>
                <strong>Submit anonymously</strong>
                <small>
                  HR will receive this grievance, but your identity will be hidden in
                  the review panel.
                </small>
              </span>
              <EyeOff size={18} />
            </label>

            <button type="submit" className="primary grievance-submit-btn" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              Submit Grievance
            </button>
          </form>
        </section>
        ) : null}

        {activeSection === 'list' ? (
        <section className="panel grievance-list-panel grievance-toggle-panel">
          <div className="section-heading">
            <div>
              <span className="grievance-section-kicker">
                {canManage ? 'HR Review Queue' : 'My Request History'}
              </span>
              <h2>{canManage ? 'HR Grievance Inbox' : 'My Grievances'}</h2>
              <p>
                {canManage
                  ? 'Review employee grievances and update their resolution status.'
                  : 'Track the status of grievances submitted by you.'}
              </p>
            </div>
          </div>

          {canManage ? (
            <div className="filter-bar">
              <div className="filter-label">
                <Filter size={16} />
                <span>Filters</span>
              </div>

              <select
                value={filters.status}
                onChange={(event) => updateFilter('status', event.target.value)}
              >
                <option value="">All Status</option>
                {options.statuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.priority}
                onChange={(event) => updateFilter('priority', event.target.value)}
              >
                <option value="">All Priority</option>
                {options.priorities.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.grievance_type}
                onChange={(event) => updateFilter('grievance_type', event.target.value)}
              >
                <option value="">All Types</option>
                {options.types.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>

              <input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="Search..."
              />

              <button type="button" className="ghost-btn" onClick={loadManageList}>
                Apply
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading grievances...</p>
            </div>
          ) : visibleItems.length ? (
            <>
              <div className="ticket-list">
                {paginatedItems.map((item) => (
                <article key={item._id || item.id || item.ticket_no} className="ticket-card">
                  <div className="ticket-topline">
                    <div>
                      <strong>{item.ticket_no || 'GRV'}</strong>
                      <span>{formatDate(item.created_at)}</span>
                    </div>

                    <div className="ticket-badges">
                      <span className={`pill ${statusClass(item.status)}`}>
                        {item.status_label || optionLabel(options.statuses, item.status)}
                      </span>
                      <span className={`pill ${priorityClass(item.priority)}`}>
                        {item.priority_label || optionLabel(options.priorities, item.priority)}
                      </span>
                    </div>
                  </div>

                  <h3>{item.subject}</h3>
                  <p>{item.description}</p>

                  <div className="ticket-meta-grid">
                    <div>
                      <span>Type</span>
                      <strong>
                        {item.grievance_type_label ||
                          optionLabel(options.types, item.grievance_type)}
                      </strong>
                    </div>

                    <div>
                      <span>Employee</span>
                      <strong>
                        {item.is_anonymous ? 'Anonymous Employee' : item.employee_name || '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Department</span>
                      <strong>
                        {item.is_anonymous ? 'Hidden' : item.department || item.employee_snapshot?.department || '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Remarks</span>
                      <strong>{item.hr_remarks || item.resolution_note || '—'}</strong>
                    </div>
                  </div>

                  {item.is_anonymous ? (
                    <div className="anonymous-note">
                      <ShieldAlert size={16} />
                      Identity hidden due to anonymous submission.
                    </div>
                  ) : null}

                  {canManage ? (
                    <div className="ticket-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => openStatusPanel(item)}
                      >
                        Update Status
                      </button>
                    </div>
                  ) : null}
                </article>
                ))}
              </div>

              {visibleItems.length > itemsPerPage ? (
              <div className="grievance-pagination" aria-label="Grievance pagination">
                <div className="grievance-pagination-info">
                  <span>
                    Showing {(currentPage - 1) * itemsPerPage + 1}
                    {' - '}
                    {Math.min(currentPage * itemsPerPage, visibleItems.length)}
                    {' of '}
                    {visibleItems.length}
                  </span>

                  <label className="grievance-page-size">
                    <span>Per page</span>
                    <select
                      value={itemsPerPage}
                      onChange={(event) => {
                        setItemsPerPage(Number(event.target.value));
                        setCurrentPage(1);
                      }}
                      aria-label="Grievances per page"
                    >
                      {[6, 10, 20, 50].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grievance-pagination-controls">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage <= 1}
                  >
                    Previous
                  </button>

                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={currentPage === page ? 'is-active' : ''}
                      onClick={() => setCurrentPage(page)}
                      aria-current={currentPage === page ? 'page' : undefined}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <MessageSquare size={30} />
              <p>No grievance records found.</p>
            </div>
          )}
        </section>
        ) : null}
      </div>

      {canManage && selectedGrievance ? (
        <div className="drawer-backdrop" onClick={() => setSelectedGrievance(null)}>
          <aside className="side-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="eyebrow">HR Action</span>
                <h2>Update Grievance</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedGrievance(null)}
              >
                ×
              </button>
            </div>

            <div className="drawer-summary">
              <strong>{selectedGrievance.ticket_no}</strong>
              <h3>{selectedGrievance.subject}</h3>
              <p>{selectedGrievance.description}</p>
            </div>

            <form className="modern-form" onSubmit={handleStatusUpdate}>
              <label>
                <span>Status</span>
                <select
                  value={statusForm.status}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                >
                  {options.statuses.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>HR Remarks</span>
                <textarea
                  value={statusForm.hr_remarks}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      hr_remarks: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Internal or visible HR remarks"
                />
              </label>

              <label>
                <span>Resolution Note</span>
                <textarea
                  value={statusForm.resolution_note}
                  onChange={(event) =>
                    setStatusForm((prev) => ({
                      ...prev,
                      resolution_note: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Final resolution note"
                />
              </label>

              <button type="submit" className="primary" disabled={statusSaving}>
                {statusSaving ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
                Save Update
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}