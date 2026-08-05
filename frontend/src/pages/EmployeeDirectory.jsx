import { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  Phone,
  Search,
  MapPin,
  BriefcaseBusiness,
  Users,
  RefreshCcw,
  Filter,
  Sparkles,
  UserRound,
} from 'lucide-react';

import {
  getEmployeeDirectory,
  getInitials,
  getProfilePhotoUrl,
} from '../api/client';

const EMPTY_FILTERS = {
  q: '',
  designation: '',
  state: '',
  phone: '',
  email: '',
};

function cleanText(value, fallback = 'Not updated') {
  const text = String(value || '').trim();
  return text || fallback;
}

function DirectoryAvatar({ employee }) {
  const photoUrl = getProfilePhotoUrl(employee);
  const name = employee?.name || employee?.employee_name || 'Employee';

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="employee-directory-avatar-img"
        loading="lazy"
      />
    );
  }

  return (
    <div className="employee-directory-avatar-fallback">
      {getInitials(name)}
    </div>
  );
}

function ContactPill({ icon: Icon, value, type }) {
  const text = String(value || '').trim();

  if (!text) {
    return (
      <span className="employee-directory-pill employee-directory-pill-muted">
        <Icon size={15} />
        Not updated
      </span>
    );
  }

  if (type === 'email') {
    return (
      <a className="employee-directory-pill" href={`mailto:${text}`}>
        <Icon size={15} />
        {text}
      </a>
    );
  }

  if (type === 'phone') {
    return (
      <a className="employee-directory-pill" href={`tel:${text}`}>
        <Icon size={15} />
        {text}
      </a>
    );
  }

  return (
    <span className="employee-directory-pill">
      <Icon size={15} />
      {text}
    </span>
  );
}

