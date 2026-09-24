import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCog,
  X,
} from 'lucide-react';

import {
  createCollectionItem,
  deleteCollectionItem,
  getDepartments,
  listCollection,
  updateCollectionItem,
} from '../api/client';

const DEFAULT_PAGE_SIZE = 100;
const DESIGNATION_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DESIGNATION_NOTICE_HIDE_MS = 3600;

const EMPTY_FORM = {
  name: '',
  title: '',
  department: '',
  status: 'active',
};

function safeText(value = '') {
  return String(value ?? '').trim();
}

function designationName(row = {}) {
  return (
    safeText(row.name) ||
    safeText(row.designation_name) ||
    safeText(row.title) ||
    'Unnamed Designation'
  );
}

function designationTitle(row = {}) {
  const title = safeText(row.title);

  if (!title || title.toLowerCase() === designationName(row).toLowerCase()) {
    return '';
  }

  return title;
}

function designationDepartment(row = {}) {
  return (
    safeText(row.department) ||
    safeText(row.department_name) ||
    'All / Not mapped'
  );
}

function statusValue(row = {}) {
  const status = safeText(row.status).toLowerCase();
  return status || 'active';
}

function statusLabel(value = '') {
  return safeText(value).toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}

function recordId(row = {}) {
  return safeText(row.id || row._id);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.$date) {
    return parseDate(value.$date);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseDate(value);

  if (!date) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function departmentOptionLabel(row = {}) {
  return (
    safeText(row.label) ||
    safeText(row.name) ||
    safeText(row.department_name) ||
    'Department'
  );
}


function pageNumbers(pageCount, page) {
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

function DesignationInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`designation-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="designation-inline-feedback-icon">
        {message.loading ? (
          <RefreshCw size={15} className="is-spinning" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <CircleOff size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="designation-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="designation-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function DesignationPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Number(pageSize || DEFAULT_PAGE_SIZE)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="designation-pagination">
      <div className="designation-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>designations</span>
      </div>

      <div className="designation-pagination-controls">
        <label className="designation-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
            }}
            aria-label="Designations per page"
            disabled={loading}
          >
            {DESIGNATION_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="designation-page-button designation-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="designation-page-numbers" aria-label="Pagination">
          {pageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`designation-page-number ${
                  item === safePage ? 'active' : ''
                }`}
                onClick={() => onPageChange(item)}
                disabled={loading}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="designation-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="designation-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="designation-page-button designation-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount || loading}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function DesignationFormModal({
  open,
  editing,
  form,
  departments,
  saving,
  error,
  feedback,
  onFeedbackClose,
  onChange,
  onClose,
  onSubmit,
}) {
  if (!open || typeof document === 'undefined') {
    return null;
  }

  const visibleFeedback =
    feedback?.text
      ? feedback
      : error
        ? {
            type: 'error',
            title: editing ? 'Update Failed' : 'Create Failed',
            text: error,
          }
        : null;

  return createPortal(
    <div
      className="designation-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="designation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="designation-form-title"
      >
        <header className="designation-modal-header">
          <div>
            <span className="designation-eyebrow">
              <BriefcaseBusiness size={16} />
              Designation master
            </span>

            <h2 id="designation-form-title">
              {editing ? 'Edit Designation' : 'Create Designation'}
            </h2>

            <p>
              {editing
                ? 'Update the designation identity, department mapping or status.'
                : 'Create a designation for employee records, reporting hierarchy and organisational filtering.'}
            </p>
          </div>

          <button
            type="button"
            className="designation-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close designation form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="designation-form" onSubmit={onSubmit}>
          <div className="designation-form-grid">
            <div className="designation-field designation-field-full">
              <label htmlFor="designation-name">
                Designation name <span>*</span>
              </label>

              <input
                id="designation-name"
                autoFocus
                value={form.name}
                onChange={(event) => onChange('name', event.target.value)}
                placeholder="Example: Senior Software Developer"
                maxLength={120}
                required
              />

              <small>
                This is the main designation name shown in employee records and
                reporting workflows.
              </small>
            </div>

            <div className="designation-field">
              <label htmlFor="designation-title">Short title</label>

              <input
                id="designation-title"
                value={form.title}
                onChange={(event) => onChange('title', event.target.value)}
                placeholder="Example: Sr. Developer"
                maxLength={80}
              />

              <small>An optional shorter display title.</small>
            </div>

            <div className="designation-field">
              <label htmlFor="designation-department">Department</label>

              <select
                id="designation-department"
                value={form.department}
                onChange={(event) => onChange('department', event.target.value)}
              >
                <option value="">All / Not mapped</option>

                {departments.map((department) => {
                  const label = departmentOptionLabel(department);

                  return (
                    <option
                      key={recordId(department) || label}
                      value={label}
                    >
                      {label}
                    </option>
                  );
                })}
              </select>

              <small>
                Mapping is optional and helps filter designations by department.
              </small>
            </div>

            <div className="designation-field designation-field-full">
              <label htmlFor="designation-status">Status</label>

              <select
                id="designation-status"
                value={form.status}
                onChange={(event) => onChange('status', event.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <small>
                Inactive designations remain visible in historical employee
                records but should not be used for new assignments.
              </small>
            </div>
          </div>

          {visibleFeedback ? (
            <DesignationInlineMessage
              message={visibleFeedback}
              onClose={onFeedbackClose}
            />
          ) : null}

          <footer className="designation-modal-footer">
            <button
              type="button"
              className="designation-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="designation-primary-button"
              disabled={saving}
            >
              {saving ? (
                <>
                  <RefreshCw size={17} className="is-spinning" />
                  Saving…
                </>
              ) : editing ? (
                <>
                  <Edit3 size={17} />
                  Save Changes
                </>
              ) : (
                <>
                  <Plus size={17} />
                  Create Designation
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function DesignationDeleteModal({
  row,
  deletingId,
  onClose,
  onConfirm,
}) {
  if (!row || typeof document === 'undefined') {
    return null;
  }

  const id = recordId(row);
  const name = designationName(row);

  return createPortal(
    <div
      className="designation-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deletingId) {
          onClose();
        }
      }}
    >
      <section
        className="designation-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="designation-delete-title"
      >
        <div className="designation-confirm-icon">
          <Trash2 size={24} />
        </div>

        <div className="designation-confirm-heading">
          <span>Remove Designation</span>
          <h2 id="designation-delete-title">Confirm designation removal</h2>
          <p>
            Remove <strong>{name}</strong>? The designation will become
            unavailable for new assignments and remain available in historical
            employee records.
          </p>
        </div>

        <div className="designation-confirm-summary">
          <div>
            <span>Designation</span>
            <strong>{name}</strong>
          </div>

          <div>
            <span>Department</span>
            <strong>{designationDepartment(row)}</strong>
          </div>

          <div>
            <span>Current Status</span>
            <strong>{statusLabel(statusValue(row))}</strong>
          </div>
        </div>

        <div className="designation-confirm-actions">
          <button
            type="button"
            className="designation-secondary-button"
            onClick={onClose}
            disabled={deletingId === id}
          >
            Cancel
          </button>

          <button
            type="button"
            className="designation-danger-button"
            onClick={onConfirm}
            disabled={deletingId === id}
          >
            {deletingId === id ? (
              <RefreshCw size={16} className="is-spinning" />
            ) : (
              <Trash2 size={16} />
            )}
            {deletingId === id ? 'Removing…' : 'Confirm Removal'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

const DESIGNATION_STYLES = `
@keyframes designationSpin {
  to { transform: rotate(360deg); }
}

@keyframes designationModalEnter {
  from { opacity: 0; transform: translateY(18px) scale(.975); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes designationMobileSheetEnter {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

.designations-page {
  --designation-ink: #101a3a;
  --designation-muted: #596483;
  --designation-primary: #6254da;
  --designation-deep: #342b78;
  --designation-blue: #3766db;
  --designation-teal: #18aaa8;
  --designation-flat-blue: #b9d7ff;
  --designation-flat-violet: #c9c0ff;
  --designation-flat-teal: #aee6d9;
  --designation-line: rgba(171, 181, 211, .68);
  --designation-ease: cubic-bezier(.22, 1, .36, 1);

  display: grid;
  gap: clamp(16px, 1.8vw, 24px);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  color: var(--designation-ink);
  font-family: var(--yc-ui, var(--body), inherit);
}

.designations-page,
.designations-page * {
  box-sizing: border-box;
}

.designations-page > *,
.designations-page section,
.designations-page article,
.designations-page form,
.designations-page nav,
.designations-page label {
  min-width: 0;
  max-width: 100%;
}

.designations-page h1,
.designations-page h2,
.designations-page h3,
.designations-page p,
.designations-page span,
.designations-page strong,
.designations-page small {
  overflow-wrap: anywhere;
}

.designations-page button,
.designations-page input,
.designations-page select {
  max-width: 100%;
  font: inherit;
}

.designations-page button {
  cursor: pointer;
  touch-action: manipulation;
}

.is-spinning {
  animation: designationSpin .8s linear infinite;
}

.designation-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 310px);
  gap: clamp(20px, 3vw, 38px);
  align-items: center;
  min-height: 240px;
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
  box-shadow:
    10px 12px 0 var(--designation-flat-blue),
    0 26px 44px rgba(70, 92, 140, .12);
}

.designation-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -2;
  opacity: .32;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
  background-size: 42px 42px;
}

.designation-hero-copy {
  min-width: 0;
  max-width: 860px;
}

.designation-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: 100%;
  padding: 9px 13px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 #575092;
  font-size: 9px;
  font-weight: 950;
  line-height: 1;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.designation-hero h1 {
  max-width: 900px;
  margin: 15px 0 0;
  color: var(--designation-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(44px, 5.2vw, 76px);
  font-weight: 760;
  line-height: .94;
  letter-spacing: -.058em;
}

.designation-hero p {
  max-width: 820px;
  margin: 17px 0 0;
  color: var(--designation-muted);
  font-size: clamp(13px, 1vw, 16px);
  line-height: 1.68;
}

.designation-hero-actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.designation-action-stack {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
}

.designation-primary-button,
.designation-secondary-button,
.designation-danger-button,
.designation-icon-button,
.designation-action-button,
.designation-page-button,
.designation-page-number {
  border: 0;
  font: inherit;
  font-weight: 900;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    filter 190ms ease,
    border-color 190ms ease,
    background 190ms ease,
    color 190ms ease;
}

.designation-primary-button,
.designation-secondary-button,
.designation-danger-button {
  min-height: 48px;
  padding: 10px 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 15px;
}

.designation-primary-button {
  border: 1px solid rgba(52, 43, 120, .16);
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow:
    5px 6px 0 #575092,
    0 12px 22px rgba(55, 102, 219, .16);
}

.designation-secondary-button {
  border: 1px solid rgba(98, 84, 218, .18);
  color: var(--designation-deep);
  background: #f1efff;
  box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
}

.designation-danger-button {
  border: 1px solid rgba(190, 47, 85, .18);
  color: #fff;
  background: linear-gradient(135deg, #d84d68 0%, #bd3d58 100%);
  box-shadow: 5px 6px 0 #f2c2cc;
}

.designation-primary-button:hover:not(:disabled),
.designation-secondary-button:hover:not(:disabled),
.designation-danger-button:hover:not(:disabled),
.designation-icon-button:hover:not(:disabled),
.designation-action-button:hover:not(:disabled),
.designation-page-button:hover:not(:disabled),
.designation-page-number:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.designation-primary-button:disabled,
.designation-secondary-button:disabled,
.designation-danger-button:disabled,
.designation-icon-button:disabled,
.designation-action-button:disabled,
.designation-page-button:disabled,
.designation-page-number:disabled {
  opacity: .58;
  cursor: not-allowed;
  transform: none;
}

.designation-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.designation-kpi {
  min-width: 0;
  min-height: 120px;
  padding: 18px;
  display: block;
  border: 1px solid var(--designation-line);
  border-radius: 22px;
  background: #edf6ff;
  box-shadow:
    7px 9px 0 var(--designation-flat-blue),
    0 18px 30px rgba(34, 38, 110, .09);
  transition: transform 190ms ease, border-color 190ms ease;
}

.designation-kpi:nth-child(2) {
  background: #eaf8f4;
  box-shadow:
    7px 9px 0 var(--designation-flat-teal),
    0 18px 30px rgba(34, 38, 110, .09);
}

.designation-kpi:nth-child(3) {
  background: #f1efff;
  box-shadow:
    7px 9px 0 var(--designation-flat-violet),
    0 18px 30px rgba(34, 38, 110, .09);
}

.designation-kpi:nth-child(4) {
  background: #fff4d5;
  box-shadow:
    7px 9px 0 #ffe0a5,
    0 18px 30px rgba(34, 38, 110, .09);
}

.designation-kpi:hover {
  transform: translateY(-3px);
  border-color: rgba(98, 84, 218, .3);
}

.designation-kpi span {
  display: block;
  color: var(--designation-muted);
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.designation-kpi strong {
  display: block;
  margin-top: 8px;
  color: var(--designation-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1;
}

.designation-kpi small {
  display: block;
  margin-top: 6px;
  color: #7b88a5;
  font-size: 10px;
  line-height: 1.4;
}

.designation-panel {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--designation-line);
  border-radius: clamp(26px, 2.2vw, 36px);
  background: #fff;
  box-shadow:
    8px 10px 0 #c4ccff,
    0 24px 42px rgba(34, 38, 110, .10);
}

.designation-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-width: 0;
  padding: clamp(18px, 2vw, 26px);
  border-bottom: 1px solid rgba(65, 55, 161, .08);
  background: rgba(255, 255, 255, .68);
}

.designation-toolbar-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-width: 0;
}

.designation-toolbar-heading > svg {
  flex: 0 0 auto;
  margin-top: 4px;
  color: var(--designation-primary);
}

.designation-toolbar-heading h2 {
  margin: 0;
  color: var(--designation-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(25px, 2.3vw, 37px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.045em;
}

.designation-toolbar-heading p {
  margin: 8px 0 0;
  color: var(--designation-muted);
  font-size: 13px;
  line-height: 1.58;
}

.designation-toolbar-actions {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
  flex: 0 0 auto;
}

.designation-directory-feedback {
  padding: 0 clamp(18px, 2vw, 26px) 18px;
}

.designation-search-row {
  display: grid;
  grid-template-columns:
    minmax(240px, 1.45fr)
    minmax(160px, .82fr)
    minmax(145px, .72fr)
    auto;
  gap: 10px;
  align-items: end;
  width: 100%;
  min-width: 0;
  padding: 18px clamp(18px, 2vw, 26px);
  background: linear-gradient(
    145deg,
    rgba(237, 248, 255, .44),
    rgba(248, 241, 255, .34)
  );
}

.designation-field {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.designation-field label {
  color: #334164;
  font-size: 11px;
  font-weight: 900;
}

.designation-field label span {
  color: #d84d68;
}

.designation-input-wrap {
  position: relative;
}

.designation-input-wrap > svg {
  position: absolute;
  top: 50%;
  left: 13px;
  color: var(--designation-primary);
  transform: translateY(-50%);
  pointer-events: none;
}

.designation-field input,
.designation-field select,
.designation-page-size-control select {
  width: 100%;
  min-height: 47px;
  padding: 0 13px;
  border: 1px solid rgba(159, 169, 205, .62);
  border-radius: 14px;
  outline: 0;
  color: var(--designation-ink);
  background: rgba(255, 255, 255, .92);
  transition:
    border-color 170ms ease,
    box-shadow 170ms ease,
    transform 170ms ease;
}

.designation-input-wrap input {
  padding-left: 39px;
}

.designation-field input:focus,
.designation-field select:focus,
.designation-page-size-control select:focus {
  border-color: var(--designation-primary);
  box-shadow:
    0 0 0 4px rgba(98, 84, 218, .10),
    3px 4px 0 rgba(98, 84, 218, .10);
  transform: translateY(-1px);
}

.designation-field small {
  color: var(--designation-muted);
  font-size: 11px;
  line-height: 1.45;
}

.designation-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.designation-field-full {
  grid-column: 1 / -1;
}

.designation-clear-row {
  padding: 0 clamp(18px, 2vw, 26px) 18px;
}

.designation-inline-feedback {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 9px;
  align-items: start;
  width: 100%;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid rgba(102, 88, 220, .18);
  border-radius: 12px;
  color: #40348d;
  background: #f1efff;
  box-shadow: 3px 4px 0 #c9c0ff;
  font-size: 10px;
  line-height: 1.45;
}

.designation-inline-feedback.success {
  border-color: rgba(4, 120, 87, .18);
  color: #047857;
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.designation-inline-feedback.warning {
  border-color: rgba(154, 104, 23, .18);
  color: #9a6817;
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.designation-inline-feedback.error {
  border-color: rgba(162, 52, 77, .18);
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 3px 4px 0 #f2c2cc;
}

.designation-inline-feedback-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
}

.designation-inline-feedback-copy {
  min-width: 0;
}

.designation-inline-feedback-copy strong,
.designation-inline-feedback-copy span {
  display: block;
  overflow-wrap: anywhere;
}

.designation-inline-feedback-copy strong {
  margin-bottom: 2px;
  font-weight: 950;
}

.designation-inline-feedback-copy span {
  font-weight: 750;
}

.designation-inline-feedback-close {
  width: 24px;
  min-width: 24px;
  height: 24px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: currentColor;
  background: rgba(255, 255, 255, .58);
  font-size: 17px;
  line-height: 1;
}

.designation-inline-feedback-close:hover {
  background: #fff;
  transform: none;
  filter: none;
}

.designation-table-wrap {
  overflow-x: auto;
  border-top: 1px solid rgba(65, 55, 161, .1);
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(98, 84, 218, .35) transparent;
  -webkit-overflow-scrolling: touch;
}

.designation-table {
  width: 100%;
  min-width: 940px;
  border-collapse: collapse;
}

.designation-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(65, 55, 161, .11);
  color: #4f5e7f;
  background: rgba(241, 239, 255, .94);
  backdrop-filter: blur(12px);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .065em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.designation-table td {
  padding: 17px 18px;
  border-top: 1px solid rgba(65, 55, 161, .09);
  color: #334164;
  background: rgba(255, 255, 255, .62);
  vertical-align: middle;
}

.designation-table tbody tr:hover td {
  background: rgba(237, 246, 255, .82);
}

.designation-name-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 250px;
}

.designation-name-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: inline-grid;
  place-items: center;
  border: 1px solid rgba(52, 43, 120, .15);
  border-radius: 13px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
}

.designation-name-cell strong {
  display: block;
  color: var(--designation-ink);
  font-weight: 950;
}

.designation-name-cell small {
  display: block;
  margin-top: 4px;
  color: var(--designation-muted);
  font-size: 11px;
}

.designation-department {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  max-width: 230px;
  padding: 7px 10px;
  border-radius: 999px;
  color: #3657b5;
  background: #e5e9ff;
  font-size: 11px;
  font-weight: 850;
}

.designation-department span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.designation-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 850;
  white-space: nowrap;
}

.designation-status.active {
  color: #13736f;
  background: #dff8f3;
}

.designation-status.inactive {
  color: #5f6983;
  background: #edf0f6;
}

.designation-updated {
  display: grid;
  gap: 4px;
  min-width: 170px;
}

.designation-updated small {
  color: var(--designation-muted);
  font-size: 10px;
}

.designation-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.designation-action-button {
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(133, 149, 187, .3);
  border-radius: 12px;
}

.designation-action-button.edit {
  border-color: rgba(98, 84, 218, .18);
  color: var(--designation-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
}

.designation-action-button.delete {
  border-color: rgba(190, 47, 85, .18);
  color: #b62f55;
  background: #ffe4ec;
}

.designation-loading {
  display: grid;
  gap: 11px;
  padding: 28px 26px;
  border-top: 1px solid rgba(133, 149, 187, .18);
}

.designation-loading span {
  display: block;
  height: 58px;
  border: 1px solid rgba(171, 181, 211, .5);
  border-radius: 15px;
  background:
    linear-gradient(
      90deg,
      #edf6ff 25%,
      #fff 37%,
      #f1efff 50%,
      #fff 63%,
      #edf6ff 75%
    );
  background-size: 400% 100%;
  animation: designationLoading 1.25s linear infinite;
}

@keyframes designationLoading {
  to { background-position: -400% 0; }
}

.designation-empty {
  min-height: 220px;
  padding: 34px 22px;
  display: grid;
  place-items: center;
  gap: 10px;
  border-top: 1px solid rgba(65, 55, 161, .1);
  color: var(--designation-muted);
  background: linear-gradient(
    145deg,
    rgba(237, 248, 255, .58),
    rgba(248, 241, 255, .52)
  );
  text-align: center;
}

.designation-empty svg {
  color: var(--designation-primary);
}

.designation-empty h3 {
  margin: 0;
  color: var(--designation-ink);
}

.designation-empty p {
  max-width: 540px;
  margin: 0;
  line-height: 1.6;
}

.designation-mobile-list {
  display: none;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid rgba(65, 55, 161, .1);
}

.designation-mobile-card {
  display: grid;
  gap: 14px;
  padding: 17px;
  border: 1px solid rgba(171, 181, 211, .64);
  border-radius: 18px;
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, .98),
    rgba(244, 249, 255, .94)
  );
  box-shadow:
    5px 6px 0 rgba(185, 215, 255, .72),
    0 14px 24px rgba(34, 38, 110, .07);
}

.designation-mobile-top,
.designation-mobile-bottom {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.designation-mobile-title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.designation-mobile-title > div:last-child {
  min-width: 0;
}

.designation-mobile-title h3 {
  margin: 0;
  color: var(--designation-ink);
  font-size: 17px;
}

.designation-mobile-title p {
  margin: 4px 0 0;
  color: var(--designation-muted);
  font-size: 12px;
}

.designation-mobile-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.designation-mobile-meta article {
  padding: 11px;
  border: 1px solid rgba(98, 84, 218, .08);
  border-radius: 13px;
  background: rgba(241, 239, 255, .52);
}

.designation-mobile-meta span {
  display: block;
  color: var(--designation-muted);
  font-size: 9px;
  font-weight: 850;
  text-transform: uppercase;
}

.designation-mobile-meta strong {
  display: block;
  margin-top: 5px;
  color: var(--designation-ink);
  font-size: 12px;
}

.designation-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  min-width: 0;
  padding: 14px clamp(18px, 2vw, 24px);
  border-top: 1px solid rgba(65, 55, 161, .1);
  background: rgba(255, 255, 255, .72);
}

.designation-pagination-copy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--designation-muted);
  font-size: 10px;
  font-weight: 850;
}

.designation-pagination-copy strong {
  color: var(--designation-ink);
  font-size: 13px;
  font-weight: 950;
}

.designation-pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.designation-page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--designation-muted);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.designation-page-size-control select {
  width: auto;
  min-width: 78px;
  min-height: 38px;
  padding: 0 28px 0 10px;
  color: #40348d;
  background: #f1efff;
  box-shadow: 2px 3px 0 #c9c0ff;
  font-size: 10px;
  font-weight: 900;
}

