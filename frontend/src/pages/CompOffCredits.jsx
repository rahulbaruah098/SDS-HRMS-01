import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  History,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
  XCircle,
} from 'lucide-react';
import { claimCompOff, getMyCompOffs } from '../api/client';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const COMP_OFF_NOTICE_HIDE_MS = 3600;
const COMP_OFF_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.compoffs)) return value.compoffs;
  return [];
}

function dateInputValue(value) {
  if (!value) return '';

  const directMatch = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

  if (directMatch) return directMatch[1];

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return '';

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const normalized = dateInputValue(value);

  if (!normalized) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function formatDate(value) {
  const parsed = parseLocalDate(value);

  if (!parsed) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function normalizeStatus(value) {
  return String(value || 'available').trim().toLowerCase();
}

function statusLabel(value) {
  const status = normalizeStatus(value);

  if (status === 'available') return 'Available';
  if (status === 'claimed') return 'Claimed';
  if (status === 'expired') return 'Expired';

  return status
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isWeeklyHoliday(value) {
  const day = value.getDay();

  if (day === 0) return true;

  if (day === 6) {
    const occurrence = Math.floor((value.getDate() - 1) / 7) + 1;
    return occurrence === 2 || occurrence === 4;
  }

  return false;
}

function fallbackRemainingWorkingDays(credit = {}) {
  const validUntil = parseLocalDate(credit.valid_until || credit.expiry_date);

  if (!validUntil) return 0;

  const today = parseLocalDate(todayInputValue());
  const availableFrom = parseLocalDate(credit.available_from);
  let cursor = today;

  if (availableFrom && availableFrom > cursor) {
    cursor = availableFrom;
  }

  if (cursor > validUntil) return 0;

  let remaining = 0;

  while (cursor <= validUntil) {
    if (!isWeeklyHoliday(cursor)) remaining += 1;
    cursor = new Date(cursor.getTime() + DAY_IN_MS);
  }

  return remaining;
}

function remainingWorkingDays(credit = {}) {
  const backendValue = Number(credit.remaining_working_days);

  if (Number.isFinite(backendValue)) {
    return Math.max(Math.trunc(backendValue), 0);
  }

  return fallbackRemainingWorkingDays(credit);
}

function claimWindowStatus(credit = {}) {
  const status = normalizeStatus(credit.status);

  if (status !== 'available') return status;

  if (credit.claim_window_status) {
    return normalizeStatus(credit.claim_window_status);
  }

  const today = todayInputValue();
  const availableFrom = dateInputValue(credit.available_from);
  const validUntil = dateInputValue(credit.valid_until || credit.expiry_date);

  if (validUntil && today > validUntil) return 'expired';
  if (availableFrom && today < availableFrom) return 'upcoming';
  return 'active';
}

function canClaimCredit(credit = {}) {
  if (normalizeStatus(credit.status) !== 'available') return false;

  if (typeof credit.claimable_now === 'boolean') {
    return credit.claimable_now;
  }

  return claimWindowStatus(credit) === 'active';
}

function creditKey(credit = {}, index = 0) {
  return String(
    credit._id ||
      credit.id ||
      `${credit.earned_date || 'credit'}-${credit.valid_until || index}-${index}`,
  );
}

function creditTitle(credit = {}) {
  return credit.holiday_title || credit.holiday_name || 'Approved Holiday Work';
}

function statusIcon(status) {
  if (status === 'claimed') return CheckCircle2;
  if (status === 'expired') return XCircle;
  if (status === 'upcoming') return Clock;
  return Gift;
}

function creditMatchesSearch(credit = {}, search = '') {
  const term = String(search || '').trim().toLowerCase();

  if (!term) return true;

  const storedStatus = normalizeStatus(credit.status);
  const windowStatus = claimWindowStatus(credit);
  const displayStatus =
    storedStatus === 'available' ? windowStatus : storedStatus;

  return [
    creditTitle(credit),
    credit.holiday_title,
    credit.holiday_name,
    statusLabel(displayStatus === 'active' ? 'available' : displayStatus),
    credit.earned_date,
    credit.available_from,
    credit.valid_until,
    credit.expiry_date,
    credit.claimed_date,
    credit.claim_date,
    credit.reason,
    credit.claim_reason,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join(' ')
    .includes(term);
}

function compOffPageNumbers(pageCount, page) {
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

function CompOffInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`co-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="co-inline-feedback-icon">
        {message.loading ? (
          <RefreshCcw size={15} className="is-spinning" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="co-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="co-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function CompOffPagination({
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
    <div className="co-pagination">
      <div className="co-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>credits</span>
      </div>

      <div className="co-pagination-controls">
        <label className="co-page-size">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Comp-Off credits per page"
          >
            {COMP_OFF_PAGE_SIZE_OPTIONS.map((size) => (
              <option value={size} key={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="co-page-button co-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="co-page-numbers" aria-label="Pagination">
          {compOffPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                className={`co-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                key={item}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="co-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="co-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="co-page-button co-page-nav"
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

export default function CompOffCredits() {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});
  const [selectedCredit, setSelectedCredit] = useState(null);
  const [claimDate, setClaimDate] = useState('');
  const [reason, setReason] = useState('');

  function clearFeedback(scopeKey) {
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
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
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
      }, COMP_OFF_NOTICE_HIDE_MS);
    }
  }

  async function loadCredits({ silent = false, feedbackScope = '' } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing your Comp-Off credit wallet...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const response = await getMyCompOffs();
      const items = toArray(response);
      setCredits(items);

      setSelectedCredit((current) => {
        if (!current) return null;

        const currentId = creditKey(current);
        const refreshed = items.find(
          (item, index) => creditKey(item, index) === currentId,
        );

        return refreshed && canClaimCredit(refreshed) ? refreshed : null;
      });

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Your Comp-Off credits are up to date.',
          'Refresh Complete',
        );
      }
    } catch (error) {
      const errorMessage =
        error.message || 'Unable to load your Comp-Off credits.';

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'error',
          errorMessage,
          'Refresh Failed',
        );
      } else {
        showFeedback(
          'wallet',
          'error',
          errorMessage,
          'Comp-Off Load Failed',
        );
      }
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    loadCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      3,
    );
    const timerId = window.setTimeout(() => {
      loadCredits({ silent: true });
    }, Math.max(nextMidnight.getTime() - now.getTime(), 1000));

    return () => window.clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits]);

  useEffect(() => {
    setPage(1);
  }, [filter, searchInput, pageSize]);

  useEffect(() => {
    const filteredCount = credits.filter((credit) => {
      const status = normalizeStatus(credit.status);
      const matchesFilter = filter === 'all' || status === filter;
      return matchesFilter && creditMatchesSearch(credit, searchInput);
    }).length;

    const pageCount = Math.max(
      1,
      Math.ceil(filteredCount / Math.max(1, pageSize)),
    );

    setPage((current) => Math.min(current, pageCount));
  }, [credits, filter, pageSize, searchInput]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.co-inline-feedback')) return;

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
    if (!selectedCredit || typeof document === 'undefined') {
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

    function blockBackgroundScroll(event) {
      if (event.target?.closest?.('.co-dialog')) return;
      event.preventDefault();
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape' && !claiming) {
        closeClaimDialog();
      }
    }

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
  }, [claiming, selectedCredit]);

  const counts = useMemo(
    () =>
      credits.reduce(
        (summary, credit) => {
          const status = normalizeStatus(credit.status);

          if (status === 'available') summary.available += 1;
          if (status === 'claimed') summary.claimed += 1;
          if (status === 'expired') summary.expired += 1;
          summary.total += 1;

          return summary;
        },
        { available: 0, claimed: 0, expired: 0, total: 0 },
      ),
    [credits],
  );

  const visibleCredits = useMemo(() => {
    const rows = credits.filter((credit) => {
      const status = normalizeStatus(credit.status);
      const matchesFilter = filter === 'all' || status === filter;

      return matchesFilter && creditMatchesSearch(credit, searchInput);
    });

    return rows.sort((left, right) => {
      const order = { available: 0, claimed: 1, expired: 2 };
      const statusDifference =
        (order[normalizeStatus(left.status)] ?? 9) -
        (order[normalizeStatus(right.status)] ?? 9);

      if (statusDifference !== 0) return statusDifference;

      return String(right.earned_date || '').localeCompare(
        String(left.earned_date || ''),
      );
    });
  }, [credits, filter, searchInput]);

  const pageCount = Math.max(
    1,
    Math.ceil(visibleCredits.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedCredits = visibleCredits.slice(
    pageStart,
    pageStart + pageSize,
  );

  function openClaimDialog(credit) {
    if (!canClaimCredit(credit)) return;

    clearFeedback('claim-modal');

    const today = todayInputValue();
    const availableFrom = dateInputValue(credit.available_from);
    const validUntil = dateInputValue(credit.valid_until || credit.expiry_date);
    let defaultDate = availableFrom && availableFrom > today ? availableFrom : today;

    if (validUntil && defaultDate > validUntil) {
      defaultDate = validUntil;
    }

    setSelectedCredit(credit);
    setClaimDate(defaultDate);
    setReason('');
  }

  function closeClaimDialog() {
    if (claiming) return;
    setSelectedCredit(null);
    setClaimDate('');
    setReason('');
  }

  async function submitClaim(event) {
    event.preventDefault();

    if (!selectedCredit || !canClaimCredit(selectedCredit)) {
      showFeedback(
        'claim-modal',
        'warning',
        'This Comp-Off credit is not currently available for claiming.',
        'Comp-Off Not Available',
      );
      return;
    }

    if (!claimDate) {
      showFeedback(
        'claim-modal',
        'warning',
        'Please select the leave date.',
        'Claim Date Required',
      );
      return;
    }

    const today = todayInputValue();
    const validUntil = dateInputValue(
      selectedCredit.valid_until || selectedCredit.expiry_date,
    );

    if (claimDate < today) {
      showFeedback(
        'claim-modal',
        'warning',
        'The claim date cannot be in the past.',
        'Invalid Claim Date',
      );
      return;
    }

    if (validUntil && claimDate > validUntil) {
      showFeedback(
        'claim-modal',
        'warning',
        `Select a date on or before ${formatDate(validUntil)}.`,
        'Claim Window Exceeded',
      );
      return;
    }

    const submittedCreditKey = creditKey(selectedCredit);

    setClaiming(true);

    showFeedback(
      'claim-modal',
      'info',
      'Submitting your Comp-Off claim...',
      'Submitting Claim',
      { loading: true },
    );

    try {
      const response = await claimCompOff(selectedCredit._id || selectedCredit.id, {
        claim_date: claimDate,
        reason: reason.trim(),
      });

      setSelectedCredit(null);
      setClaimDate('');
      setReason('');
      clearFeedback('claim-modal');
      await loadCredits({ silent: true });

      showFeedback(
        `credit-${submittedCreditKey}`,
        'success',
        response.message || 'Your Comp-Off claim has been submitted.',
        'Comp-Off Claimed',
      );
    } catch (error) {
      showFeedback(
        'claim-modal',
        'error',
        error.message || 'Unable to submit the Comp-Off claim.',
        'Comp-Off Claim Failed',
      );
    } finally {
      setClaiming(false);
    }
  }

  const selectedValidUntil = dateInputValue(
    selectedCredit?.valid_until || selectedCredit?.expiry_date,
  );

  return (
    <div className="comp-off-page">
      <style>{`
        .comp-off-page {
          --co-ink: #101a3a;
          --co-copy: #5d6d8d;
          --co-line: rgba(16, 26, 58, .14);
          --co-blue: #4d77dd;
          --co-cyan: #2eb2b9;
          --co-violet: #575092;
          --co-teal: #16835f;
          --co-amber: #da7b12;
          --co-red: #a2344d;
          width: 100%;
          min-width: 0;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          color: var(--co-ink);
        }

        .comp-off-page,
        .comp-off-page * {
          box-sizing: border-box;
        }

        .comp-off-page > *,
        .comp-off-page section,
        .comp-off-page article,
        .comp-off-page form,
        .comp-off-page label {
          min-width: 0;
          max-width: 100%;
        }

        .comp-off-page::before,
        .comp-off-page::after,
        .comp-off-page .co-hero::before,
        .comp-off-page .co-hero::after,
        .comp-off-page .co-summary-card::before,
        .comp-off-page .co-summary-card::after {
          content: none;
          display: none;
          background: none;
        }

        .co-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(220px, 330px);
          gap: clamp(20px, 3vw, 38px);
          align-items: center;
          min-height: 240px;
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

        .co-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .co-kicker {
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

        .co-hero h1 {
          margin: 0;
          color: var(--co-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .co-hero h1 em {
          color: var(--co-blue);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .co-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--co-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .co-policy-card {
          padding: 18px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 18px;
          background: rgba(255,255,255,.86);
          box-shadow: 0 12px 26px rgba(70,92,140,.08);
        }

        .co-policy-card strong {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--co-ink);
          font-size: 13px;
        }

        .co-policy-card strong svg {
          color: var(--co-blue);
        }

        .co-policy-card span {
          display: block;
          margin-top: 8px;
          color: var(--co-copy);
          font-size: 12px;
          line-height: 1.55;
        }

        .co-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .co-summary-card {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34,38,110,.07);
        }

        .co-summary-card:nth-child(2) {
          background: #eaf8f4;
        }

        .co-summary-card:nth-child(3) {
          background: #fff4d5;
        }

        .co-summary-card:nth-child(4) {
          background: #f1efff;
        }

        .co-summary-card span,
        .co-summary-card strong,
        .co-summary-card small {
          display: block;
        }

        .co-summary-card span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .co-summary-card strong {
          margin-top: 8px;
          color: var(--co-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .co-summary-card small {
          margin-top: 7px;
          color: var(--co-copy);
          font-size: 11px;
          line-height: 1.45;
        }

        .co-list-section {
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #fff;
          box-shadow: 0 22px 42px rgba(34,38,110,.09);
        }

        .co-list-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: clamp(18px, 2vw, 24px);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .co-list-head h2 {
          margin: 0;
          color: var(--co-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.4vw, 34px);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .co-list-head p {
          margin: 7px 0 0;
          color: var(--co-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .co-refresh-stack {
          width: min(260px, 100%);
          display: grid;
          gap: 8px;
        }

        .co-refresh-btn,
        .co-claim-btn,
        .co-cancel-btn,
        .co-submit-btn,
        .co-dialog-close,
        .co-filter-btn,
        .co-page-button,
        .co-page-number,
        .co-inline-feedback-close {
          font: inherit;
          cursor: pointer;
        }

        .co-refresh-btn,
        .co-claim-btn,
        .co-cancel-btn,
        .co-submit-btn,
        .co-filter-btn {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .co-refresh-btn {
          color: #4767b4;
          border-color: rgba(77,119,221,.18);
          background: #fff;
        }

        .co-claim-btn,
        .co-submit-btn {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77,119,221,.18);
        }

        .co-cancel-btn {
          color: #536078;
          border-color: rgba(100,116,139,.16);
          background: #f3f5f9;
        }

        .co-refresh-btn:hover:not(:disabled),
        .co-claim-btn:hover:not(:disabled),
        .co-submit-btn:hover:not(:disabled),
        .co-filter-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .co-refresh-btn:disabled,
        .co-claim-btn:disabled,
        .co-submit-btn:disabled,
        .co-cancel-btn:disabled,
        .co-dialog-close:disabled {
          cursor: not-allowed;
          opacity: .55;
          transform: none;
        }

        .is-spinning,
        .co-refresh-btn svg.is-spinning {
          animation: co-spin .8s linear infinite;
        }

        .co-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 16px clamp(18px, 2vw, 24px);
          background:
            linear-gradient(
              145deg,
              rgba(237,248,255,.44),
              rgba(248,241,255,.30)
            );
        }

        .co-search-wrap {
          position: relative;
          min-width: 0;
        }

        .co-search-wrap > svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--co-blue);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .co-search-wrap input {
          width: 100%;
          min-height: 46px;
          padding: 0 13px 0 39px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 14px;
          outline: 0;
          color: var(--co-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-size: 13px;
        }

        .co-search-wrap input:focus,
        .co-page-size select:focus,
        .co-field input:focus,
        .co-field textarea:focus {
          border-color: rgba(77,119,221,.65);
          box-shadow: 0 0 0 4px rgba(77,119,221,.09);
        }

        .co-filters {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          flex-wrap: wrap;
        }

        .co-filter-btn {
          min-height: 40px;
          padding: 8px 12px;
          color: #4767b4;
          border-color: rgba(77,119,221,.18);
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
        }

        .co-filter-btn.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.17);
        }

        .co-wallet-feedback {
          padding: 0 clamp(18px, 2vw, 24px) 14px;
        }

        .co-inline-feedback {
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

        .co-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
        }

        .co-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
        }

        .co-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
        }

        .co-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .co-inline-feedback-copy {
          min-width: 0;
        }

        .co-inline-feedback-copy strong,
        .co-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .co-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .co-inline-feedback-copy span {
          font-weight: 750;
        }

        .co-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          display: inline-grid;
          place-items: center;
          color: currentColor;
          background: rgba(255,255,255,.58);
          font-size: 17px;
          line-height: 1;
        }

        .co-inline-feedback-close:hover {
          background: #fff;
        }

        .co-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px clamp(18px, 2vw, 24px);
          border-top: 1px solid rgba(65,55,161,.08);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .co-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--co-copy);
          font-size: 10px;
          font-weight: 850;
        }

        .co-pagination-copy strong {
          color: var(--co-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .co-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .co-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--co-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .co-page-size select {
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

        .co-page-button,
        .co-page-number {
          border: 1px solid rgba(77,119,221,.18);
          color: #4767b4;
          background: #fff;
          font-size: 10px;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .co-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .co-page-nav {
          min-width: 78px;
        }

        .co-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .co-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .co-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .co-page-button:hover:not(:disabled),
        .co-page-number:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46,178,185,.42);
        }

        .co-page-button:disabled,
        .co-page-number:disabled {
          opacity: .5;
          cursor: not-allowed;
          transform: none;
        }

        .co-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .co-page-indicator {
          min-width: 82px;
          color: var(--co-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .co-credit-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          padding: clamp(16px, 2vw, 24px);
        }

        .co-credit-card {
          position: relative;
          overflow: hidden;
          min-width: 0;
          display: grid;
          gap: 16px;
          padding: 20px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 14px 28px rgba(34,38,110,.07);
        }

        .co-credit-card.is-active,
        .co-credit-card.is-upcoming {
          background: #f7fbff;
        }

        .co-credit-card.is-claimed {
          background: #f4fbf8;
        }

        .co-credit-card.is-expired {
          background: #fff8f9;
        }

        .co-credit-card::before {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: var(--co-blue);
        }

        .co-credit-card.is-claimed::before {
          background: var(--co-teal);
        }

        .co-credit-card.is-expired::before {
          background: var(--co-red);
        }

        .co-credit-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .co-credit-title {
          min-width: 0;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .co-credit-icon {
          width: 42px;
          height: 42px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 13px;
          color: #4767b4;
          background: #edf6ff;
        }

        .co-credit-card.is-claimed .co-credit-icon {
          color: #147b76;
          background: #e4faf6;
        }

        .co-credit-card.is-expired .co-credit-icon {
          color: #a84759;
          background: #fff0f3;
        }

        .co-credit-title h3 {
          margin: 0;
          overflow-wrap: anywhere;
          color: var(--co-ink);
          font-size: 18px;
        }

        .co-credit-title p {
          margin: 5px 0 0;
          color: var(--co-copy);
          font-size: 12px;
        }

        .co-status-badge {
          flex: 0 0 auto;
          padding: 7px 10px;
          border-radius: 999px;
          color: #4767b4;
          background: #edf6ff;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .co-status-badge.is-claimed {
          color: #0b706a;
          background: #dcf7f2;
        }

        .co-status-badge.is-expired {
          color: #a1394d;
          background: #ffe9ee;
        }

        .co-date-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .co-date-box {
          min-width: 0;
          padding: 12px;
          border: 1px solid #e3e7ef;
          border-radius: 14px;
          background: rgba(255,255,255,.84);
        }

        .co-date-box span,
        .co-date-box strong {
          display: block;
        }

        .co-date-box span {
          color: var(--co-copy);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .co-date-box strong {
          margin-top: 5px;
          overflow-wrap: anywhere;
          color: var(--co-ink);
          font-size: 12px;
        }

        .co-countdown {
          display: grid;
          gap: 9px;
          padding: 13px;
          border-radius: 14px;
          background: linear-gradient(135deg, #f0f5ff, #eefcfb);
        }

        .co-countdown-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .co-countdown-label {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #4767b4;
          font-size: 12px;
          font-weight: 900;
        }

        .co-countdown-head strong {
          font-size: 13px;
        }

        .co-progress-track {
          height: 7px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(77,119,221,.14);
        }

        .co-progress-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #4d77dd 0%, #2eb2b9 100%);
          transition: width .3s ease;
        }

        .co-countdown small {
          color: var(--co-copy);
          line-height: 1.4;
        }

        .co-credit-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .co-days-credit {
          color: var(--co-copy);
          font-size: 12px;
          font-weight: 800;
        }

        .co-days-credit strong {
          color: var(--co-ink);
        }

        .co-card-feedback {
          grid-column: 1 / -1;
        }

        .co-history-note {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--co-copy);
          font-size: 12px;
          font-weight: 800;
        }

        .co-empty-state {
          min-height: 250px;
          margin: clamp(16px, 2vw, 24px);
          padding: 30px;
          border: 1px dashed rgba(77,119,221,.30);
          border-radius: 20px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 9px;
          color: var(--co-copy);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
        }

        .co-empty-state h3 {
          margin: 3px 0 0;
          color: var(--co-ink);
        }

        .co-empty-state p {
          max-width: 480px;
          margin: 0;
          line-height: 1.55;
        }

        .co-skeleton-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          padding: clamp(16px, 2vw, 24px);
        }

        .co-skeleton {
          min-height: 285px;
          border-radius: 20px;
          background:
            linear-gradient(
              90deg,
              #eef1f7 25%,
              #f8f9fc 50%,
              #eef1f7 75%
            );
          background-size: 200% 100%;
          animation: co-shimmer 1.2s infinite linear;
        }

        .co-dialog-backdrop {
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

        .co-dialog {
          width: min(100%, 580px);
          max-height: calc(100dvh - 28px);
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid rgba(255,255,255,.62);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9,16,35,.28);
          -webkit-overflow-scrolling: touch;
        }

        .co-dialog-head {
          position: sticky;
          top: 0;
          z-index: 4;
          padding: 18px 20px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 1px solid rgba(65,55,161,.10);
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
        }

        .co-dialog-head h2 {
          margin: 0;
          color: var(--co-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 4vw, 32px);
          font-weight: 760;
          letter-spacing: -.035em;
        }

        .co-dialog-head p {
          margin: 7px 0 0;
          color: var(--co-copy);
          font-size: 13px;
        }

        .co-dialog-close {
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
        }

        .co-dialog-body {
          padding: clamp(18px, 3vw, 26px);
        }

        .co-dialog-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 0 0 20px;
          padding: 14px;
          border-radius: 16px;
          background: linear-gradient(135deg, #f0f5ff, #eefcfb);
        }

        .co-dialog-summary span,
        .co-dialog-summary strong {
          display: block;
        }

        .co-dialog-summary span {
          color: var(--co-copy);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .co-dialog-summary strong {
          margin-top: 4px;
          font-size: 13px;
        }

        .co-claim-form {
          display: grid;
          gap: 16px;
        }

        .co-field {
          display: grid;
          gap: 7px;
        }

        .co-field label {
          color: #334155;
          font-size: 12px;
          font-weight: 900;
        }

        .co-field input,
        .co-field textarea {
          width: 100%;
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid #d7dce9;
          border-radius: 14px;
          outline: none;
          color: var(--co-ink);
          background: #fff;
          font: inherit;
        }

        .co-field textarea {
          min-height: 92px;
          resize: vertical;
        }

        .co-field small {
          color: var(--co-copy);
          line-height: 1.4;
        }

        .co-dialog-action-stack {
          display: grid;
          gap: 9px;
          width: 100%;
        }

        .co-dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 4px;
        }

        @keyframes co-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes co-shimmer {
          to { background-position: -200% 0; }
        }

        @media (max-width: 1180px) {
          .co-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .co-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .co-pagination-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 900px) {
          .co-hero {
            grid-template-columns: 1fr;
          }

          .co-policy-card {
            width: min(520px, 100%);
          }

          .co-controls {
            grid-template-columns: 1fr;
          }

          .co-filters {
            justify-content: flex-start;
          }

          .co-credit-grid,
          .co-skeleton-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 680px) {
          .comp-off-page {
            gap: 15px;
          }

          .co-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34,38,110,.09);
          }

          .co-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .co-summary-grid {
            grid-template-columns: 1fr;
          }

          .co-list-head,
          .co-credit-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .co-refresh-stack,
          .co-refresh-btn,
          .co-claim-btn {
            width: 100%;
          }

          .co-filters {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .co-filter-btn {
            width: 100%;
          }

          .co-pagination {
            padding: 12px;
          }

          .co-pagination-controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .co-page-size,
          .co-page-numbers,
          .co-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .co-page-size {
            justify-content: space-between;
          }

          .co-page-size select {
            flex: 1 1 auto;
          }

          .co-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .co-page-nav {
            width: 100%;
          }

          .co-date-grid {
            grid-template-columns: 1fr;
          }

          .co-credit-top {
            align-items: flex-start;
            flex-direction: column;
          }

          .co-dialog-backdrop {
            align-items: stretch;
            padding: 0;
          }

          .co-dialog {
            width: 100%;
            max-width: 100%;
            height: 100dvh;
            max-height: 100dvh;
            margin: 0;
            border-radius: 0;
            box-shadow: none;
          }

          .co-dialog-body {
            padding: 16px;
          }
        }

        @media (max-width: 480px) {
          .co-hero {
            padding: 16px;
          }

          .co-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .co-filters {
            grid-template-columns: 1fr;
          }

          .co-dialog-summary {
            grid-template-columns: 1fr;
          }

          .co-dialog-actions {
            flex-direction: column-reverse;
          }

          .co-cancel-btn,
          .co-submit-btn {
            width: 100%;
          }

          .co-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (orientation: landscape) and (max-height: 600px) {
          .co-dialog {
            max-height: 100dvh;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .comp-off-page *,
          .comp-off-page *::before,
          .comp-off-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="co-hero">
        <div className="co-hero-copy">
          <span className="co-kicker">
            <Gift size={14} />
            Earned Benefit
          </span>

          <h1>
            My Comp-Off <em>Credits</em>
          </h1>

          <p>
            A Comp-Off credit is generated after approved holiday work attendance.
            View every available credit, follow its seven-working-day countdown,
            and claim it before the window closes.
          </p>
        </div>

        <div className="co-policy-card">
          <strong>
            <ShieldCheck size={19} />
            Automatic and verified
          </strong>

          <span>
            Credits cannot be added manually. Each credit remains linked to
            verified holiday work and can be used for one day of Comp-Off leave.
          </span>
        </div>
      </section>

      <section className="co-summary-grid" aria-label="Comp-Off summary">
        <article className="co-summary-card">
          <span>Total Credits</span>
          <strong>{counts.total}</strong>
          <small>All credits in your Comp-Off wallet</small>
        </article>

        <article className="co-summary-card">
          <span>Available Credits</span>
          <strong>{counts.available}</strong>
          <small>Credits that may still be claimed</small>
        </article>

        <article className="co-summary-card">
          <span>Claimed Credits</span>
          <strong>{counts.claimed}</strong>
          <small>Credits already submitted for leave</small>
        </article>

        <article className="co-summary-card">
          <span>Expired Credits</span>
          <strong>{counts.expired}</strong>
          <small>Credits whose claim window has ended</small>
        </article>
      </section>

      <section className="co-list-section">
        <div className="co-list-head">
          <div>
            <h2>Credit Wallet</h2>
            <p>
              Available credits appear first. Claimed and expired credits remain
              visible as history.
            </p>
          </div>

          <div className="co-refresh-stack">
            <button
              type="button"
              className="co-refresh-btn"
              onClick={() =>
                loadCredits({
                  silent: true,
                  feedbackScope: 'refresh',
                })
              }
              disabled={loading || refreshing}
            >
              <RefreshCcw
                size={16}
                className={refreshing ? 'is-spinning' : ''}
              />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <CompOffInlineMessage
              message={feedbackMap.refresh}
              onClose={() => clearFeedback('refresh')}
            />
          </div>
        </div>

        <div className="co-controls">
          <div className="co-search-wrap">
            <Search size={17} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search holiday, status, date or claim..."
              aria-label="Search Comp-Off credits"
            />
          </div>

          <div className="co-filters" aria-label="Filter Comp-Off credits">
            {[
              ['all', 'All', counts.total],
              ['available', 'Available', counts.available],
              ['claimed', 'Claimed', counts.claimed],
              ['expired', 'Expired', counts.expired],
            ].map(([value, label, count]) => (
              <button
                type="button"
                className={`co-filter-btn ${filter === value ? 'is-active' : ''}`}
                onClick={() => setFilter(value)}
                key={value}
                aria-pressed={filter === value}
              >
                {label} ({count})
              </button>
            ))}
          </div>
        </div>

        {feedbackMap.wallet ? (
          <div className="co-wallet-feedback">
            <CompOffInlineMessage
              message={feedbackMap.wallet}
              onClose={() => clearFeedback('wallet')}
            />
          </div>
        ) : null}

        <CompOffPagination
          total={visibleCredits.length}
          page={safePage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPage(1);
            setPageSize(value);
          }}
        />

        {loading ? (
          <div className="co-skeleton-grid" aria-label="Loading Comp-Off credits">
            <div className="co-skeleton" />
            <div className="co-skeleton" />
          </div>
        ) : visibleCredits.length === 0 ? (
          <div className="co-empty-state">
            <CalendarDays size={38} />
            <h3>
              {searchInput
                ? 'No matching Comp-Off credits'
                : filter === 'all'
                  ? 'No Comp-Off credits yet'
                  : `No ${statusLabel(filter)} credits`}
            </h3>
            <p>
              {searchInput
                ? 'No credit matches the current search and status filter.'
                : filter === 'all'
                  ? 'A credit will appear here automatically after approved holiday work attendance and checkout.'
                  : 'There are no credits in this status.'}
            </p>
          </div>
        ) : (
          <div className="co-credit-grid" aria-live="polite">
            {pagedCredits.map((credit, index) => {
              const storedStatus = normalizeStatus(credit.status);
              const windowStatus = claimWindowStatus(credit);
              const displayStatus =
                storedStatus === 'available' ? windowStatus : storedStatus;
              const remaining = remainingWorkingDays(credit);
              const totalWindow = Math.max(
                Number(credit.claim_window_working_days) || 7,
                1,
              );
              const progress = Math.min(
                Math.max((remaining / totalWindow) * 100, 0),
                100,
              );
              const claimable = canClaimCredit(credit);
              const StatusIcon = statusIcon(displayStatus);
              const rowKey = creditKey(credit, pageStart + index);
              const rowFeedback = feedbackMap[`credit-${rowKey}`];

              return (
                <article
                  className={`co-credit-card is-${
                    storedStatus === 'available' ? displayStatus : storedStatus
                  }`}
                  key={rowKey}
                >
                  <div className="co-credit-top">
                    <div className="co-credit-title">
                      <span className="co-credit-icon">
                        <StatusIcon size={21} />
                      </span>

                      <div>
                        <h3>{creditTitle(credit)}</h3>
                        <p>Earned through approved holiday attendance</p>
                      </div>
                    </div>

                    <span
                      className={`co-status-badge is-${
                        storedStatus === 'available' ? displayStatus : storedStatus
                      }`}
                    >
                      {displayStatus === 'active'
                        ? 'Available'
                        : statusLabel(displayStatus)}
                    </span>
                  </div>

                  <div className="co-date-grid">
                    <div className="co-date-box">
                      <span>Earned On</span>
                      <strong>{formatDate(credit.earned_date)}</strong>
                    </div>

                    <div className="co-date-box">
                      <span>Claim From</span>
                      <strong>{formatDate(credit.available_from)}</strong>
                    </div>

                    <div className="co-date-box">
                      <span>Valid Until</span>
                      <strong>
                        {formatDate(credit.valid_until || credit.expiry_date)}
                      </strong>
                    </div>
                  </div>

                  {storedStatus === 'available' ? (
                    <div className="co-countdown">
                      <div className="co-countdown-head">
                        <span className="co-countdown-label">
                          <Timer size={16} />
                          Claim countdown
                        </span>

                        <strong>
                          {remaining} working {remaining === 1 ? 'day' : 'days'} left
                        </strong>
                      </div>

                      <div className="co-progress-track" aria-hidden="true">
                        <div
                          className="co-progress-bar"
                          style={{ width: `${progress}%` }}
                        />
                      </div>

                      <small>
                        {displayStatus === 'upcoming'
                          ? `Claiming opens on ${formatDate(credit.available_from)}.`
                          : 'Claim this credit before the displayed validity date.'}
                      </small>
                    </div>
                  ) : (
                    <div className="co-history-note">
                      <History size={16} />
                      {storedStatus === 'claimed'
                        ? `Claimed for ${formatDate(
                            credit.claimed_date || credit.claim_date,
                          )}`
                        : `The claim window ended on ${formatDate(
                            credit.valid_until || credit.expiry_date,
                          )}`}
                    </div>
                  )}

                  <div className="co-credit-footer">
                    <span className="co-days-credit">
                      Credit value:{' '}
                      <strong>{Number(credit.leave_days) || 1} day</strong>
                    </span>

                    {storedStatus === 'available' && (
                      <button
                        type="button"
                        className="co-claim-btn"
                        onClick={() => openClaimDialog(credit)}
                        disabled={!claimable}
                        title={
                          claimable
                            ? 'Claim this Comp-Off credit'
                            : `Claiming opens on ${formatDate(credit.available_from)}`
                        }
                      >
                        <Send size={16} />
                        {claimable ? 'Claim Comp-Off' : 'Not Claimable Yet'}
                      </button>
                    )}
                  </div>

                  {rowFeedback ? (
                    <div className="co-card-feedback">
                      <CompOffInlineMessage
                        message={rowFeedback}
                        onClose={() => clearFeedback(`credit-${rowKey}`)}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedCredit && (
        <div
          className="co-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeClaimDialog();
          }}
        >
          <section
            className="co-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="co-claim-title"
          >
            <div className="co-dialog-head">
              <div>
                <h2 id="co-claim-title">Claim Comp-Off</h2>
                <p>{creditTitle(selectedCredit)}</p>
              </div>

              <button
                type="button"
                className="co-dialog-close"
                onClick={closeClaimDialog}
                disabled={claiming}
                aria-label="Close claim form"
              >
                <X size={20} />
              </button>
            </div>

            <div className="co-dialog-body">
              <div className="co-dialog-summary">
                <div>
                  <span>Earned On</span>
                  <strong>{formatDate(selectedCredit.earned_date)}</strong>
                </div>

                <div>
                  <span>Time Remaining</span>
                  <strong>
                    {remainingWorkingDays(selectedCredit)} working days
                  </strong>
                </div>
              </div>

              <form className="co-claim-form" onSubmit={submitClaim}>
              <div className="co-field">
                <label htmlFor="co-claim-date">Comp-Off Leave Date</label>
                <input
                  id="co-claim-date"
                  type="date"
                  value={claimDate}
                  min={todayInputValue()}
                  max={selectedValidUntil || undefined}
                  onChange={(event) => setClaimDate(event.target.value)}
                  disabled={claiming}
                  required
                />
                <small>
                  Select the date on which you want to take the Comp-Off leave.
                </small>
              </div>

              <div className="co-field">
                <label htmlFor="co-claim-reason">Reason or Note (optional)</label>
                <textarea
                  id="co-claim-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Add a short reason or handover note"
                  disabled={claiming}
                  maxLength={500}
                />
              </div>

              <div className="co-dialog-action-stack">
                <div className="co-dialog-actions">
                  <button
                    type="button"
                    className="co-cancel-btn"
                    onClick={closeClaimDialog}
                    disabled={claiming}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="co-submit-btn"
                    disabled={claiming || !claimDate}
                  >
                    <CalendarCheck size={17} />
                    {claiming ? 'Submitting...' : 'Submit Claim'}
                  </button>
                </div>

                <CompOffInlineMessage
                  message={feedbackMap['claim-modal']}
                  onClose={() => clearFeedback('claim-modal')}
                />
              </div>
            </form>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}