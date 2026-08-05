import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Download,
  HardDrive,
  Laptop,
  PackageCheck,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
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
            --as-ink: #101a3a;
            --as-copy: #5d6d8d;
            --as-violet: #6658dc;
            --as-blue: #3766db;
            --as-cyan: #18b5c8;
            --as-teal: #34c9c4;
            --as-yellow: #d8ff43;
            --as-danger: #d84d68;
            min-height: 100%;
            width: 100%;
            min-width: 0;
            padding: 0 0 24px;
            overflow-x: hidden;
            color: var(--as-ink);
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

          .asset-shell {
            width: 100%;
            min-width: 0;
            display: grid;
            gap: clamp(18px, 2vw, 26px);
          }

          .asset-hero {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(280px, .34fr);
            gap: 18px;
            align-items: stretch;
          }

          .asset-hero-main,
          .asset-hero-side,
          .asset-card {
            border: 1px solid rgba(171,181,211,.70);
            background: linear-gradient(145deg, #ffffff, #f7fbff);
            box-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34,38,110,.10);
          }

          .asset-hero-main {
            position: relative;
            isolation: isolate;
            overflow: hidden;
            min-height: 275px;
            padding: clamp(25px, 3vw, 42px);
            border-radius: clamp(28px, 2.7vw, 40px);
            background:
              radial-gradient(circle at 8% 6%, rgba(105,217,208,.26), transparent 29%),
              radial-gradient(circle at 95% 4%, rgba(153,164,245,.24), transparent 31%),
              linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
            box-shadow: 12px 14px 0 #c6d8f7, 0 28px 48px rgba(34,38,110,.13);
          }

          .asset-hero-main::before {
            content: "";
            position: absolute;
            z-index: -1;
            width: 175px;
            height: 175px;
            right: 8%;
            bottom: -98px;
            border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
            background: linear-gradient(145deg, rgba(105,217,208,.30), rgba(132,181,241,.28));
            transform: rotate(-18deg);
          }

          .asset-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            width: max-content;
            max-width: 100%;
            margin-bottom: 15px;
            padding: 9px 13px;
            border-radius: 999px;
            color: #fff;
            background: #342b78;
            box-shadow: 4px 5px 0 #18b5c8;
            font-size: 9px;
            font-weight: 950;
            line-height: 1;
            letter-spacing: .12em;
            text-transform: uppercase;
          }

          .asset-hero h1 {
            max-width: 900px;
            margin: 0;
            color: var(--as-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(44px, 5.2vw, 77px);
            font-weight: 760;
            line-height: .94;
            letter-spacing: -.058em;
          }

          .asset-hero h1 em {
            color: var(--as-violet);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 500;
          }

          .asset-hero p {
            max-width: 830px;
            margin: 17px 0 0;
            color: var(--as-copy);
            font-size: clamp(13px, 1vw, 16px);
            line-height: 1.68;
          }

          .asset-hero-side {
            padding: 18px;
            border-radius: 30px;
            display: grid;
            gap: 13px;
            align-content: center;
          }

          .asset-quick-role,
          .asset-quick-note {
            border-radius: 20px;
            padding: 18px;
            box-shadow: 4px 5px 0 rgba(52,43,120,.08);
          }

          .asset-quick-role {
            color: #fff;
            background: linear-gradient(145deg, #342b78, #4f65d7 58%, #18b5c8);
            box-shadow: 5px 6px 0 #b9d7ff;
          }

          .asset-quick-role span {
            display: block;
            margin-bottom: 7px;
            color: rgba(255,255,255,.76);
            font-size: 10px;
            font-weight: 900;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .asset-quick-role strong {
            display: block;
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(18px, 1.5vw, 25px);
            line-height: 1.25;
          }

          .asset-quick-note {
            color: var(--as-copy);
            background: #edf6ff;
            border: 1px solid rgba(171,181,211,.48);
            box-shadow: 4px 5px 0 #b9d7ff;
            line-height: 1.6;
          }

          .asset-stats {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 14px;
          }

          .asset-stat {
            min-width: 0;
            min-height: 135px;
            padding: 18px;
            border: 1px solid rgba(171,181,211,.66);
            border-radius: 22px;
            background: #edf6ff;
            box-shadow: 7px 9px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.09);
            transition: transform 190ms ease;
          }

          .asset-stat:nth-child(2) {
            background: #eaf8f4;
            box-shadow: 7px 9px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.09);
          }

          .asset-stat:nth-child(3) {
            background: #fff4d5;
            box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(34,38,110,.09);
          }

          .asset-stat:nth-child(4) {
            background: #f1efff;
            box-shadow: 7px 9px 0 #c9c0ff, 0 18px 30px rgba(34,38,110,.09);
          }

          .asset-stat:nth-child(5) {
            background: #fff0f2;
            box-shadow: 7px 9px 0 #f2c2cc, 0 18px 30px rgba(34,38,110,.09);
          }

          .asset-stat:nth-child(6) {
            background: #eaf8f4;
            box-shadow: 7px 9px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.09);
          }

          .asset-stat:hover {
            transform: translateY(-4px);
          }

          .asset-stat-icon {
            width: 42px;
            height: 42px;
            margin-bottom: 12px;
            display: grid;
            place-items: center;
            border-radius: 14px;
            color: #fff;
            background: linear-gradient(145deg, #6658dc, #18b5c8);
            box-shadow: 3px 4px 0 rgba(52,43,120,.18);
            animation: assetIconFloat 3.2s ease-in-out infinite;
          }

          .asset-stat span {
            display: block;
            color: #5d6785;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .09em;
            text-transform: uppercase;
          }

          .asset-stat strong {
            display: block;
            margin-top: 8px;
            color: var(--as-ink);
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(27px, 2.6vw, 39px);
            line-height: 1;
          }

          .asset-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 9px;
          }

          .asset-tab {
            min-height: 42px;
            padding: 9px 14px;
            border: 1px solid rgba(171,181,211,.62);
            border-radius: 999px;
            color: var(--as-copy);
            background: #fff;
            box-shadow: 3px 4px 0 rgba(52,43,120,.08);
            font-weight: 900;
            cursor: pointer;
            transition: transform 180ms ease, background 180ms ease, box-shadow 180ms ease;
          }

          .asset-tab:hover {
            transform: translateY(-2px);
          }

          .asset-tab.active {
            color: #fff;
            background: #342b78;
            border-color: transparent;
            box-shadow: 4px 5px 0 #18b5c8;
          }

          .asset-grid {
            display: grid;
            grid-template-columns: minmax(370px, .84fr) minmax(0, 1.16fr);
            gap: 22px;
            align-items: start;
          }

          .asset-card {
            min-width: 0;
            padding: clamp(20px, 2vw, 28px);
            border-radius: clamp(26px, 2.2vw, 36px);
            overflow: hidden;
            transition: transform 210ms ease, box-shadow 210ms ease, border-color 210ms ease;
          }

          .asset-card:hover {
            transform: translateY(-3px);
            border-color: rgba(102,88,220,.28);
            box-shadow: 10px 12px 0 #c4ccff, 0 30px 50px rgba(34,38,110,.14);
          }

          .asset-card-header,
          .asset-report-toolbar {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            margin-bottom: 18px;
          }

          .asset-card-title {
            margin: 0;
            color: var(--as-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(25px, 2.3vw, 37px);
            font-weight: 760;
            line-height: 1;
            letter-spacing: -.045em;
          }

          .asset-card-subtitle {
            margin: 8px 0 0;
            color: var(--as-copy);
            font-size: 13px;
            line-height: 1.58;
          }

          .asset-form {
            display: grid;
            gap: 15px;
          }

          .asset-field-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .asset-field {
            display: grid;
            gap: 8px;
            min-width: 0;
          }

          .asset-field label {
            color: #303b5b;
            font-size: 11px;
            font-weight: 900;
          }

          .asset-field input,
          .asset-field select,
          .asset-field textarea,
          .asset-filter-bar input,
          .asset-filter-bar select {
            width: 100%;
            min-width: 0;
            min-height: 47px;
            padding: 11px 13px;
            border: 1px solid rgba(151,161,197,.58);
            border-radius: 15px;
            outline: none;
            color: var(--as-ink);
            background: rgba(255,255,255,.94);
            transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
          }

          .asset-field textarea {
            min-height: 105px;
            resize: vertical;
          }

          .asset-field input:focus,
          .asset-field select:focus,
          .asset-field textarea:focus,
          .asset-filter-bar input:focus,
          .asset-filter-bar select:focus {
            border-color: rgba(102,88,220,.65);
            box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08);
            transform: translateY(-1px);
          }

          .asset-selected-employee {
            display: grid;
            grid-template-columns: 48px minmax(0, 1fr);
            gap: 12px;
            align-items: center;
            padding: 14px;
            border: 1px solid rgba(171,181,211,.50);
            border-radius: 18px;
            color: #40348d;
            background: linear-gradient(145deg, #edf6ff, #f1efff);
            box-shadow: 4px 5px 0 #c9c0ff;
          }

          .asset-avatar {
            width: 48px;
            height: 48px;
            border-radius: 16px;
            display: grid;
            place-items: center;
            color: #fff;
            background: linear-gradient(145deg, #6658dc, #18b5c8);
            box-shadow: 3px 4px 0 #b9d7ff;
            font-weight: 950;
          }

          .asset-selected-employee strong {
            display: block;
            color: var(--as-ink);
          }

          .asset-selected-employee span {
            display: block;
            margin-top: 4px;
            color: var(--as-copy);
            font-size: 12px;
            overflow-wrap: anywhere;
          }

          .asset-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 9px;
            align-items: center;
          }

          .asset-btn {
            min-height: 44px;
            padding: 10px 15px;
            border: 1px solid transparent;
            border-radius: 15px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-weight: 900;
            cursor: pointer;
            transition: transform 190ms ease, box-shadow 190ms ease, filter 190ms ease;
          }

          .asset-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            filter: saturate(1.04);
          }

          .asset-btn:disabled {
            opacity: .58;
            cursor: not-allowed;
          }

          .asset-btn-primary {
            color: #fff;
            background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
            box-shadow: 5px 6px 0 #a9d6f5, 0 14px 25px rgba(36,74,128,.16);
          }

          .asset-btn-secondary {
            color: #40348d;
            background: rgba(255,255,255,.92);
            border-color: rgba(65,55,161,.18);
            box-shadow: 3px 4px 0 rgba(52,43,120,.10);
          }

          .asset-btn-danger {
            color: #a2344d;
            background: #fff0f2;
            border-color: rgba(216,77,104,.22);
            box-shadow: 3px 4px 0 #f2c2cc;
          }

          .asset-btn-success {
            color: #047857;
            background: #eaf8f4;
            border-color: rgba(52,201,196,.30);
            box-shadow: 3px 4px 0 #aee6d9;
          }

          .asset-filter-bar {
            display: grid;
            grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(140px, .8fr));
            gap: 10px;
            margin-bottom: 16px;
            padding: 13px;
            border: 1px solid rgba(171,181,211,.55);
            border-radius: 20px;
            background: linear-gradient(145deg, #f8fbff, #f7f4ff);
            box-shadow: 4px 5px 0 rgba(52,43,120,.08);
          }

          .asset-list {
            display: grid;
            gap: 15px;
          }

          .asset-item {
            min-width: 0;
            padding: 17px;
            border: 1px solid rgba(171,181,211,.62);
            border-radius: 22px;
            background: linear-gradient(145deg, #ffffff, #f7fbff);
            box-shadow: 5px 6px 0 rgba(52,43,120,.08);
            transition: transform 190ms ease, border-color 190ms ease;
          }

          .asset-item:nth-child(3n + 1) {
            background: linear-gradient(145deg, #edf6ff, #ffffff);
            box-shadow: 5px 6px 0 #b9d7ff;
          }

          .asset-item:nth-child(3n + 2) {
            background: linear-gradient(145deg, #eaf8f4, #ffffff);
            box-shadow: 5px 6px 0 #aee6d9;
          }

          .asset-item:nth-child(3n + 3) {
            background: linear-gradient(145deg, #f1efff, #ffffff);
            box-shadow: 5px 6px 0 #c9c0ff;
          }

          .asset-item:hover {
            transform: translateY(-3px);
            border-color: rgba(102,88,220,.28);
          }

          .asset-item-head {
            display: flex;
            justify-content: space-between;
            gap: 14px;
            align-items: flex-start;
          }

          .asset-item-title {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
          }

          .asset-item-title h3 {
            margin: 0;
            color: var(--as-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: 21px;
            font-weight: 760;
            letter-spacing: -.03em;
          }

          .asset-meta {
            margin-top: 9px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            color: var(--as-copy);
            font-size: 12px;
          }

          .asset-meta span {
            max-width: 100%;
            padding: 7px 10px;
            border: 1px solid rgba(171,181,211,.44);
            border-radius: 999px;
            background: rgba(255,255,255,.84);
            box-shadow: 2px 3px 0 rgba(52,43,120,.06);
            overflow-wrap: anywhere;
          }

          .asset-detail-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-top: 14px;
          }

          .asset-detail {
            min-width: 0;
            padding: 12px;
            border: 1px solid rgba(171,181,211,.44);
            border-radius: 15px;
            background: rgba(255,255,255,.84);
            box-shadow: 3px 4px 0 rgba(52,43,120,.07);
          }

          .asset-detail span,
          .asset-report-summary-card span {
            display: block;
            margin-bottom: 6px;
            color: #5d6785;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .07em;
            text-transform: uppercase;
          }

          .asset-detail strong {
            display: block;
            color: var(--as-ink);
            font-size: 13px;
            line-height: 1.45;
            overflow-wrap: anywhere;
          }

          .asset-pill {
            display: inline-flex;
            align-items: center;
            padding: 7px 10px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 900;
            white-space: nowrap;
            box-shadow: 2px 3px 0 rgba(52,43,120,.07);
          }

          .asset-pill--primary { color: #40348d; background: #f1efff; box-shadow: 2px 3px 0 #c9c0ff; }
          .asset-pill--success { color: #047857; background: #eaf8f4; box-shadow: 2px 3px 0 #aee6d9; }
          .asset-pill--warning { color: #9a6817; background: #fff4d5; box-shadow: 2px 3px 0 #ffe0a5; }
          .asset-pill--danger { color: #a2344d; background: #fff0f2; box-shadow: 2px 3px 0 #f2c2cc; }
          .asset-pill--neutral { color: #475569; background: #f1f5f9; box-shadow: 2px 3px 0 #dbe1e8; }
          .asset-pill--info { color: #245da8; background: #edf6ff; box-shadow: 2px 3px 0 #b9d7ff; }

          .asset-empty,
          .asset-loading {
            min-height: 220px;
            padding: 28px;
            display: grid;
            place-items: center;
            text-align: center;
            border: 1px dashed rgba(102,88,220,.34);
            border-radius: 20px;
            color: var(--as-copy);
            background: linear-gradient(145deg, #f8f7ff, #effbf8);
            box-shadow: 4px 5px 0 rgba(52,43,120,.07);
          }

          .asset-report-summary {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 16px;
          }

          .asset-report-summary-card {
            min-width: 0;
            padding: 15px;
            border: 1px solid rgba(171,181,211,.50);
            border-radius: 18px;
            background: #edf6ff;
            box-shadow: 4px 5px 0 #b9d7ff;
          }

          .asset-report-summary-card:nth-child(2) {
            background: #eaf8f4;
            box-shadow: 4px 5px 0 #aee6d9;
          }

          .asset-report-summary-card:nth-child(3) {
            background: #fff4d5;
            box-shadow: 4px 5px 0 #ffe0a5;
          }

          .asset-report-summary-card:nth-child(4) {
            background: #f1efff;
            box-shadow: 4px 5px 0 #c9c0ff;
          }

          .asset-report-summary-card strong {
            display: block;
            color: var(--as-ink);
            font-family: Georgia, "Times New Roman", serif;
            font-size: 26px;
          }

          .asset-report-table-wrap {
            width: 100%;
            overflow-x: auto;
            border: 1px solid rgba(171,181,211,.50);
            border-radius: 18px;
            background: #fff;
            box-shadow: 4px 5px 0 rgba(52,43,120,.08);
            -webkit-overflow-scrolling: touch;
          }

          .asset-report-table {
            width: 100%;
            min-width: 980px;
            border-collapse: collapse;
          }

          .asset-report-table th,
          .asset-report-table td {
            padding: 13px 14px;
            border-bottom: 1px solid rgba(171,181,211,.36);
            text-align: left;
            vertical-align: top;
          }

          .asset-report-table th {
            position: sticky;
            top: 0;
            z-index: 1;
            color: #536381;
            background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
            font-size: 10px;
            font-weight: 950;
            letter-spacing: .06em;
            text-transform: uppercase;
          }

          .asset-report-table td {
            color: var(--as-copy);
            font-size: 12px;
          }

          .asset-report-assets {
            display: grid;
            gap: 7px;
          }

          .asset-report-asset {
            padding: 10px;
            border: 1px solid rgba(171,181,211,.44);
            border-radius: 13px;
            background: #f8fafc;
            box-shadow: 2px 3px 0 rgba(52,43,120,.06);
          }

          .asset-report-asset strong {
            display: block;
            margin-bottom: 4px;
            color: var(--as-ink);
          }

          .asset-report-asset span {
            color: var(--as-copy);
            font-size: 11px;
          }

          @keyframes assetIconFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-3px) rotate(-3deg); }
          }

          @media (max-width: 1380px) {
            .asset-stats {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }

            .asset-filter-bar {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }

            .asset-filter-bar input:first-child {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 1180px) {
            .asset-hero,
            .asset-grid {
              grid-template-columns: 1fr;
            }

            .asset-hero-side {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .asset-detail-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 760px) {
            .asset-shell {
              gap: 16px;
            }

            .asset-hero-main {
              min-height: 0;
              padding: 20px;
              border-radius: 26px;
              box-shadow: 6px 7px 0 #c6d8f7, 0 18px 30px rgba(34,38,110,.10);
            }

            .asset-hero h1 {
              font-size: clamp(36px,10vw,52px);
            }

            .asset-hero-side,
            .asset-stats,
            .asset-field-grid,
            .asset-filter-bar,
            .asset-detail-grid,
            .asset-report-summary {
              grid-template-columns: 1fr;
            }

            .asset-stats {
              gap: 10px;
            }

            .asset-card {
              padding: 18px;
              border-radius: 22px;
              box-shadow: 5px 6px 0 #c4ccff, 0 17px 28px rgba(34,38,110,.09);
            }

            .asset-tabs {
              display: grid;
              grid-template-columns: 1fr;
            }

            .asset-tab {
              width: 100%;
            }

            .asset-card-header,
            .asset-report-toolbar,
            .asset-item-head {
              flex-direction: column;
              align-items: stretch;
            }

            .asset-actions {
              display: grid;
              grid-template-columns: 1fr;
            }

            .asset-btn {
              width: 100%;
            }
          }

          @media (max-width: 430px) {
            .asset-hero-main {
              padding: 16px;
            }

            .asset-hero h1 {
              font-size: clamp(32px,11vw,44px);
            }

            .asset-card {
              padding: 15px;
            }

            .asset-stat {
              min-height: 78px;
              display: grid;
              grid-template-columns: auto minmax(0,1fr) auto;
              gap: 10px;
              align-items: center;
            }

            .asset-stat-icon {
              margin-bottom: 0;
            }

            .asset-stat strong {
              margin-top: 0;
            }

            .asset-item-title {
              align-items: flex-start;
              flex-direction: column;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .asset-page *,
            .asset-page *::before,
            .asset-page *::after {
              animation: none !important;
              transition: none !important;
            }
          }
        `}
      </style>

      <div className="asset-shell">
        <section className="asset-hero">
          <div className="asset-hero-main">
            <span className="asset-eyebrow">
              <Sparkles size={13} />
              Asset Management
            </span>
            <h1>
              Assets that stay <em>organised.</em>
            </h1>
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
            <div className="asset-stat-icon"><PackageCheck size={18} /></div>
            <span>Total Assets</span>
            <strong>{stats.total || 0}</strong>
          </div>
          <div className="asset-stat">
            <div className="asset-stat-icon"><Laptop size={18} /></div>
            <span>Hardware</span>
            <strong>{stats.hardware || 0}</strong>
          </div>
          <div className="asset-stat">
            <div className="asset-stat-icon"><HardDrive size={18} /></div>
            <span>Software</span>
            <strong>{stats.software || 0}</strong>
          </div>
          <div className="asset-stat">
            <div className="asset-stat-icon"><ShieldCheck size={18} /></div>
            <span>Assigned</span>
            <strong>{stats.assigned || 0}</strong>
          </div>
          <div className="asset-stat">
            <div className="asset-stat-icon"><BarChart3 size={18} /></div>
            <span>Pending</span>
            <strong>{stats.pending || 0}</strong>
          </div>
          <div className="asset-stat">
            <div className="asset-stat-icon"><CheckCircle2 size={18} /></div>
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
                    <Save size={16} />
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
                                <Pencil size={15} />
                                Edit
                              </button>

                              <button
                                type="button"
                                className="asset-btn asset-btn-danger"
                                onClick={() => handleDelete(asset)}
                                disabled={deletingId === assetId}
                              >
                                <Trash2 size={15} />
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
                  <RefreshCw size={15} />
                  {reportLoading ? 'Refreshing...' : 'Refresh Report'}
                </button>

                <button
                  type="button"
                  className="asset-btn asset-btn-success"
                  onClick={handleExportCsv}
                  disabled={!reportRows.length}
                >
                  <Download size={15} />
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