.designation-page-button {
  min-width: 38px;
  height: 38px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 12px;
  color: var(--designation-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
  font-size: 10px;
}

.designation-page-nav {
  min-width: 78px;
}

.designation-page-numbers {
  display: flex;
  align-items: center;
  gap: 5px;
}

.designation-page-number {
  width: 36px;
  height: 36px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 11px;
  color: #4767b4;
  background: #fff;
  box-shadow: 2px 3px 0 rgba(87, 80, 146, .12);
  font-size: 10px;
}

.designation-page-number.active {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 3px 4px 0 #575092;
}

.designation-page-ellipsis {
  width: 18px;
  text-align: center;
  color: #7b88a5;
  font-weight: 900;
}

.designation-page-indicator {
  min-width: 82px;
  color: var(--designation-muted);
  font-size: 10px;
  font-weight: 900;
  text-align: center;
  white-space: nowrap;
}

.designation-modal-backdrop {
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
  background: rgba(15, 23, 42, .48);
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
}

.designation-modal,
.designation-confirm-modal {
  width: min(720px, 100%);
  max-height: calc(100dvh - 28px);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgba(255, 255, 255, .56);
  border-radius: 28px;
  background: #fff;
  box-shadow:
    0 34px 90px rgba(9, 16, 35, .30),
    8px 10px 0 rgba(185, 215, 255, .48);
  animation: designationModalEnter 240ms var(--designation-ease) both;
  -webkit-overflow-scrolling: touch;
}

.designation-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 25px 26px 20px;
  border-bottom: 1px solid rgba(65, 55, 161, .10);
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
}