export default function EmployeeDirectory() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [directory, setDirectory] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    designations: [],
    states: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const totalEmployees = directory.length;

  const visibleEmployees = useMemo(() => {
    const search = String(filters.q || '').trim().toLowerCase();
    const designation = String(filters.designation || '').trim().toLowerCase();
    const state = String(filters.state || '').trim().toLowerCase();
    const phone = String(filters.phone || '').trim().toLowerCase();
    const email = String(filters.email || '').trim().toLowerCase();

    return directory.filter((employee) => {
    const employeeName = String(employee.name || employee.employee_name || '').toLowerCase();
    const employeeDesignation = String(employee.designation || '').toLowerCase();
const employeeOrganisation = String(
  employee.organisation ||
    employee.organization ||
    employee.organisation_name ||
    employee.organization_name ||
    employee.organisation_code ||
    employee.organization_code ||
    ''
).toLowerCase();
    const employeeDepartment = String(
      employee.department || employee.department_name || ''
    ).toLowerCase();
    const employeeState = String(employee.state || '').toLowerCase();
    const employeePhone = String(employee.phone || '').toLowerCase();
    const employeeEmail = String(employee.email || '').toLowerCase();

    const searchMatch =
      !search ||
      [
        employeeName,
        employeeDesignation,
        employeeOrganisation,
        employeeDepartment,
        employeeState,
        employeePhone,
        employeeEmail,
      ].some((value) => value.includes(search));

      if (!searchMatch) return false;
      if (designation && employeeDesignation !== designation) return false;
      if (state && employeeState !== state) return false;
      if (phone && !employeePhone.includes(phone)) return false;
      if (email && !employeeEmail.includes(email)) return false;

      return true;
    });
  }, [directory, filters]);

  async function loadDirectory(nextFilters = filters, options = {}) {
    const isRefresh = Boolean(options.refresh);

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');

    try {
      const data = await getEmployeeDirectory({
        limit: 500,
        q: nextFilters.q,
        designation: nextFilters.designation,
        state: nextFilters.state,
        phone: nextFilters.phone,
        email: nextFilters.email,
      });

      setDirectory(Array.isArray(data.items) ? data.items : []);
      setFilterOptions({
        designations: Array.isArray(data.filters?.designations)
          ? data.filters.designations
          : [],
        states: Array.isArray(data.filters?.states)
          ? data.filters.states
          : [],
      });
    } catch (err) {
      setError(err?.message || 'Unable to load employee directory.');
      setDirectory([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDirectory(EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyFilters(event) {
    event.preventDefault();
    loadDirectory(filters);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    loadDirectory(EMPTY_FILTERS);
  }

  return (
    <div className="employee-directory-page">
      <style>{`
        .employee-directory-page {
          --directory-ink: #101a3a;
          --directory-ink-soft: #596483;
          --directory-violet: #6254da;
          --directory-violet-deep: #342b78;
          --directory-blue: #3766db;
          --directory-teal: #18aaa8;
          --directory-sky: #edf8ff;
          --directory-lilac: #f1efff;
          --directory-flat-blue: #b9d7ff;
          --directory-flat-violet: #c9c0ff;
          --directory-flat-teal: #aee6d9;

          position: relative;
          min-height: 100%;
          width: 100%;
          color: var(--directory-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .employee-directory-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          margin-bottom: 22px;
          padding: clamp(24px, 2.8vw, 36px);
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: clamp(28px, 2.5vw, 40px);
          background:
            radial-gradient(circle at 8% 8%, rgba(121, 219, 238, 0.34), transparent 31%),
            radial-gradient(circle at 92% 12%, rgba(191, 190, 249, 0.3), transparent 34%),
            linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
          box-shadow:
            12px 14px 0 var(--directory-flat-blue),
            0 28px 48px rgba(34, 38, 110, 0.13);
        }

        .employee-directory-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          pointer-events: none;
          opacity: 0.42;
          background-image:
            linear-gradient(rgba(65, 55, 161, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, 0.035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .employee-directory-hero::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: clamp(165px, 20vw, 290px);
          aspect-ratio: 1;
          right: clamp(-110px, -7vw, -55px);
          top: clamp(-118px, -8vw, -60px);
          border: 1px solid rgba(65, 55, 161, 0.12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(145deg, rgba(105, 217, 208, 0.72), rgba(121, 189, 242, 0.72));
          transform: rotate(18deg);
        }

        .employee-directory-hero-content {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 26px;
        }

        .employee-directory-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          max-width: 100%;
          padding: 9px 13px;
          border-radius: 999px;
          color: #ffffff;
          background: var(--directory-violet-deep);
          font-size: clamp(8px, 0.7vw, 10px);
          font-weight: 950;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .employee-directory-title {
          max-width: 820px;
          margin: 15px 0 9px;
          color: var(--directory-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(34px, 4.4vw, 66px);
          font-weight: 760;
          line-height: 0.94;
          letter-spacing: -0.055em;
        }

        .employee-directory-subtitle {
          max-width: 780px;
          margin: 0;
          color: var(--directory-ink-soft);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .employee-directory-stat-card {
          min-width: 210px;
          padding: 20px;
          border: 1px solid rgba(159, 169, 205, 0.58);
          border-radius: 22px;
          color: var(--directory-ink);
          background: rgba(255, 255, 255, 0.86);
          box-shadow:
            7px 9px 0 var(--directory-flat-violet),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .employee-directory-stat-icon {
          display: grid;
          place-items: center;
          width: 46px;
          height: 46px;
          margin-bottom: 14px;
          border: 1px solid rgba(52, 43, 120, 0.15);
          border-radius: 15px;
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow: 4px 5px 0 rgba(52, 43, 120, 0.76);
        }

        .employee-directory-stat-value {
          color: var(--directory-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(32px, 3vw, 46px);
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.04em;
        }

        .employee-directory-stat-label {
          margin-top: 6px;
          color: var(--directory-ink-soft);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .employee-directory-toolbar {
          margin-bottom: 22px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: 24px;
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(244, 249, 255, 0.98));
          box-shadow:
            8px 10px 0 #d1dcfa,
            0 22px 38px rgba(34, 38, 110, 0.09);
        }

        .employee-directory-filter-grid {
          display: grid;
          grid-template-columns:
            minmax(220px, 1.4fr)
            minmax(160px, 0.85fr)
            minmax(150px, 0.75fr)
            minmax(140px, 0.7fr)
            minmax(180px, 0.9fr)
            auto
            auto;
          align-items: center;
          gap: 12px;
        }

        .employee-directory-field {
          position: relative;
          min-width: 0;
        }

        .employee-directory-field svg {
          position: absolute;
          left: 13px;
          top: 50%;
          z-index: 1;
          transform: translateY(-50%);
          color: var(--directory-violet);
          pointer-events: none;
        }

        .employee-directory-input,
        .employee-directory-select {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          padding: 0 14px 0 40px;
          border: 1px solid rgba(159, 169, 205, 0.62);
          border-radius: 14px;
          outline: none;
          color: var(--directory-ink);
          background: rgba(255, 255, 255, 0.86);
          font: inherit;
          font-size: 13px;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .employee-directory-select {
          cursor: pointer;
        }

        .employee-directory-input:hover,
        .employee-directory-select:hover {
          border-color: rgba(98, 84, 218, 0.34);
        }

        .employee-directory-input:focus,
        .employee-directory-select:focus {
          border-color: var(--directory-violet);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, 0.11);
        }

        .employee-directory-button {
          appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 0 16px;
          border: 1px solid transparent;
          border-radius: 14px;
          cursor: pointer;
          font: inherit;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease,
            filter 180ms ease;
        }

        .employee-directory-button:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .employee-directory-button-primary {
          border-color: rgba(52, 43, 120, 0.16);
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, 0.8),
            0 12px 22px rgba(55, 102, 219, 0.16);
        }

        .employee-directory-button-soft {
          border-color: rgba(98, 84, 218, 0.18);
          color: var(--directory-violet-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, 0.14);
        }

        .employee-directory-button:disabled {
          cursor: not-allowed;
          opacity: 0.62;
          transform: none;
          box-shadow: none;
          filter: none;
        }

        .employee-directory-button:focus-visible,
        .employee-directory-input:focus-visible,
        .employee-directory-select:focus-visible,
        .employee-directory-pill:focus-visible {
          outline: 3px solid rgba(98, 84, 218, 0.2);
          outline-offset: 2px;
        }

        .employee-directory-content-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .employee-directory-section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: var(--directory-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(22px, 2vw, 30px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -0.03em;
        }

        .employee-directory-section-title svg {
          color: var(--directory-violet);
        }

        .employee-directory-count-chip {
          display: inline-flex;
          align-items: center;
          padding: 8px 11px;
          border-radius: 999px;
          color: #13736f;
          background: #dff8f3;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
        }

        .employee-directory-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .employee-directory-card {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          min-width: 0;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, 0.68);
          border-radius: 24px;
          color: var(--directory-ink);
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(244, 249, 255, 0.98));
          box-shadow:
            7px 9px 0 var(--directory-flat-blue),
            0 18px 30px rgba(15, 20, 75, 0.09);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .employee-directory-card:nth-child(3n + 2) {
          background:
            linear-gradient(145deg, #ffffff, #f4f1ff);
          box-shadow:
            7px 9px 0 var(--directory-flat-violet),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .employee-directory-card:nth-child(3n + 3) {
          background:
            linear-gradient(145deg, #ffffff, #eefaf7);
          box-shadow:
            7px 9px 0 var(--directory-flat-teal),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .employee-directory-card::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 120px;
          aspect-ratio: 1;
          top: -54px;
          right: -45px;
          border-radius: 46% 54% 58% 42% / 53% 44% 56% 47%;
          background: linear-gradient(145deg, rgba(105, 217, 208, 0.24), rgba(121, 189, 242, 0.24));
          transform: rotate(18deg);
        }

        .employee-directory-card:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, 0.34);
          box-shadow:
            10px 12px 0 var(--directory-flat-blue),
            0 24px 38px rgba(15, 20, 75, 0.13);
        }

        .employee-directory-card:nth-child(3n + 2):hover {
          box-shadow:
            10px 12px 0 var(--directory-flat-violet),
            0 24px 38px rgba(15, 20, 75, 0.13);
        }

        .employee-directory-card:nth-child(3n + 3):hover {
          box-shadow:
            10px 12px 0 var(--directory-flat-teal),
            0 24px 38px rgba(15, 20, 75, 0.13);
        }

        .employee-directory-card-main {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 16px;
        }

        .employee-directory-avatar {
          flex: 0 0 auto;
        }

        .employee-directory-avatar-img,
        .employee-directory-avatar-fallback {
          width: 62px;
          height: 62px;
          border: 3px solid #ffffff;
          border-radius: 20px;
          object-fit: cover;
          box-shadow:
            4px 5px 0 rgba(98, 84, 218, 0.16),
            0 12px 24px rgba(34, 38, 110, 0.12);
        }

        .employee-directory-avatar-fallback {
          display: grid;
          place-items: center;
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          font-size: 16px;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .employee-directory-card-main > div:last-child {
          min-width: 0;
        }

        .employee-directory-name {
          margin: 0;
          color: var(--directory-ink);
          font-size: 17px;
          font-weight: 950;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }

        .employee-directory-designation {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 7px;
          color: var(--directory-ink-soft);
          font-size: 12px;
          font-weight: 800;
        }

        .employee-directory-designation svg {
          flex: 0 0 auto;
          color: var(--directory-violet);
        }

        .employee-directory-entity,
        .employee-directory-department {
          width: fit-content;
          max-width: 100%;
          margin-top: 7px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

        .employee-directory-entity {
          color: #3657b5;
          background: #e5e9ff;
        }

        .employee-directory-department {
          color: #13736f;
          background: #dff8f3;
        }

        .employee-directory-contact-list {
          display: grid;
          gap: 9px;
        }

        .employee-directory-pill {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(98, 84, 218, 0.12);
          border-radius: 14px;
          color: #334164;
          background: rgba(255, 255, 255, 0.74);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.4;
          text-decoration: none;
          overflow-wrap: anywhere;
          transition:
            transform 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
        }

        a.employee-directory-pill:hover {
          transform: translateX(2px);
          border-color: rgba(98, 84, 218, 0.3);
          background: #ffffff;
        }

        .employee-directory-pill svg {
          flex: 0 0 auto;
          color: var(--directory-violet);
        }

        .employee-directory-pill-muted {
          color: #8a93aa;
          background: rgba(241, 239, 255, 0.54);
        }

        .employee-directory-empty,
        .employee-directory-error {
          padding: 36px;
          border: 1px solid rgba(171, 181, 211, 0.68);
          border-radius: 24px;
          color: var(--directory-ink-soft);
          background:
            linear-gradient(145deg, rgba(237, 248, 255, 0.82), rgba(248, 241, 255, 0.76));
          box-shadow:
            7px 9px 0 var(--directory-flat-blue),
            0 18px 30px rgba(15, 20, 75, 0.09);
          text-align: center;
        }

        .employee-directory-empty-icon,
        .employee-directory-loading-icon {
          display: grid;
          place-items: center;
          width: 58px;
          height: 58px;
          margin: 0 auto 14px;
          border: 1px solid rgba(52, 43, 120, 0.15);
          border-radius: 18px;
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow: 4px 5px 0 rgba(52, 43, 120, 0.76);
        }

        .employee-directory-empty h3 {
          margin: 0 0 7px;
          color: var(--directory-ink);
          font-size: 18px;
          font-weight: 900;
        }

        .employee-directory-empty p {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
        }

        .employee-directory-error {
          color: #a33b5c;
          border-color: rgba(190, 47, 85, 0.2);
          background: #fff1f5;
          box-shadow:
            7px 9px 0 #ffd1df,
            0 18px 30px rgba(190, 47, 85, 0.08);
        }

        .employee-directory-loading-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .employee-directory-skeleton {
          height: 230px;
          border: 1px solid rgba(171, 181, 211, 0.56);
          border-radius: 24px;
          background:
            linear-gradient(
              90deg,
              #edf6ff 25%,
              #ffffff 37%,
              #f1efff 50%,
              #ffffff 63%,
              #edf6ff 75%
            );
          background-size: 400% 100%;
          box-shadow:
            7px 9px 0 rgba(185, 215, 255, 0.72),
            0 18px 30px rgba(15, 20, 75, 0.06);
          animation: employeeDirectorySkeleton 1.35s ease infinite;
        }

        @keyframes employeeDirectorySkeleton {
          0% {
            background-position: 100% 50%;
          }

          100% {
            background-position: 0 50%;
          }
        }

        @media (hover: hover) and (pointer: fine) {
          .employee-directory-button-primary:hover {
            box-shadow:
              7px 8px 0 rgba(52, 43, 120, 0.8),
              0 16px 25px rgba(55, 102, 219, 0.2);
          }

          .employee-directory-button-soft:hover {
            box-shadow: 6px 7px 0 rgba(98, 84, 218, 0.17);
          }
        }

        @media (max-width: 1180px) {
          .employee-directory-filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .employee-directory-grid,
          .employee-directory-loading-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .employee-directory-button {
            width: 100%;
          }
        }

        @media (max-width: 760px) {
          .employee-directory-hero {
            padding: 20px;
            border-radius: 24px;
            box-shadow:
              7px 8px 0 var(--directory-flat-blue),
              0 18px 30px rgba(34, 38, 110, 0.1);
          }

          .employee-directory-hero-content {
            grid-template-columns: 1fr;
          }

          .employee-directory-title {
            font-size: clamp(31px, 9.2vw, 43px);
          }

          .employee-directory-stat-card {
            min-width: 0;
          }

          .employee-directory-toolbar {
            padding: 15px;
            border-radius: 22px;
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, 0.08);
          }

          .employee-directory-filter-grid,
          .employee-directory-grid,
          .employee-directory-loading-grid {
            grid-template-columns: 1fr;
          }

          .employee-directory-content-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .employee-directory-count-chip {
            width: 100%;
            justify-content: center;
          }

          .employee-directory-card {
            box-shadow:
              6px 7px 0 var(--directory-flat-blue),
              0 16px 28px rgba(34, 38, 110, 0.08);
          }
        }

        @media (max-width: 430px) {
          .employee-directory-card-main {
            align-items: flex-start;
          }

          .employee-directory-avatar-img,
          .employee-directory-avatar-fallback {
            width: 56px;
            height: 56px;
            border-radius: 18px;
          }

          .employee-directory-entity,
          .employee-directory-department {
            border-radius: 11px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .employee-directory-page *,
          .employee-directory-page *::before,
          .employee-directory-page *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <section className="employee-directory-hero">
        <div className="employee-directory-hero-content">
          <div>
            <div className="employee-directory-kicker">
              <Sparkles size={15} />
              Tenant Contact Hub
            </div>

            <h1 className="employee-directory-title">Employee Directory</h1>

            <p className="employee-directory-subtitle">
              View active employees from your company with quick access to their
              name, designation, state, phone number, email and profile photo.
              Resigned employees are automatically removed from this list.
            </p>
          </div>

          <div className="employee-directory-stat-card">
            <div className="employee-directory-stat-icon">
              <Users size={24} />
            </div>
            <div className="employee-directory-stat-value">
              {loading ? '...' : totalEmployees}
            </div>
            <div className="employee-directory-stat-label">
              Active contacts visible
            </div>
          </div>
        </div>
      </section>

      <form className="employee-directory-toolbar" onSubmit={applyFilters}>
        <div className="employee-directory-filter-grid">
          <label className="employee-directory-field">
            <Search size={17} />
            <input
              className="employee-directory-input"
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search name, phone, email, state..."
            />
          </label>

          <label className="employee-directory-field">
            <BriefcaseBusiness size={17} />
            <select
              className="employee-directory-select"
              value={filters.designation}
              onChange={(event) => updateFilter('designation', event.target.value)}
            >
              <option value="">All designations</option>
              {filterOptions.designations.map((designation) => (
                <option key={designation} value={designation}>
                  {designation}
                </option>
              ))}
            </select>
          </label>

          <label className="employee-directory-field">
            <MapPin size={17} />
            <select
              className="employee-directory-select"
              value={filters.state}
              onChange={(event) => updateFilter('state', event.target.value)}
            >
              <option value="">All states</option>
              {filterOptions.states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label className="employee-directory-field">
            <Phone size={17} />
            <input
              className="employee-directory-input"
              value={filters.phone}
              onChange={(event) => updateFilter('phone', event.target.value)}
              placeholder="Phone"
            />
          </label>

          <label className="employee-directory-field">
            <Mail size={17} />
            <input
              className="employee-directory-input"
              value={filters.email}
              onChange={(event) => updateFilter('email', event.target.value)}
              placeholder="Email"
            />
          </label>

          <button
            className="employee-directory-button employee-directory-button-primary"
            type="submit"
            disabled={loading || refreshing}
          >
            <Filter size={17} />
            Filter
          </button>

          <button
            className="employee-directory-button employee-directory-button-soft"
            type="button"
            onClick={() => loadDirectory(filters, { refresh: true })}
            disabled={loading || refreshing}
          >
            <RefreshCcw size={17} />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        {(filters.q ||
          filters.designation ||
          filters.state ||
          filters.phone ||
          filters.email) && (
          <div style={{ marginTop: 12 }}>
            <button
              className="employee-directory-button employee-directory-button-soft"
              type="button"
              onClick={clearFilters}
              disabled={loading || refreshing}
            >
              Clear filters
            </button>
          </div>
        )}
      </form>

      <div className="employee-directory-content-head">
        <h2 className="employee-directory-section-title">
          <UserRound size={20} />
          Directory List
        </h2>

        <div className="employee-directory-count-chip">
          Showing {visibleEmployees.length} of {totalEmployees}
        </div>
      </div>

      {error ? (
        <div className="employee-directory-error">{error}</div>
      ) : loading ? (
        <div className="employee-directory-loading-grid">
          <div className="employee-directory-skeleton" />
          <div className="employee-directory-skeleton" />
          <div className="employee-directory-skeleton" />
          <div className="employee-directory-skeleton" />
          <div className="employee-directory-skeleton" />
          <div className="employee-directory-skeleton" />
        </div>
      ) : visibleEmployees.length ? (
        <div className="employee-directory-grid">
          {visibleEmployees.map((employee) => (
            <article
              className="employee-directory-card"
              key={employee.id || employee._id || employee.email || employee.phone}
            >
              <div className="employee-directory-card-main">
                <div className="employee-directory-avatar">
                  <DirectoryAvatar employee={employee} />
                </div>

                <div>
                  <h3 className="employee-directory-name">
                    {cleanText(employee.name || employee.employee_name, 'Employee')}
                  </h3>

                  <div className="employee-directory-designation">
                    <BriefcaseBusiness size={14} />
                    {cleanText(employee.designation)}
                  </div>

                  <div className="employee-directory-entity">
                   Organisation: {cleanText(
                    employee.organisation ||
                      employee.organization ||
                      employee.organisation_name ||
                      employee.organization_name ||
                      employee.organisation_code ||
                      employee.organization_code
                  )}
                  </div>

                  <div className="employee-directory-department">
                    Department: {cleanText(employee.department || employee.department_name)}
                  </div>
                </div>
              </div>

              <div className="employee-directory-contact-list">
                <ContactPill
                  icon={MapPin}
                  value={employee.state}
                />

                <ContactPill
                  icon={Phone}
                  value={employee.phone}
                  type="phone"
                />

                <ContactPill
                  icon={Mail}
                  value={employee.email}
                  type="email"
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="employee-directory-empty">
          <div className="employee-directory-empty-icon">
            <Users size={26} />
          </div>
          <h3>No employees found</h3>
          <p>
            No active employee contact matched your current filters.
          </p>
        </div>
      )}
    </div>
  );
}