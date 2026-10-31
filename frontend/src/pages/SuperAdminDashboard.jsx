import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { api } from '../api/client';
import { allModules, SUPERADMIN_PLATFORM_MODULE_KEYS } from '../data/modules';
import Table from '../components/Table';
import ModuleGrid from '../components/ModuleGrid';

function formatDateTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}


function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function rolesLabel(value) {
  if (Array.isArray(value)) {
    return value.map(statusLabel).join(', ') || '—';
  }

  return value ? statusLabel(value) : '—';
}

const SUPER_ADMIN_KPI_KEYWORDS = [
  'admin',
  'company',
  'companies',
  'tenant',
  'user',
  'employee',
  'premium',
  'trial',
  'subscription',
  'payment',
  'pricing',
  'plan',
  'notification',
  'ticket',
  'support',
  'audit',
  'payslip',
];

function isSuperAdminKpi(label) {
  const normalizedLabel = String(label || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');

  return SUPER_ADMIN_KPI_KEYWORDS.some((keyword) =>
    normalizedLabel.includes(keyword),
  );
}

function superAdminKpiTarget(label) {
  const normalizedLabel = String(label || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');

  if (
    normalizedLabel.includes('company') ||
    normalizedLabel.includes('companies') ||
    normalizedLabel.includes('tenant')
  ) {
    return 'companies';
  }

  if (normalizedLabel.includes('employee')) {
    return 'employees';
  }

  if (
    normalizedLabel.includes('user') ||
    normalizedLabel.includes('admin')
  ) {
    return 'users';
  }

  if (
    normalizedLabel.includes('premium') &&
    (
      normalizedLabel.includes('request') ||
      normalizedLabel.includes('application')
    )
  ) {
    return 'premium_requests';
  }

  if (
    normalizedLabel.includes('trial') &&
    (
      normalizedLabel.includes('request') ||
      normalizedLabel.includes('application')
    )
  ) {
    return 'demo_requests';
  }

  if (
    normalizedLabel.includes('subscription') ||
    normalizedLabel.includes('payment') ||
    normalizedLabel.includes('pricing') ||
    normalizedLabel.includes('plan') ||
    normalizedLabel.includes('trial') ||
    normalizedLabel.includes('premium')
  ) {
    return 'subscriptions';
  }

  if (normalizedLabel.includes('notification')) {
    return 'notifications';
  }

  if (
    normalizedLabel.includes('ticket') ||
    normalizedLabel.includes('support')
  ) {
    return 'it_support';
  }

  if (normalizedLabel.includes('audit')) {
    return 'audit_logs';
  }

  if (normalizedLabel.includes('payslip')) {
    return 'payslip_designer';
  }

  return null;
}


export default function SuperAdminDashboard({ setPage }) {
 const [data, setData] = useState(() => {
  try {
    const cachedDashboard = sessionStorage.getItem(
      'super_admin_dashboard_cache',
    );

    return cachedDashboard
      ? JSON.parse(cachedDashboard)
      : null;
  } catch {
    return null;
  }
});

const [message, setMessage] = useState('');
const [loading, setLoading] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState(null);
  const refreshFeedbackTimerRef = useRef(null); 

  function clearRefreshFeedback() {
    if (refreshFeedbackTimerRef.current) {
      window.clearTimeout(refreshFeedbackTimerRef.current);
      refreshFeedbackTimerRef.current = null;
    }
    setRefreshFeedback(null);
  }

  function showRefreshFeedback(textValue, tone = 'success') {
    if (refreshFeedbackTimerRef.current) {
      window.clearTimeout(refreshFeedbackTimerRef.current);
    }

    setRefreshFeedback({
      text: String(textValue || '').trim(),
      tone,
    });

    refreshFeedbackTimerRef.current = window.setTimeout(() => {
      setRefreshFeedback(null);
      refreshFeedbackTimerRef.current = null;
    }, 3400);
  }

  async function loadDashboard({ announce = false } = {}) {
    try {
      if (announce) {
        setLoading(true);
      }

      setMessage('');

      const dashboardData = await api('/dashboard/superadmin');

      setData(dashboardData);

      try {
        sessionStorage.setItem(
          'super_admin_dashboard_cache',
          JSON.stringify(dashboardData),
        );
      } catch {
        // Ignore browser storage errors.
      }

      if (announce) {
        showRefreshFeedback(
          'Dashboard data refreshed successfully.',
          'success',
        );
      }
    } catch (error) {
      console.error(error);

      if (announce) {
        showRefreshFeedback(
          error.message || 'Unable to refresh dashboard data.',
          'error',
        );
      } else {
        setMessage(error.message || 'Unable to load dashboard data');
      }
    } finally {
      if (announce) {
        setLoading(false);
      }
    }
  }

  useLayoutEffect(() => {
  const history = window.history;

  const previousScrollRestoration =
    'scrollRestoration' in history
      ? history.scrollRestoration
      : null;

  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto',
  });

  return () => {
    if (
      'scrollRestoration' in history &&
      previousScrollRestoration
    ) {
      history.scrollRestoration =
        previousScrollRestoration;
    }
  };
}, []);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => () => {
    if (refreshFeedbackTimerRef.current) {
      window.clearTimeout(refreshFeedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!refreshFeedback) return undefined;

    const dismissFeedback = () => {
      clearRefreshFeedback();
    };

    document.addEventListener('pointerdown', dismissFeedback, true);
    return () => document.removeEventListener('pointerdown', dismissFeedback, true);
  }, [refreshFeedback]);

  useEffect(() => {
    const tableShells = Array.from(
      document.querySelectorAll('.sa-table-shell'),
    );

    const cleanups = tableShells.map((shell) => {
      const scroller = shell.querySelector('.table-wrap') || shell;

      let activePointerId = null;
      let startX = 0;
      let startY = 0;
      let startScrollLeft = 0;
      let dragAxis = null;
      let dragging = false;

      const releasePointerCapture = () => {
        if (
          activePointerId !== null &&
          typeof scroller.hasPointerCapture === 'function' &&
          scroller.hasPointerCapture(activePointerId)
        ) {
          try {
            scroller.releasePointerCapture(activePointerId);
          } catch (_error) {
            // Pointer capture may already have been released by the browser.
          }
        }
      };

      const stopDragging = () => {
        releasePointerCapture();
        dragging = false;
        dragAxis = null;
        activePointerId = null;
        shell.classList.remove('is-dragging');
      };

      const handlePointerDown = (event) => {
        if (event.pointerType === 'touch') {
          return;
        }

        if (event.button !== 0) {
          return;
        }

        if (
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        if (
          event.target instanceof Element &&
          event.target.closest(
            'button, a, input, select, textarea, [role="button"]',
          )
        ) {
          return;
        }

        const scrollerRect = scroller.getBoundingClientRect();
        const horizontalScrollbarHeight =
          scroller.offsetHeight - scroller.clientHeight;

        if (
          horizontalScrollbarHeight > 0 &&
          event.clientY >= scrollerRect.bottom - horizontalScrollbarHeight
        ) {
          return;
        }

        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startScrollLeft = scroller.scrollLeft;
        dragAxis = null;
        dragging = false;
      };

      const handlePointerMove = (event) => {
        if (
          activePointerId === null ||
          event.pointerId !== activePointerId
        ) {
          return;
        }

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (!dragAxis) {
          if (Math.max(absX, absY) < 5) {
            return;
          }

          if (absY > absX) {
            dragAxis = 'vertical';
            activePointerId = null;
            return;
          }

          dragAxis = 'horizontal';
          dragging = true;
          shell.classList.add('is-dragging');

          if (
            event.pointerType !== 'touch' &&
            typeof window.getSelection === 'function'
          ) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount) {
              selection.removeAllRanges();
            }
          }

          if (typeof scroller.setPointerCapture === 'function') {
            try {
              scroller.setPointerCapture(event.pointerId);
            } catch (_error) {
              // Continue without pointer capture if the browser rejects it.
            }
          }
        }

        if (dragAxis !== 'horizontal') {
          return;
        }

        if (event.cancelable) {
          event.preventDefault();
        }

        scroller.scrollLeft = startScrollLeft - deltaX;
      };

      const handlePointerEnd = (event) => {
        if (
          activePointerId !== null &&
          event.pointerId !== activePointerId
        ) {
          return;
        }

        stopDragging();
      };

      const handleDragStart = (event) => {
        if (dragging) {
          event.preventDefault();
        }
      };

      const handleModifiedClick = (event) => {
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }

        if (
          !(event.target instanceof Element) ||
          event.target.closest(
            'button, a, input, select, textarea, [role="button"]',
          )
        ) {
          return;
        }

        const cell = event.target.closest('td, th');
        if (!cell || typeof window.getSelection !== 'function') {
          return;
        }

        const selection = window.getSelection();
        if (!selection) {
          return;
        }

        const range = document.createRange();
        range.selectNodeContents(cell);
        selection.removeAllRanges();
        selection.addRange(range);
      };

      scroller.addEventListener('pointerdown', handlePointerDown);
      scroller.addEventListener('pointermove', handlePointerMove, { passive: false });
      scroller.addEventListener('pointerup', handlePointerEnd);
      scroller.addEventListener('pointercancel', handlePointerEnd);
      scroller.addEventListener('lostpointercapture', stopDragging);
      scroller.addEventListener('dragstart', handleDragStart);
      scroller.addEventListener('click', handleModifiedClick);

      return () => {
        stopDragging();
        scroller.removeEventListener('pointerdown', handlePointerDown);
        scroller.removeEventListener('pointermove', handlePointerMove);
        scroller.removeEventListener('pointerup', handlePointerEnd);
        scroller.removeEventListener('pointercancel', handlePointerEnd);
        scroller.removeEventListener('lostpointercapture', stopDragging);
        scroller.removeEventListener('dragstart', handleDragStart);
        scroller.removeEventListener('click', handleModifiedClick);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [data]);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  const stats = data?.stats || {};
  const tenants = data?.tenants || [];
  const recentUsers = data?.recent_users || [];
  const recentAudit = data?.recent_audit || [];

  const superAdminStats = Object.entries(stats).filter(([key]) =>
    isSuperAdminKpi(key),
  );

  const dashboardModules = SUPERADMIN_PLATFORM_MODULE_KEYS
    .map((moduleKey) =>
      allModules.find(([key]) => key === moduleKey),
    )
    .filter(Boolean);

  const tenantRows = tenants.map((row) => ({
    tenant_id: row.tenant_id || '—',
    name: row.name || '—',
    status: statusLabel(row.status),
    users: row.users || 0,
    employees: row.employees || 0,
  }));

  const recentUserRows = recentUsers.map((row) => ({
    name: row.name || '—',
    email: row.email || '—',
    tenant_id: row.tenant_id || '—',
    roles: rolesLabel(row.roles),
    is_active: row.is_active ? 'Active' : 'Inactive',
    created_at: formatDateTime(row.created_at),
  }));

  const recentAuditRows = recentAudit.map((row) => ({
    action: row.action || '—',
    entity: row.entity || '—',
    actor_email: row.actor_email || row.actor || '—',
    tenant_id: row.tenant_id || '—',
    created_at: formatDateTime(row.created_at),
  }));


  return (
    <div className="page-grid sa-dashboard-page">
      <style>{`
        .sa-dashboard-page {
          --sa-ink: #101a3a;
          --sa-ink-soft: #263657;
          --sa-copy: #5d6d8d;
          --sa-muted: #7b88a6;
          --sa-blue: #4d77dd;
          --sa-cyan: #2eb2b9;
          --sa-purple: #575092;
          --sa-sky: #d3f4fb;
          --sa-lavender: #f0edfb;
          --sa-border: rgba(154, 164, 205, .56);
          --sa-border-soft: rgba(154, 164, 205, .34);
          --sa-shadow: 0 24px 42px rgba(34, 38, 110, .09);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          box-sizing: border-box;
          gap: clamp(16px, 1.8vw, 24px);
          padding-right: clamp(10px, 1vw, 16px);
          padding-bottom: clamp(10px, 1vw, 16px);
          overflow-x: visible;
          color: var(--sa-ink);
        }

        .sa-dashboard-page *,
        .sa-dashboard-page *::before,
        .sa-dashboard-page *::after {
          box-sizing: border-box;
        }

        .sa-dashboard-page button,
        .sa-dashboard-page input,
        .sa-dashboard-page select,
        .sa-dashboard-page textarea {
          font: inherit;
        }

        .sa-dashboard-page button {
          -webkit-tap-highlight-color: transparent;
        }

        .sa-dashboard-page button:focus-visible {
          outline: 3px solid rgba(46, 178, 185, .20);
          outline-offset: 2px;
        }

        .sa-dashboard-page > .hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: clamp(22px, 3vw, 42px);
          padding: clamp(24px, 3vw, 38px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70, 92, 140, .12);
        }

        .sa-dashboard-page > .hero > div:first-child {
          min-width: 0;
          max-width: 980px;
        }

        .sa-dashboard-page .kicker {
          width: fit-content;
          max-width: 100%;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin: 0 0 10px;
          padding: 9px 13px;
          border: 0;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, var(--sa-blue) 0%, var(--sa-cyan) 100%);
          box-shadow: 4px 5px 0 var(--sa-purple);
          font-size: 9px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: .12em;
          text-transform: uppercase;
          white-space: normal;
        }

        .sa-dashboard-page > .hero h1 {
          margin: 0;
          max-width: 920px;
          color: var(--sa-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(35px, 4.4vw, 62px);
          line-height: .96;
          letter-spacing: -.052em;
          font-weight: 760;
        }

        .sa-dashboard-page > .hero p {
          margin: 13px 0 0;
          max-width: 900px;
          color: var(--sa-copy);
          font-size: clamp(13px, 1.1vw, 15px);
          line-height: 1.72;
        }

        .sa-dashboard-page .hero-actions {
          flex: 0 1 560px;
          width: min(100%, 560px);
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: start;
          justify-content: end;
          gap: 11px;
          min-width: 0;
        }

        .sa-dashboard-page .hero-actions > button,
        .sa-dashboard-page .hero-actions > .sa-refresh-action {
          width: 100%;
          min-width: 0;
        }

        .sa-dashboard-page .hero-actions > button,
        .sa-dashboard-page .hero-actions > .sa-refresh-action > button {
          min-height: 46px;
          height: 46px;
          padding-inline: 12px;
        }

        .sa-dashboard-page .hero-actions > button,
        .sa-dashboard-page .toolbar > button,
        .sa-dashboard-page .mini-list > button,
        .sa-dashboard-page .sa-refresh-action > button {
          min-height: 44px;
          border-radius: 15px;
          padding: 0 15px;
          border: 1px solid transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.2;
          text-align: center;
          transition:
            transform .18s ease,
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            color .18s ease;
        }

        .sa-dashboard-page button.primary {
          color: #fff;
          border-color: rgba(77, 119, 221, .18);
          background: linear-gradient(135deg, var(--sa-blue) 0%, var(--sa-cyan) 100%);
          box-shadow:
            5px 6px 0 var(--sa-purple),
            0 14px 25px rgba(67, 116, 170, .14);
        }

        .sa-dashboard-page button.primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow:
            6px 7px 0 var(--sa-purple),
            0 16px 28px rgba(67, 116, 170, .16);
        }

        .sa-dashboard-page button.secondary {
          color: #40588c;
          border-color: rgba(77, 119, 221, .18);
          background: rgba(255, 255, 255, .96);
          box-shadow: 3px 4px 0 rgba(87, 80, 146, .11);
        }

        .sa-dashboard-page button.secondary:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .34);
          color: #314a7e;
          background: #fff;
        }

        .sa-dashboard-page button:disabled {
          cursor: not-allowed;
          opacity: .52;
          transform: none !important;
        }

        .sa-refresh-action {
          position: relative;
          display: grid;
          gap: 8px;
          width: 100%;
          min-width: 0;
          align-items: start;
        }

        .sa-refresh-action > button {
          width: 100%;
        }

        .sa-refresh-feedback {
          width: min(320px, 100%);
          min-width: 0;
          display: grid;
          grid-template-columns: 8px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          padding: 9px 10px;
          border: 1px solid rgba(46, 178, 185, .24);
          border-radius: 12px;
          background: #f0fbf8;
          color: #315f57;
          box-shadow: 3px 4px 0 rgba(87, 80, 146, .10);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.35;
          animation: sa-feedback-in .18s ease both;
        }

        .sa-refresh-feedback::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--sa-cyan);
        }

        .sa-refresh-feedback.error {
          border-color: rgba(203, 84, 107, .24);
          background: #fff2f5;
          color: #934559;
        }

        .sa-refresh-feedback.error::before {
          background: #cb546b;
        }

        .sa-refresh-feedback button {
          width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: currentColor;
          cursor: pointer;
          font-size: 17px;
          line-height: 1;
        }

        .sa-dashboard-page > .inline-message {
          margin: 0;
          padding: 11px 13px;
          border: 1px solid rgba(203, 84, 107, .22);
          border-radius: 14px;
          background: #fff2f5;
          color: #934559;
          box-shadow: 4px 5px 0 rgba(87, 80, 146, .10);
          font-size: 12px;
          font-weight: 800;
        }

        .sa-dashboard-page .stats-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 16px;
          min-width: 0;
        }

        .sa-dashboard-page .stats-grid > * {
          min-width: 0;
          border: 1px solid rgba(154, 164, 205, .48);
          border-radius: 28px;
          background: #fff;
          box-shadow:
            7px 10px 0 rgba(196, 204, 255, .70),
            0 20px 34px rgba(34, 38, 110, .07);
        }

        .sa-dashboard-page .stats-grid > .panel {
          padding: 18px;
        }

        .sa-dashboard-page .sa-kpi-card {
          width: 100%;
          min-width: 0;
          min-height: 178px;
          padding: 24px 26px;
          border: 1px solid rgba(154, 164, 205, .48);
          border-radius: 28px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          gap: 12px;
          color: var(--sa-ink);
          text-align: left;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            border-color .18s ease;
        }

        .sa-dashboard-page .sa-kpi-card:hover {
          transform: translateY(-2px);
          border-color: rgba(77, 119, 221, .28);
        }

        .sa-dashboard-page .sa-kpi-card:active {
          transform: translateY(0);
        }

        .sa-dashboard-page .sa-kpi-card:focus-visible {
          outline: 3px solid rgba(46, 178, 185, .22);
          outline-offset: 3px;
        }

   .sa-dashboard-page .sa-kpi-label {
  display: block;
  color: #62718f;
  font-size: clamp(12px, .9vw, 15px);
  font-weight: 700;
  line-height: 1.25;
  text-transform: capitalize;
  overflow-wrap: anywhere;
}

.sa-dashboard-page .sa-kpi-value {
  display: block;
  color: var(--sa-ink);
  font-size: clamp(32px, 2.8vw, 46px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -.04em;
  overflow-wrap: anywhere;
}

        .sa-dashboard-page .stats-grid > :nth-child(8n + 1) {
          background: linear-gradient(145deg, #eefaff 0%, #dff6fb 100%);
          border-color: rgba(46, 178, 185, .24);
          box-shadow:
            5px 7px 0 rgba(126, 222, 225, .42),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 2) {
          background: linear-gradient(145deg, #f5f1ff 0%, #ebe6ff 100%);
          border-color: rgba(111, 92, 190, .20);
          box-shadow:
            5px 7px 0 rgba(196, 187, 244, .52),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 3) {
          background: linear-gradient(145deg, #effcf6 0%, #dcf7e9 100%);
          border-color: rgba(58, 168, 118, .20);
          box-shadow:
            5px 7px 0 rgba(169, 229, 198, .54),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 4) {
          background: linear-gradient(145deg, #fff8eb 0%, #ffedc8 100%);
          border-color: rgba(210, 150, 52, .22);
          box-shadow:
            5px 7px 0 rgba(245, 211, 147, .58),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 5) {
          background: linear-gradient(145deg, #fff1f5 0%, #ffe3eb 100%);
          border-color: rgba(204, 92, 126, .20);
          box-shadow:
            5px 7px 0 rgba(244, 184, 202, .54),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 6) {
          background: linear-gradient(145deg, #eef5ff 0%, #ddeaff 100%);
          border-color: rgba(77, 119, 221, .20);
          box-shadow:
            5px 7px 0 rgba(183, 207, 252, .56),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 7) {
          background: linear-gradient(145deg, #fff8ef 0%, #f7ead8 100%);
          border-color: rgba(181, 126, 75, .18);
          box-shadow:
            5px 7px 0 rgba(231, 207, 178, .58),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-dashboard-page .stats-grid > :nth-child(8n + 8) {
          background: linear-gradient(145deg, #f1f4ff 0%, #e4e7ff 100%);
          border-color: rgba(87, 80, 146, .20);
          box-shadow:
            5px 7px 0 rgba(194, 197, 240, .56),
            0 18px 32px rgba(34, 38, 110, .05);
        }

        .sa-project-hero {
          position: relative;
          overflow: hidden;
          min-width: 0;
          border: 1px solid rgba(154, 164, 205, .52);
          border-radius: clamp(24px, 2vw, 32px);
          padding: clamp(20px, 2.4vw, 30px);
          background: linear-gradient(
            118deg,
            #eef8ff 0%,
            #ffffff 46%,
            #f5f1ff 100%
          );
          box-shadow:
            7px 9px 0 #c4ccff,
            var(--sa-shadow);
        }

        .sa-project-hero .toolbar {
          align-items: flex-start;
        }

        .sa-project-hero h2 {
          margin: 0;
          color: var(--sa-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(27px, 3vw, 42px);
          line-height: 1;
          letter-spacing: -.045em;
          font-weight: 760;
        }

        .sa-project-hero p {
          margin: 10px 0 0;
          max-width: 860px;
          color: var(--sa-copy);
          line-height: 1.65;
          font-size: 13px;
        }

        .sa-project-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 13px;
          margin-top: 22px;
        }

        .sa-project-stat {
          min-width: 0;
          border: 1px solid rgba(77, 119, 221, .13);
          border-radius: 18px;
          background: linear-gradient(145deg, #ffffff 0%, #f4f8ff 100%);
          padding: 17px;
          box-shadow: 4px 5px 0 rgba(185, 215, 255, .62);
        }

        .sa-project-stat span {
          display: block;
          color: #6a7897;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .075em;
        }

        .sa-project-stat strong {
          display: block;
          margin-top: 9px;
          color: var(--sa-ink);
          font-size: clamp(25px, 2.5vw, 34px);
          line-height: 1;
          overflow-wrap: anywhere;
        }

        .sa-dashboard-page .two-col {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          min-width: 0;
          align-items: stretch;
        }

        .sa-dashboard-page .panel {
          min-width: 0;
          max-width: 100%;
          padding: clamp(16px, 1.8vw, 22px);
          border: 1px solid rgba(154, 164, 205, .48);
          border-radius: 24px;
          background: #fff;
          box-shadow:
            6px 8px 0 rgba(196, 204, 255, .66),
            0 20px 36px rgba(34, 38, 110, .07);
          overflow: hidden;
        }

        .sa-dashboard-page .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-width: 0;
          margin-bottom: 16px;
        }

        .sa-dashboard-page .toolbar > div {
          min-width: 0;
        }

        .sa-dashboard-page .toolbar h3 {
          margin: 0;
          color: var(--sa-ink);
          font-size: clamp(17px, 1.5vw, 21px);
          line-height: 1.15;
          font-weight: 900;
          letter-spacing: -.025em;
        }

        .sa-dashboard-page .toolbar p {
          margin: 6px 0 0;
          color: var(--sa-copy);
          font-size: 12px;
          line-height: 1.55;
        }

        .sa-dept-bars {
          display: grid;
          gap: 11px;
        }

        .sa-dept-bar-card {
          min-width: 0;
          border: 1px solid rgba(77, 119, 221, .13);
          border-radius: 16px;
          padding: 13px;
          background: linear-gradient(135deg, #f8fbff 0%, #f4fcfb 100%);
        }

        .sa-dept-bar-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .sa-dept-bar-head strong {
          min-width: 0;
          color: var(--sa-ink-soft);
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .sa-dept-bar-head span {
          flex: 0 0 auto;
          color: var(--sa-blue);
          font-size: 12px;
          font-weight: 950;
        }

        .sa-dept-track,
        .sa-project-chart-track {
          overflow: hidden;
          border-radius: 999px;
          background: #e7edf8;
        }

        .sa-dept-track {
          height: 9px;
          margin-top: 10px;
        }

        .sa-dept-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--sa-blue), var(--sa-cyan));
        }

        .sa-dept-bar-card p {
          margin: 8px 0 0;
          color: #72809d;
          font-size: 11px;
          font-weight: 750;
        }

        .sa-project-chart {
          display: grid;
          gap: 10px;
        }

        .sa-project-chart-row {
          display: grid;
          grid-template-columns: 58px minmax(0, 1fr) 48px;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .sa-project-chart-row span,
        .sa-project-chart-row strong {
          color: #42577e;
          font-size: 11px;
          font-weight: 900;
        }

        .sa-project-chart-track {
          height: 11px;
        }

        .sa-project-chart-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--sa-blue), #54a5e8, var(--sa-cyan));
        }

        .sa-dashboard-page .empty {
          width: 100%;
          padding: 24px 16px;
          border: 1px dashed rgba(77, 119, 221, .24);
          border-radius: 15px;
          background: #f8fbff;
          color: #73809c;
          text-align: center;
          font-size: 12px;
          font-weight: 750;
        }

        .sa-table-shell {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          border-radius: 15px;
        }

        .sa-table-shell > .table-wrap {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-inline: contain;
          scrollbar-width: thin;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y pinch-zoom;
          cursor: grab;
        }

        .sa-table-shell.is-dragging > .table-wrap,
        .sa-table-shell.is-dragging {
          cursor: grabbing;
          user-select: none;
          -webkit-user-select: none;
        }

        .sa-table-shell.is-dragging * {
          cursor: grabbing !important;
          user-select: none !important;
          -webkit-user-select: none !important;
        }

        .sa-table-shell table {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
        }

        .sa-table-shell th {
          background: linear-gradient(135deg, #eef4ff 0%, #eefcfb 100%);
          color: #40527a;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .045em;
          text-transform: uppercase;
        }

        .sa-table-shell td {
          color: #42516f;
          font-size: 12px;
        }

        .sa-table-shell th,
        .sa-table-shell td {
          max-width: none;
          white-space: nowrap;
          overflow-wrap: normal;
          word-break: normal;
          user-select: text;
          -webkit-user-select: text;
          cursor: grab;
        }

        .sa-dashboard-page .mini-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px;
          min-width: 0;
        }

        .sa-dashboard-page .mini-list > button {
          width: 100%;
          min-width: 0;
          min-height: 48px;
          white-space: normal;
        }

        .sa-module-shell {
          min-width: 0;
          max-width: 100%;
          padding: clamp(16px, 1.8vw, 22px);
          border: 1px solid rgba(154, 164, 205, .48);
          border-radius: 24px;
          background: #fff;
          box-shadow:
            6px 8px 0 rgba(196, 204, 255, .66),
            0 20px 36px rgba(34, 38, 110, .07);
          overflow: hidden;
        }

        @keyframes sa-feedback-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 1180px) {
          .sa-dashboard-page > .hero {
            align-items: stretch;
            flex-direction: column;
          }

          .sa-dashboard-page .hero-actions {
            width: min(100%, 560px);
            justify-content: start;
          }

          .sa-dashboard-page .stats-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .sa-dashboard-page .two-col {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 980px) {
          .sa-project-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .sa-dashboard-page .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .sa-dashboard-page {
            gap: 14px;
            padding-right: 7px;
            padding-bottom: 7px;
          }

          .sa-dashboard-page > .hero {
            padding: 20px;
            border-radius: 28px;
            box-shadow:
              7px 9px 0 #b9d7ff,
              0 20px 34px rgba(70, 92, 140, .10);
          }

          .sa-dashboard-page > .hero h1 {
            font-size: clamp(32px, 10vw, 46px);
          }

          .sa-dashboard-page .hero-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .sa-dashboard-page .hero-actions > button,
          .sa-dashboard-page .sa-refresh-action,
          .sa-dashboard-page .sa-refresh-action > button {
            width: 100%;
            min-width: 0;
          }

          .sa-refresh-feedback {
            width: 100%;
          }

          .sa-dashboard-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .sa-dashboard-page .toolbar > button {
            width: 100%;
          }

          .sa-project-hero {
            border-radius: 22px;
            padding: 18px;
          }

          .sa-dashboard-page .panel,
          .sa-module-shell {
            border-radius: 20px;
          }
        }

        @media (max-width: 520px) {
          .sa-dashboard-page .stats-grid,
          .sa-project-stats {
            grid-template-columns: 1fr;
          }

          .sa-dashboard-page .hero-actions {
            grid-template-columns: 1fr;
          }

          .sa-dashboard-page .mini-list {
            grid-template-columns: 1fr;
          }

          .sa-project-chart-row {
            grid-template-columns: 50px minmax(0, 1fr) 42px;
            gap: 7px;
          }

          .sa-dashboard-page > .hero {
            padding: 17px;
            border-radius: 24px;
          }

          .sa-dashboard-page .panel,
          .sa-module-shell {
            padding: 14px;
            border-radius: 18px;
          }

          .sa-project-stat {
            padding: 14px;
          }
        }
      `}</style>

      <section className="hero">
        <div>
          <span className="kicker">Platform Super Admin</span>

          <h1>Super Admin Platform Control Center</h1>

          <p>
            Manage companies and tenant users, employee records, system settings,
            audit logs, payslip design, escalated IT support, notifications,
            Premium and Trial requests, subscriptions and your Super Admin profile.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() => goTo('companies')}
          >
            Companies / Tenants
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('users')}
          >
            User Control
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('employees')}
          >
            Employee Management
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('notifications')}
          >
            Notifications
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('system_settings')}
          >
            System Settings
          </button>

          <div className="sa-refresh-action">
            <button
              type="button"
              className="secondary"
              onClick={() => loadDashboard({ announce: true })}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            {refreshFeedback ? (
              <div
                className={`sa-refresh-feedback ${refreshFeedback.tone === 'error' ? 'error' : ''}`}
                role="status"
                aria-live="polite"
              >
                <span>{refreshFeedback.text}</span>
                <button
                  type="button"
                  onClick={clearRefreshFeedback}
                  aria-label="Dismiss refresh notification"
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      {data ? (
        <>
          <section className="stats-grid">
            {superAdminStats.map(([key, value]) => {
              const targetPage = superAdminKpiTarget(key);

              return (
                <button
                  key={key}
                  type="button"
                  className="sa-kpi-card"
                  onClick={() => {
                    if (targetPage) {
                      goTo(targetPage);
                    }
                  }}
                  aria-label={`Open ${statusLabel(key)}`}
                  title={targetPage ? `Open ${statusLabel(key)}` : statusLabel(key)}
                >
                  <span className="sa-kpi-label">{statusLabel(key)}</span>
                  <strong className="sa-kpi-value">{value}</strong>
                </button>
              );
            })}

            {!loading && !message && !superAdminStats.length && (
              <div className="panel">
                <p>No Super Admin KPI data available.</p>
              </div>
            )}
          </section>

          <section className="two-col">
            <div className="panel">
              <div className="toolbar">
                <div>
                  <h3>Companies / Tenants</h3>
                  <p>
                    Tenant-wise platform overview with company status, users and
                    employees.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => goTo('companies')}
                >
                  Manage Companies
                </button>
              </div>

              <div className="sa-table-shell">
                <Table rows={tenantRows} maxColumns={5} />
              </div>
            </div>

            <div className="panel">
              <div className="toolbar">
                <div>
                  <h3>Recent Users</h3>
                  <p>Latest platform users without password data.</p>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => goTo('users')}
                >
                  User Control
                </button>
              </div>

              <div className="sa-table-shell">
                <Table rows={recentUserRows} maxColumns={8} />
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="toolbar">
              <div>
                <h3>Recent Audit</h3>
                <p>Latest system actions across the SaaS platform.</p>
              </div>

              <button
                type="button"
                className="secondary"
                onClick={() => goTo('audit_logs')}
              >
                Audit Logs
              </button>
            </div>

            <div className="sa-table-shell">
              <Table rows={recentAuditRows} maxColumns={8} />
            </div>
          </section>
        </>
      ) : null}

      <div className="sa-module-shell">
        <ModuleGrid modules={dashboardModules} setPage={setPage} />
      </div>
    </div>
  );
}