.designation-modal-header h2,
.designation-confirm-heading h2 {
  margin: 8px 0 0;
  color: var(--designation-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(26px, 3vw, 38px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.04em;
}

.designation-modal-header p,
.designation-confirm-heading p {
  max-width: 560px;
  margin: 10px 0 0;
  color: var(--designation-muted);
  font-size: 12px;
  line-height: 1.58;
}

.designation-icon-button {
  width: 42px;
  min-width: 42px;
  height: 42px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 14px;
  color: var(--designation-deep);
  background: #fff;
  box-shadow: 3px 4px 0 #c9c0ff;
}

.designation-form {
  display: grid;
  gap: 18px;
  padding: 22px 26px 26px;
}

.designation-modal-footer {
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin: 0 -26px -26px;
  padding: 16px 26px max(18px, env(safe-area-inset-bottom));
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid rgba(65, 55, 161, .11);
  background: rgba(255, 255, 255, .92);
  backdrop-filter: blur(14px);
}

.designation-confirm-modal {
  width: min(610px, 100%);
  padding: clamp(22px, 3vw, 30px);
}

.designation-confirm-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  margin-bottom: 16px;
  border-radius: 18px;
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 4px 5px 0 #f2c2cc;
}

.designation-confirm-heading > span {
  display: inline-block;
  color: #4767b4;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .10em;
  text-transform: uppercase;
}

.designation-confirm-summary {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.designation-confirm-summary div {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(162, 169, 196, .46);
  border-radius: 17px;
  background: #edf6ff;
  box-shadow: 3px 4px 0 #b9d7ff;
}

.designation-confirm-summary div:nth-child(2) {
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.designation-confirm-summary div:nth-child(3) {
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.designation-confirm-summary span {
  display: block;
  margin-bottom: 6px;
  color: #5d6785;
  font-size: 8px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.designation-confirm-summary strong {
  display: block;
  color: var(--designation-ink);
  font-size: 12px;
}

.designation-confirm-actions {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 1050px) {
  .designation-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .designation-search-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .designation-search-row > button {
    grid-column: 1 / -1;
  }

  .designation-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .designation-pagination-controls {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 820px) {
  .designation-table-wrap {
    display: none;
  }

  .designation-mobile-list {
    display: grid;
  }

  .designation-hero {
    grid-template-columns: 1fr;
  }

  .designation-hero-actions {
    justify-content: flex-start;
  }

  .designation-action-stack,
  .designation-toolbar-actions {
    width: min(360px, 100%);
  }

  .designation-toolbar {
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .designations-page {
    gap: 15px;
  }

  .designation-hero {
    min-height: 0;
    padding: 20px;
    border-radius: 26px;
    box-shadow:
      6px 7px 0 var(--designation-flat-blue),
      0 18px 30px rgba(34, 38, 110, .10);
  }

  .designation-hero h1 {
    font-size: clamp(36px, 10vw, 52px);
  }

  .designation-kpi-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .designation-panel {
    border-radius: 22px;
    box-shadow:
      5px 6px 0 #c4ccff,
      0 17px 28px rgba(34, 38, 110, .09);
  }

  .designation-toolbar {
    padding: 18px;
  }

  .designation-toolbar-actions,
  .designation-toolbar-actions .designation-secondary-button {
    width: 100%;
  }

  .designation-directory-feedback,
  .designation-clear-row {
    padding-inline: 18px;
  }

  .designation-search-row {
    grid-template-columns: 1fr;
    padding: 16px 18px 18px;
  }

  .designation-search-row > button {
    grid-column: auto;
    width: 100%;
  }

  .designation-mobile-list {
    padding: 12px;
  }

  .designation-mobile-bottom {
    flex-direction: column;
  }

  .designation-actions {
    width: 100%;
  }

  .designation-actions .designation-action-button {
    flex: 1 1 0;
  }

  .designation-pagination {
    padding: 12px;
  }

  .designation-pagination-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
  }

  .designation-page-size-control,
  .designation-page-numbers,
  .designation-page-indicator {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .designation-page-size-control {
    justify-content: space-between;
  }

  .designation-page-size-control select {
    flex: 1 1 auto;
  }

  .designation-page-numbers {
    justify-content: center;
    flex-wrap: wrap;
  }

  .designation-page-indicator {
    text-align: center;
  }

  .designation-page-nav {
    width: 100%;
  }

  .designation-modal-backdrop {
    align-items: end;
    padding: 0;
  }

  .designation-modal,
  .designation-confirm-modal {
    width: 100%;
    max-width: 100%;
    max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
    margin: 0;
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -18px 60px rgba(34, 38, 110, .24);
    animation-name: designationMobileSheetEnter;
    transform-origin: 50% 100%;
  }

  .designation-modal-header,
  .designation-form {
    padding-left: 19px;
    padding-right: 19px;
  }

  .designation-form-grid {
    grid-template-columns: 1fr;
  }

  .designation-field-full {
    grid-column: auto;
  }

  .designation-modal-footer {
    margin-left: -19px;
    margin-right: -19px;
    padding-left: 19px;
    padding-right: 19px;
    flex-direction: column-reverse;
  }

  .designation-modal-footer button,
  .designation-confirm-actions button {
    width: 100%;
  }

  .designation-confirm-modal {
    padding: 20px 18px max(18px, env(safe-area-inset-bottom));
  }

  .designation-confirm-summary,
  .designation-confirm-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 430px) {
  .designation-mobile-top {
    flex-direction: column;
  }

  .designation-mobile-meta {
    grid-template-columns: 1fr;
  }

  .designation-page-number {
    width: 34px;
    height: 34px;
  }
}

@media (orientation: landscape) and (max-height: 600px) {
  .designation-modal,
  .designation-confirm-modal {
    max-height: calc(100dvh - 8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .designations-page *,
  .designations-page *::before,
  .designations-page *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default function Designations() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingRow, setEditingRow] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formReturnScope, setFormReturnScope] = useState('hero-actions');

  const [pendingDelete, setPendingDelete] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState({
    type: '',
    text: '',
    title: '',
    scope: 'page',
    loading: false,
  });
  const messageTimerRef = useRef(null);

  const clearMessage = useCallback(() => {
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }

    setMessage({
      type: '',
      text: '',
      title: '',
      scope: 'page',
      loading: false,
    });
  }, []);

  const showMessage = useCallback(
    (type, text, title = '', options = {}) => {
      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }

      setMessage({
        type,
        text,
        title,
        scope: options.scope || 'page',
        loading: Boolean(options.loading),
      });

      if (!options.loading) {
        messageTimerRef.current = window.setTimeout(() => {
          setMessage({
            type: '',
            text: '',
            title: '',
            scope: 'page',
            loading: false,
          });
          messageTimerRef.current = null;
        }, DESIGNATION_NOTICE_HIDE_MS);
      }
    },
    [],
  );

  const loadDesignations = useCallback(
    async ({ silent = false, feedbackScope = '' } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setPageError('');

      if (feedbackScope) {
        showMessage(
          'info',
          'Refreshing designation records...',
          'Refreshing',
          { loading: true, scope: feedbackScope },
        );
      }

      try {
        const departmentPromise = getDepartments({ status: 'active' }).catch(
          () => ({ items: [] }),
        );

        let designationRows = [];
        let designationTotal = 0;

        if (statusFilter || departmentFilter) {
          const allSearchRows = [];
          const fetchLimit = 500;
          let fetchPage = 1;

          while (fetchPage <= 1000) {
            const data = await listCollection('designations', {
              page: fetchPage,
              limit: fetchLimit,
              q: appliedSearch,
              sort_by: 'name',
              sort_dir: 'asc',
            });

            const items = Array.isArray(data.items) ? data.items : [];
            const sourceTotal = Number(data.total || 0);

            allSearchRows.push(...items);

            if (
              items.length === 0 ||
              allSearchRows.length >= sourceTotal
            ) {
              break;
            }

            fetchPage += 1;
          }

          const filteredRows = allSearchRows.filter((row) => {
            if (statusFilter && statusValue(row) !== statusFilter) {
              return false;
            }

            if (
              departmentFilter &&
              designationDepartment(row) !== departmentFilter
            ) {
              return false;
            }

            return true;
          });

          const start = (Math.max(1, page) - 1) * pageSize;
          designationRows = filteredRows.slice(start, start + pageSize);
          designationTotal = filteredRows.length;
        } else {
          const designationData = await listCollection('designations', {
            page,
            limit: pageSize,
            q: appliedSearch,
            sort_by: 'name',
            sort_dir: 'asc',
          });

          designationRows = Array.isArray(designationData.items)
            ? designationData.items
            : [];
          designationTotal = Number(designationData.total || 0);
        }

        const departmentData = await departmentPromise;

        setRows(designationRows);
        setTotal(designationTotal);
        setDepartments(
          Array.isArray(departmentData.items) ? departmentData.items : [],
        );

        if (feedbackScope) {
          showMessage(
            'success',
            'Designation records are up to date.',
            'Refresh Complete',
            { scope: feedbackScope },
          );
        }

        return true;
      } catch (error) {
        setRows([]);
        setTotal(0);

        const errorMessage =
          error?.message ||
          'Designations could not be loaded. Please check your access and try again.';

        setPageError(errorMessage);

        if (feedbackScope) {
          showMessage(
            'error',
            errorMessage,
            'Refresh Failed',
            { scope: feedbackScope },
          );
        }

        return false;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      appliedSearch,
      departmentFilter,
      page,
      pageSize,
      showMessage,
      statusFilter,
    ],
  );

  useEffect(() => {
    loadDesignations();
  }, [loadDesignations]);

  const visibleRows = rows;

  const activeCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'active').length,
    [rows],
  );

  const inactiveCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'inactive').length,
    [rows],
  );

  const mappedCount = useMemo(
    () =>
      rows.filter(
        (row) => designationDepartment(row) !== 'All / Not mapped',
      ).length,
    [rows],
  );

  const uniqueDepartmentCount = useMemo(
    () =>
      new Set(
        rows
          .map(designationDepartment)
          .filter((value) => value !== 'All / Not mapped'),
      ).size,
    [rows],
  );

  const departmentOptions = useMemo(
    () =>
      [...new Set(
        departments
          .map(departmentOptionLabel)
          .filter((value) => value && value !== 'Department'),
      )].sort((first, second) => first.localeCompare(second)),
    [departments],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(total / Number(pageSize || DEFAULT_PAGE_SIZE)),
  );

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    const modalOpen = formOpen || Boolean(pendingDelete);

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
      const interactiveSurface = event.target?.closest?.(
        '.designation-modal, .designation-confirm-modal',
      );

      if (interactiveSurface) return;
      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (pendingDelete && !deletingId) {
        setPendingDelete(null);
        return;
      }

      if (formOpen && !saving) {
        setFormOpen(false);
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
  }, [formOpen, pendingDelete, saving, deletingId]);

  useEffect(() => {
    const dismissMessage = (event) => {
      if (event.target?.closest?.('.designation-inline-feedback')) return;

      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }

      setMessage((current) =>
        current.text
          ? {
              type: '',
              text: '',
              title: '',
              scope: 'page',
              loading: false,
            }
          : current,
      );
    };

    document.addEventListener('pointerdown', dismissMessage);

    return () => {
      document.removeEventListener('pointerdown', dismissMessage);

      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
    };
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openCreateForm(scope = 'hero-actions') {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError('');
    clearMessage();
    setFormReturnScope(scope);
    setFormOpen(true);
  }

  function openEditForm(row) {
    const name = designationName(row);

    setEditingRow(row);
    setForm({
      name: name === 'Unnamed Designation' ? '' : name,
      title: designationTitle(row),
      department:
        designationDepartment(row) === 'All / Not mapped'
          ? ''
          : designationDepartment(row),
      status: statusValue(row),
    });
    setFormError('');
    clearMessage();
    setFormReturnScope('directory-actions');
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setFormOpen(false);
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError('');
    clearMessage();
  }

  function applySearch(event) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  }

  function clearFilters() {
    setSearchInput('');
    setAppliedSearch('');
    setDepartmentFilter('');
    setStatusFilter('');
    setPage(1);
  }

  async function submitDesignation(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const title = safeText(form.title);
    const department = safeText(form.department);
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('Designation name is required.');
      return;
    }

    const payload = {
      name,
      designation_name: name,
      title: title || name,
      department,
      status,
    };

    setSaving(true);
    setFormError('');

    showMessage(
      'info',
      editingRow
        ? 'Saving designation changes...'
        : 'Creating the designation...',
      editingRow ? 'Updating Designation' : 'Creating Designation',
      { loading: true, scope: 'form-modal' },
    );

    try {
      let response;
      const wasEditing = Boolean(editingRow);

      if (editingRow) {
        const id = recordId(editingRow);

        if (!id) {
          throw new Error(
            'This designation cannot be updated because its internal reference is missing.',
          );
        }

        response = await updateCollectionItem(
          'designations',
          id,
          payload,
        );
      } else {
        response = await createCollectionItem('designations', payload);
      }

      const successText =
        response?.message ||
        (wasEditing
          ? 'Designation updated successfully.'
          : 'Designation created successfully.');

      setFormOpen(false);
      setEditingRow(null);
      setForm(EMPTY_FORM);
      setFormError('');

      await loadDesignations({ silent: true });

      showMessage(
        'success',
        successText,
        wasEditing ? 'Designation Updated' : 'Designation Created',
        { scope: wasEditing ? 'directory-actions' : formReturnScope },
      );
    } catch (error) {
      const errorMessage =
        error?.message ||
        `Unable to ${editingRow ? 'update' : 'create'} the designation.`;

      setFormError(errorMessage);

      showMessage(
        'error',
        errorMessage,
        editingRow ? 'Update Failed' : 'Create Failed',
        { scope: 'form-modal' },
      );
    } finally {
      setSaving(false);
    }
  }

  function removeDesignation(row) {
    const id = recordId(row);

    if (!id) {
      setPageError(
        'This designation cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setPendingDelete(row);
    setPageError('');
    clearMessage();
  }

  async function confirmRemoveDesignation() {
    if (!pendingDelete) return;

    const id = recordId(pendingDelete);

    if (!id) {
      setPendingDelete(null);
      setPageError(
        'This designation cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setDeletingId(id);
    setPageError('');

    try {
      const response = await deleteCollectionItem('designations', id);
      const successText =
        response?.message || 'Designation removed successfully.';

      setPendingDelete(null);

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadDesignations({ silent: true });
      }

      showMessage(
        'success',
        successText,
        'Designation Removed',
        { scope: 'directory-actions' },
      );
    } catch (error) {
      const errorMessage =
        error?.message || 'Unable to remove the designation.';

      setPageError(errorMessage);

      showMessage(
        'error',
        errorMessage,
        'Removal Failed',
        { scope: 'directory-actions' },
      );
    } finally {
      setDeletingId('');
    }
  }

  const hasFilters = Boolean(
    appliedSearch || departmentFilter || statusFilter,
  );

  return (
    <section className="designations-page">
      <style>{DESIGNATION_STYLES}</style>

      <header className="designation-hero">
        <div className="designation-hero-copy">
          <span className="designation-eyebrow">
            <ShieldCheck size={17} />
            Employee setup
          </span>

          <h1>Designations</h1>

          <p>
            Maintain the job titles used in employee records, user control,
            reporting hierarchy and workforce filtering. Internal database IDs are
            intentionally hidden from this interface.
          </p>
        </div>

        <div className="designation-hero-actions">
          <div className="designation-action-stack">
            <button
              type="button"
              className="designation-primary-button"
              onClick={() => openCreateForm('hero-actions')}
            >
              <Plus size={18} />
              Add Designation
            </button>

            {message.scope === 'hero-actions' ? (
              <DesignationInlineMessage
                message={message}
                onClose={clearMessage}
              />
            ) : null}
          </div>
        </div>
      </header>

      <section className="designation-kpi-grid" aria-label="Designation summary">
        <article className="designation-kpi">
          <div>
            <span>Total designations</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="designation-kpi">
          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available for new employee assignments</small>
          </div>
        </article>

        <article className="designation-kpi">
          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained in historical employee records</small>
          </div>
        </article>

        <article className="designation-kpi">
          <div>
            <span>Department mapped</span>
            <strong>{mappedCount.toLocaleString('en-IN')}</strong>
            <small>
              Across {uniqueDepartmentCount.toLocaleString('en-IN')} department
              {uniqueDepartmentCount === 1 ? '' : 's'}
            </small>
          </div>
        </article>
      </section>

      {message.scope === 'page' ? (
        <DesignationInlineMessage
          message={message}
          onClose={clearMessage}
        />
      ) : null}

      <section className="designation-panel">
        <div className="designation-toolbar">
          <div className="designation-toolbar-heading">
            <Activity size={21} />

            <div>
              <h2>Designation Directory</h2>
              <p>
                Search, create, update and safely deactivate designations without
                exposing internal IDs.
              </p>
            </div>
          </div>

          <div className="designation-toolbar-actions">
            <button
              type="button"
              className="designation-secondary-button"
              onClick={() =>
                loadDesignations({
                  silent: true,
                  feedbackScope: 'refresh',
                })
              }
              disabled={refreshing}
            >
              <RefreshCw
                size={17}
                className={refreshing ? 'is-spinning' : ''}
              />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>

            {message.scope === 'refresh' ? (
              <DesignationInlineMessage
                message={message}
                onClose={clearMessage}
              />
            ) : null}
          </div>
        </div>

        {message.scope === 'directory-actions' ? (
          <div className="designation-directory-feedback">
            <DesignationInlineMessage
              message={message}
              onClose={clearMessage}
            />
          </div>
        ) : null}

        <form className="designation-search-row" onSubmit={applySearch}>
          <div className="designation-field">
            <label htmlFor="designation-search">Search designations</label>

            <div className="designation-input-wrap">
              <Search size={18} />

              <input
                id="designation-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Designation name or short title"
              />
            </div>
          </div>

          <div className="designation-field">
            <label htmlFor="designation-department-filter">Department</label>

            <select
              id="designation-department-filter"
              value={departmentFilter}
              onChange={(event) => {
                setDepartmentFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All departments</option>

              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </div>

          <div className="designation-field">
            <label htmlFor="designation-status-filter">Status</label>

            <select
              id="designation-status-filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <button type="submit" className="designation-primary-button">
            <Search size={17} />
            Search
          </button>
        </form>

        {hasFilters ? (
          <div className="designation-clear-row">
            <button
              type="button"
              className="designation-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear Filters
            </button>
          </div>
        ) : null}

        {pageError ? (
          <div className="designation-clear-row">
            <DesignationInlineMessage
              message={{
                type: 'error',
                title: 'Designation Load Error',
                text: pageError,
              }}
              onClose={() => setPageError('')}
            />
          </div>
        ) : null}

        <DesignationPagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPage(1);
            setPageSize(value);
          }}
          loading={loading}
        />

        {loading ? (
          <div className="designation-loading" aria-label="Loading designations">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="designation-table-wrap">
              <table className="designation-table">
                <thead>
                  <tr>
                    <th>Designation</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const id = recordId(row);
                    const status = statusValue(row);
                    const title = designationTitle(row);

                    return (
                      <tr
                        key={
                          id ||
                          `${designationName(row)}-${designationDepartment(row)}-${index}`
                        }
                      >
                        <td>
                          <div className="designation-name-cell">
                            <span className="designation-name-icon">
                              <UserRoundCog size={20} />
                            </span>

                            <div>
                              <strong>{designationName(row)}</strong>
                              <small>
                                {title || 'No separate short title'}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="designation-department">
                            <Building2 size={15} />
                            <span>{designationDepartment(row)}</span>
                          </span>
                        </td>

                        <td>
                          <span className={`designation-status ${status}`}>
                            {status === 'active' ? (
                              <BadgeCheck size={15} />
                            ) : (
                              <CircleOff size={15} />
                            )}
                            {statusLabel(status)}
                          </span>
                        </td>

                        <td>
                          <div className="designation-updated">
                            <strong>
                              {formatDateTime(row.updated_at || row.created_at)}
                            </strong>
                            <small>
                              {safeText(row.updated_by_name) ||
                                safeText(row.created_by_name) ||
                                'Updated by the system'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="designation-actions">
                            <button
                              type="button"
                              className="designation-action-button edit"
                              onClick={() => openEditForm(row)}
                            >
                              <Edit3 size={16} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="designation-action-button delete"
                              onClick={() => removeDesignation(row)}
                              disabled={deletingId === id}
                            >
                              {deletingId === id ? (
                                <RefreshCw size={16} className="is-spinning" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                              {deletingId === id ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="designation-mobile-list">
              {visibleRows.map((row, index) => {
                const id = recordId(row);
                const status = statusValue(row);
                const title = designationTitle(row);

                return (
                  <article
                    className="designation-mobile-card"
                    key={
                      id ||
                      `mobile-${designationName(row)}-${designationDepartment(row)}-${index}`
                    }
                  >
                    <div className="designation-mobile-top">
                      <div className="designation-mobile-title">
                        <span className="designation-name-icon">
                          <UserRoundCog size={20} />
                        </span>

                        <div>
                          <h3>{designationName(row)}</h3>
                          <p>{title || 'No separate short title'}</p>
                        </div>
                      </div>

                      <span className={`designation-status ${status}`}>
                        {status === 'active' ? (
                          <BadgeCheck size={15} />
                        ) : (
                          <CircleOff size={15} />
                        )}
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="designation-mobile-meta">
                      <article>
                        <span>Department</span>
                        <strong>{designationDepartment(row)}</strong>
                      </article>

                      <article>
                        <span>Last updated</span>
                        <strong>
                          {formatDateTime(row.updated_at || row.created_at)}
                        </strong>
                      </article>
                    </div>

                    <div className="designation-mobile-bottom">
                      <small>
                        Updated by{' '}
                        {safeText(row.updated_by_name) ||
                          safeText(row.created_by_name) ||
                          'the system'}
                      </small>

                      <div className="designation-actions">
                        <button
                          type="button"
                          className="designation-action-button edit"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="designation-action-button delete"
                          onClick={() => removeDesignation(row)}
                          disabled={deletingId === id}
                        >
                          {deletingId === id ? (
                            <RefreshCw size={16} className="is-spinning" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                          {deletingId === id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="designation-empty">
            <BriefcaseBusiness size={44} />
            <h3>No designations found</h3>
            <p>
              No designation matches the current search and filters. Clear the
              filters or create a new designation.
            </p>

            <button
              type="button"
              className="designation-primary-button"
              onClick={() => openCreateForm('directory-actions')}
            >
              <Plus size={17} />
              Add Designation
            </button>
          </div>
        )}
      </section>

      <DesignationFormModal
        open={formOpen}
        editing={Boolean(editingRow)}
        form={form}
        departments={departments}
        saving={saving}
        error={formError}
        feedback={message.scope === 'form-modal' ? message : null}
        onFeedbackClose={() => {
          clearMessage();
          setFormError('');
        }}
        onChange={updateForm}
        onClose={closeForm}
        onSubmit={submitDesignation}
      />

      <DesignationDeleteModal
        row={pendingDelete}
        deletingId={deletingId}
        onClose={() => {
          if (!deletingId) {
            setPendingDelete(null);
          }
        }}
        onConfirm={confirmRemoveDesignation}
      />
    </section>
  );
}
