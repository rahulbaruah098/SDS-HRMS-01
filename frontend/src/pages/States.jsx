import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  CheckCircle2,
  Edit3,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
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
const STATE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const STATE_NOTICE_HIDE_MS = 3600;

const EMPTY_FORM = {
  name: '',
  code: '',
  status: 'active',
};

function safeText(value = '') {
  return String(value ?? '').trim();
}

function stateName(row = {}) {
  return safeText(row.name) || safeText(row.state_name) || 'Unnamed State';
}

function stateCode(row = {}) {
  return safeText(row.code || row.state_code).toUpperCase();
}

function statusValue(row = {}) {
  const value = safeText(row.status).toLowerCase();
  return value || 'active';
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

function StateInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`state-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="state-inline-feedback-icon">
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

      <span className="state-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="state-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function StatePagination({
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
    <div className="state-pagination">
      <div className="state-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>states</span>
      </div>

      <div className="state-pagination-controls">
        <label className="state-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
            }}
            aria-label="States per page"
            disabled={loading}
          >
            {STATE_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="state-page-button state-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="state-page-numbers" aria-label="Pagination">
          {pageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`state-page-number ${item === safePage ? 'active' : ''}`}
                onClick={() => onPageChange(item)}
                disabled={loading}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="state-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="state-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="state-page-button state-page-nav"
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

function StateFormModal({
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
      className="state-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="state-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="state-form-title"
      >
        <header className="state-modal-header">
          <div>
            <span className="state-eyebrow">
              <MapPin size={16} />
              State master
            </span>

            <h2 id="state-form-title">
              {editing ? 'Edit State' : 'Create State'}
            </h2>

            <p>
              {editing
                ? 'Update the operating-state name, code or availability.'
                : 'Add an operating state used in employee records, attendance, holidays, branches and payroll configuration.'}
            </p>
          </div>

          <button
            type="button"
            className="state-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close state form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="state-form" onSubmit={onSubmit}>
          <div className="state-field">
            <label htmlFor="state-name">
              State name <span>*</span>
            </label>

            <input
              id="state-name"
              autoFocus
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Example: Assam"
              maxLength={100}
              required
            />

            <small>
              This name will appear in employee, attendance, holiday and reporting
              forms.
            </small>
          </div>

          <div className="state-field">
            <label htmlFor="state-code">
              State code <span>*</span>
            </label>

            <input
              id="state-code"
              value={form.code}
              onChange={(event) =>
                onChange(
                  'code',
                  event.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase(),
                )
              }
              placeholder="Example: AS"
              minLength={2}
              maxLength={2}
              required
            />

            <small>
              Enter the standard two-letter state code, such as AS, TR, MN or AR.
            </small>
          </div>

          <div className="state-field">
            <label htmlFor="state-status">Status</label>

            <select
              id="state-status"
              value={form.status}
              onChange={(event) => onChange('status', event.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <small>
              Inactive states remain available in historical records but should
              not be offered in new employee or attendance forms.
            </small>
          </div>

          {visibleFeedback ? (
            <StateInlineMessage
              message={visibleFeedback}
              onClose={onFeedbackClose}
            />
          ) : null}

          <footer className="state-modal-footer">
            <button
              type="button"
              className="state-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="state-primary-button"
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
                  Create State
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

function StateDeleteModal({
  row,
  deletingId,
  onClose,
  onConfirm,
}) {
  if (!row || typeof document === 'undefined') {
    return null;
  }

  const id = recordId(row);
  const name = stateName(row);

  return createPortal(
    <div
      className="state-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deletingId) {
          onClose();
        }
      }}
    >
      <section
        className="state-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="state-delete-title"
      >
        <div className="state-confirm-icon">
          <Trash2 size={24} />
        </div>

        <div className="state-confirm-heading">
          <span>Remove State</span>
          <h2 id="state-delete-title">Confirm state removal</h2>
          <p>
            Remove <strong>{name}</strong>? The state will become unavailable
            for new assignments and remain available in historical records.
          </p>
        </div>

        <div className="state-confirm-summary">
          <div>
            <span>State</span>
            <strong>{name}</strong>
          </div>

          <div>
            <span>Code</span>
            <strong>{stateCode(row) || 'Not assigned'}</strong>
          </div>

          <div>
            <span>Current Status</span>
            <strong>{statusLabel(statusValue(row))}</strong>
          </div>
        </div>

        <div className="state-confirm-actions">
          <button
            type="button"
            className="state-secondary-button"
            onClick={onClose}
            disabled={deletingId === id}
          >
            Cancel
          </button>

          <button
            type="button"
            className="state-danger-button"
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

const STATE_STYLES = `
@keyframes stateSpin {
  to { transform: rotate(360deg); }
}

@keyframes stateSectionReveal {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes stateModalEnter {
  from { opacity: 0; transform: translateY(18px) scale(.975); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes stateMobileSheetEnter {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

.states-page {
  --state-ink: #101a3a;
  --state-muted: #596483;
  --state-primary: #6254da;
  --state-deep: #342b78;
  --state-blue: #3766db;
  --state-teal: #18aaa8;
  --state-flat-blue: #b9d7ff;
  --state-flat-violet: #c9c0ff;
  --state-flat-teal: #aee6d9;
  --state-line: rgba(171, 181, 211, .68);
  --state-ease: cubic-bezier(.22, 1, .36, 1);

  display: grid;
  gap: clamp(16px, 1.8vw, 24px);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  color: var(--state-ink);
  font-family: var(--yc-ui, var(--body), inherit);
}

.states-page,
.states-page * {
  box-sizing: border-box;
}

.states-page > *,
.states-page section,
.states-page article,
.states-page form,
.states-page nav,
.states-page label {
  min-width: 0;
  max-width: 100%;
}

.states-page h1,
.states-page h2,
.states-page h3,
.states-page p,
.states-page span,
.states-page strong,
.states-page small {
  overflow-wrap: anywhere;
}

.states-page button,
.states-page input,
.states-page select {
  font: inherit;
  max-width: 100%;
}

.states-page button {
  cursor: pointer;
  touch-action: manipulation;
}

.is-spinning {
  animation: stateSpin .8s linear infinite;
}

.state-hero {
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
    10px 12px 0 var(--state-flat-blue),
    0 26px 44px rgba(70, 92, 140, .12);
}

.state-hero::before {
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

.state-hero-copy {
  min-width: 0;
  max-width: 860px;
}

.state-eyebrow,
.state-section-kicker {
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

.state-eyebrow {
  padding: 9px 13px;
  box-shadow: 4px 5px 0 #575092;
}

.state-section-kicker {
  margin-bottom: 10px;
  padding: 7px 10px;
  box-shadow: 3px 4px 0 #575092;
}

.state-hero h1 {
  max-width: 900px;
  margin: 15px 0 0;
  color: var(--state-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(44px, 5.2vw, 76px);
  font-weight: 760;
  line-height: .94;
  letter-spacing: -.058em;
}

.state-hero p {
  max-width: 820px;
  margin: 17px 0 0;
  color: var(--state-muted);
  font-size: clamp(13px, 1vw, 16px);
  line-height: 1.68;
}

.state-hero-actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.state-action-stack {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
}

.state-primary-button,
.state-secondary-button,
.state-danger-button,
.state-icon-button,
.state-action-button,
.state-page-button,
.state-page-number {
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

.state-primary-button,
.state-secondary-button,
.state-danger-button {
  min-height: 48px;
  padding: 10px 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 15px;
}

.state-primary-button {
  border: 1px solid rgba(52, 43, 120, .16);
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow:
    5px 6px 0 #575092,
    0 12px 22px rgba(55, 102, 219, .16);
}

.state-secondary-button {
  border: 1px solid rgba(98, 84, 218, .18);
  color: var(--state-deep);
  background: #f1efff;
  box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
}

.state-danger-button {
  border: 1px solid rgba(190, 47, 85, .18);
  color: #fff;
  background: linear-gradient(135deg, #d84d68 0%, #bd3d58 100%);
  box-shadow: 5px 6px 0 #f2c2cc;
}

.state-primary-button:hover:not(:disabled),
.state-secondary-button:hover:not(:disabled),
.state-danger-button:hover:not(:disabled),
.state-icon-button:hover:not(:disabled),
.state-action-button:hover:not(:disabled),
.state-page-button:hover:not(:disabled),
.state-page-number:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.state-primary-button:disabled,
.state-secondary-button:disabled,
.state-danger-button:disabled,
.state-icon-button:disabled,
.state-action-button:disabled,
.state-page-button:disabled,
.state-page-number:disabled {
  opacity: .58;
  cursor: not-allowed;
  transform: none;
}

.state-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.state-kpi {
  min-width: 0;
  min-height: 120px;
  padding: 18px;
  display: block;
  border: 1px solid var(--state-line);
  border-radius: 22px;
  background: #edf6ff;
  box-shadow:
    7px 9px 0 var(--state-flat-blue),
    0 18px 30px rgba(34, 38, 110, .09);
  transition: transform 190ms ease, border-color 190ms ease;
}

.state-kpi:nth-child(2) {
  background: #eaf8f4;
  box-shadow:
    7px 9px 0 var(--state-flat-teal),
    0 18px 30px rgba(34, 38, 110, .09);
}

.state-kpi:nth-child(3) {
  background: #f1efff;
  box-shadow:
    7px 9px 0 var(--state-flat-violet),
    0 18px 30px rgba(34, 38, 110, .09);
}

.state-kpi:nth-child(4) {
  background: #fff4d5;
  box-shadow:
    7px 9px 0 #ffe0a5,
    0 18px 30px rgba(34, 38, 110, .09);
}

.state-kpi:hover {
  transform: translateY(-3px);
  border-color: rgba(98, 84, 218, .3);
}

.state-name-icon {
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

.state-kpi span {
  display: block;
  color: var(--state-muted);
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.state-kpi strong {
  display: block;
  margin-top: 8px;
  color: var(--state-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1;
}

.state-kpi small {
  display: block;
  margin-top: 6px;
  color: #7b88a5;
  font-size: 10px;
  line-height: 1.4;
}

.state-section-content {
  width: 100%;
  min-width: 0;
  animation: stateSectionReveal 220ms ease both;
}

.state-panel {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--state-line);
  border-radius: clamp(26px, 2.2vw, 36px);
  background: #fff;
  box-shadow:
    8px 10px 0 #c4ccff,
    0 24px 42px rgba(34, 38, 110, .10);
}

.state-toolbar {
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

.state-toolbar-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-width: 0;
}

.state-toolbar-heading > svg {
  flex: 0 0 auto;
  margin-top: 4px;
  color: var(--state-primary);
}

.state-toolbar-heading h2 {
  margin: 0;
  color: var(--state-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(25px, 2.3vw, 37px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.045em;
}

.state-toolbar-heading p {
  margin: 8px 0 0;
  color: var(--state-muted);
  font-size: 13px;
  line-height: 1.58;
}

.state-toolbar-actions {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
  flex: 0 0 auto;
}

.state-search-row {
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

.state-field {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.state-field label {
  color: #334164;
  font-size: 11px;
  font-weight: 900;
}

.state-field label span {
  color: #d84d68;
}

.state-input-wrap {
  position: relative;
}

.state-input-wrap > svg {
  position: absolute;
  top: 50%;
  left: 13px;
  color: var(--state-primary);
  transform: translateY(-50%);
  pointer-events: none;
}

.state-field input,
.state-field select,
.state-page-size-control select {
  width: 100%;
  min-height: 47px;
  padding: 0 13px;
  border: 1px solid rgba(159, 169, 205, .62);
  border-radius: 14px;
  outline: 0;
  color: var(--state-ink);
  background: rgba(255, 255, 255, .92);
  transition:
    border-color 170ms ease,
    box-shadow 170ms ease,
    transform 170ms ease;
}

.state-input-wrap input {
  padding-left: 39px;
}

.state-field input:focus,
.state-field select:focus,
.state-page-size-control select:focus {
  border-color: var(--state-primary);
  box-shadow:
    0 0 0 4px rgba(98, 84, 218, .10),
    3px 4px 0 rgba(98, 84, 218, .10);
  transform: translateY(-1px);
}

.state-field small {
  color: var(--state-muted);
  font-size: 11px;
  line-height: 1.45;
}

.state-clear-row {
  padding: 0 clamp(18px, 2vw, 26px) 18px;
}

.state-inline-feedback {
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

.state-inline-feedback.success {
  border-color: rgba(4, 120, 87, .18);
  color: #047857;
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.state-inline-feedback.warning {
  border-color: rgba(154, 104, 23, .18);
  color: #9a6817;
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.state-inline-feedback.error {
  border-color: rgba(162, 52, 77, .18);
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 3px 4px 0 #f2c2cc;
}

.state-inline-feedback-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  flex: 0 0 22px;
}

.state-inline-feedback-copy {
  min-width: 0;
}

.state-inline-feedback-copy strong,
.state-inline-feedback-copy span {
  display: block;
  overflow-wrap: anywhere;
}

.state-inline-feedback-copy strong {
  margin-bottom: 2px;
  font-weight: 950;
}

.state-inline-feedback-copy span {
  font-weight: 750;
}

.state-inline-feedback-close {
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

.state-inline-feedback-close:hover {
  background: #fff;
  transform: none;
  filter: none;
}

.state-table-wrap {
  overflow-x: auto;
  border-top: 1px solid rgba(65, 55, 161, .1);
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(98, 84, 218, .35) transparent;
  -webkit-overflow-scrolling: touch;
}

.state-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
}

.state-table th {
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

.state-table td {
  padding: 17px 18px;
  border-top: 1px solid rgba(65, 55, 161, .09);
  color: #334164;
  background: rgba(255, 255, 255, .62);
  vertical-align: middle;
}

.state-table tbody tr:hover td {
  background: rgba(237, 246, 255, .82);
}

.state-name-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 245px;
}

.state-name-cell strong {
  display: block;
  color: var(--state-ink);
  font-weight: 950;
}

.state-name-cell small {
  display: block;
  margin-top: 4px;
  color: var(--state-muted);
  font-size: 11px;
}

.state-code {
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

.state-code.empty {
  color: #5f6983;
  background: #edf0f6;
  font-weight: 750;
  letter-spacing: normal;
}

.state-status {
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

.state-status.active {
  color: #13736f;
  background: #dff8f3;
}

.state-status.inactive {
  color: #5f6983;
  background: #edf0f6;
}

.state-updated {
  display: grid;
  gap: 4px;
  min-width: 170px;
}

.state-updated small {
  color: var(--state-muted);
  font-size: 10px;
}

.state-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.state-action-button {
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(133, 149, 187, .3);
  border-radius: 12px;
}

.state-action-button.edit {
  border-color: rgba(98, 84, 218, .18);
  color: var(--state-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
}

.state-action-button.delete {
  border-color: rgba(190, 47, 85, .18);
  color: #b62f55;
  background: #ffe4ec;
}

.state-loading {
  display: grid;
  gap: 11px;
  padding: 28px 26px;
  border-top: 1px solid rgba(133, 149, 187, .18);
}

.state-loading span {
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
  animation: stateLoading 1.25s linear infinite;
}

@keyframes stateLoading {
  to { background-position: -400% 0; }
}

.state-empty {
  min-height: 220px;
  padding: 34px 22px;
  display: grid;
  place-items: center;
  gap: 10px;
  border-top: 1px solid rgba(65, 55, 161, .1);
  color: var(--state-muted);
  background: linear-gradient(
    145deg,
    rgba(237, 248, 255, .58),
    rgba(248, 241, 255, .52)
  );
  text-align: center;
}

.state-empty svg {
  color: var(--state-primary);
}

.state-empty h3 {
  margin: 0;
  color: var(--state-ink);
}

.state-empty p {
  max-width: 540px;
  margin: 0;
  line-height: 1.6;
}

.state-mobile-list {
  display: none;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid rgba(65, 55, 161, .1);
}

.state-mobile-card {
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

.state-mobile-top,
.state-mobile-bottom {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.state-mobile-title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.state-mobile-title > div:last-child {
  min-width: 0;
}

.state-mobile-title h3 {
  margin: 0;
  color: var(--state-ink);
  font-size: 17px;
}

.state-mobile-title p {
  margin: 4px 0 0;
  color: var(--state-muted);
  font-size: 12px;
}

.state-mobile-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.state-mobile-meta article {
  padding: 11px;
  border: 1px solid rgba(98, 84, 218, .08);
  border-radius: 13px;
  background: rgba(241, 239, 255, .52);
}

.state-mobile-meta span {
  display: block;
  color: var(--state-muted);
  font-size: 9px;
  font-weight: 850;
  text-transform: uppercase;
}

.state-mobile-meta strong {
  display: block;
  margin-top: 5px;
  color: var(--state-ink);
  font-size: 12px;
}

.state-pagination {
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

.state-pagination-copy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--state-muted);
  font-size: 10px;
  font-weight: 850;
}

.state-pagination-copy strong {
  color: var(--state-ink);
  font-size: 13px;
  font-weight: 950;
}

.state-pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.state-page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--state-muted);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.state-page-size-control select {
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

.state-page-button {
  min-width: 38px;
  height: 38px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 12px;
  color: var(--state-deep);
  background: #f1efff;
  box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
  font-size: 10px;
}

.state-page-nav {
  min-width: 78px;
}

.state-page-numbers {
  display: flex;
  align-items: center;
  gap: 5px;
}

.state-page-number {
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

.state-page-number.active {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 3px 4px 0 #575092;
}

.state-page-ellipsis {
  width: 18px;
  text-align: center;
  color: #7b88a5;
  font-weight: 900;
}

.state-page-indicator {
  min-width: 82px;
  color: var(--state-muted);
  font-size: 10px;
  font-weight: 900;
  text-align: center;
  white-space: nowrap;
}

.state-modal-backdrop {
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

.state-modal,
.state-confirm-modal {
  width: min(640px, 100%);
  max-height: calc(100dvh - 28px);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgba(255, 255, 255, .56);
  border-radius: 28px;
  background: #fff;
  box-shadow:
    0 34px 90px rgba(9, 16, 35, .30),
    8px 10px 0 rgba(185, 215, 255, .48);
  animation: stateModalEnter 240ms var(--state-ease) both;
  -webkit-overflow-scrolling: touch;
}

.state-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 25px 26px 20px;
  border-bottom: 1px solid rgba(65, 55, 161, .10);
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
}

.state-modal-header h2,
.state-confirm-heading h2 {
  margin: 8px 0 0;
  color: var(--state-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(26px, 3vw, 38px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.04em;
}

.state-modal-header p,
.state-confirm-heading p {
  max-width: 500px;
  margin: 10px 0 0;
  color: var(--state-muted);
  font-size: 12px;
  line-height: 1.58;
}

.state-icon-button {
  width: 42px;
  min-width: 42px;
  height: 42px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 84, 218, .18);
  border-radius: 14px;
  color: var(--state-deep);
  background: #fff;
  box-shadow: 3px 4px 0 #c9c0ff;
}

.state-form {
  display: grid;
  gap: 18px;
  padding: 22px 26px 26px;
}

.state-modal-footer {
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

.state-confirm-modal {
  width: min(590px, 100%);
  padding: clamp(22px, 3vw, 30px);
}

.state-confirm-icon {
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

.state-confirm-heading > span {
  display: inline-block;
  color: #4767b4;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .10em;
  text-transform: uppercase;
}

.state-confirm-summary {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.state-confirm-summary div {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(162, 169, 196, .46);
  border-radius: 17px;
  background: #edf6ff;
  box-shadow: 3px 4px 0 #b9d7ff;
}

.state-confirm-summary div:nth-child(2) {
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.state-confirm-summary div:nth-child(3) {
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.state-confirm-summary span {
  display: block;
  margin-bottom: 6px;
  color: #5d6785;
  font-size: 8px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.state-confirm-summary strong {
  display: block;
  color: var(--state-ink);
  font-size: 12px;
}

.state-confirm-actions {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 1050px) {
  .state-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-search-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-search-row > button {
    grid-column: 1 / -1;
  }

  .state-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .state-pagination-controls {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 820px) {
  .state-table-wrap {
    display: none;
  }

  .state-mobile-list {
    display: grid;
  }

  .state-hero {
    grid-template-columns: 1fr;
  }

  .state-hero-actions {
    justify-content: flex-start;
  }

  .state-action-stack {
    width: min(360px, 100%);
  }

  .state-toolbar {
    flex-direction: column;
  }

  .state-toolbar-actions {
    width: min(360px, 100%);
  }
}

@media (max-width: 640px) {
  .states-page {
    gap: 15px;
  }

  .state-hero {
    min-height: 0;
    padding: 20px;
    border-radius: 26px;
    box-shadow:
      6px 7px 0 var(--state-flat-blue),
      0 18px 30px rgba(34, 38, 110, .10);
  }

  .state-hero h1 {
    font-size: clamp(36px, 10vw, 52px);
  }

  .state-kpi-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .state-panel {
    border-radius: 22px;
    box-shadow:
      5px 6px 0 #c4ccff,
      0 17px 28px rgba(34, 38, 110, .09);
  }

  .state-search-row {
    grid-template-columns: 1fr;
    padding: 16px 18px 18px;
  }

  .state-search-row > button {
    grid-column: auto;
    width: 100%;
  }

  .state-clear-row {
    padding-inline: 18px;
  }

  .state-toolbar {
    padding: 18px;
  }

  .state-toolbar-actions,
  .state-toolbar-actions .state-secondary-button {
    width: 100%;
  }

  .state-mobile-list {
    padding: 12px;
  }

  .state-mobile-bottom {
    flex-direction: column;
  }

  .state-actions {
    width: 100%;
  }

  .state-actions .state-action-button {
    flex: 1 1 0;
  }

  .state-pagination {
    padding: 12px;
  }

  .state-pagination-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
  }

  .state-page-size-control,
  .state-page-numbers,
  .state-page-indicator {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .state-page-size-control {
    justify-content: space-between;
  }

  .state-page-size-control select {
    flex: 1 1 auto;
  }

  .state-page-numbers {
    justify-content: center;
    flex-wrap: wrap;
  }

  .state-page-indicator {
    text-align: center;
  }

  .state-page-nav {
    width: 100%;
  }

  .state-modal-backdrop {
    align-items: stretch;
    padding: 0;
  }

  .state-modal,
  .state-confirm-modal {
    width: 100%;
    max-width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border-radius: 0;
    box-shadow: none;
    animation-name: stateMobileSheetEnter;
    transform-origin: 50% 100%;
  }

  .state-modal-header,
  .state-form {
    padding-left: 19px;
    padding-right: 19px;
  }

  .state-modal-footer {
    margin-left: -19px;
    margin-right: -19px;
    padding-left: 19px;
    padding-right: 19px;
    flex-direction: column-reverse;
  }

  .state-modal-footer button,
  .state-confirm-actions button {
    width: 100%;
  }

  .state-confirm-modal {
    padding: 20px 18px max(18px, env(safe-area-inset-bottom));
  }

  .state-confirm-summary,
  .state-confirm-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 430px) {
  .state-mobile-top {
    flex-direction: column;
  }

  .state-mobile-meta {
    grid-template-columns: 1fr;
  }

  .state-page-number {
    width: 34px;
    height: 34px;
  }
}

@media (orientation: landscape) and (max-height: 600px) {
  .state-modal,
  .state-confirm-modal {
    max-height: calc(100dvh - 8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .states-page *,
  .states-page *::before,
  .states-page *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default function States() {
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
        }, STATE_NOTICE_HIDE_MS);
      }
    },
    [],
  );

  const loadStates = useCallback(
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
          'Refreshing state records...',
          'Refreshing',
          { loading: true, scope: feedbackScope },
        );
      }

      try {
        if (statusFilter) {
          const allSearchRows = [];
          const fetchLimit = 500;
          let fetchPage = 1;

          while (fetchPage <= 1000) {
            const data = await listCollection('states', {
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

          const filteredRows = allSearchRows.filter(
            (row) => statusValue(row) === statusFilter,
          );
          const start = (Math.max(1, page) - 1) * pageSize;

          setRows(filteredRows.slice(start, start + pageSize));
          setTotal(filteredRows.length);
        } else {
          const data = await listCollection('states', {
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
            'State records are up to date.',
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
          'States could not be loaded. Please check your access and try again.';

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
    [appliedSearch, page, pageSize, showMessage, statusFilter],
  );

  useEffect(() => {
    loadStates();
  }, [loadStates]);

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
    () => rows.filter((row) => stateCode(row).length === 2).length,
    [rows],
  );

  const alphabeticCoverage = useMemo(() => {
    const firstLetters = new Set(
      rows
        .map((row) => stateName(row).charAt(0).toUpperCase())
        .filter(Boolean),
    );

    return firstLetters.size;
  }, [rows]);

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
        '.state-modal, .state-confirm-modal',
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
      if (event.target?.closest?.('.state-inline-feedback')) return;

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
    const name = stateName(row);

    setEditingRow(row);
    setForm({
      name: name === 'Unnamed State' ? '' : name,
      code: stateCode(row),
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

  async function submitState(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const code = safeText(form.code).toUpperCase();
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('State name is required.');
      return;
    }

    if (!/^[A-Z]{2}$/.test(code)) {
      setFormError('State code must contain exactly two letters.');
      return;
    }

    setSaving(true);
    setFormError('');

    let duplicateCheckRows = [];

    try {
      const duplicateCheckLimit = 500;
      let duplicateCheckPage = 1;

      while (duplicateCheckPage <= 1000) {
        const data = await listCollection('states', {
          page: duplicateCheckPage,
          limit: duplicateCheckLimit,
          sort_by: 'name',
          sort_dir: 'asc',
        });

        const items = Array.isArray(data.items) ? data.items : [];
        const sourceTotal = Number(data.total || 0);

        duplicateCheckRows.push(...items);

        if (
          items.length === 0 ||
          (sourceTotal > 0 && duplicateCheckRows.length >= sourceTotal)
        ) {
          break;
        }

        duplicateCheckPage += 1;
      }
    } catch (error) {
      setFormError(
        error?.message ||
          'Unable to verify whether this state name or code already exists. Please try again.',
      );
      setSaving(false);
      return;
    }

    const duplicate = duplicateCheckRows.some((row) => {
      const currentId = recordId(row);
      const editingId = recordId(editingRow || {});

      if (editingId && currentId === editingId) {
        return false;
      }

      return (
        stateName(row).toLowerCase() === name.toLowerCase() ||
        stateCode(row) === code
      );
    });

    if (duplicate) {
      setFormError(
        'A state with the same name or two-letter code already exists.',
      );
      setSaving(false);
      return;
    }

    const payload = {
      name,
      state_name: name,
      code,
      state_code: code,
      status,
    };

    showMessage(
      'info',
      editingRow ? 'Saving state changes...' : 'Creating the state...',
      editingRow ? 'Updating State' : 'Creating State',
      { loading: true, scope: 'form-modal' },
    );

    try {
      let response;
      const wasEditing = Boolean(editingRow);

      if (editingRow) {
        const id = recordId(editingRow);

        if (!id) {
          throw new Error(
            'This state cannot be updated because its internal reference is missing.',
          );
        }

        response = await updateCollectionItem('states', id, payload);
      } else {
        response = await createCollectionItem('states', payload);
      }

      const successText =
        response?.message ||
        (wasEditing
          ? 'State updated successfully.'
          : 'State created successfully.');

      setFormOpen(false);
      setEditingRow(null);
      setForm(EMPTY_FORM);
      setFormError('');

      await loadStates({ silent: true });

      showMessage(
        'success',
        successText,
        wasEditing ? 'State Updated' : 'State Created',
        { scope: wasEditing ? 'directory-actions' : formReturnScope },
      );
    } catch (error) {
      const errorMessage =
        error?.message ||
        `Unable to ${editingRow ? 'update' : 'create'} the state.`;

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

  function removeState(row) {
    const id = recordId(row);

    if (!id) {
      setPageError(
        'This state cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setPendingDelete(row);
    setPageError('');
    clearMessage();
  }

  async function confirmRemoveState() {
    if (!pendingDelete) return;

    const id = recordId(pendingDelete);

    if (!id) {
      setPendingDelete(null);
      setPageError(
        'This state cannot be removed because its internal reference is missing.',
      );
      return;
    }

    setDeletingId(id);
    setPageError('');

    try {
      const response = await deleteCollectionItem('states', id);
      const successText =
        response?.message || 'State removed successfully.';

      setPendingDelete(null);

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadStates({ silent: true });
      }

      showMessage(
        'success',
        successText,
        'State Removed',
        { scope: 'directory-actions' },
      );
    } catch (error) {
      const errorMessage =
        error?.message || 'Unable to remove the state.';

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
    <section className="states-page">
      <style>{STATE_STYLES}</style>

      <header className="state-hero">
        <div className="state-hero-copy">
          <span className="state-eyebrow">
            <ShieldCheck size={17} />
            Operating locations
          </span>

          <h1>States</h1>

          <p>
            Maintain the operating states used in employee records, attendance,
            holiday calendars, branches, reports and payroll configuration.
            Internal database IDs are intentionally hidden.
          </p>
        </div>

        <div className="state-hero-actions">
          <div className="state-action-stack">
            <button
              type="button"
              className="state-primary-button"
              onClick={() => openCreateForm('hero-actions')}
            >
              <Plus size={18} />
              Add State
            </button>

            {message.scope === 'hero-actions' ? (
              <StateInlineMessage
                message={message}
                onClose={clearMessage}
              />
            ) : null}
          </div>
        </div>
      </header>

      <section className="state-kpi-grid" aria-label="State summary">
        <article className="state-kpi">
          <div>
            <span>Total states</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="state-kpi">
          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available in operational forms</small>
          </div>
        </article>

        <article className="state-kpi">
          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained for historical records</small>
          </div>
        </article>

        <article className="state-kpi">
          <div>
            <span>Valid codes</span>
            <strong>{codedCount.toLocaleString('en-IN')}</strong>
            <small>
              Covering {alphabeticCoverage.toLocaleString('en-IN')} alphabetic
              group{alphabeticCoverage === 1 ? '' : 's'}
            </small>
          </div>
        </article>
      </section>

      {message.scope === 'page' ? (
        <StateInlineMessage
          message={message}
          onClose={clearMessage}
        />
      ) : null}

      <section className="state-section-content state-panel">
        <div className="state-toolbar">
          <div className="state-toolbar-heading">
            <Activity size={21} />

            <div>
              <h2>State Directory</h2>
              <p>
                Search, create, update and safely deactivate operating states
                without exposing internal IDs.
              </p>
            </div>
          </div>

          <div className="state-toolbar-actions">
            <button
              type="button"
              className="state-secondary-button"
              onClick={() =>
                loadStates({
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
              <StateInlineMessage
                message={message}
                onClose={clearMessage}
              />
            ) : null}
          </div>
        </div>

        {message.scope === 'directory-actions' ? (
          <div className="state-clear-row">
            <StateInlineMessage
              message={message}
              onClose={clearMessage}
            />
          </div>
        ) : null}

        <form className="state-search-row" onSubmit={applySearch}>
          <div className="state-field">
            <label htmlFor="state-search">Search states</label>

            <div className="state-input-wrap">
              <Search size={18} />

              <input
                id="state-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="State name or two-letter code"
              />
            </div>
          </div>

          <div className="state-field">
            <label htmlFor="state-status-filter">Status</label>

            <select
              id="state-status-filter"
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

          <button type="submit" className="state-primary-button">
            <Search size={17} />
            Search
          </button>
        </form>

        {hasFilters ? (
          <div className="state-clear-row">
            <button
              type="button"
              className="state-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear Filters
            </button>
          </div>
        ) : null}

        {pageError ? (
          <div className="state-clear-row">
            <StateInlineMessage
              message={{
                type: 'error',
                title: 'State Load Error',
                text: pageError,
              }}
              onClose={() => setPageError('')}
            />
          </div>
        ) : null}

        <StatePagination
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
          <div className="state-loading" aria-label="Loading states">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="state-table-wrap">
              <table className="state-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const id = recordId(row);
                    const code = stateCode(row);
                    const status = statusValue(row);

                    return (
                      <tr
                        key={
                          id || `${stateName(row)}-${code || 'no-code'}-${index}`
                        }
                      >
                        <td>
                          <div className="state-name-cell">
                            <span className="state-name-icon">
                              <MapPin size={19} />
                            </span>

                            <div>
                              <strong>{stateName(row)}</strong>
                              <small>Operating-state master record</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="state-code">{code || '—'}</span>
                        </td>

                        <td>
                          <span className={`state-status ${status}`}>
                            {status === 'active' ? (
                              <BadgeCheck size={15} />
                            ) : (
                              <CircleOff size={15} />
                            )}
                            {statusLabel(status)}
                          </span>
                        </td>

                        <td>
                          <div className="state-updated">
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
                          <div className="state-actions">
                            <button
                              type="button"
                              className="state-action-button edit"
                              onClick={() => openEditForm(row)}
                            >
                              <Edit3 size={16} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="state-action-button delete"
                              onClick={() => removeState(row)}
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

            <div className="state-mobile-list">
              {visibleRows.map((row, index) => {
                const id = recordId(row);
                const code = stateCode(row);
                const status = statusValue(row);

                return (
                  <article
                    className="state-mobile-card"
                    key={
                      id ||
                      `mobile-${stateName(row)}-${code || 'no-code'}-${index}`
                    }
                  >
                    <div className="state-mobile-top">
                      <div className="state-mobile-title">
                        <span className="state-name-icon">
                          <MapPin size={19} />
                        </span>

                        <div>
                          <h3>{stateName(row)}</h3>
                          <p>{code || 'No state code assigned'}</p>
                        </div>
                      </div>

                      <span className={`state-status ${status}`}>
                        {status === 'active' ? (
                          <BadgeCheck size={15} />
                        ) : (
                          <CircleOff size={15} />
                        )}
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="state-mobile-meta">
                      <article>
                        <span>State code</span>
                        <strong>{code || 'Not assigned'}</strong>
                      </article>

                      <article>
                        <span>Last updated</span>
                        <strong>
                          {formatDateTime(row.updated_at || row.created_at)}
                        </strong>
                      </article>
                    </div>

                    <div className="state-mobile-bottom">
                      <small>
                        Updated by{' '}
                        {safeText(row.updated_by_name) ||
                          safeText(row.created_by_name) ||
                          'the system'}
                      </small>

                      <div className="state-actions">
                        <button
                          type="button"
                          className="state-action-button edit"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="state-action-button delete"
                          onClick={() => removeState(row)}
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
          <div className="state-empty">
            <MapPin size={44} />
            <h3>No states found</h3>
            <p>
              No state matches the current search and status filter. Clear the
              filters or create a new operating state.
            </p>

            <button
              type="button"
              className="state-primary-button"
              onClick={() => openCreateForm('directory-actions')}
            >
              <Plus size={17} />
              Add State
            </button>
          </div>
        )}
      </section>

      <StateFormModal
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
        onSubmit={submitState}
      />

      <StateDeleteModal
        row={pendingDelete}
        deletingId={deletingId}
        onClose={() => {
          if (!deletingId) {
            setPendingDelete(null);
          }
        }}
        onConfirm={confirmRemoveState}
      />
    </section>
  );
}
