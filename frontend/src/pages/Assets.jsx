import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VERIFICATION_STATUSES,
  createAsset,
  deleteAsset,
  exportAssetReportCsv,
  getAssetConditionLabel,
  getAssetEmployeeOptions,
  getAssetReport,
  getAssetStatusLabel,
  getAssetTypeLabel,
  getAssetVerificationStatusLabel,
  getAssets,
  updateAsset,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const EMPTY_FORM = {
  assigned_to_employee_id: '',
  asset_type: 'hardware',
  asset_name: '',
  category: '',
  brand: '',
  model: '',
  license_key: '',
  license_email: '',
  purchase_date: '',
  warranty_expiry: '',
  license_expiry: '',
  status: 'assigned',
  condition: 'good',
  verification_status: 'verified',
  remarks: '',
  rejection_reason: '',
};

const FILTERS = {
  q: '',
  asset_type: '',
  status: '',
  verification_status: '',
  employee_id: '',
};

function formatDate(value) {
  if (!value) return '—';

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }

    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value).slice(0, 10);
  }
}

function valueOrDash(value) {
  return value ? value : '—';
}

function downloadTextFile(filename, content, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function buildDateStamp() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function statusClass(value = '') {
  const key = String(value || '').toLowerCase();

  if (key === 'verified') return 'asset-pill asset-pill--success';
  if (key === 'pending') return 'asset-pill asset-pill--warning';
  if (key === 'rejected') return 'asset-pill asset-pill--danger';
  if (key === 'returned') return 'asset-pill asset-pill--neutral';
  if (key === 'lost' || key === 'damaged' || key === 'expired') return 'asset-pill asset-pill--danger';
  if (key === 'available') return 'asset-pill asset-pill--info';

  return 'asset-pill asset-pill--primary';
}

function getAssetIdentifier(asset) {
  if (!asset) return '—';

  if (asset.asset_type === 'software') {
    return asset.license_email || asset.license_key || '—';
  }

  return asset.model || asset.brand || asset.category || '—';
}

function getAssetExpiry(asset) {
  if (!asset) return '—';

  if (asset.asset_type === 'software') {
    return asset.license_expiry || '—';
  }

  return asset.warranty_expiry || '—';
}

export default function Assets() {
  const alerts = useCustomAlert();
  const [assets, setAssets] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    hardware: 0,
    software: 0,
    assigned: 0,
    available: 0,
    pending: 0,
    verified: 0,
  });

  const [filters, setFilters] = useState(FILTERS);
  const [employees, setEmployees] = useState([]);
  const [reportRows, setReportRows] = useState([]);
  const [reportSummary, setReportSummary] = useState({
    employee_count: 0,
    asset_count: 0,
    hardware_count: 0,
    software_count: 0,
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingAssetId, setEditingAssetId] = useState('');
  const [activeTab, setActiveTab] = useState('assets');

  const [canManage, setCanManage] = useState(false);
  const [canReport, setCanReport] = useState(false);

  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const isSoftware = form.asset_type === 'software';
  const isEditing = Boolean(editingAssetId);

  const selectedEmployee = useMemo(() => {
    if (!form.assigned_to_employee_id) return null;

    return employees.find((employee) => employee.id === form.assigned_to_employee_id) || null;
  }, [employees, form.assigned_to_employee_id]);

  const filteredReportRows = useMemo(() => reportRows, [reportRows]);

  const loadEmployees = useCallback(async () => {
    try {
      const data = await getAssetEmployeeOptions();
      setEmployees(data.items || []);
    } catch {
      setEmployees([]);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    setLoading(true);

    try {
      const data = await getAssets({
        ...filters,
        page: 1,
        limit: 200,
      });

      setAssets(data.items || []);
      setStats(data.stats || {});
      setCanManage(Boolean(data.can_manage));
      setCanReport(Boolean(data.can_report));

      if (data.can_manage || data.can_report) {
        loadEmployees();
      }
    } catch (error) {
      alerts.error(error?.message || 'Unable to load assets', 'Assets Load Failed');
    } finally {
      setLoading(false);
    }
  }, [filters, loadEmployees, alerts]);

  const loadReport = useCallback(async () => {
    if (!canReport) return;

    setReportLoading(true);

    try {
      const data = await getAssetReport({
        asset_type: filters.asset_type,
        status: filters.status,
        verification_status: filters.verification_status,
        employee_id: filters.employee_id,
      });

      setReportRows(data.items || []);
      setReportSummary(data.summary || {});
    } catch (error) {
      alerts.error(error?.message || 'Unable to load asset report', 'Asset Report Load Failed');
    } finally {
      setReportLoading(false);
    }
  }, [
    canReport,
    filters.asset_type,
    filters.employee_id,
    filters.status,
    filters.verification_status,
    alerts,
  ]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (activeTab === 'report' && canReport) {
      loadReport();
    }
  }, [activeTab, canReport, loadReport]);

  function updateFilter(name, value) {
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function updateForm(name, value) {
    setForm((prev) => {
      const next = {
        ...prev,
        [name]: value,
      };

      if (name === 'asset_type') {
        if (value === 'software') {
          next.condition = 'not_applicable';
          next.status = prev.status || 'assigned';
        } else {
          next.condition = prev.condition === 'not_applicable' ? 'good' : prev.condition;
        }
      }

      return next;
    });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingAssetId('');
  }

  function validateForm() {
    if (canManage && !form.assigned_to_employee_id) {
      return 'Please select employee';
    }

    if (!form.asset_name.trim()) {
      return 'Asset name is required';
    }

    if (form.asset_type === 'software') {
      if (!form.license_key.trim() && !form.license_email.trim()) {
        return 'For software, enter License Key or License Email';
      }
    }

    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationError = validateForm();

    if (validationError) {
      alerts.warning(validationError, 'Asset Details Required');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        ...form,
      };

      if (!canManage) {
        delete payload.assigned_to_employee_id;
        delete payload.verification_status;
        delete payload.rejection_reason;
      }

      if (isEditing) {
        await updateAsset(editingAssetId, payload);
        alerts.success('Asset updated successfully', 'Asset Updated');
      } else {
        await createAsset(payload);
        alerts.success(
          canManage
            ? 'Asset saved and verified successfully'
            : 'Asset submitted successfully. HR will verify it.',
          canManage ? 'Asset Saved' : 'Asset Submitted',
        );
      }

      resetForm();
      await loadAssets();

      if (activeTab === 'report' && canReport) {
        await loadReport();
      }
    } catch (error) {
      alerts.error(error?.message || 'Unable to save asset', 'Asset Save Failed');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(asset) {
    if (!canManage) return;

    setEditingAssetId(asset.id || asset._id);

    setForm({
      assigned_to_employee_id: asset.assigned_to_employee_id || '',
      asset_type: asset.asset_type || 'hardware',
      asset_name: asset.asset_name || '',
      category: asset.category || '',
      brand: asset.brand || '',
      model: asset.model || '',
      license_key: asset.license_key || '',
      license_email: asset.license_email || '',
      purchase_date: asset.purchase_date ? String(asset.purchase_date).slice(0, 10) : '',
      warranty_expiry: asset.warranty_expiry ? String(asset.warranty_expiry).slice(0, 10) : '',
      license_expiry: asset.license_expiry ? String(asset.license_expiry).slice(0, 10) : '',
      status: asset.status || 'assigned',
      condition: asset.condition || 'good',
      verification_status: asset.verification_status || 'verified',
      remarks: asset.remarks || '',
      rejection_reason: asset.rejection_reason || '',
    });

    setActiveTab('assets');

    window.requestAnimationFrame(() => {
      document.getElementById('asset-form-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  async function handleDelete(asset) {
    if (!canManage) return;

    const assetId = asset.id || asset._id;

    if (!assetId) {
      alerts.warning('Invalid asset selected.', 'Asset Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete asset "${asset.asset_name}" assigned to ${asset.assigned_to_name || 'this employee'}?`,
      'Delete Asset?',
    );

    if (!confirmed) return;

    setDeletingId(assetId);

    try {
      await deleteAsset(assetId);
      alerts.success('Asset deleted successfully', 'Asset Deleted');
      await loadAssets();

      if (activeTab === 'report' && canReport) {
        await loadReport();
      }
    } catch (error) {
      alerts.error(error?.message || 'Unable to delete asset', 'Asset Delete Failed');
    } finally {
      setDeletingId('');
    }
  }

  function handleExportCsv() {
    if (!reportRows.length) {
      alerts.warning('No report data available to export', 'Export Not Available');
      return;
    }

    const csv = exportAssetReportCsv(reportRows);
    downloadTextFile(`asset-report-${buildDateStamp()}.csv`, csv);
    alerts.success('Asset report CSV exported successfully.', 'Export Ready');
  }

  return (
    <div className="asset-page">
      <style>
        {`
          .asset-page {
            min-height: 100%;
            width: 100%;
            min-width: 0;
            padding: clamp(14px, 2vw, 28px);
            overflow-x: hidden;
            background:
              radial-gradient(circle at top left, rgba(79, 70, 229, 0.13), transparent 32%),
              radial-gradient(circle at top right, rgba(16, 185, 129, 0.11), transparent 30%),
              linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
            color: #0f172a;
          }

          .asset-page,
          .asset-page * {
            box-sizing: border-box;
          }

          .asset-page button,
          .asset-page input,
          .asset-page select,
          .asset-page textarea {
            font: inherit;
          }

          .asset-page input,
          .asset-page select,
          .asset-page textarea {
            max-width: 100%;
          }

          .asset-shell {
            width: 100%;
            max-width: 1680px;
            min-width: 0;
            margin: 0 auto;
          }

          @keyframes assetFadeUp {
            from {
              opacity: 0;
              transform: translateY(14px);
            }

            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes assetSoftGlow {
            0%,
            100% {
              box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
            }

            50% {
              box-shadow: 0 24px 70px rgba(79, 70, 229, 0.14);
            }
          }

          .asset-hero,
          .asset-stats,
          .asset-tabs,
          .asset-grid,
          .asset-card {
            animation: assetFadeUp 0.28s ease both;
          }

          .asset-hero {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.6fr);
            gap: clamp(14px, 1.6vw, 20px);
            align-items: stretch;
            margin-bottom: clamp(14px, 1.6vw, 20px);
            min-width: 0;
          }

          .asset-hero-main,
          .asset-hero-side,
          .asset-card {
            min-width: 0;
            border: 1px solid rgba(226, 232, 240, 0.95);
            background: rgba(255, 255, 255, 0.94);
            border-radius: clamp(20px, 1.8vw, 28px);
            box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
            backdrop-filter: blur(16px);
          }

          .asset-hero-main {
            padding: clamp(20px, 2.2vw, 32px);
            position: relative;
            overflow: hidden;
          }

          .asset-hero-main::before {
            content: "";
            position: absolute;
            inset: 0;
            background:
              linear-gradient(135deg, rgba(79, 70, 229, 0.06), transparent 42%),
              radial-gradient(circle at 96% 12%, rgba(14, 165, 233, 0.14), transparent 28%);
            pointer-events: none;
          }

          .asset-hero-main::after {
            content: "";
            position: absolute;
            width: clamp(150px, 18vw, 240px);
            height: clamp(150px, 18vw, 240px);
            border-radius: 999px;
            right: -82px;
            top: -82px;
            background: linear-gradient(135deg, rgba(79, 70, 229, 0.20), rgba(16, 185, 129, 0.16));
            filter: blur(1px);
          }

          .asset-hero-main > * {
            position: relative;
            z-index: 1;
          }

          .asset-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 999px;
            background: #eef2ff;
            color: #4338ca;
            font-size: 12px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 14px;
          }

          .asset-hero h1 {
            margin: 0;
            max-width: 920px;
            font-size: clamp(28px, 3.2vw, 48px);
            line-height: 1.04;
            letter-spacing: -0.05em;
            color: #0f172a;
            overflow-wrap: anywhere;
          }

          .asset-hero p {
            margin: 12px 0 0;
            color: #64748b;
            font-size: clamp(14px, 1vw, 16px);
            max-width: 840px;
            line-height: 1.7;
          }

          .asset-hero-side {
            padding: clamp(16px, 1.5vw, 22px);
            display: grid;
            gap: 12px;
          }

          .asset-quick-role {
            border-radius: 20px;
            padding: 18px;
            background:
              radial-gradient(circle at top right, rgba(99, 102, 241, 0.36), transparent 34%),
              linear-gradient(135deg, #0f172a, #334155);
            color: #fff;
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.16);
          }

          .asset-quick-role span {
            display: block;
            color: rgba(255, 255, 255, 0.72);
            font-size: 12px;
            margin-bottom: 6px;
          }

          .asset-quick-role strong {
            display: block;
            font-size: clamp(16px, 1.2vw, 20px);
            line-height: 1.25;
          }

          .asset-quick-note {
            padding: 14px;
            border-radius: 18px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #475569;
            font-size: 13px;
            line-height: 1.6;
          }

          .asset-stats {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: clamp(10px, 1.3vw, 16px);
            margin-bottom: clamp(14px, 1.6vw, 20px);
            min-width: 0;
          }

          .asset-stat {
            position: relative;
            min-width: 0;
            overflow: hidden;
            border-radius: clamp(18px, 1.5vw, 24px);
            padding: clamp(16px, 1.5vw, 22px);
            border: 1px solid rgba(226, 232, 240, 0.95);
            background: rgba(255, 255, 255, 0.94);
            box-shadow: 0 14px 36px rgba(15, 23, 42, 0.07);
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          }

          .asset-stat:hover {
            transform: translateY(-2px);
            border-color: rgba(99, 102, 241, 0.36);
            box-shadow: 0 22px 52px rgba(15, 23, 42, 0.11);
          }

          .asset-stat::before {
            content: "";
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at top right, rgba(79, 70, 229, 0.14), transparent 42%);
            pointer-events: none;
          }

          .asset-stat span {
            position: relative;
            display: block;
            color: #64748b;
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .asset-stat strong {
            position: relative;
            display: block;
            margin-top: 10px;
            color: #0f172a;
            font-size: clamp(26px, 2vw, 36px);
            line-height: 1;
            letter-spacing: -0.05em;
          }

          .asset-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: clamp(14px, 1.4vw, 18px);
          }

          .asset-tab {
            min-height: 46px;
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #334155;
            border-radius: 999px;
            padding: 11px 18px;
            font-weight: 900;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            white-space: nowrap;
          }

          .asset-tab:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
          }

          .asset-tab.active {
            background: linear-gradient(135deg, #4f46e5, #2563eb);
            border-color: transparent;
            color: #fff;
            box-shadow: 0 12px 30px rgba(79, 70, 229, 0.24);
          }

          .asset-grid {
            display: grid;
            grid-template-columns: minmax(360px, 0.42fr) minmax(0, 0.58fr);
            gap: clamp(14px, 1.6vw, 20px);
            align-items: start;
            min-width: 0;
          }

          .asset-card {
            padding: clamp(16px, 1.6vw, 24px);
            overflow: hidden;
          }

          .asset-card-header {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            margin-bottom: 16px;
            min-width: 0;
          }

          .asset-card-title {
            margin: 0;
            color: #0f172a;
            font-size: clamp(20px, 1.55vw, 26px);
            line-height: 1.15;
            letter-spacing: -0.04em;
            overflow-wrap: anywhere;
          }

          .asset-card-subtitle {
            margin: 7px 0 0;
            color: #64748b;
            font-size: 14px;
            line-height: 1.55;
          }

          .asset-form {
            display: grid;
            gap: 14px;
            min-width: 0;
          }

          .asset-field-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            min-width: 0;
          }

          .asset-field {
            display: grid;
            gap: 7px;
            min-width: 0;
          }

          .asset-field label {
            color: #334155;
            font-size: 12px;
            font-weight: 950;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .asset-field input,
          .asset-field select,
          .asset-field textarea {
            width: 100%;
            min-width: 0;
            min-height: 48px;
            border: 1px solid #dbe4ef;
            border-radius: 16px;
            background: #fff;
            color: #0f172a;
            padding: 12px 14px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          }

          .asset-field textarea {
            min-height: 92px;
            resize: vertical;
            line-height: 1.5;
          }

          .asset-field input:focus,
          .asset-field select:focus,
          .asset-field textarea:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
            background: #fff;
          }

          .asset-selected-employee {
            display: grid;
            grid-template-columns: 44px minmax(0, 1fr);
            gap: 12px;
            align-items: center;
            padding: 12px;
            border-radius: 18px;
            border: 1px solid #dbeafe;
            background: linear-gradient(135deg, #eff6ff, #ffffff);
            color: #1e3a8a;
          }

          .asset-avatar {
            width: 44px;
            height: 44px;
            border-radius: 16px;
            display: grid;
            place-items: center;
            background: linear-gradient(135deg, #4f46e5, #06b6d4);
            color: #fff;
            font-weight: 950;
          }

          .asset-selected-employee strong {
            display: block;
            font-size: 14px;
            overflow-wrap: anywhere;
          }

          .asset-selected-employee span {
            display: block;
            margin-top: 3px;
            font-size: 12px;
            color: #475569;
            overflow-wrap: anywhere;
          }

          .asset-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
            min-width: 0;
          }

          .asset-btn {
            min-height: 44px;
            border: 0;
            border-radius: 15px;
            padding: 12px 16px;
            font-weight: 950;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            text-align: center;
          }

          .asset-btn:disabled {
            opacity: 0.65;
            cursor: not-allowed;
          }

          .asset-btn-primary {
            background: linear-gradient(135deg, #4f46e5, #2563eb);
            color: #fff;
            box-shadow: 0 14px 30px rgba(79, 70, 229, 0.24);
          }

          .asset-btn-secondary {
            background: #f1f5f9;
            color: #334155;
          }

          .asset-btn-danger {
            background: #fee2e2;
            color: #b91c1c;
          }

          .asset-btn-success {
            background: #dcfce7;
            color: #166534;
          }

          .asset-btn:hover:not(:disabled) {
            transform: translateY(-1px);
          }

          .asset-filter-bar {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
            gap: 10px;
            margin-bottom: 14px;
            min-width: 0;
          }

          .asset-filter-bar input:first-child {
            grid-column: span 2;
          }

          .asset-filter-bar input,
          .asset-filter-bar select {
            width: 100%;
            min-width: 0;
            min-height: 46px;
            border: 1px solid #dbe4ef;
            border-radius: 15px;
            padding: 11px 12px;
            outline: none;
            background: #fff;
            color: #0f172a;
          }

          .asset-filter-bar input:focus,
          .asset-filter-bar select:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
          }

          .asset-list {
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .asset-item {
            min-width: 0;
            border: 1px solid #e2e8f0;
            border-radius: 22px;
            padding: 16px;
            background: #fff;
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          }

          .asset-item:hover {
            transform: translateY(-1px);
            border-color: rgba(99, 102, 241, 0.28);
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
          }

          .asset-item-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
            min-width: 0;
          }

          .asset-item-title {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            min-width: 0;
          }

          .asset-item-title h3 {
            margin: 0;
            color: #0f172a;
            font-size: 17px;
            letter-spacing: -0.02em;
            overflow-wrap: anywhere;
          }

          .asset-meta {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            color: #64748b;
            font-size: 12px;
          }

          .asset-meta span {
            max-width: 100%;
            padding: 6px 9px;
            border-radius: 999px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            overflow-wrap: anywhere;
          }

          .asset-detail-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 145px), 1fr));
            gap: 10px;
            margin-top: 14px;
            min-width: 0;
          }

          .asset-detail {
            border-radius: 15px;
            padding: 11px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            min-width: 0;
          }

          .asset-detail span {
            display: block;
            color: #64748b;
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 950;
            letter-spacing: 0.06em;
            margin-bottom: 5px;
          }

          .asset-detail strong {
            display: block;
            color: #0f172a;
            font-size: 13px;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .asset-pill {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 950;
            white-space: nowrap;
          }

          .asset-pill--primary {
            background: #eef2ff;
            color: #4338ca;
          }

          .asset-pill--success {
            background: #dcfce7;
            color: #166534;
          }

          .asset-pill--warning {
            background: #fef3c7;
            color: #92400e;
          }

          .asset-pill--danger {
            background: #fee2e2;
            color: #b91c1c;
          }

          .asset-pill--neutral {
            background: #f1f5f9;
            color: #475569;
          }

          .asset-pill--info {
            background: #e0f2fe;
            color: #0369a1;
          }

          .asset-empty,
          .asset-loading {
            border: 1px dashed #cbd5e1;
            border-radius: 20px;
            padding: 28px;
            text-align: center;
            color: #64748b;
            background: #f8fafc;
          }

          .asset-message {
            margin-bottom: 16px;
            border-radius: 16px;
            padding: 13px 15px;
            font-weight: 900;
          }

          .asset-message.success {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #bbf7d0;
          }

          .asset-message.error {
            background: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fecaca;
          }

          .asset-report-toolbar {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: center;
            margin-bottom: 14px;
            min-width: 0;
          }

          .asset-report-summary {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 16px;
          }

          .asset-report-summary-card {
            min-width: 0;
            border-radius: 18px;
            padding: 14px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
          }

          .asset-report-summary-card span {
            display: block;
            color: #64748b;
            font-size: 11px;
            font-weight: 950;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }

          .asset-report-summary-card strong {
            display: block;
            margin-top: 8px;
            font-size: 22px;
            color: #0f172a;
          }

          .asset-report-table-wrap {
            width: 100%;
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            border-radius: 18px;
            border: 1px solid #e2e8f0;
            background: #fff;
          }

          .asset-report-table {
            width: 100%;
            border-collapse: collapse;
            min-width: 980px;
          }

          .asset-report-table th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: #f8fafc;
            color: #334155;
            text-align: left;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            padding: 12px;
            border-bottom: 1px solid #e2e8f0;
          }

          .asset-report-table td {
            padding: 12px;
            border-bottom: 1px solid #e2e8f0;
            color: #334155;
            font-size: 13px;
            vertical-align: top;
          }

          .asset-report-table tr:last-child td {
            border-bottom: 0;
          }

          .asset-report-assets {
            display: grid;
            gap: 6px;
          }

          .asset-report-asset {
            padding: 8px;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
          }

          .asset-report-asset strong {
            display: block;
            color: #0f172a;
            margin-bottom: 4px;
            overflow-wrap: anywhere;
          }

          .asset-report-asset span {
            color: #64748b;
            font-size: 12px;
            overflow-wrap: anywhere;
          }

          @media (min-width: 1700px) {
            .asset-shell {
              max-width: 1760px;
            }

            .asset-grid {
              grid-template-columns: minmax(420px, 0.40fr) minmax(0, 0.60fr);
            }
          }

          @media (max-width: 1440px) {
            .asset-stats {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }

            .asset-filter-bar {
              grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
            }
          }

          @media (max-width: 1280px) {
            .asset-hero,
            .asset-grid {
              grid-template-columns: 1fr;
            }

            .asset-hero-side {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 1024px) {
            .asset-page {
              padding: 16px;
            }

            .asset-stats {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .asset-report-summary {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .asset-card-header,
            .asset-report-toolbar {
              flex-direction: column;
              align-items: stretch;
            }

            .asset-report-toolbar .asset-actions {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 760px) {
            .asset-page {
              padding: 12px;
            }

            .asset-hero-main,
            .asset-hero-side,
            .asset-card {
              border-radius: 20px;
              padding: 16px;
            }

            .asset-hero-side,
            .asset-field-grid,
            .asset-filter-bar,
            .asset-detail-grid,
            .asset-report-summary {
              grid-template-columns: 1fr;
            }

            .asset-filter-bar input:first-child {
              grid-column: 1 / -1;
            }

            .asset-stats {
              grid-template-columns: 1fr 1fr;
              gap: 10px;
            }

            .asset-stat {
              padding: 14px;
              border-radius: 18px;
            }

            .asset-stat span {
              font-size: 10.5px;
            }

            .asset-stat strong {
              font-size: 25px;
            }

            .asset-tabs {
              display: grid;
              grid-template-columns: 1fr;
            }

            .asset-tab {
              width: 100%;
            }

            .asset-item-head {
              flex-direction: column;
              align-items: stretch;
            }

            .asset-actions {
              width: 100%;
              display: grid;
              grid-template-columns: 1fr;
            }

            .asset-btn {
              width: 100%;
            }

            .asset-selected-employee {
              grid-template-columns: 40px minmax(0, 1fr);
            }

            .asset-avatar {
              width: 40px;
              height: 40px;
            }
          }

          @media (max-width: 480px) {
            .asset-page {
              padding: 10px;
            }

            .asset-hero h1 {
              font-size: 26px;
            }

            .asset-stats {
              grid-template-columns: 1fr;
            }

            .asset-stat {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
            }

            .asset-stat strong {
              margin-top: 0;
            }

            .asset-quick-role,
            .asset-quick-note,
            .asset-item,
            .asset-empty,
            .asset-loading {
              border-radius: 16px;
            }

            .asset-field input,
            .asset-field select,
            .asset-field textarea,
            .asset-filter-bar input,
            .asset-filter-bar select {
              min-height: 46px;
              border-radius: 14px;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .asset-hero,
            .asset-stats,
            .asset-tabs,
            .asset-grid,
            .asset-card,
            .asset-stat,
            .asset-item,
            .asset-tab,
            .asset-btn {
              animation: none !important;
              transition-duration: 0.001ms !important;
            }
          }
        `}
      </style>

      <div className="asset-shell">
        <section className="asset-hero">
          <div className="asset-hero-main">
            <span className="asset-eyebrow">Asset Management</span>
            <h1>Hardware and software asset tracking</h1>
            <p>
              Employees can submit their own assigned assets. HR/Admin can add, verify,
              update and generate employee-wise asset allocation reports.
            </p>
          </div>

          <aside className="asset-hero-side">
            <div className="asset-quick-role">
              <span>Your access</span>
              <strong>{canManage ? 'HR/Admin Asset Control' : 'Employee Asset Submission'}</strong>
            </div>

            <div className="asset-quick-note">
              {canManage
                ? 'You can assign assets to employees, verify submitted records, maintain status and export reports.'
                : 'You can submit your own hardware/software asset details. HR will verify your submission.'}
            </div>
          </aside>
        </section>

        <section className="asset-stats">
          <div className="asset-stat">
            <span>Total Assets</span>
            <strong>{stats.total || 0}</strong>
          </div>
          <div className="asset-stat">
            <span>Hardware</span>
            <strong>{stats.hardware || 0}</strong>
          </div>
          <div className="asset-stat">
            <span>Software</span>
            <strong>{stats.software || 0}</strong>
          </div>
          <div className="asset-stat">
            <span>Assigned</span>
            <strong>{stats.assigned || 0}</strong>
          </div>
          <div className="asset-stat">
            <span>Pending</span>
            <strong>{stats.pending || 0}</strong>
          </div>
          <div className="asset-stat">
            <span>Verified</span>
            <strong>{stats.verified || 0}</strong>
          </div>
        </section>

        <section className="asset-tabs">
          <button
            type="button"
            className={`asset-tab ${activeTab === 'assets' ? 'active' : ''}`}
            onClick={() => setActiveTab('assets')}
          >
            Assets
          </button>

          {canReport ? (
            <button
              type="button"
              className={`asset-tab ${activeTab === 'report' ? 'active' : ''}`}
              onClick={() => setActiveTab('report')}
            >
              Employee-wise Report
            </button>
          ) : null}
        </section>

        {activeTab === 'assets' ? (
          <section className="asset-grid">
            <div className="asset-card" id="asset-form-card">
              <div className="asset-card-header">
                <div>
                  <h2 className="asset-card-title">
                    {isEditing ? 'Update Asset' : 'Add Asset'}
                  </h2>
                  <p className="asset-card-subtitle">
                    {canManage
                      ? 'Create or update asset allocation for employees.'
                      : 'Submit your assigned hardware/software asset details.'}
                  </p>
                </div>
              </div>

              <form className="asset-form" onSubmit={handleSubmit} noValidate>
                {canManage ? (
                  <div className="asset-field">
                    <label>Employee</label>
                    <select
                      value={form.assigned_to_employee_id}
                      onChange={(event) => updateForm('assigned_to_employee_id', event.target.value)}
                      required
                    >
                      <option value="">Select employee</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                          {employee.employee_code ? ` - ${employee.employee_code}` : ''}
                          {employee.department ? ` (${employee.department})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {selectedEmployee ? (
                  <div className="asset-selected-employee">
                    <div className="asset-avatar">
                      {String(selectedEmployee.name || 'E').slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{selectedEmployee.name}</strong>
                      <span>
                        {selectedEmployee.employee_code || 'No code'} ·{' '}
                        {selectedEmployee.department || 'No department'} ·{' '}
                        {selectedEmployee.designation || 'No designation'}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="asset-field-grid">
                  <div className="asset-field">
                    <label>Asset Type</label>
                    <select
                      value={form.asset_type}
                      onChange={(event) => updateForm('asset_type', event.target.value)}
                    >
                      {ASSET_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="asset-field">
                    <label>Asset Name</label>
                    <input
                      value={form.asset_name}
                      onChange={(event) => updateForm('asset_name', event.target.value)}
                      placeholder={isSoftware ? 'Microsoft 365 / Adobe / Antivirus' : 'Laptop / Mouse / Monitor'}
                      required
                    />
                  </div>
                </div>

                <div className="asset-field">
                  <label>Category</label>
                  <input
                    value={form.category}
                    onChange={(event) => updateForm('category', event.target.value)}
                    placeholder={isSoftware ? 'Productivity / Design / Security' : 'Laptop / Desktop / Peripheral'}
                  />
                </div>

                <div className="asset-field-grid">
                  <div className="asset-field">
                    <label>Brand</label>
                    <input
                      value={form.brand}
                      onChange={(event) => updateForm('brand', event.target.value)}
                      placeholder="Dell / HP / Lenovo / Microsoft"
                    />
                  </div>

                  <div className="asset-field">
                    <label>Model</label>
                    <input
                      value={form.model}
                      onChange={(event) => updateForm('model', event.target.value)}
                      placeholder="Model / Version"
                    />
                  </div>
                </div>

                {isSoftware ? (
                  <div className="asset-field">
                    <label>License Key</label>
                    <input
                      value={form.license_key}
                      onChange={(event) => updateForm('license_key', event.target.value)}
                      placeholder="License key"
                    />
                  </div>
                ) : null}

                {isSoftware ? (
                  <div className="asset-field-grid">
                    <div className="asset-field">
                      <label>License Email</label>
                      <input
                        value={form.license_email}
                        onChange={(event) => updateForm('license_email', event.target.value)}
                        placeholder="license@example.com"
                      />
                    </div>

                    <div className="asset-field">
                      <label>License Expiry</label>
                      <input
                        type="date"
                        value={form.license_expiry}
                        onChange={(event) => updateForm('license_expiry', event.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="asset-field-grid">
                    <div className="asset-field">
                      <label>Purchase Date</label>
                      <input
                        type="date"
                        value={form.purchase_date}
                        onChange={(event) => updateForm('purchase_date', event.target.value)}
                      />
                    </div>

                    <div className="asset-field">
                      <label>Warranty Expiry</label>
                      <input
                        type="date"
                        value={form.warranty_expiry}
                        onChange={(event) => updateForm('warranty_expiry', event.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="asset-field-grid">
                  <div className="asset-field">
                    <label>Status</label>
                    <select
                      value={form.status}
                      onChange={(event) => updateForm('status', event.target.value)}
                    >
                      {ASSET_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="asset-field">
                    <label>Condition</label>
                    <select
                      value={form.condition}
                      onChange={(event) => updateForm('condition', event.target.value)}
                    >
                      {ASSET_CONDITIONS.map((condition) => (
                        <option key={condition.value} value={condition.value}>
                          {condition.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {canManage ? (
                  <div className="asset-field">
                    <label>Verification Status</label>
                    <select
                      value={form.verification_status}
                      onChange={(event) => updateForm('verification_status', event.target.value)}
                    >
                      {ASSET_VERIFICATION_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {canManage && form.verification_status === 'rejected' ? (
                  <div className="asset-field">
                    <label>Rejection Reason</label>
                    <textarea
                      value={form.rejection_reason}
                      onChange={(event) => updateForm('rejection_reason', event.target.value)}
                      placeholder="Why this asset entry was rejected"
                    />
                  </div>
                ) : null}

                <div className="asset-field">
                  <label>Remarks</label>
                  <textarea
                    value={form.remarks}
                    onChange={(event) => updateForm('remarks', event.target.value)}
                    placeholder="Additional notes"
                  />
                </div>

                <div className="asset-actions">
                  <button
                    className="asset-btn asset-btn-primary"
                    type="submit"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : isEditing ? 'Update Asset' : 'Save Asset'}
                  </button>

                  {isEditing ? (
                    <button
                      className="asset-btn asset-btn-secondary"
                      type="button"
                      onClick={resetForm}
                      disabled={saving}
                    >
                      Cancel Edit
                    </button>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="asset-card">
              <div className="asset-card-header">
                <div>
                  <h2 className="asset-card-title">
                    {canManage ? 'All Asset Records' : 'My Asset Records'}
                  </h2>
                  <p className="asset-card-subtitle">
                    Search, filter and review hardware/software asset entries.
                  </p>
                </div>
              </div>

              <div className="asset-filter-bar">
                <input
                  value={filters.q}
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Search asset, employee, code..."
                />

                <select
                  value={filters.asset_type}
                  onChange={(event) => updateFilter('asset_type', event.target.value)}
                >
                  <option value="">All Types</option>
                  {ASSET_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.status}
                  onChange={(event) => updateFilter('status', event.target.value)}
                >
                  <option value="">All Status</option>
                  {ASSET_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.verification_status}
                  onChange={(event) => updateFilter('verification_status', event.target.value)}
                >
                  <option value="">All Verification</option>
                  {ASSET_VERIFICATION_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>

                {canManage ? (
                  <select
                    value={filters.employee_id}
                    onChange={(event) => updateFilter('employee_id', event.target.value)}
                  >
                    <option value="">All Employees</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.employee_code ? ` - ${employee.employee_code}` : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              {loading ? (
                <div className="asset-loading">Loading assets...</div>
              ) : assets.length ? (
                <div className="asset-list">
                  {assets.map((asset) => {
                    const assetId = asset.id || asset._id;

                    return (
                      <article className="asset-item" key={assetId}>
                        <div className="asset-item-head">
                          <div>
                            <div className="asset-item-title">
                              <h3>{asset.asset_name}</h3>
                              <span className="asset-pill asset-pill--primary">
                                {getAssetTypeLabel(asset.asset_type)}
                              </span>
                              <span className={statusClass(asset.verification_status)}>
                                {getAssetVerificationStatusLabel(asset.verification_status)}
                              </span>
                            </div>

                            <div className="asset-meta">
                              <span>{asset.assigned_to_name || 'Employee'}</span>
                              <span>{asset.assigned_to_employee_code || 'No Code'}</span>
                              <span>{asset.assigned_to_department || 'No Department'}</span>
                            </div>
                          </div>

                          {canManage ? (
                            <div className="asset-actions">
                              <button
                                type="button"
                                className="asset-btn asset-btn-secondary"
                                onClick={() => handleEdit(asset)}
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                className="asset-btn asset-btn-danger"
                                onClick={() => handleDelete(asset)}
                                disabled={deletingId === assetId}
                              >
                                {deletingId === assetId ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          ) : null}
                        </div>

                        <div className="asset-detail-grid">
                          <div className="asset-detail">
                            <span>Identifier</span>
                            <strong>{getAssetIdentifier(asset)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>Status</span>
                            <strong>{getAssetStatusLabel(asset.status)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>Condition</span>
                            <strong>{getAssetConditionLabel(asset.condition)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>{asset.asset_type === 'software' ? 'License Expiry' : 'Warranty Expiry'}</span>
                            <strong>{formatDate(getAssetExpiry(asset))}</strong>
                          </div>
                        </div>

                        <div className="asset-detail-grid">
                          <div className="asset-detail">
                            <span>Category</span>
                            <strong>{valueOrDash(asset.category)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>Brand</span>
                            <strong>{valueOrDash(asset.brand)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>Model</span>
                            <strong>{valueOrDash(asset.model)}</strong>
                          </div>

                          <div className="asset-detail">
                            <span>Entry Source</span>
                            <strong>{asset.entry_source === 'hr' ? 'HR/Admin' : 'Employee'}</strong>
                          </div>
                        </div>

                        {asset.remarks ? (
                          <div className="asset-detail" style={{ marginTop: 10 }}>
                            <span>Remarks</span>
                            <strong>{asset.remarks}</strong>
                          </div>
                        ) : null}

                        {asset.verification_status === 'rejected' && asset.rejection_reason ? (
                          <div className="asset-detail" style={{ marginTop: 10 }}>
                            <span>Rejection Reason</span>
                            <strong>{asset.rejection_reason}</strong>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="asset-empty">
                  No asset record found. Add your first asset entry from the form.
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === 'report' && canReport ? (
          <section className="asset-card">
            <div className="asset-report-toolbar">
              <div>
                <h2 className="asset-card-title">Employee-wise Asset Report</h2>
                <p className="asset-card-subtitle">
                  HR/Admin report showing which employee has which hardware and software assets.
                </p>
              </div>

              <div className="asset-actions">
                <button
                  type="button"
                  className="asset-btn asset-btn-secondary"
                  onClick={loadReport}
                  disabled={reportLoading}
                >
                  {reportLoading ? 'Refreshing...' : 'Refresh Report'}
                </button>

                <button
                  type="button"
                  className="asset-btn asset-btn-success"
                  onClick={handleExportCsv}
                  disabled={!reportRows.length}
                >
                  Export CSV
                </button>
              </div>
            </div>

            <div className="asset-report-summary">
              <div className="asset-report-summary-card">
                <span>Employees</span>
                <strong>{reportSummary.employee_count || 0}</strong>
              </div>

              <div className="asset-report-summary-card">
                <span>Total Assets</span>
                <strong>{reportSummary.asset_count || 0}</strong>
              </div>

              <div className="asset-report-summary-card">
                <span>Hardware</span>
                <strong>{reportSummary.hardware_count || 0}</strong>
              </div>

              <div className="asset-report-summary-card">
                <span>Software</span>
                <strong>{reportSummary.software_count || 0}</strong>
              </div>
            </div>

            {reportLoading ? (
              <div className="asset-loading">Generating report...</div>
            ) : filteredReportRows.length ? (
              <div className="asset-report-table-wrap">
                <table className="asset-report-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Designation</th>
                      <th>Hardware</th>
                      <th>Software</th>
                      <th>Total</th>
                      <th>Assets</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredReportRows.map((row) => (
                      <tr key={row.employee_id}>
                        <td>
                          <strong>{row.employee_name}</strong>
                          <br />
                          <span>{valueOrDash(row.employee_code)}</span>
                          <br />
                          <span>{valueOrDash(row.email)}</span>
                        </td>
                        <td>{valueOrDash(row.department)}</td>
                        <td>{valueOrDash(row.designation)}</td>
                        <td>{row.hardware_count}</td>
                        <td>{row.software_count}</td>
                        <td>{row.total_assets}</td>
                        <td>
                          <div className="asset-report-assets">
                            {row.assets.map((asset) => (
                              <div className="asset-report-asset" key={asset.id || asset._id}>
                                <strong>
                                  {asset.asset_name} · {getAssetTypeLabel(asset.asset_type)}
                                </strong>
                                <span>
                                  {getAssetIdentifier(asset)} · {getAssetStatusLabel(asset.status)} ·{' '}
                                  {getAssetVerificationStatusLabel(asset.verification_status)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="asset-empty">
                No report data found for the selected filters.
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}