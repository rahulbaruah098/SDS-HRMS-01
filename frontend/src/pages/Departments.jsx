import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit3,
  FolderKanban,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

import {
  createCollectionItem,
  deleteCollectionItem,
  listCollection,
  updateCollectionItem,
} from '../api/client';

const DEFAULT_PAGE_SIZE = 100;
const DEPARTMENT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEPARTMENT_NOTICE_HIDE_MS = 3600;

const EMPTY_FORM = {
  name: '',
  code: '',
  status: 'active',
};

function safeText(value = '') {
  return String(value ?? '').trim();
}

function departmentName(row = {}) {
  return (
    safeText(row.name) ||
    safeText(row.department_name) ||
    'Unnamed Department'
  );
}

function departmentCode(row = {}) {
  return safeText(row.code).toUpperCase();
}

function statusValue(row = {}) {
  const value = safeText(row.status).toLowerCase();
  return value || 'active';
}

function statusLabel(value = '') {
  const status = safeText(value).toLowerCase();

  if (status === 'inactive') {
    return 'Inactive';
  }

  return 'Active';
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

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function DepartmentInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`department-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="department-inline-feedback-icon">
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

      <span className="department-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="department-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function DepartmentPagination({
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
    <div className="department-pagination">
      <div className="department-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>departments</span>
      </div>

      <div className="department-pagination-controls">
        <label className="department-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
            }}
            aria-label="Departments per page"
            disabled={loading}
          >
            {DEPARTMENT_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="department-page-button department-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="department-page-numbers" aria-label="Pagination">
          {pageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`department-page-number ${
                  item === safePage ? 'active' : ''
                }`}
                onClick={() => onPageChange(item)}
                disabled={loading}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="department-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="department-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="department-page-button department-page-nav"
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

function DepartmentFormModal({
  open,
  editing,
  form,
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
      className="department-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="department-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-form-title"
      >
        <header className="department-modal-header">
          <div>
            <span className="department-eyebrow">
              <Building2 size={16} />
              Department master
            </span>

            <h2 id="department-form-title">
              {editing ? 'Edit Department' : 'Create Department'}
            </h2>

            <p>
              {editing
                ? 'Update the department name, code or active status.'
                : 'Add a department that can be used in employee, attendance, leave, project and reporting workflows.'}
            </p>
          </div>

          <button
            type="button"
            className="department-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close department form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="department-form" onSubmit={onSubmit}>
          <div className="department-field">
            <label htmlFor="department-name">
              Department name <span>*</span>
            </label>

            <input
              id="department-name"
              autoFocus
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Example: Human Resources"
              maxLength={120}
              required
            />

            <small>
              This name will be available in employee, attendance, leave and
              project forms.
            </small>
          </div>

          <div className="department-field">
            <label htmlFor="department-code">Department code</label>

            <input
              id="department-code"
              value={form.code}
              onChange={(event) =>
                onChange(
                  'code',
                  event.target.value
                    .replace(/[^a-zA-Z0-9_-]/g, '')
                    .toUpperCase(),
                )
              }
              placeholder="Example: HR"
              maxLength={20}
            />

            <small>
              Use a short unique code. Letters, numbers, hyphens and underscores
              are accepted.
            </small>
          </div>

          <div className="department-field">
            <label htmlFor="department-status">Status</label>

            <select
              id="department-status"
              value={form.status}
              onChange={(event) => onChange('status', event.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <small>
              Inactive departments remain in historical records but should not be
              used for new employee assignments.
            </small>
          </div>

          {visibleFeedback ? (
            <DepartmentInlineMessage
              message={visibleFeedback}
              onClose={onFeedbackClose}
            />
          ) : null}

          <footer className="department-modal-footer">
            <button
              type="button"
              className="department-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="department-primary-button"
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
                  Create Department
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

function DepartmentDeleteModal({
  row,
  deletingId,
  onClose,
  onConfirm,
}) {
  if (!row || typeof document === 'undefined') {
    return null;
  }

  const id = recordId(row);
  const name = departmentName(row);

  return createPortal(
    <div
      className="department-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deletingId) {
          onClose();
        }
      }}
    >
      <section
        className="department-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-delete-title"
      >
        <div className="department-confirm-icon">
          <Trash2 size={24} />
        </div>

        <div className="department-confirm-heading">
          <span>Remove Department</span>
          <h2 id="department-delete-title">Confirm department removal</h2>
          <p>
            Remove <strong>{name}</strong>? The department will become inactive
            and remain available in historical records.
          </p>
        </div>

        <div className="department-confirm-summary">
          <div>
            <span>Department</span>
            <strong>{name}</strong>
          </div>

          <div>
            <span>Code</span>
            <strong>{departmentCode(row) || 'Not assigned'}</strong>
          </div>

          <div>
            <span>Current Status</span>
            <strong>{statusLabel(statusValue(row))}</strong>
          </div>
        </div>

        <div className="department-confirm-actions">
          <button
            type="button"
            className="department-secondary-button"
            onClick={onClose}
            disabled={deletingId === id}
          >
            Cancel
          </button>

          <button
            type="button"
            className="department-danger-button"
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

const DEPARTMENT_STYLES = `
@keyframes departmentSpin {
  to { transform: rotate(360deg); }
}

@keyframes departmentSectionReveal {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes departmentModalEnter {
  from { opacity: 0; transform: translateY(18px) scale(.975); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes departmentMobileSheetEnter {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

.departments-page {
  --department-ink: #101a3a;
  --department-muted: #596483;
  --department-primary: #6254da;
  --department-deep: #342b78;
  --department-blue: #3766db;
  --department-teal: #18aaa8;
  --department-flat-blue: #b9d7ff;
  --department-flat-violet: #c9c0ff;
  --department-flat-teal: #aee6d9;
  --department-line: rgba(171, 181, 211, .68);
  --department-ease: cubic-bezier(.22, 1, .36, 1);

  display: grid;
  gap: clamp(16px, 1.8vw, 24px);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  color: var(--department-ink);
  font-family: var(--yc-ui, var(--body), inherit);
}

.departments-page,
.departments-page * {
  box-sizing: border-box;
}

.departments-page > *,
.departments-page section,
.departments-page article,
.departments-page form,
.departments-page nav,
.departments-page label {
  min-width: 0;
  max-width: 100%;
}

.departments-page h1,
.departments-page h2,
.departments-page h3,
.departments-page p,
.departments-page span,
.departments-page strong,
.departments-page small {
  overflow-wrap: anywhere;
}

.departments-page button,
.departments-page input,
.departments-page select {
  font: inherit;
  max-width: 100%;
}

.departments-page button {
  cursor: pointer;
  touch-action: manipulation;
}

.is-spinning {
  animation: departmentSpin .8s linear infinite;
}

.department-hero {
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
    10px 12px 0 var(--department-flat-blue),
    0 26px 44px rgba(70, 92, 140, .12);
}

.department-hero::before {
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

.department-hero-copy {
  min-width: 0;
  max-width: 860px;
}

.department-eyebrow,
.department-section-kicker {
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

.department-eyebrow {
  padding: 9px 13px;
  box-shadow: 4px 5px 0 #575092;
}

.department-section-kicker {
  margin-bottom: 10px;
  padding: 7px 10px;
  box-shadow: 3px 4px 0 #575092;
}

.department-hero h1 {
  max-width: 900px;
  margin: 15px 0 0;
  color: var(--department-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(44px, 5.2vw, 76px);
  font-weight: 760;
  line-height: .94;
  letter-spacing: -.058em;
}

.department-hero p {
  max-width: 820px;
  margin: 17px 0 0;
  color: var(--department-muted);
  font-size: clamp(13px, 1vw, 16px);
  line-height: 1.68;
}

.department-hero-actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.department-action-stack {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
}

.department-primary-button,
.department-secondary-button,
.department-danger-button,
.department-icon-button,
.department-action-button,
.department-page-button,
.department-page-number {
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

.department-primary-button,
.department-secondary-button,
.department-danger-button {
  min-height: 48px;
  padding: 10px 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 15px;
}

.department-primary-button {
  border: 1px solid rgba(52, 43, 120, .16);
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow:
    5px 6px 0 #575092,
    0 12px 22px rgba(55, 102, 219, .16);
}

.department-secondary-button {
  border: 1px solid rgba(98, 84, 218, .18);
  color: var(--department-deep);
  background: #f1efff;
  box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
}

.department-danger-button {
  border: 1px solid rgba(190, 47, 85, .18);
  color: #fff;
  background: linear-gradient(135deg, #d84d68 0%, #bd3d58 100%);
  box-shadow: 5px 6px 0 #f2c2cc;
}

.department-primary-button:hover:not(:disabled),
.department-secondary-button:hover:not(:disabled),
.department-danger-button:hover:not(:disabled),
.department-icon-button:hover:not(:disabled),
.department-action-button:hover:not(:disabled),
.department-page-button:hover:not(:disabled),
.department-page-number:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.department-primary-button:disabled,
.department-secondary-button:disabled,
.department-danger-button:disabled,
.department-icon-button:disabled,
.department-action-button:disabled,
.department-page-button:disabled,
.department-page-number:disabled {
  opacity: .58;
  cursor: not-allowed;
  transform: none;
}

.department-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.department-kpi {
  min-width: 0;
  min-height: 120px;
  padding: 18px;
  display: block;
  border: 1px solid var(--department-line);
  border-radius: 22px;
  background: #edf6ff;
  box-shadow:
    7px 9px 0 var(--department-flat-blue),
    0 18px 30px rgba(34, 38, 110, .09);
  transition: transform 190ms ease, border-color 190ms ease;
}

.department-kpi:nth-child(2) {
  background: #eaf8f4;
  box-shadow:
    7px 9px 0 var(--department-flat-teal),
    0 18px 30px rgba(34, 38, 110, .09);
}

.department-kpi:nth-child(3) {
  background: #f1efff;
  box-shadow:
    7px 9px 0 var(--department-flat-violet),
    0 18px 30px rgba(34, 38, 110, .09);
}

.department-kpi:nth-child(4) {
  background: #fff4d5;
  box-shadow:
    7px 9px 0 #ffe0a5,
    0 18px 30px rgba(34, 38, 110, .09);
}

.department-kpi:hover {
  transform: translateY(-3px);
  border-color: rgba(98, 84, 218, .3);
}

.department-name-icon {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  display: inline-grid;
  place-items: center;
  border: 1px solid rgba(52, 43, 120, .15);
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
}

.department-kpi span {
  display: block;
  color: var(--department-muted);
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.department-kpi strong {
  display: block;
  margin-top: 8px;
  color: var(--department-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1;
}

.department-kpi small {
  display: block;
  margin-top: 6px;
  color: #7b88a5;
  font-size: 10px;
  line-height: 1.4;
}

.department-section-content {
  width: 100%;
  min-width: 0;
  animation: departmentSectionReveal 220ms ease both;
}

.department-panel {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--department-line);
  border-radius: clamp(26px, 2.2vw, 36px);
  background: #fff;
  box-shadow:
    8px 10px 0 #c4ccff,
    0 24px 42px rgba(34, 38, 110, .10);
}

.department-toolbar {
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

.department-toolbar-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-width: 0;
}

.department-toolbar-heading > svg {
  flex: 0 0 auto;
  margin-top: 4px;
  color: var(--department-primary);
}

.department-toolbar-heading h2 {
  margin: 0;
  color: var(--department-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(25px, 2.3vw, 37px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.045em;
}

.department-toolbar-heading p {
  margin: 8px 0 0;
  color: var(--department-muted);
  font-size: 13px;
  line-height: 1.58;
}

.department-toolbar-actions {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
  flex: 0 0 auto;
}

.department-search-row {
  display: grid;
  grid-template-columns:
    minmax(240px, 1.5fr)
    minmax(150px, .8fr)
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

.department-field {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.department-field label {
  color: #334164;
  font-size: 11px;
  font-weight: 900;
}

.department-field label span {
  color: #d84d68;
}

.department-input-wrap {
  position: relative;
}

.department-input-wrap > svg {
  position: absolute;
  top: 50%;
  left: 13px;
  color: var(--department-primary);
  transform: translateY(-50%);
  pointer-events: none;
}

.department-field input,
.department-field select,
.department-page-size-control select {
  width: 100%;
  min-height: 47px;
  padding: 0 13px;
  border: 1px solid rgba(159, 169, 205, .62);
  border-radius: 14px;
  outline: 0;
  color: var(--department-ink);
  background: rgba(255, 255, 255, .92);
  transition:
    border-color 170ms ease,
    box-shadow 170ms ease,
    transform 170ms ease;
}

.department-input-wrap input {
  padding-left: 39px;
}

.department-field input:focus,
.department-field select:focus,
.department-page-size-control select:focus {
  border-color: var(--department-primary);
  box-shadow:
    0 0 0 4px rgba(98, 84, 218, .10),
    3px 4px 0 rgba(98, 84, 218, .10);
  transform: translateY(-1px);
}

.department-field small {
  color: var(--department-muted);
  font-size: 11px;
  line-height: 1.45;
}

.department-clear-row {
  padding: 0 clamp(18px, 2vw, 26px) 18px;
}

.department-inline-feedback {
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

.department-inline-feedback.success {
  border-color: rgba(4, 120, 87, .18);
  color: #047857;
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.department-inline-feedback.warning {
  border-color: rgba(154, 104, 23, .18);
  color: #9a6817;
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.department-inline-feedback.error {
  border-color: rgba(162, 52, 77, .18);
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 3px 4px 0 #f2c2cc;
}

.department-inline-feedback-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  flex: 0 0 22px;
}

.department-inline-feedback-copy {
  min-width: 0;
}

.department-inline-feedback-copy strong,
.department-inline-feedback-copy span {
  display: block;
  overflow-wrap: anywhere;
}

.department-inline-feedback-copy strong {
  margin-bottom: 2px;
  font-weight: 950;
}

.department-inline-feedback-copy span {
  font-weight: 750;
}

.department-inline-feedback-close {
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

.department-inline-feedback-close:hover {
  background: #fff;
  transform: none;
  filter: none;
}

.department-table-wrap {
  overflow-x: auto;
  border-top: 1px solid rgba(65, 55, 161, .1);
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(98, 84, 218, .35) transparent;
  -webkit-overflow-scrolling: touch;
}

.department-table {
  width: 100%;
  min-width: 800px;
  border-collapse: collapse;
}

.department-table th {
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

.department-table td {
  padding: 17px 18px;
  border-top: 1px solid rgba(65, 55, 161, .09);
  color: #334164;
  background: rgba(255, 255, 255, .62);
  vertical-align: middle;
}

.department-table tbody tr:hover td {
  background: rgba(237, 246, 255, .82);
}

.department-name-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 245px;
}

.department-name-cell strong {
  display: block;
  color: var(--department-ink);
  font-weight: 950;
}

.department-name-cell small {
  display: block;
  margin-top: 4px;
  color: var(--department-muted);
  font-size: 11px;
}

.department-code {
  display: block;
  width: fit-content;
  min-width: 48px;
  padding: 7px 10px;
  border-radius: 999px;
  color: #3657b5;
  background: #e5e9ff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .045em;
  white-space: nowrap;
}

.department-code.empty {
  color: #5f6983;
  background: #edf0f6;
  font-weight: 750;
  letter-spacing: normal;
}

.department-status {
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

.department-status.active {
  color: #13736f;
  background: #dff8f3;
}

.department-status.inactive {
  color: #5f6983;
  background: #edf0f6;
}

.department-updated {
  display: grid;
  gap: 4px;
  min-width: 170px;
}

.department-updated small {
  color: var(--department-muted);
  font-size: 10px;
}

.department-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.department-action-button {
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(133, 149, 187, .3);
  border-radius: 12px;
}

.department-action-button.edit {
  border-color: rgba(98, 84, 218, .18);
  color: var(--department-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
}

.department-action-button.delete {
  border-color: rgba(190, 47, 85, .18);
  color: #b62f55;
  background: #ffe4ec;
}

.department-loading {
  display: grid;
  gap: 11px;
  padding: 28px 26px;
  border-top: 1px solid rgba(133, 149, 187, .18);
}

.department-loading span {
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
  animation: departmentLoading 1.25s linear infinite;
}

@keyframes departmentLoading {
  to { background-position: -400% 0; }
}

.department-empty {
  min-height: 220px;
  padding: 34px 22px;
  display: grid;
  place-items: center;
  gap: 10px;
  border-top: 1px solid rgba(65, 55, 161, .1);
  color: var(--department-muted);
  background: linear-gradient(
    145deg,
    rgba(237, 248, 255, .58),
    rgba(248, 241, 255, .52)
  );
  text-align: center;
}

.department-empty svg {
  color: var(--department-primary);
}

.department-empty h3 {
  margin: 0;
  color: var(--department-ink);
}

.department-empty p {
  max-width: 540px;
  margin: 0;
  line-height: 1.6;
}

.department-mobile-list {
  display: none;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid rgba(65, 55, 161, .1);
}

.department-mobile-card {
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

.department-mobile-top,
.department-mobile-bottom {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.department-mobile-title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.department-mobile-title > div:last-child {
  min-width: 0;
}

.department-mobile-title h3 {
  margin: 0;
  color: var(--department-ink);
  font-size: 17px;
}

.department-mobile-title p {
  margin: 4px 0 0;
  color: var(--department-muted);
  font-size: 12px;
}

.department-mobile-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.department-mobile-meta article {
  padding: 11px;
  border: 1px solid rgba(98, 84, 218, .08);
  border-radius: 13px;
  background: rgba(241, 239, 255, .52);
}

.department-mobile-meta span {
  display: block;
  color: var(--department-muted);
  font-size: 9px;
  font-weight: 850;
  text-transform: uppercase;
}

.department-mobile-meta strong {
  display: block;
  margin-top: 5px;
  color: var(--department-ink);
  font-size: 12px;
}

.department-pagination {
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

.department-pagination-copy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--department-muted);
  font-size: 10px;
  font-weight: 850;
}

.department-pagination-copy strong {
  color: var(--department-ink);
  font-size: 13px;
  font-weight: 950;
}

.department-pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.department-page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--department-muted);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.department-page-size-control select {
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

.department-page-button {
  min-width: 38px;
  height: 38px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 12px;
  color: var(--department-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
  font-size: 10px;
}

.department-page-nav {
  min-width: 78px;
}

.department-page-numbers {
  display: flex;
  align-items: center;
  gap: 5px;
}

.department-page-number {
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

.department-page-number.active {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 3px 4px 0 #575092;
}

.department-page-ellipsis {
  width: 18px;
  text-align: center;
  color: #7b88a5;
  font-weight: 900;
}

.department-page-indicator {
  min-width: 82px;
  color: var(--department-muted);
  font-size: 10px;
  font-weight: 900;
  text-align: center;
  white-space: nowrap;
}

.department-modal-backdrop {
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

.department-modal,
.department-confirm-modal {
  width: min(620px, 100%);
  max-height: calc(100dvh - 28px);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgba(255, 255, 255, .56);
  border-radius: 28px;
  background: #fff;
  box-shadow:
    0 34px 90px rgba(9, 16, 35, .30),
    8px 10px 0 rgba(185, 215, 255, .48);
  animation: departmentModalEnter 240ms var(--department-ease) both;
  -webkit-overflow-scrolling: touch;
}

.department-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 25px 26px 20px;
  border-bottom: 1px solid rgba(65, 55, 161, .10);
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
}

.department-modal-header h2,
.department-confirm-heading h2 {
  margin: 8px 0 0;
  color: var(--department-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(26px, 3vw, 38px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.04em;
}

.department-modal-header p,
.department-confirm-heading p {
  max-width: 500px;
  margin: 10px 0 0;
  color: var(--department-muted);
  font-size: 12px;
  line-height: 1.58;
}

.department-icon-button {
  width: 42px;
  min-width: 42px;
  height: 42px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 14px;
  color: var(--department-deep);
  background: #fff;
  box-shadow: 3px 4px 0 #c9c0ff;
}

.department-form {
  display: grid;
  gap: 18px;
  padding: 22px 26px 26px;
}

.department-modal-footer {
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

.department-confirm-modal {
  width: min(590px, 100%);
  padding: clamp(22px, 3vw, 30px);
}

.department-confirm-icon {
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

.department-confirm-heading > span {
  display: inline-block;
  color: #4767b4;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .10em;
  text-transform: uppercase;
}

.department-confirm-summary {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.department-confirm-summary div {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(162, 169, 196, .46);
  border-radius: 17px;
  background: #edf6ff;
  box-shadow: 3px 4px 0 #b9d7ff;
}

.department-confirm-summary div:nth-child(2) {
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.department-confirm-summary div:nth-child(3) {
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.department-confirm-summary span {
  display: block;
  margin-bottom: 6px;
  color: #5d6785;
  font-size: 8px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.department-confirm-summary strong {
  display: block;
  color: var(--department-ink);
  font-size: 12px;
}

.department-confirm-actions {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 1050px) {
  .department-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .department-search-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .department-search-row > button {
    grid-column: 1 / -1;
  }

  .department-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .department-pagination-controls {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 820px) {
  .department-table-wrap {
    display: none;
  }

  .department-mobile-list {
    display: grid;
  }

  .department-hero {
    grid-template-columns: 1fr;
  }

  .department-hero-actions {
    justify-content: flex-start;
  }

  .department-action-stack {
    width: min(360px, 100%);
  }

  .department-toolbar {
    flex-direction: column;
  }

  .department-toolbar-actions {
    width: min(360px, 100%);
  }
}

@media (max-width: 640px) {
  .departments-page {
    gap: 15px;
  }

  .department-hero {
    min-height: 0;
    padding: 20px;
    border-radius: 26px;
    box-shadow:
      6px 7px 0 var(--department-flat-blue),
      0 18px 30px rgba(34, 38, 110, .10);
  }

  .department-hero h1 {
    font-size: clamp(36px, 10vw, 52px);
  }

  .department-kpi-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .department-panel {
    border-radius: 22px;
    box-shadow:
      5px 6px 0 #c4ccff,
      0 17px 28px rgba(34, 38, 110, .09);
  }

  .department-search-row {
    grid-template-columns: 1fr;
    padding: 16px 18px 18px;
  }

  .department-search-row > button {
    grid-column: auto;
    width: 100%;
  }

  .department-clear-row {
    padding-inline: 18px;
  }

  .department-toolbar {
    padding: 18px;
  }

  .department-toolbar-actions,
  .department-toolbar-actions .department-secondary-button {
    width: 100%;
  }

  .department-mobile-list {
    padding: 12px;
  }

  .department-mobile-bottom {
    flex-direction: column;
  }

  .department-actions {
    width: 100%;
  }

  .department-actions .department-action-button {
    flex: 1 1 0;
  }

  .department-pagination {
    padding: 12px;
  }

  .department-pagination-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
  }

  .department-page-size-control,
  .department-page-numbers,
  .department-page-indicator {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .department-page-size-control {
    justify-content: space-between;
  }

  .department-page-size-control select {
    flex: 1 1 auto;
  }

  .department-page-numbers {
    justify-content: center;
    flex-wrap: wrap;
  }

  .department-page-indicator {
    text-align: center;
  }

  .department-page-nav {
    width: 100%;
  }

  .department-modal-backdrop {
    align-items: end;
    padding: 0;
  }

  .department-modal,
  .department-confirm-modal {
    width: 100%;
    max-width: 100%;
    max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
    margin: 0;
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -18px 60px rgba(34, 38, 110, .24);
    animation-name: departmentMobileSheetEnter;
    transform-origin: 50% 100%;
  }

  .department-modal-header,
  .department-form {
    padding-left: 19px;
    padding-right: 19px;
  }

  .department-modal-footer {
    margin-left: -19px;
    margin-right: -19px;
    padding-left: 19px;
    padding-right: 19px;
    flex-direction: column-reverse;
  }

  .department-modal-footer button,
  .department-confirm-actions button {
    width: 100%;
  }

  .department-confirm-modal {
    padding: 20px 18px max(18px, env(safe-area-inset-bottom));
  }

  .department-confirm-summary,
  .department-confirm-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 430px) {
  .department-mobile-top {
    flex-direction: column;
  }

  .department-mobile-meta {
    grid-template-columns: 1fr;
  }

  .department-page-number {
    width: 34px;
    height: 34px;
  }
}

@media (orientation: landscape) and (max-height: 600px) {
  .department-modal,
  .department-confirm-modal {
    max-height: calc(100dvh - 8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .departments-page *,
  .departments-page *::before,
  .departments-page *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default function Departments() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingRow, setEditingRow] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formReturnScope, setFormReturnScope] = useState('directory-actions');

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
        }, DEPARTMENT_NOTICE_HIDE_MS);
      }
    },
    [],
  );

  const loadDepartments = useCallback(
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
          'Refreshing department records...',
          'Refreshing',
          { loading: true, scope: feedbackScope },
        );
      }

      try {
        if (statusFilter) {
          const allSearchRows = [];
          const fetchLimit = 500;
          let fetchPage = 1;
          let sourceTotal = 0;

          while (true) {
            const data = await listCollection('departments', {
              page: fetchPage,
              limit: fetchLimit,
              q: appliedSearch,
              sort_by: 'name',
              sort_dir: 'asc',
            });

            const items = Array.isArray(data.items) ? data.items : [];
            sourceTotal = Number(data.total || 0);
            allSearchRows.push(...items);

            if (
              items.length === 0 ||
              allSearchRows.length >= sourceTotal
            ) {
              break;
            }

            fetchPage += 1;
          }

          const filteredRows = allSearchRows.filter(
            (row) => statusValue(row) === statusFilter,
          );
          const start = (Math.max(1, page) - 1) * pageSize;

          setRows(filteredRows.slice(start, start + pageSize));
          setTotal(filteredRows.length);
        } else {
          const data = await listCollection('departments', {
            page,
            limit: pageSize,
            q: appliedSearch,
            sort_by: 'name',
            sort_dir: 'asc',
          });

          setRows(Array.isArray(data.items) ? data.items : []);
          setTotal(Number(data.total || 0));
        }

        if (feedbackScope) {
          showMessage(
            'success',
            'Department records are up to date.',
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
          'Departments could not be loaded. Please check your access and try again.';

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
    [appliedSearch, page, pageSize, statusFilter, showMessage],
  );

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const visibleRows = rows;

  const activeCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'active').length,
    [rows],
  );

  const inactiveCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'inactive').length,
    [rows],
  );

  const codedCount = useMemo(
    () => rows.filter((row) => Boolean(departmentCode(row))).length,
    [rows],
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
        '.department-modal, .department-confirm-modal',
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
      if (event.target?.closest?.('.department-inline-feedback')) return;

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

  function openCreateForm(scope = 'directory-actions') {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError('');
    clearMessage();
    setFormReturnScope(scope);
    setFormOpen(true);
  }

  function openEditForm(row) {
    setEditingRow(row);
    setForm({
      name:
        departmentName(row) === 'Unnamed Department'
          ? ''
          : departmentName(row),
      code: departmentCode(row),
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
    setStatusFilter('');
    setPage(1);
  }

  async function submitDepartment(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const code = safeText(form.code).toUpperCase();
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('Department name is required.');
      return;
    }

    const payload = {
      name,
      department_name: name,
      code,
      status,
    };

    setSaving(true);
    setFormError('');

    showMessage(
      'info',
      editingRow
        ? 'Saving department changes...'
        : 'Creating the department...',
      editingRow ? 'Updating Department' : 'Creating Department',
      { loading: true, scope: 'form-modal' },
    );

    try {
      let response;

      if (editingRow) {
        const id = recordId(editingRow);

        if (!id) {
          throw new Error(
            'This department cannot be updated because its internal reference is missing.',
          );
        }

        response = await updateCollectionItem(
          'departments',
          id,
          payload,
        );
      } else {
        response = await createCollectionItem('departments', payload);
      }

      const wasEditing = Boolean(editingRow);
      const successText =
        response?.message ||
        (wasEditing
          ? 'Department updated successfully.'
          : 'Department created successfully.');

      setFormOpen(false);
      setEditingRow(null);
      setForm(EMPTY_FORM);
      setFormError('');

      await loadDepartments({ silent: true });

      showMessage(
        'success',
        successText,
        wasEditing ? 'Department Updated' : 'Department Created',
        { scope: formReturnScope },
      );
    } catch (error) {
      const errorMessage =
        error?.message ||
        `Unable to ${editingRow ? 'update' : 'create'} the department.`;

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

  function removeDepartment(row) {
    const id = recordId(row);

    if (!id) {
      setPageError(
        'This department cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setPendingDelete(row);
    setPageError('');
    clearMessage();
  }

  async function confirmRemoveDepartment() {
    if (!pendingDelete) return;

    const id = recordId(pendingDelete);

    if (!id) {
      setPendingDelete(null);
      setPageError(
        'This department cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setDeletingId(id);
    setPageError('');

    try {
      const response = await deleteCollectionItem('departments', id);
      const successText =
        response?.message || 'Department removed successfully.';

      setPendingDelete(null);

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadDepartments({ silent: true });
      }

      showMessage(
        'success',
        successText,
        'Department Removed',
        { scope: 'directory-actions' },
      );
    } catch (error) {
      const errorMessage =
        error?.message || 'Unable to remove the department.';

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

  const hasFilters = Boolean(appliedSearch || statusFilter);

  return (
    <section className="departments-page">
      <style>{DEPARTMENT_STYLES}</style>

      <header className="department-hero">
        <div className="department-hero-copy">
          <span className="department-eyebrow">
            <ShieldCheck size={17} />
            Employee setup
          </span>

          <h1>Departments</h1>

          <p>
            Build and maintain the department structure used throughout employee
            records, attendance, leave, projects, payroll and reports. Internal
            database IDs remain intentionally hidden.
          </p>
        </div>

        <div className="department-hero-actions">
          <div className="department-action-stack">
            <button
              type="button"
              className="department-primary-button"
              onClick={() => openCreateForm('hero-actions')}
            >
              <Plus size={18} />
              Add Department
            </button>

            {message.scope === 'hero-actions' ? (
              <DepartmentInlineMessage
                message={message}
                onClose={clearMessage}
              />
            ) : null}
          </div>
        </div>
      </header>

      <section className="department-kpi-grid" aria-label="Department summary">
        <article className="department-kpi">
          <div>
            <span>Total departments</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="department-kpi">
          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available for employee assignment</small>
          </div>
        </article>

        <article className="department-kpi">
          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained for historical records</small>
          </div>
        </article>

        <article className="department-kpi">
          <div>
            <span>Codes assigned</span>
            <strong>{codedCount.toLocaleString('en-IN')}</strong>
            <small>Departments with a short code</small>
          </div>
        </article>
      </section>

      {message.scope === 'page' ? (
        <DepartmentInlineMessage
          message={message}
          onClose={clearMessage}
        />
      ) : null}

      <section className="department-section-content department-panel">
          <div className="department-toolbar">
            <div className="department-toolbar-heading">
              <Activity size={21} />

              <div>
                <span className="department-section-kicker">
                  <FolderKanban size={12} />
                  Department Master
                </span>

                <h2>Department Directory</h2>

                <p>
                  Search, create, edit or safely deactivate departments without
                  exposing internal IDs.
                </p>
              </div>
            </div>

            <div className="department-toolbar-actions">
              <button
                type="button"
                className="department-secondary-button"
                onClick={() =>
                  loadDepartments({
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

              <button
                type="button"
                className="department-primary-button"
                onClick={() => openCreateForm('directory-actions')}
              >
                <Plus size={17} />
                Add Department
              </button>

              {message.scope === 'refresh' ? (
                <DepartmentInlineMessage
                  message={message}
                  onClose={clearMessage}
                />
              ) : null}

              {message.scope === 'directory-actions' ? (
                <DepartmentInlineMessage
                  message={message}
                  onClose={clearMessage}
                />
              ) : null}
            </div>
          </div>

          <form className="department-search-row" onSubmit={applySearch}>
            <div className="department-field">
              <label htmlFor="department-search">Search departments</label>

              <div className="department-input-wrap">
                <Search size={18} />

                <input
                  id="department-search"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Department name or code"
                />
              </div>
            </div>

            <div className="department-field">
              <label htmlFor="department-status-filter">Status</label>

              <select
                id="department-status-filter"
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

            <button type="submit" className="department-primary-button">
              <Search size={17} />
              Search
            </button>
          </form>

          {hasFilters ? (
            <div className="department-clear-row">
              <button
                type="button"
                className="department-secondary-button"
                onClick={clearFilters}
              >
                <X size={17} />
                Clear Filters
              </button>
            </div>
          ) : null}

          {pageError ? (
            <div className="department-clear-row">
              <DepartmentInlineMessage
                message={{
                  type: 'error',
                  title: 'Department Load Error',
                  text: pageError,
                }}
                onClose={() => setPageError('')}
              />
            </div>
          ) : null}

          <DepartmentPagination
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
            <div className="department-loading" aria-label="Loading departments">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : visibleRows.length > 0 ? (
            <>
              <div className="department-table-wrap">
                <table className="department-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Code</th>
                      <th>Status</th>
                      <th>Last updated</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleRows.map((row, index) => {
                      const id = recordId(row);
                      const code = departmentCode(row);
                      const status = statusValue(row);

                      return (
                        <tr
                          key={
                            id ||
                            `${departmentName(row)}-${code || 'no-code'}-${index}`
                          }
                        >
                          <td>
                            <div className="department-name-cell">
                              <span className="department-name-icon">
                                <Building2 size={19} />
                              </span>

                              <div>
                                <strong>{departmentName(row)}</strong>
                                <small>Department master record</small>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span
                              className={`department-code ${code ? '' : 'empty'}`}
                            >
                              {code || 'Not assigned'}
                            </span>
                          </td>

                          <td>
                            <span className={`department-status ${status}`}>
                              {status === 'active' ? (
                                <BadgeCheck size={15} />
                              ) : (
                                <CircleOff size={15} />
                              )}
                              {statusLabel(status)}
                            </span>
                          </td>

                          <td>
                            <div className="department-updated">
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
                            <div className="department-actions">
                              <button
                                type="button"
                                className="department-action-button edit"
                                onClick={() => openEditForm(row)}
                              >
                                <Edit3 size={16} />
                                Edit
                              </button>

                              <button
                                type="button"
                                className="department-action-button delete"
                                onClick={() => removeDepartment(row)}
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

              <div className="department-mobile-list">
                {visibleRows.map((row, index) => {
                  const id = recordId(row);
                  const code = departmentCode(row);
                  const status = statusValue(row);

                  return (
                    <article
                      className="department-mobile-card"
                      key={
                        id ||
                        `mobile-${departmentName(row)}-${code || 'no-code'}-${index}`
                      }
                    >
                      <div className="department-mobile-top">
                        <div className="department-mobile-title">
                          <span className="department-name-icon">
                            <Building2 size={19} />
                          </span>

                          <div>
                            <h3>{departmentName(row)}</h3>
                            <p>{code || 'No department code assigned'}</p>
                          </div>
                        </div>

                        <span className={`department-status ${status}`}>
                          {status === 'active' ? (
                            <BadgeCheck size={15} />
                          ) : (
                            <CircleOff size={15} />
                          )}
                          {statusLabel(status)}
                        </span>
                      </div>

                      <div className="department-mobile-meta">
                        <article>
                          <span>Department code</span>
                          <strong>{code || 'Not assigned'}</strong>
                        </article>

                        <article>
                          <span>Last updated</span>
                          <strong>
                            {formatDateTime(row.updated_at || row.created_at)}
                          </strong>
                        </article>
                      </div>

                      <div className="department-mobile-bottom">
                        <small>
                          Updated by{' '}
                          {safeText(row.updated_by_name) ||
                            safeText(row.created_by_name) ||
                            'the system'}
                        </small>

                        <div className="department-actions">
                          <button
                            type="button"
                            className="department-action-button edit"
                            onClick={() => openEditForm(row)}
                          >
                            <Edit3 size={16} />
                            Edit
                          </button>

                          <button
                            type="button"
                            className="department-action-button delete"
                            onClick={() => removeDepartment(row)}
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
            <div className="department-empty">
              <Building2 size={44} />
              <h3>No departments found</h3>
              <p>
                No department matches the current search and status filter. Clear
                the filters or create a new department.
              </p>

              <button
                type="button"
                className="department-primary-button"
                onClick={() => openCreateForm('directory-actions')}
              >
                <Plus size={17} />
                Add Department
              </button>
            </div>
          )}
        </section>

      <DepartmentFormModal
        open={formOpen}
        editing={Boolean(editingRow)}
        form={form}
        saving={saving}
        error={formError}
        feedback={message.scope === 'form-modal' ? message : null}
        onFeedbackClose={() => {
          clearMessage();
          setFormError('');
        }}
        onChange={updateForm}
        onClose={closeForm}
        onSubmit={submitDepartment}
      />

      <DepartmentDeleteModal
        row={pendingDelete}
        deletingId={deletingId}
        onClose={() => {
          if (!deletingId) {
            setPendingDelete(null);
          }
        }}
        onConfirm={confirmRemoveDepartment}
      />
    </section>
  );
}
