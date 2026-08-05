import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock,
  FileText,
  Loader2,
  Mail,
  MapPin,
  PenLine,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

import {
  assignManagementGroupMinutesWriter,
  createManagementGroupMeeting,
  deleteManagementGroupMeeting,
  getManagementGroup,
  getManagementGroupEmployeeOptions,
  getManagementGroupMeetings,
  updateManagementGroupMembers,
  updateManagementGroupMinutes,
} from '../api/client';

import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const EMPTY_MEETING_FORM = {
  topic: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  mode: 'Offline',
  location: '',
  agenda: '',
  assigned_minutes_user_id: '',
};

const EMPTY_MINUTES_FORM = {
  minutes: '',
  decisions: '',
  action_items: '',
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return 'Not set';

  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return '';

  try {
    return new Date(value).toLocaleString('en-IN', {
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

function initials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return 'MG';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function memberSearchText(member = {}) {
  return [
    member.name,
    member.employee_name,
    member.email,
    member.phone,
    member.department,
    member.designation,
    member.employee_code,
  ]
    .join(' ')
    .toLowerCase();
}

function uniqueValues(items = [], key) {
  return [
    ...new Set(
      items
        .map((item) => String(item?.[key] || '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function StatusPill({ value }) {
  const text = String(value || 'scheduled').replaceAll('_', ' ');

  return (
    <span className={`mg-pill mg-pill-${String(value || '').toLowerCase()}`}>
      {text}
    </span>
  );
}


const MANAGEMENT_GROUP_STYLES = `
  .mg-page {
    --mg-ink: #101a3a;
    --mg-soft: #596483;
    --mg-violet: #6254da;
    --mg-deep: #342b78;
    --mg-blue: #3766db;
    --mg-teal: #18aaa8;
    --mg-flat-blue: #b9d7ff;
    --mg-flat-violet: #c9c0ff;
    --mg-flat-teal: #aee6d9;
    display: grid;
    gap: 22px;
    width: 100%;
    color: var(--mg-ink);
    font-family: var(--yc-ui, var(--body), inherit);
  }

  .mg-hero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 26px;
    padding: clamp(24px, 2.8vw, 36px);
    border: 1px solid rgba(171, 181, 211, .72);
    border-radius: clamp(28px, 2.5vw, 40px);
    background:
      radial-gradient(circle at 8% 8%, rgba(121, 219, 238, .34), transparent 31%),
      radial-gradient(circle at 92% 12%, rgba(191, 190, 249, .3), transparent 34%),
      linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
    box-shadow: 12px 14px 0 var(--mg-flat-blue), 0 28px 48px rgba(34, 38, 110, .13);
  }

  .mg-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -2;
    opacity: .42;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
    background-size: 42px 42px;
  }

  .mg-hero::after {
    content: "";
    position: absolute;
    z-index: -1;
    width: clamp(165px, 20vw, 290px);
    aspect-ratio: 1;
    right: clamp(-110px, -7vw, -55px);
    top: clamp(-118px, -8vw, -60px);
    border: 1px solid rgba(65, 55, 161, .12);
    border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
    background: linear-gradient(145deg, rgba(105, 217, 208, .72), rgba(121, 189, 242, .72));
    transform: rotate(18deg);
  }

  .mg-eyebrow {
    display: inline-flex;
    width: fit-content;
    padding: 9px 13px;
    border-radius: 999px;
    color: #fff;
    background: var(--mg-deep);
    font-size: 9px;
    font-weight: 950;
    line-height: 1;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .mg-hero h1 {
    margin: 15px 0 9px;
    color: var(--mg-ink);
    font-family: var(--yc-display, var(--heading), inherit);
    font-size: clamp(34px, 4.4vw, 66px);
    font-weight: 760;
    line-height: .94;
    letter-spacing: -.055em;
  }

  .mg-hero p,
  .mg-panel-head p,
  .mg-member-info p,
  .mg-empty p,
  .mg-restricted-note p {
    color: var(--mg-soft);
  }

  .mg-hero p {
    max-width: 780px;
    margin: 0;
    font-size: clamp(13px, 1vw, 16px);
    line-height: 1.68;
  }

  .mg-hero-card {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 210px;
    padding: 20px;
    border: 1px solid rgba(159, 169, 205, .58);
    border-radius: 22px;
    background: rgba(255, 255, 255, .86);
    box-shadow: 7px 9px 0 var(--mg-flat-violet), 0 18px 30px rgba(15, 20, 75, .09);
  }

  .mg-hero-icon,
  .mg-avatar {
    display: grid;
    place-items: center;
    color: #fff;
    background: linear-gradient(145deg, #4f72df, #2bb9b5);
    box-shadow: 4px 5px 0 rgba(52, 43, 120, .76);
  }

  .mg-hero-icon {
    width: 48px;
    height: 48px;
    border-radius: 15px;
  }

  .mg-hero-card strong {
    display: block;
    font-size: 34px;
    line-height: 1;
  }

  .mg-hero-card span {
    display: block;
    margin-top: 5px;
    color: var(--mg-soft);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .mg-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .mg-stat-card {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 18px;
    border: 1px solid rgba(171, 181, 211, .68);
    border-radius: 21px;
    background: #f8fbff;
    box-shadow: 7px 9px 0 var(--mg-flat-blue), 0 18px 30px rgba(15, 20, 75, .08);
  }

  .mg-stat-card:nth-child(2) { background: #f1efff; box-shadow: 7px 9px 0 var(--mg-flat-violet), 0 18px 30px rgba(15,20,75,.08); }
  .mg-stat-card:nth-child(3) { background: #eaf8f4; box-shadow: 7px 9px 0 var(--mg-flat-teal), 0 18px 30px rgba(15,20,75,.08); }
  .mg-stat-card:nth-child(4) { background: #fff4d5; box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(15,20,75,.08); }
  .mg-stat-card > svg { color: var(--mg-violet); flex: 0 0 auto; }
  .mg-stat-card span { display: block; color: var(--mg-soft); font-size: 10px; font-weight: 900; text-transform: uppercase; }
  .mg-stat-card strong { font-size: 28px; line-height: 1; }

  .mg-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr);
    gap: 20px;
    align-items: start;
  }

  .mg-panel {
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgba(171, 181, 211, .72);
    border-radius: clamp(24px, 2vw, 32px);
    background: linear-gradient(145deg, rgba(255,255,255,.99), rgba(244,249,255,.98));
    box-shadow: 9px 11px 0 #d1dcfa, 0 24px 42px rgba(34, 38, 110, .1);
  }

  .mg-grid > .mg-panel:nth-child(2),
  .mg-history-panel {
    background: linear-gradient(145deg, #f4fbff 0%, #f8f1ff 56%, #fffaf0 100%);
    box-shadow: 9px 11px 0 #c9ddf5, 0 24px 42px rgba(34, 38, 110, .1);
  }

  .mg-panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 22px 24px;
    border-bottom: 1px solid rgba(65, 55, 161, .12);
    background: rgba(255,255,255,.68);
  }

  .mg-panel-head h2 {
    margin: 0 0 6px;
    font-family: var(--yc-display, var(--heading), inherit);
    font-size: clamp(22px, 2vw, 30px);
    line-height: 1;
    letter-spacing: -.03em;
  }

  .mg-panel-head p { margin: 0; font-size: 12px; line-height: 1.55; }

  .mg-member-toolbar,
  .mg-filter-bar {
    display: grid;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(65, 55, 161, .1);
    background: rgba(255,255,255,.58);
  }

  .mg-member-toolbar { grid-template-columns: minmax(0, 1fr) 210px; }
  .mg-filter-bar { grid-template-columns: minmax(220px, 1fr) 160px 160px auto auto; }

  .mg-search-box { position: relative; display: flex; align-items: center; min-width: 0; }
  .mg-search-box svg { position: absolute; left: 13px; color: var(--mg-violet); pointer-events: none; }
  .mg-search-box input { padding-left: 40px !important; }

  .mg-member-toolbar input,
  .mg-member-toolbar select,
  .mg-filter-bar input,
  .mg-filter-bar select,
  .mg-form input,
  .mg-form select,
  .mg-form textarea,
  .mg-inline-assign select,
  .mg-minutes-panel textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(159, 169, 205, .62);
    border-radius: 14px;
    outline: none;
    color: var(--mg-ink);
    background: rgba(255,255,255,.86);
    padding: 12px 13px;
    font: inherit;
    transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }

  .mg-member-toolbar input:focus,
  .mg-member-toolbar select:focus,
  .mg-filter-bar input:focus,
  .mg-filter-bar select:focus,
  .mg-form input:focus,
  .mg-form select:focus,
  .mg-form textarea:focus,
  .mg-inline-assign select:focus,
  .mg-minutes-panel textarea:focus {
    border-color: var(--mg-violet);
    background: #fff;
    box-shadow: 0 0 0 4px rgba(98, 84, 218, .11);
  }

  .mg-member-list {
    display: grid;
    gap: 12px;
    max-height: 680px;
    overflow: auto;
    padding: 18px;
  }

  .mg-member-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 14px;
    border: 1px solid rgba(171, 181, 211, .6);
    border-radius: 19px;
    background: rgba(255,255,255,.72);
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
  }

  .mg-member-card:hover { transform: translateY(-2px); border-color: rgba(98,84,218,.32); box-shadow: 5px 6px 0 rgba(185,215,255,.72); }
  .mg-member-active { border-color: rgba(55,102,219,.28); background: linear-gradient(145deg, #edf6ff, #fff 62%, #f1efff); box-shadow: 5px 6px 0 var(--mg-flat-blue); }

  .mg-avatar {
    width: 52px;
    height: 52px;
    overflow: hidden;
    border: 3px solid #fff;
    border-radius: 17px;
    font-weight: 950;
  }

  .mg-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .mg-member-info { min-width: 0; }
  .mg-member-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .mg-member-title strong { font-size: 14px; font-weight: 950; }
  .mg-member-info p { margin: 5px 0 0; font-size: 11px; }

  .mg-admin-badge,
  .mg-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    width: fit-content;
    padding: 6px 9px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 900;
    line-height: 1;
  }

  .mg-admin-badge { color: #3657b5; background: #e5e9ff; }
  .mg-member-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; color: #687492; font-size: 10px; }
  .mg-member-meta span { display: inline-flex; align-items: center; gap: 5px; overflow-wrap: anywhere; }
  .mg-member-actions { display: grid; gap: 8px; }
  .mg-check-row { display: inline-flex; align-items: center; gap: 7px; color: #334164; font-size: 10px; font-weight: 900; cursor: pointer; }
  .mg-check-row input { width: 17px; height: 17px; accent-color: var(--mg-violet); }

  .mg-form { padding: 20px; }
  .mg-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .mg-form label, .mg-minutes-panel label { display: grid; gap: 7px; min-width: 0; }
  .mg-form label > span, .mg-minutes-panel label > span { color: #334164; font-size: 11px; font-weight: 900; }
  .mg-form textarea, .mg-minutes-panel textarea { resize: vertical; line-height: 1.55; }
  .mg-span-2 { grid-column: 1 / -1; }
  .mg-form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(65,55,161,.11); }

  .mg-primary-btn,
  .mg-secondary-btn,
  .mg-ghost-btn,
  .mg-danger-btn,
  .mg-icon-btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 10px 14px;
    border: 1px solid transparent;
    border-radius: 13px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 900;
    line-height: 1;
    white-space: nowrap;
    transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
  }

  .mg-primary-btn { color: #fff; background: linear-gradient(145deg, #4f72df, #2bb9b5); box-shadow: 5px 6px 0 rgba(52,43,120,.8); }
  .mg-secondary-btn { color: var(--mg-deep); background: #f1efff; border-color: rgba(98,84,218,.18); box-shadow: 4px 5px 0 rgba(98,84,218,.14); }
  .mg-ghost-btn { color: #4f5e7f; background: rgba(255,255,255,.74); border-color: rgba(159,169,205,.42); }
  .mg-danger-btn { min-width: 40px; padding-inline: 10px; color: #b62f55; background: #ffe4ec; border-color: rgba(190,47,85,.18); }
  .mg-icon-btn { width: 40px; padding: 0; color: var(--mg-deep); background: #f1efff; border-color: rgba(98,84,218,.18); }
  .mg-primary-btn:hover, .mg-secondary-btn:hover, .mg-ghost-btn:hover, .mg-danger-btn:hover, .mg-icon-btn:hover { transform: translateY(-2px); filter: saturate(1.04); }
  .mg-primary-btn:disabled, .mg-secondary-btn:disabled, .mg-ghost-btn:disabled, .mg-danger-btn:disabled { opacity: .62; cursor: not-allowed; transform: none; box-shadow: none; }

  .mg-meeting-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, .78fr); gap: 18px; padding: 18px; }
  .mg-meeting-list { display: grid; align-content: start; gap: 13px; }
  .mg-meeting-card { padding: 16px; border: 1px solid rgba(171,181,211,.62); border-radius: 20px; background: rgba(255,255,255,.76); box-shadow: 4px 5px 0 rgba(185,215,255,.62); transition: transform .18s ease, box-shadow .18s ease; }
  .mg-meeting-card:hover { transform: translateY(-2px); box-shadow: 7px 8px 0 var(--mg-flat-blue); }
  .mg-meeting-active { background: linear-gradient(145deg, #edf6ff, #fff 58%, #f1efff); box-shadow: 7px 8px 0 var(--mg-flat-violet); }
  .mg-meeting-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .mg-meeting-top h3 { margin: 0; font-size: 16px; font-weight: 950; }
  .mg-meeting-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; color: var(--mg-soft); font-size: 10px; }
  .mg-meeting-meta span { display: inline-flex; align-items: center; gap: 5px; }
  .mg-meeting-agenda { margin: 13px 0 0; padding: 11px 12px; border: 1px solid rgba(98,84,218,.1); border-radius: 13px; color: #4f5e7f; background: rgba(241,239,255,.48); font-size: 11px; line-height: 1.55; white-space: pre-wrap; }
  .mg-meeting-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(65,55,161,.1); color: var(--mg-soft); font-size: 10px; }
  .mg-card-actions { display: flex; align-items: center; gap: 8px; }
  .mg-inline-assign { display: flex; align-items: center; gap: 9px; margin-top: 12px; color: var(--mg-violet); }

  .mg-minutes-panel { position: sticky; top: 16px; align-self: start; padding: 18px; border: 1px solid rgba(171,181,211,.68); border-radius: 21px; background: linear-gradient(145deg, rgba(255,255,255,.96), rgba(244,249,255,.94)); box-shadow: 7px 9px 0 #d1dcfa; }
  .mg-minutes-panel form { display: grid; gap: 14px; }
  .mg-minutes-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 13px; border-bottom: 1px solid rgba(65,55,161,.1); }
  .mg-minutes-head > div > span { color: var(--mg-violet); font-size: 9px; font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
  .mg-minutes-head h3 { margin: 5px 0; font-size: 19px; font-weight: 950; }
  .mg-minutes-head p, .mg-update-note { margin: 0; color: var(--mg-soft); font-size: 10px; line-height: 1.5; }
  .mg-update-note { padding: 10px 12px; border-radius: 12px; background: #f1efff; }

  .mg-pill-completed { color: #13736f; background: #dff8f3; }
  .mg-pill-pending, .mg-pill-scheduled { color: #8b5a14; background: #fff4d5; }
  .mg-pill-cancelled { color: #b62f55; background: #ffe4ec; }

  .mg-restricted-note { display: flex; align-items: flex-start; gap: 12px; padding: 15px 17px; border: 1px solid rgba(98,84,218,.18); border-radius: 18px; color: #4a5680; background: linear-gradient(145deg, #edf6ff, #f1efff); box-shadow: 5px 6px 0 rgba(185,215,255,.62); }
  .mg-restricted-note > svg { flex: 0 0 auto; color: var(--mg-violet); }
  .mg-restricted-note strong { display: block; margin-bottom: 4px; }
  .mg-restricted-note p { margin: 0; font-size: 11px; line-height: 1.5; }
  .mg-compact-note { padding: 11px 12px; }

  .mg-empty { display: grid; place-items: center; padding: 30px 20px; border: 1px dashed rgba(98,84,218,.35); border-radius: 18px; color: var(--mg-soft); background: linear-gradient(145deg, rgba(237,248,255,.72), rgba(248,241,255,.68)); text-align: center; }
  .mg-empty svg { margin-bottom: 10px; color: var(--mg-violet); }
  .mg-empty strong { display: block; margin-bottom: 5px; color: var(--mg-ink); font-size: 15px; }
  .mg-empty p { margin: 0; font-size: 11px; line-height: 1.5; }
  .mg-sticky-empty { min-height: 280px; }

  .mg-loading-card { display: flex; align-items: center; gap: 14px; padding: 24px; border: 1px solid rgba(171,181,211,.68); border-radius: 24px; background: linear-gradient(145deg, #edf6ff, #fff 58%, #f1efff); box-shadow: 8px 10px 0 var(--mg-flat-blue), 0 18px 30px rgba(15,20,75,.08); }
  .mg-loading-card h2 { margin: 0 0 5px; }
  .mg-loading-card p { margin: 0; color: var(--mg-soft); }
  .mg-spin { animation: mgSpin .9s linear infinite; }
  @keyframes mgSpin { to { transform: rotate(360deg); } }

  @media (max-width: 1180px) {
    .mg-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mg-grid, .mg-meeting-layout { grid-template-columns: 1fr; }
    .mg-minutes-panel { position: static; }
  }

  @media (max-width: 860px) {
    .mg-member-toolbar, .mg-filter-bar { grid-template-columns: 1fr; }
    .mg-panel-head { flex-direction: column; }
    .mg-panel-head .mg-primary-btn { width: 100%; }
  }

  @media (max-width: 720px) {
    .mg-page { gap: 17px; }
    .mg-hero { grid-template-columns: 1fr; padding: 20px; border-radius: 24px; box-shadow: 7px 8px 0 var(--mg-flat-blue), 0 18px 30px rgba(34,38,110,.1); }
    .mg-hero h1 { font-size: clamp(31px, 9.2vw, 43px); }
    .mg-hero-card { min-width: 0; }
    .mg-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .mg-stat-card { padding: 14px; border-radius: 17px; }
    .mg-panel { border-radius: 23px; box-shadow: 6px 7px 0 #d1dcfa, 0 16px 28px rgba(34,38,110,.08); }
    .mg-panel-head, .mg-form, .mg-member-list, .mg-meeting-layout { padding: 17px; }
    .mg-form-grid { grid-template-columns: 1fr; }
    .mg-span-2 { grid-column: auto; }
    .mg-member-card { grid-template-columns: auto minmax(0, 1fr); }
    .mg-member-actions { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mg-check-row { justify-content: center; padding: 9px; border-radius: 11px; background: rgba(241,239,255,.62); }
    .mg-meeting-footer { align-items: flex-start; flex-direction: column; }
    .mg-card-actions, .mg-form-actions { width: 100%; }
  }

  @media (max-width: 430px) {
    .mg-stat-grid { grid-template-columns: 1fr; }
    .mg-member-card { grid-template-columns: 1fr; text-align: center; }
    .mg-avatar { margin-inline: auto; }
    .mg-member-title, .mg-member-meta { justify-content: center; }
  }

  @media (prefers-reduced-motion: reduce) {
    .mg-page *, .mg-page *::before, .mg-page *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
`;

export default function ManagementGroup({ user }) {
  const alerts = useCustomAlert();
  const [loading, setLoading] = useState(true);
  const [savingMembers, setSavingMembers] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [deletingMeetingId, setDeletingMeetingId] = useState('');

  const [group, setGroup] = useState({});
  const [members, setMembers] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [permissions, setPermissions] = useState({});

  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [selectedGroupAdminUserIds, setSelectedGroupAdminUserIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberDepartment, setMemberDepartment] = useState('');

  const [meetingForm, setMeetingForm] = useState({
    ...EMPTY_MEETING_FORM,
    meeting_date: todayDate(),
  });

  const [filters, setFilters] = useState({
    topic: '',
    from_date: '',
    to_date: '',
  });

  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [minutesForm, setMinutesForm] = useState(EMPTY_MINUTES_FORM);


  const canManage = Boolean(permissions.can_manage);
  const canViewPrivate = Boolean(permissions.can_view_private);

  const loggedInUserId = String(user?._id || user?.id || '');

  const memberUserIds = useMemo(
    () => new Set(members.map((member) => String(member.user_id || '')).filter(Boolean)),
    [members],
  );

  const isCurrentUserMember = useMemo(() => {
    if (permissions.is_member) return true;
    return loggedInUserId && memberUserIds.has(loggedInUserId);
  }, [permissions.is_member, loggedInUserId, memberUserIds]);

  const visibleEmployeeOptions = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();

    return employeeOptions.filter((employee) => {
      if (query && !memberSearchText(employee).includes(query)) {
        return false;
      }

      if (
        memberDepartment &&
        String(employee.department || '').trim().toLowerCase() !== memberDepartment.toLowerCase()
      ) {
        return false;
      }

      return true;
    });
  }, [employeeOptions, memberSearch, memberDepartment]);

  const departmentOptions = useMemo(
    () => uniqueValues(employeeOptions, 'department'),
    [employeeOptions],
  );

  const selectedMembersForWriter = useMemo(() => {
    const selectedSet = new Set(selectedMemberIds.map(String));

    return employeeOptions.filter((employee) =>
      selectedSet.has(String(employee.employee_id || employee._id || employee.id || '')),
    );
  }, [employeeOptions, selectedMemberIds]);

  const meetingStats = useMemo(() => {
    const total = meetings.length;
    const completed = meetings.filter((item) => item.minutes_status === 'completed').length;
    const pending = meetings.filter((item) => item.minutes_status !== 'completed').length;

    return { total, completed, pending };
  }, [meetings]);

  async function loadGroup({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await getManagementGroup();

      setGroup(data.group || {});
      setMembers(data.members || []);
      setPermissions(data.permissions || {});

      const memberIds = (data.members || [])
        .map((member) => String(member.employee_id || member._id || member.id || ''))
        .filter(Boolean);

      const adminUserIds = (data.members || [])
        .filter((member) => member.is_group_admin)
        .map((member) => String(member.user_id || ''))
        .filter(Boolean);

      setSelectedMemberIds(memberIds);
      setSelectedGroupAdminUserIds(adminUserIds);

      if (data.permissions?.can_manage) {
        const optionsData = await getManagementGroupEmployeeOptions();
        setEmployeeOptions(optionsData.items || optionsData.employees || []);
      } else {
        setEmployeeOptions(data.members || []);
      }

      if (data.permissions?.can_view_private) {
        await loadMeetings();
      } else {
        setMeetings([]);
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to load Management Group.', 'Management Group Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadMeetings(nextFilters = filters) {
    try {
      const data = await getManagementGroupMeetings(nextFilters);
      setMeetings(data.items || data.meetings || []);
    } catch (ex) {
      alerts.error(ex.message || 'Unable to load Management Group meetings.', 'Meetings Load Failed');
    }
  }

  useEffect(() => {
    loadGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMember(employee) {
    const employeeId = String(employee.employee_id || employee._id || employee.id || '');
    const userId = String(employee.user_id || '');

    if (!employeeId) return;

    setSelectedMemberIds((current) => {
      if (current.includes(employeeId)) {
        setSelectedGroupAdminUserIds((admins) =>
          admins.filter((adminId) => adminId !== userId),
        );

        return current.filter((id) => id !== employeeId);
      }

      return [...current, employeeId];
    });
  }

  function toggleGroupAdmin(employee) {
    const employeeId = String(employee.employee_id || employee._id || employee.id || '');
    const userId = String(employee.user_id || '');

    if (!employeeId || !userId) return;

    if (!selectedMemberIds.includes(employeeId)) {
      setSelectedMemberIds((current) => [...current, employeeId]);
    }

    setSelectedGroupAdminUserIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }

      return [...current, userId];
    });
  }

  async function handleSaveMembers(event) {
    event.preventDefault();

    if (!selectedMemberIds.length) {
      alerts.warning('Select at least one Management Group member.', 'Members Required');
      return;
    }

    setSavingMembers(true);

    try {
      const data = await updateManagementGroupMembers({
        name: group.name || 'Management Group',
        description: group.description || '',
        member_employee_ids: selectedMemberIds,
        group_admin_user_ids: selectedGroupAdminUserIds,
      });

      setGroup(data.group || {});
      setMembers(data.members || []);
      alerts.success(data.message || 'Management Group members updated successfully.', 'Members Updated');

      await loadGroup({ silent: true });
    } catch (ex) {
      alerts.error(ex.message || 'Unable to update Management Group members.', 'Members Update Failed');
    } finally {
      setSavingMembers(false);
    }
  }

  function updateMeetingField(field, value) {
    setMeetingForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleCreateMeeting(event) {
    event.preventDefault();

    if (!meetingForm.topic.trim()) {
      alerts.warning('Meeting topic is required.', 'Meeting Topic Required');
      return;
    }

    if (!meetingForm.meeting_date) {
      alerts.warning('Meeting date is required.', 'Meeting Date Required');
      return;
    }

    setSavingMeeting(true);

    try {
      const data = await createManagementGroupMeeting(meetingForm);

      alerts.success(data.message || 'Management Group meeting scheduled successfully.', 'Meeting Scheduled');
      setMeetingForm({
        ...EMPTY_MEETING_FORM,
        meeting_date: todayDate(),
      });

      await loadMeetings();
    } catch (ex) {
      alerts.error(ex.message || 'Unable to schedule Management Group meeting.', 'Meeting Schedule Failed');
    } finally {
      setSavingMeeting(false);
    }
  }

  function openMinutesEditor(meeting) {
    setSelectedMeeting(meeting);
    setMinutesForm({
      minutes: meeting.minutes || '',
      decisions: meeting.decisions || '',
      action_items: meeting.action_items || '',
    });
  }

  function closeMinutesEditor() {
    setSelectedMeeting(null);
    setMinutesForm(EMPTY_MINUTES_FORM);
  }

  function canEditMinutes(meeting) {
    if (canManage) return true;

    return (
      loggedInUserId &&
      String(meeting.assigned_minutes_user_id || '') === loggedInUserId
    );
  }

  async function handleSaveMinutes(event) {
    event.preventDefault();

    if (!selectedMeeting?._id && !selectedMeeting?.id) {
      alerts.warning('Please select a meeting first.', 'Meeting Required');
      return;
    }

    if (!minutesForm.minutes.trim()) {
      alerts.warning('Meeting minutes are required.', 'Minutes Required');
      return;
    }

    const meetingId = selectedMeeting._id || selectedMeeting.id;

    setSavingMinutes(true);

    try {
      const data = await updateManagementGroupMinutes(meetingId, minutesForm);

      alerts.success(data.message || 'Meeting minutes saved successfully.', 'Minutes Saved');
      setSelectedMeeting(data.meeting || null);
      await loadMeetings();
    } catch (ex) {
      alerts.error(ex.message || 'Unable to save meeting minutes.', 'Minutes Save Failed');
    } finally {
      setSavingMinutes(false);
    }
  }

  async function handleAssignWriter(meetingId, userId) {
    if (!meetingId || !userId) return;


    try {
      const data = await assignManagementGroupMinutesWriter(meetingId, {
        assigned_minutes_user_id: userId,
      });

      alerts.success(data.message || 'Minutes writer assigned successfully.', 'Minutes Writer Assigned');
      await loadMeetings();

      if (selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId)) {
        setSelectedMeeting(data.meeting || selectedMeeting);
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to assign minutes writer.', 'Writer Assignment Failed');
    }
  }

  async function handleDeleteMeeting(meeting) {
    const meetingId = meeting._id || meeting.id;

    if (!meetingId) return;

    const confirmed = await alerts.confirm(
      `Delete meeting "${meeting.topic}"? This will hide it from Management Group history.`,
      'Delete Meeting?',
    );

    if (!confirmed) return;

    setDeletingMeetingId(meetingId);

    try {
      const data = await deleteManagementGroupMeeting(meetingId);

      alerts.success(data.message || 'Meeting deleted successfully.', 'Meeting Deleted');
      await loadMeetings();

      if (selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId)) {
        closeMinutesEditor();
      }
    } catch (ex) {
      alerts.error(ex.message || 'Unable to delete meeting.', 'Meeting Delete Failed');
    } finally {
      setDeletingMeetingId('');
    }
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();
    await loadMeetings(filters);
  }

  function clearFilters() {
    const next = {
      topic: '',
      from_date: '',
      to_date: '',
    };

    setFilters(next);
    loadMeetings(next);
  }

  if (loading) {
    return (
      <section className="mg-page">
        <style>{MANAGEMENT_GROUP_STYLES}</style>
        <div className="mg-loading-card">
          <Loader2 className="mg-spin" size={26} />
          <div>
            <h2>Loading Management Group</h2>
            <p>Preparing members, access rules and meeting history.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mg-page">
      <style>{MANAGEMENT_GROUP_STYLES}</style>
      <div className="mg-hero">
        <div>
          <span className="mg-eyebrow">Tenant Management</span>
          <h1>Management Group</h1>
          <p>
            Control group membership, schedule meetings, assign minutes writers
            and maintain searchable meeting minutes history.
          </p>
        </div>

        <div className="mg-hero-card">
          <div className="mg-hero-icon">
            <Users size={28} />
          </div>
          <div>
            <strong>{members.length}</strong>
            <span>Members</span>
          </div>
        </div>
      </div>

      {!canViewPrivate && (
        <div className="mg-restricted-note">
          <ShieldCheck size={20} />
          <div>
            <strong>View-only access</strong>
            <p>
              You are not a Management Group member. You can view the Management Group
              members only. Meetings and minutes are visible only to group members.
            </p>
          </div>
        </div>
      )}

      <div className="mg-stat-grid">
        <div className="mg-stat-card">
          <Users size={22} />
          <div>
            <span>Total Members</span>
            <strong>{members.length}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <CalendarDays size={22} />
          <div>
            <span>Total Meetings</span>
            <strong>{canViewPrivate ? meetingStats.total : '--'}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <FileText size={22} />
          <div>
            <span>Minutes Completed</span>
            <strong>{canViewPrivate ? meetingStats.completed : '--'}</strong>
          </div>
        </div>

        <div className="mg-stat-card">
          <Clock size={22} />
          <div>
            <span>Minutes Pending</span>
            <strong>{canViewPrivate ? meetingStats.pending : '--'}</strong>
          </div>
        </div>
      </div>

      <div className="mg-grid">
        <div className="mg-panel mg-members-panel">
          <div className="mg-panel-head">
            <div>
              <h2>Management Group Members</h2>
              <p>
                {canManage
                  ? 'Tenant admin can select members and assign group admins.'
                  : 'Visible Management Group member directory.'}
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                className="mg-primary-btn"
                onClick={handleSaveMembers}
                disabled={savingMembers}
              >
                {savingMembers ? <Loader2 className="mg-spin" size={16} /> : <Save size={16} />}
                Save Members
              </button>
            )}
          </div>

          {canManage && (
            <form className="mg-member-toolbar" onSubmit={handleSaveMembers}>
              <label className="mg-search-box">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search employee by name, code, email, department..."
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                />
              </label>

              <select
                value={memberDepartment}
                onChange={(event) => setMemberDepartment(event.target.value)}
              >
                <option value="">All Departments</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </form>
          )}

          <div className="mg-member-list">
            {(canManage ? visibleEmployeeOptions : members).map((member) => {
              const employeeId = String(member.employee_id || member._id || member.id || '');
              const userId = String(member.user_id || '');
              const selected = selectedMemberIds.includes(employeeId);
              const isAdmin = selectedGroupAdminUserIds.includes(userId) || member.is_group_admin;

              return (
                <div
                  key={`${employeeId}-${userId}`}
                  className={`mg-member-card ${selected || !canManage ? 'mg-member-active' : ''}`}
                >
                  <div className="mg-avatar">
                    {member.avatar || member.photo_url ? (
                      <img src={member.avatar || member.photo_url} alt={member.name} />
                    ) : (
                      <span>{initials(member.name)}</span>
                    )}
                  </div>

                  <div className="mg-member-info">
                    <div className="mg-member-title">
                      <strong>{member.name || member.employee_name}</strong>
                      {isAdmin ? (
                        <span className="mg-admin-badge">
                          <ShieldCheck size={13} />
                          Group Admin
                        </span>
                      ) : null}
                    </div>

                    <p>
                      {member.designation || 'Employee'}
                      {member.department ? ` · ${member.department}` : ''}
                    </p>

                    <div className="mg-member-meta">
                      {member.email ? (
                        <span>
                          <Mail size={13} />
                          {member.email}
                        </span>
                      ) : null}
                      {member.employee_code ? <span>{member.employee_code}</span> : null}
                    </div>
                  </div>

                  {canManage && (
                    <div className="mg-member-actions">
                      <label className="mg-check-row">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMember(member)}
                        />
                        <span>Member</span>
                      </label>

                      <label className="mg-check-row">
                        <input
                          type="checkbox"
                          checked={isAdmin}
                          disabled={!userId}
                          onChange={() => toggleGroupAdmin(member)}
                        />
                        <span>Admin</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}

            {!(canManage ? visibleEmployeeOptions : members).length && (
              <div className="mg-empty">
                <Users size={26} />
                <strong>No members found</strong>
                <p>
                  {canManage
                    ? 'Adjust search/filter or add active employees first.'
                    : 'Management Group members are not configured yet.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {canViewPrivate && (
          <div className="mg-panel">
            <div className="mg-panel-head">
              <div>
                <h2>Meeting Control</h2>
                <p>
                  {canManage
                    ? 'Schedule meetings and notify only Management Group members.'
                    : isCurrentUserMember
                      ? 'View assigned meetings and update minutes when assigned.'
                      : 'Meeting access is restricted.'}
                </p>
              </div>
            </div>

            {canManage && (
              <form className="mg-form" onSubmit={handleCreateMeeting}>
                <div className="mg-form-grid">
                  <label>
                    <span>Meeting Topic *</span>
                    <input
                      value={meetingForm.topic}
                      onChange={(event) => updateMeetingField('topic', event.target.value)}
                      placeholder="Example: Monthly Management Review"
                    />
                  </label>

                  <label>
                    <span>Meeting Date *</span>
                    <input
                      type="date"
                      value={meetingForm.meeting_date}
                      onChange={(event) => updateMeetingField('meeting_date', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Start Time</span>
                    <input
                      type="time"
                      value={meetingForm.start_time}
                      onChange={(event) => updateMeetingField('start_time', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>End Time</span>
                    <input
                      type="time"
                      value={meetingForm.end_time}
                      onChange={(event) => updateMeetingField('end_time', event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Mode</span>
                    <select
                      value={meetingForm.mode}
                      onChange={(event) => updateMeetingField('mode', event.target.value)}
                    >
                      <option value="Offline">Offline</option>
                      <option value="Online">Online</option>
                      <option value="Hybrid">Hybrid</option>
                    </select>
                  </label>

                  <label>
                    <span>Location / Meeting Link</span>
                    <input
                      value={meetingForm.location}
                      onChange={(event) => updateMeetingField('location', event.target.value)}
                      placeholder="Conference room / Google Meet / Zoom link"
                    />
                  </label>

                  <label className="mg-span-2">
                    <span>Assign Minutes Writer</span>
                    <select
                      value={meetingForm.assigned_minutes_user_id}
                      onChange={(event) =>
                        updateMeetingField('assigned_minutes_user_id', event.target.value)
                      }
                    >
                      <option value="">Select Management Group member</option>
                      {selectedMembersForWriter
                        .filter((member) => member.user_id)
                        .map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.name || member.employee_name}
                            {member.designation ? ` — ${member.designation}` : ''}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="mg-span-2">
                    <span>Agenda</span>
                    <textarea
                      rows={4}
                      value={meetingForm.agenda}
                      onChange={(event) => updateMeetingField('agenda', event.target.value)}
                      placeholder="Add agenda points for the Management Group meeting..."
                    />
                  </label>
                </div>

                <div className="mg-form-actions">
                  <button type="submit" className="mg-primary-btn" disabled={savingMeeting}>
                    {savingMeeting ? <Loader2 className="mg-spin" size={16} /> : <Plus size={16} />}
                    Schedule Meeting
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {canViewPrivate && (
        <div className="mg-panel mg-history-panel">
          <div className="mg-panel-head">
            <div>
              <h2>Meeting Minutes Book</h2>
              <p>Search previous meetings by date range and topic/minutes text.</p>
            </div>
          </div>

          <form className="mg-filter-bar" onSubmit={handleFilterSubmit}>
            <label className="mg-search-box">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search topic, agenda or minutes..."
                value={filters.topic}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    topic: event.target.value,
                  }))
                }
              />
            </label>

            <input
              type="date"
              value={filters.from_date}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from_date: event.target.value,
                }))
              }
            />

            <input
              type="date"
              value={filters.to_date}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to_date: event.target.value,
                }))
              }
            />

            <button type="submit" className="mg-secondary-btn">
              Filter
            </button>

            <button type="button" className="mg-ghost-btn" onClick={clearFilters}>
              Clear
            </button>
          </form>

          <div className="mg-meeting-layout">
            <div className="mg-meeting-list">
              {meetings.map((meeting) => {
                const meetingId = meeting._id || meeting.id;
                const active = selectedMeeting && String(selectedMeeting._id || selectedMeeting.id) === String(meetingId);

                return (
                  <article
                    key={meetingId}
                    className={`mg-meeting-card ${active ? 'mg-meeting-active' : ''}`}
                  >
                    <div className="mg-meeting-top">
                      <div>
                        <h3>{meeting.topic}</h3>
                        <div className="mg-meeting-meta">
                          <span>
                            <CalendarDays size={14} />
                            {formatDate(meeting.meeting_date)}
                          </span>
                          {meeting.start_time ? (
                            <span>
                              <Clock size={14} />
                              {meeting.start_time}
                              {meeting.end_time ? ` - ${meeting.end_time}` : ''}
                            </span>
                          ) : null}
                          {meeting.location ? (
                            <span>
                              <MapPin size={14} />
                              {meeting.location}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <StatusPill value={meeting.minutes_status} />
                    </div>

                    {meeting.agenda ? <p className="mg-meeting-agenda">{meeting.agenda}</p> : null}

                    <div className="mg-meeting-footer">
                      <span>
                        Minutes Writer:{' '}
                        <strong>{meeting.assigned_minutes_user_name || 'Not assigned'}</strong>
                      </span>

                      <div className="mg-card-actions">
                        <button
                          type="button"
                          className="mg-secondary-btn"
                          onClick={() => openMinutesEditor(meeting)}
                        >
                          <PenLine size={15} />
                          {meeting.minutes ? 'View / Edit' : 'Minutes'}
                        </button>

                        {canManage && (
                          <button
                            type="button"
                            className="mg-danger-btn"
                            onClick={() => handleDeleteMeeting(meeting)}
                            disabled={deletingMeetingId === meetingId}
                          >
                            {deletingMeetingId === meetingId ? (
                              <Loader2 className="mg-spin" size={15} />
                            ) : (
                              <Trash2 size={15} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <div className="mg-inline-assign">
                        <UserCheck size={15} />
                        <select
                          value={meeting.assigned_minutes_user_id || ''}
                          onChange={(event) => handleAssignWriter(meetingId, event.target.value)}
                        >
                          <option value="">Assign minutes writer</option>
                          {members
                            .filter((member) => member.user_id)
                            .map((member) => (
                              <option key={member.user_id} value={member.user_id}>
                                {member.name || member.employee_name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </article>
                );
              })}

              {!meetings.length && (
                <div className="mg-empty">
                  <FileText size={28} />
                  <strong>No meetings found</strong>
                  <p>Schedule a meeting or adjust filters to view previous minutes.</p>
                </div>
              )}
            </div>

            <div className="mg-minutes-panel">
              {selectedMeeting ? (
                <form onSubmit={handleSaveMinutes}>
                  <div className="mg-minutes-head">
                    <div>
                      <span>Minutes Editor</span>
                      <h3>{selectedMeeting.topic}</h3>
                      <p>
                        {formatDate(selectedMeeting.meeting_date)}
                        {selectedMeeting.assigned_minutes_user_name
                          ? ` · Assigned to ${selectedMeeting.assigned_minutes_user_name}`
                          : ''}
                      </p>
                    </div>
                    <button type="button" className="mg-icon-btn" onClick={closeMinutesEditor}>
                      <X size={18} />
                    </button>
                  </div>

                  {!canEditMinutes(selectedMeeting) && (
                    <div className="mg-restricted-note mg-compact-note">
                      <ShieldCheck size={18} />
                      <p>
                        Only tenant admin or assigned minutes writer can update this meeting minutes.
                      </p>
                    </div>
                  )}

                  <label>
                    <span>Meeting Minutes *</span>
                    <textarea
                      rows={8}
                      value={minutesForm.minutes}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          minutes: event.target.value,
                        }))
                      }
                      placeholder="Write complete meeting discussion, proceedings and important notes..."
                    />
                  </label>

                  <label>
                    <span>Key Decisions</span>
                    <textarea
                      rows={4}
                      value={minutesForm.decisions}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          decisions: event.target.value,
                        }))
                      }
                      placeholder="Decision 1, Decision 2..."
                    />
                  </label>

                  <label>
                    <span>Action Items</span>
                    <textarea
                      rows={4}
                      value={minutesForm.action_items}
                      disabled={!canEditMinutes(selectedMeeting)}
                      onChange={(event) =>
                        setMinutesForm((current) => ({
                          ...current,
                          action_items: event.target.value,
                        }))
                      }
                      placeholder="Owner, task, deadline..."
                    />
                  </label>

                  {selectedMeeting.minutes_updated_by_name || selectedMeeting.minutes_updated_at ? (
                    <p className="mg-update-note">
                      Last updated by {selectedMeeting.minutes_updated_by_name || 'User'}
                      {selectedMeeting.minutes_updated_at
                        ? ` on ${formatDateTime(selectedMeeting.minutes_updated_at)}`
                        : ''}
                    </p>
                  ) : null}

                  {canEditMinutes(selectedMeeting) && (
                    <div className="mg-form-actions">
                      <button type="submit" className="mg-primary-btn" disabled={savingMinutes}>
                        {savingMinutes ? <Loader2 className="mg-spin" size={16} /> : <Save size={16} />}
                        Save Minutes
                      </button>
                    </div>
                  )}
                </form>
              ) : (
                <div className="mg-empty mg-sticky-empty">
                  <PenLine size={30} />
                  <strong>Select a meeting</strong>
                  <p>
                    Open a meeting from the left panel to view or update its minutes,
                    decisions and action items.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}