import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Gift,
  History,
  RefreshCcw,
  Send,
  ShieldCheck,
  Timer,
  X,
  XCircle,
} from 'lucide-react';
import { claimCompOff, getMyCompOffs } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

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

export default function CompOffCredits() {
  const alerts = useCustomAlert();
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selectedCredit, setSelectedCredit] = useState(null);
  const [claimDate, setClaimDate] = useState('');
  const [reason, setReason] = useState('');

  async function loadCredits({ silent = false } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);

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
    } catch (error) {
      alerts.error(
        error.message || 'Unable to load your Comp-Off credits.',
        'Comp-Off Load Failed',
      );
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
    if (!selectedCredit) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function closeOnEscape(event) {
      if (event.key === 'Escape' && !claiming) {
        closeClaimDialog();
      }
    }

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
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
      return filter === 'all' || status === filter;
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
  }, [credits, filter]);

  function openClaimDialog(credit) {
    if (!canClaimCredit(credit)) return;

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
      alerts.warning(
        'This Comp-Off credit is not currently available for claiming.',
        'Comp-Off Not Available',
      );
      return;
    }

    if (!claimDate) {
      alerts.warning('Please select the leave date.', 'Claim Date Required');
      return;
    }

    const today = todayInputValue();
    const validUntil = dateInputValue(
      selectedCredit.valid_until || selectedCredit.expiry_date,
    );

    if (claimDate < today) {
      alerts.warning('The claim date cannot be in the past.', 'Invalid Claim Date');
      return;
    }

    if (validUntil && claimDate > validUntil) {
      alerts.warning(
        `Select a date on or before ${formatDate(validUntil)}.`,
        'Claim Window Exceeded',
      );
      return;
    }

    setClaiming(true);

    try {
      const response = await claimCompOff(selectedCredit._id || selectedCredit.id, {
        claim_date: claimDate,
        reason: reason.trim(),
      });

      setSelectedCredit(null);
      setClaimDate('');
      setReason('');
      await loadCredits({ silent: true });

      alerts.success(
        response.message || 'Your Comp-Off claim has been submitted.',
        'Comp-Off Claimed',
      );
    } catch (error) {
      alerts.error(
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
          --co-ink: #17223f;
          --co-copy: #64748b;
          --co-line: rgba(100, 116, 139, .2);
          --co-purple: #6657dc;
          --co-purple-dark: #3f348f;
          --co-teal: #159f98;
          --co-amber: #d98516;
          --co-red: #c85568;
          display: grid;
          gap: 22px;
          color: var(--co-ink);
        }

        .co-hero {
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(270px, .7fr);
          gap: 24px;
          align-items: end;
          padding: clamp(26px, 4vw, 46px);
          border: 1px solid rgba(135, 146, 196, .34);
          border-radius: 34px;
          background:
            radial-gradient(circle at 92% 10%, rgba(83, 205, 187, .28), transparent 30%),
            radial-gradient(circle at 5% 5%, rgba(135, 119, 235, .25), transparent 32%),
            linear-gradient(135deg, #f3f1ff, #f5fbff 52%, #effbf7);
          box-shadow: 10px 12px 0 #d4ddf7, 0 24px 46px rgba(41, 52, 109, .1);
        }

        .co-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          width: max-content;
          margin-bottom: 14px;
          padding: 8px 12px;
          border-radius: 999px;
          color: #fff;
          background: var(--co-purple-dark);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .co-hero h1 {
          margin: 0;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: clamp(40px, 5vw, 70px);
          line-height: .96;
          letter-spacing: -.05em;
        }

        .co-hero h1 em {
          color: var(--co-purple);
          font-weight: 500;
        }

        .co-hero p {
          max-width: 760px;
          margin: 16px 0 0;
          color: var(--co-copy);
          line-height: 1.7;
        }

        .co-policy-card {
          padding: 19px;
          border: 1px solid rgba(102, 87, 220, .2);
          border-radius: 22px;
          background: rgba(255, 255, 255, .78);
          box-shadow: 6px 7px 0 rgba(102, 87, 220, .16);
        }

        .co-policy-card strong {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .co-policy-card span {
          display: block;
          margin-top: 8px;
          color: var(--co-copy);
          font-size: 13px;
          line-height: 1.55;
        }

        .co-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .co-summary-card,
        .co-credit-card,
        .co-empty-state {
          border: 1px solid var(--co-line);
          background: linear-gradient(145deg, #fff, #f8fbff);
          box-shadow: 7px 8px 0 #d8def7, 0 20px 34px rgba(38, 48, 94, .08);
        }

        .co-summary-card {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
          padding: 20px;
          border-radius: 24px;
        }

        .co-summary-icon {
          display: grid;
          place-items: center;
          width: 48px;
          height: 48px;
          flex: 0 0 auto;
          border-radius: 16px;
          color: var(--co-purple);
          background: #eeecff;
        }

        .co-summary-card.is-claimed .co-summary-icon {
          color: #127a76;
          background: #e4faf6;
        }

        .co-summary-card.is-expired .co-summary-icon {
          color: #ad4c5d;
          background: #fff0f3;
        }

        .co-summary-card span,
        .co-summary-card strong {
          display: block;
        }

        .co-summary-card span {
          color: var(--co-copy);
          font-size: 12px;
          font-weight: 800;
        }

        .co-summary-card strong {
          margin-top: 3px;
          font-size: clamp(23px, 3vw, 32px);
          line-height: 1;
        }

        .co-list-section {
          display: grid;
          gap: 18px;
          padding: clamp(20px, 3vw, 30px);
          border: 1px solid var(--co-line);
          border-radius: 28px;
          background: rgba(255, 255, 255, .82);
          box-shadow: 7px 8px 0 #d8def7, 0 20px 34px rgba(38, 48, 94, .07);
        }

        .co-list-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
        }

        .co-list-head h2 {
          margin: 0;
          font-size: clamp(24px, 3vw, 32px);
        }

        .co-list-head p {
          margin: 7px 0 0;
          color: var(--co-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .co-refresh-btn,
        .co-claim-btn,
        .co-cancel-btn,
        .co-submit-btn,
        .co-dialog-close,
        .co-filter-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          cursor: pointer;
          font: inherit;
          font-weight: 900;
          transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
        }

        .co-refresh-btn {
          min-height: 42px;
          padding: 10px 15px;
          border-radius: 999px;
          color: var(--co-purple-dark);
          background: #eeecff;
        }

        .co-refresh-btn:hover:not(:disabled),
        .co-claim-btn:hover:not(:disabled),
        .co-submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .co-refresh-btn:disabled,
        .co-claim-btn:disabled,
        .co-submit-btn:disabled,
        .co-cancel-btn:disabled,
        .co-dialog-close:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .co-refresh-btn svg.is-spinning {
          animation: co-spin .8s linear infinite;
        }

        .co-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }

        .co-filter-btn {
          min-height: 38px;
          padding: 9px 14px;
          border: 1px solid #e1e5ef;
          border-radius: 999px;
          color: #536078;
          background: #fff;
        }

        .co-filter-btn.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, var(--co-purple-dark), var(--co-purple));
          box-shadow: 0 9px 18px rgba(79, 68, 176, .2);
        }

        .co-credit-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .co-credit-card {
          position: relative;
          overflow: hidden;
          display: grid;
          gap: 17px;
          padding: 22px;
          border-radius: 25px;
        }

        .co-credit-card::before {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 5px;
          background: var(--co-purple);
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
          display: flex;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
        }

        .co-credit-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          flex: 0 0 auto;
          border-radius: 15px;
          color: var(--co-purple-dark);
          background: #eeecff;
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
          color: var(--co-purple-dark);
          background: #eeecff;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
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
          border-radius: 16px;
          background: #fafbff;
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
          font-size: 12px;
        }

        .co-countdown {
          display: grid;
          gap: 9px;
          padding: 14px;
          border-radius: 17px;
          background: linear-gradient(135deg, #f0efff, #f4fbff);
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
          color: var(--co-purple-dark);
          font-size: 12px;
          font-weight: 900;
        }

        .co-countdown-head strong {
          font-size: 13px;
        }

        .co-progress-track {
          overflow: hidden;
          height: 8px;
          border-radius: 999px;
          background: rgba(102, 87, 220, .14);
        }

        .co-progress-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, var(--co-purple-dark), #8071ef);
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

        .co-claim-btn {
          min-height: 42px;
          padding: 10px 16px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, var(--co-purple-dark), var(--co-purple));
          box-shadow: 0 10px 20px rgba(79, 68, 176, .23);
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
          min-height: 260px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 9px;
          padding: 30px;
          border-radius: 25px;
          color: var(--co-copy);
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
          gap: 18px;
        }

        .co-skeleton {
          min-height: 285px;
          border-radius: 25px;
          background: linear-gradient(90deg, #eef1f7 25%, #f8f9fc 50%, #eef1f7 75%);
          background-size: 200% 100%;
          animation: co-shimmer 1.2s infinite linear;
        }

        .co-dialog-backdrop {
          position: fixed;
          z-index: 9999;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(15, 23, 42, .58);
          backdrop-filter: blur(7px);
        }

        .co-dialog {
          width: min(100%, 560px);
          max-height: calc(100vh - 36px);
          overflow-y: auto;
          padding: clamp(22px, 4vw, 32px);
          border: 1px solid rgba(255, 255, 255, .7);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 30px 80px rgba(15, 23, 42, .3);
        }

        .co-dialog-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .co-dialog-head h2 {
          margin: 0;
          font-size: clamp(24px, 4vw, 32px);
        }

        .co-dialog-head p {
          margin: 7px 0 0;
          color: var(--co-copy);
          font-size: 13px;
        }

        .co-dialog-close {
          width: 40px;
          height: 40px;
          flex: 0 0 auto;
          border-radius: 50%;
          color: #536078;
          background: #f0f2f7;
        }

        .co-dialog-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 20px 0;
          padding: 14px;
          border-radius: 18px;
          background: linear-gradient(135deg, #f1efff, #f3fbff);
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
          box-sizing: border-box;
          border: 1px solid #d7dce9;
          border-radius: 15px;
          outline: none;
          color: var(--co-ink);
          background: #fff;
          padding: 12px 13px;
          font: inherit;
        }

        .co-field input:focus,
        .co-field textarea:focus {
          border-color: rgba(102, 87, 220, .62);
          box-shadow: 0 0 0 4px rgba(102, 87, 220, .1);
        }

        .co-field textarea {
          min-height: 92px;
          resize: vertical;
        }

        .co-field small {
          color: var(--co-copy);
          line-height: 1.4;
        }

        .co-dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 4px;
        }

        .co-cancel-btn,
        .co-submit-btn {
          min-height: 44px;
          padding: 11px 17px;
          border-radius: 999px;
        }

        .co-cancel-btn {
          color: #536078;
          background: #eef1f6;
        }

        .co-submit-btn {
          color: #fff;
          background: linear-gradient(135deg, var(--co-purple-dark), var(--co-purple));
          box-shadow: 0 11px 22px rgba(79, 68, 176, .24);
        }

        @keyframes co-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes co-shimmer {
          to { background-position: -200% 0; }
        }

        @media (max-width: 900px) {
          .co-hero {
            grid-template-columns: 1fr;
          }

          .co-credit-grid,
          .co-skeleton-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 680px) {
          .co-summary-grid {
            grid-template-columns: 1fr;
          }

          .co-list-head,
          .co-credit-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .co-refresh-btn,
          .co-claim-btn {
            width: 100%;
          }

          .co-date-grid {
            grid-template-columns: 1fr;
          }

          .co-credit-top {
            align-items: flex-start;
            flex-direction: column;
          }

          .co-status-badge {
            margin-left: 56px;
          }
        }

        @media (max-width: 480px) {
          .co-hero,
          .co-list-section {
            border-radius: 23px;
          }

          .co-hero h1 {
            font-size: 38px;
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
        }

        @media (prefers-reduced-motion: reduce) {
          .co-refresh-btn,
          .co-claim-btn,
          .co-submit-btn,
          .co-progress-bar {
            transition: none;
          }

          .co-skeleton,
          .co-refresh-btn svg.is-spinning {
            animation: none;
          }
        }
      `}</style>

      <section className="co-hero">
        <div>
          <span className="co-kicker">
            <Gift size={14} /> Earned Benefit
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
            <ShieldCheck size={19} /> Automatic and verified
          </strong>
          <span>
            Credits cannot be added manually. Each credit remains linked to
            verified holiday work and can be used for one day of Comp-Off leave.
          </span>
        </div>
      </section>

      <section className="co-summary-grid" aria-label="Comp-Off summary">
        <article className="co-summary-card">
          <span className="co-summary-icon">
            <Gift size={23} />
          </span>
          <div>
            <span>Available Credits</span>
            <strong>{counts.available}</strong>
          </div>
        </article>

        <article className="co-summary-card is-claimed">
          <span className="co-summary-icon">
            <CheckCircle2 size={23} />
          </span>
          <div>
            <span>Claimed Credits</span>
            <strong>{counts.claimed}</strong>
          </div>
        </article>

        <article className="co-summary-card is-expired">
          <span className="co-summary-icon">
            <XCircle size={23} />
          </span>
          <div>
            <span>Expired Credits</span>
            <strong>{counts.expired}</strong>
          </div>
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

          <button
            type="button"
            className="co-refresh-btn"
            onClick={() => loadCredits({ silent: true })}
            disabled={loading || refreshing}
          >
            <RefreshCcw
              size={16}
              className={refreshing ? 'is-spinning' : ''}
            />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
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

        {loading ? (
          <div className="co-skeleton-grid" aria-label="Loading Comp-Off credits">
            <div className="co-skeleton" />
            <div className="co-skeleton" />
          </div>
        ) : visibleCredits.length === 0 ? (
          <div className="co-empty-state">
            <CalendarDays size={38} />
            <h3>
              {filter === 'all'
                ? 'No Comp-Off credits yet'
                : `No ${statusLabel(filter)} credits`}
            </h3>
            <p>
              {filter === 'all'
                ? 'A credit will appear here automatically after approved holiday work attendance and checkout.'
                : 'There are no credits in this status.'}
            </p>
          </div>
        ) : (
          <div className="co-credit-grid" aria-live="polite">
            {visibleCredits.map((credit, index) => {
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

              return (
                <article
                  className={`co-credit-card is-${
                    storedStatus === 'available' ? displayStatus : storedStatus
                  }`}
                  key={creditKey(credit, index)}
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
                          <Timer size={16} /> Claim countdown
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
                      Credit value: <strong>{Number(credit.leave_days) || 1} day</strong>
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
            </form>
          </section>
        </div>
      )}
    </div>
  );
}