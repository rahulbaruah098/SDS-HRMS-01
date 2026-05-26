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
          position: relative;
          min-height: 100%;
          color: #10231d;
        }

        .employee-directory-hero {
          position: relative;
          overflow: hidden;
          border-radius: 30px;
          padding: 26px;
          background:
            radial-gradient(circle at top left, rgba(24, 139, 96, 0.28), transparent 34%),
            radial-gradient(circle at bottom right, rgba(10, 83, 61, 0.24), transparent 36%),
            linear-gradient(135deg, #f7fffb 0%, #e7f7ee 48%, #ffffff 100%);
          border: 1px solid rgba(13, 94, 67, 0.12);
          box-shadow: 0 24px 70px rgba(12, 70, 51, 0.13);
          margin-bottom: 22px;
        }

        .employee-directory-hero::before,
        .employee-directory-hero::after {
          content: "";
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
        }

        .employee-directory-hero::before {
          width: 230px;
          height: 230px;
          top: -90px;
          right: 9%;
          background: rgba(255, 255, 255, 0.68);
          filter: blur(2px);
        }

        .employee-directory-hero::after {
          width: 150px;
          height: 150px;
          bottom: -70px;
          left: 18%;
          background: rgba(9, 92, 65, 0.12);
        }

        .employee-directory-hero-content {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
        }

        .employee-directory-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.78);
          color: #0b4d3a;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border: 1px solid rgba(13, 94, 67, 0.12);
        }

        .employee-directory-title {
          margin: 14px 0 8px;
          font-size: clamp(28px, 4vw, 46px);
          line-height: 1.02;
          letter-spacing: -0.05em;
          color: #092f24;
          font-weight: 950;
        }

        .employee-directory-subtitle {
          max-width: 760px;
          margin: 0;
          color: #45665a;
          font-size: 15px;
          line-height: 1.65;
        }

        .employee-directory-stat-card {
          min-width: 210px;
          padding: 18px;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(13, 94, 67, 0.12);
          box-shadow: 0 18px 45px rgba(9, 70, 49, 0.12);
          backdrop-filter: blur(16px);
        }

        .employee-directory-stat-icon {
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: #0b4d3a;
          color: #ffffff;
          margin-bottom: 14px;
        }

        .employee-directory-stat-value {
          font-size: 34px;
          line-height: 1;
          font-weight: 950;
          color: #092f24;
        }

        .employee-directory-stat-label {
          margin-top: 5px;
          font-size: 13px;
          color: #5c756b;
          font-weight: 700;
        }

        .employee-directory-toolbar {
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.86);
          border: 1px solid rgba(13, 94, 67, 0.1);
          box-shadow: 0 18px 50px rgba(13, 64, 47, 0.08);
          padding: 18px;
          margin-bottom: 22px;
        }

        .employee-directory-filter-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 0.85fr) minmax(150px, 0.75fr) minmax(140px, 0.7fr) minmax(180px, 0.9fr) auto auto;
          gap: 12px;
          align-items: center;
        }

        .employee-directory-field {
          position: relative;
        }

        .employee-directory-field svg {
          position: absolute;
          left: 13px;
          top: 50%;
          transform: translateY(-50%);
          color: #789186;
          pointer-events: none;
        }

        .employee-directory-input,
        .employee-directory-select {
          width: 100%;
          border: 1px solid rgba(13, 94, 67, 0.12);
          background: #f7fbf8;
          color: #14382c;
          border-radius: 16px;
          min-height: 46px;
          padding: 0 14px 0 40px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .employee-directory-select {
          appearance: none;
          cursor: pointer;
        }

        .employee-directory-input:focus,
        .employee-directory-select:focus {
          background: #ffffff;
          border-color: rgba(11, 77, 58, 0.42);
          box-shadow: 0 0 0 4px rgba(11, 77, 58, 0.09);
        }

        .employee-directory-button {
          border: 0;
          min-height: 46px;
          padding: 0 16px;
          border-radius: 16px;
          font-weight: 850;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          white-space: nowrap;
          transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
        }

        .employee-directory-button:hover {
          transform: translateY(-1px);
        }

        .employee-directory-button-primary {
          background: #0b4d3a;
          color: #ffffff;
          box-shadow: 0 14px 26px rgba(11, 77, 58, 0.2);
        }

        .employee-directory-button-soft {
          background: #eef7f2;
          color: #0b4d3a;
          border: 1px solid rgba(11, 77, 58, 0.12);
        }

        .employee-directory-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .employee-directory-content-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 14px;
        }

        .employee-directory-section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #102f25;
          font-size: 18px;
          font-weight: 950;
        }

        .employee-directory-count-chip {
          padding: 7px 12px;
          border-radius: 999px;
          background: #ecf8f2;
          color: #0b4d3a;
          font-size: 12px;
          font-weight: 850;
          border: 1px solid rgba(11, 77, 58, 0.1);
        }

        .employee-directory-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .employee-directory-card {
          position: relative;
          overflow: hidden;
          border-radius: 26px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 255, 252, 0.96));
          border: 1px solid rgba(13, 94, 67, 0.1);
          box-shadow: 0 18px 48px rgba(10, 56, 41, 0.08);
          padding: 18px;
          isolation: isolate;
        }

        .employee-directory-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 20% 0%, rgba(39, 174, 96, 0.12), transparent 34%),
            radial-gradient(circle at 100% 100%, rgba(11, 77, 58, 0.1), transparent 38%);
          opacity: 0;
          transition: opacity 0.22s ease;
          z-index: -1;
        }

        .employee-directory-card:hover::before {
          opacity: 1;
        }

        .employee-directory-card-main {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 15px;
        }

        .employee-directory-avatar {
          flex: 0 0 auto;
        }

        .employee-directory-avatar-img,
        .employee-directory-avatar-fallback {
          width: 58px;
          height: 58px;
          border-radius: 22px;
          object-fit: cover;
          box-shadow: 0 12px 26px rgba(8, 58, 41, 0.14);
          border: 3px solid #ffffff;
        }

        .employee-directory-avatar-fallback {
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #0b4d3a, #169b69);
          color: #ffffff;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .employee-directory-name {
          margin: 0;
          font-size: 17px;
          line-height: 1.2;
          color: #102f25;
          font-weight: 950;
        }

        .employee-directory-designation {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          color: #58766b;
          font-size: 13px;
          font-weight: 750;
        }
        .employee-directory-entity,
        .employee-directory-department {
          margin-top: 6px;
          width: fit-content;
          max-width: 100%;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.25;
        }

        .employee-directory-entity {
          background: rgba(37, 99, 235, 0.09);
          color: #1d4ed8;
        }

        .employee-directory-department {
          background: rgba(11, 77, 58, 0.08);
          color: #0b4d3a;
        }

        .employee-directory-contact-list {
          display: grid;
          gap: 9px;
        }

        .employee-directory-pill {
          min-width: 0;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          width: 100%;
          padding: 10px 11px;
          border-radius: 15px;
          background: #f5fbf7;
          border: 1px solid rgba(13, 94, 67, 0.08);
          color: #173a2f;
          text-decoration: none;
          font-size: 13px;
          font-weight: 750;
          overflow-wrap: anywhere;
        }

        .employee-directory-pill svg {
          flex: 0 0 auto;
          color: #0b4d3a;
        }

        .employee-directory-pill-muted {
          color: #8a9c95;
        }

        .employee-directory-empty,
        .employee-directory-error {
          border-radius: 26px;
          background: #ffffff;
          border: 1px solid rgba(13, 94, 67, 0.1);
          box-shadow: 0 18px 48px rgba(10, 56, 41, 0.08);
          padding: 34px;
          text-align: center;
          color: #58766b;
        }

        .employee-directory-empty-icon,
        .employee-directory-loading-icon {
          width: 58px;
          height: 58px;
          display: grid;
          place-items: center;
          margin: 0 auto 14px;
          border-radius: 22px;
          background: #eef8f3;
          color: #0b4d3a;
        }

        .employee-directory-error {
          color: #8d2424;
          background: #fff7f7;
          border-color: rgba(185, 28, 28, 0.16);
        }

        .employee-directory-loading-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .employee-directory-skeleton {
          height: 210px;
          border-radius: 26px;
          background:
            linear-gradient(90deg, #f2f8f4 25%, #ffffff 37%, #f2f8f4 63%);
          background-size: 400% 100%;
          animation: employeeDirectorySkeleton 1.35s ease infinite;
          border: 1px solid rgba(13, 94, 67, 0.08);
        }

        @keyframes employeeDirectorySkeleton {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0 50%;
          }
        }

        @media (max-width: 1180px) {
          .employee-directory-filter-grid,
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
          }

          .employee-directory-hero-content {
            grid-template-columns: 1fr;
          }

          .employee-directory-stat-card {
            min-width: 0;
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

          .employee-directory-toolbar {
            padding: 14px;
            border-radius: 22px;
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