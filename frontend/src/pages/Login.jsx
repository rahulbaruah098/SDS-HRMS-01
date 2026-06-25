import React, { useState } from 'react';
import { api, setSession, refreshCurrentSession, currentUser } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

export default function Login({ onLogin }) {
  const alerts = useCustomAlert();
  const [form, setForm] = useState({
    email: '',
    password: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const email = form.email.trim();

    if (!email) {
      alerts.warning('Email is required.', 'Missing Email');
      return;
    }

    if (!form.password) {
      alerts.warning('Password is required.', 'Missing Password');
      return;
    }

    try {
      setLoading(true);

      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.toLowerCase(),
          password: form.password,
        }),
      });

      setSession(data);

      try {
        await refreshCurrentSession();
      } catch (sessionError) {
        console.warn('Session refresh failed after login:', sessionError);
      }

      const freshUser = currentUser();
      onLogin(freshUser || data.user);
    } catch (err) {
      alerts.error(err.message || 'Unable to login.', 'Login Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sds-login-page">
      <style>
        {`
          .sds-login-page {
            min-height: 100vh;
            width: 100%;
            padding: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            background:
              radial-gradient(circle at 12% 16%, rgba(99, 102, 241, 0.28), transparent 30%),
              radial-gradient(circle at 84% 18%, rgba(14, 165, 233, 0.24), transparent 28%),
              radial-gradient(circle at 72% 86%, rgba(34, 197, 94, 0.16), transparent 30%),
              linear-gradient(135deg, #020617 0%, #0f172a 46%, #111827 100%);
            position: relative;
            overflow: hidden;
          }

          .sds-login-page::before {
            content: "";
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
            background-size: 44px 44px;
            mask-image: radial-gradient(circle at center, black 0%, transparent 82%);
            pointer-events: none;
          }

          .sds-login-page::after {
            content: "";
            position: absolute;
            width: 720px;
            height: 720px;
            border-radius: 999px;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            background:
              conic-gradient(
                from 120deg,
                rgba(79, 70, 229, 0.18),
                rgba(14, 165, 233, 0.14),
                rgba(34, 197, 94, 0.10),
                rgba(79, 70, 229, 0.18)
              );
            filter: blur(90px);
            opacity: 0.72;
            pointer-events: none;
          }

          .sds-orb {
            position: absolute;
            border-radius: 999px;
            pointer-events: none;
            animation: sdsFloat 9s ease-in-out infinite;
          }

          .sds-orb.one {
            width: 190px;
            height: 190px;
            left: 5%;
            top: 9%;
            background: rgba(99, 102, 241, 0.18);
            filter: blur(5px);
          }

          .sds-orb.two {
            width: 240px;
            height: 240px;
            right: 4%;
            bottom: 4%;
            background: rgba(14, 165, 233, 0.14);
            filter: blur(6px);
            animation-delay: 1.4s;
          }

          .sds-orb.three {
            width: 110px;
            height: 110px;
            right: 30%;
            top: 8%;
            background: rgba(34, 197, 94, 0.14);
            filter: blur(4px);
            animation-delay: 2.4s;
          }

          @keyframes sdsFloat {
            0%, 100% {
              transform: translate3d(0, 0, 0) scale(1);
            }
            50% {
              transform: translate3d(0, 16px, 0) scale(1.04);
            }
          }

          .sds-login-stage {
            width: min(1180px, 100%);
            min-height: min(690px, calc(100vh - 44px));
            position: relative;
            z-index: 2;
            display: grid;
            grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.95fr);
            gap: 18px;
            animation: sdsStageIn 0.45s ease both;
          }

          @keyframes sdsStageIn {
            from {
              opacity: 0;
              transform: translateY(14px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .sds-command-panel,
          .sds-access-panel {
            border: 1px solid rgba(226, 232, 240, 0.16);
            background: rgba(15, 23, 42, 0.62);
            backdrop-filter: blur(24px);
            border-radius: 32px;
            overflow: hidden;
            box-shadow:
              0 32px 90px rgba(0, 0, 0, 0.36),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }

          .sds-command-panel {
            padding: 30px;
            color: #f8fafc;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
          }

          .sds-command-panel::before {
            content: "";
            position: absolute;
            inset: 18px;
            border-radius: 28px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            pointer-events: none;
          }

          .sds-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            position: relative;
            z-index: 1;
          }

          .sds-brand {
            display: flex;
            align-items: center;
            gap: 13px;
            min-width: 0;
          }

          .sds-logo {
            width: 54px;
            height: 54px;
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            background:
              linear-gradient(135deg, rgba(255,255,255,0.98), rgba(219,234,254,0.94));
            color: #0f172a;
            font-weight: 950;
            letter-spacing: -0.08em;
            box-shadow:
              0 18px 42px rgba(14, 165, 233, 0.22),
              inset 0 -9px 18px rgba(15, 23, 42, 0.07);
            flex: 0 0 auto;
          }

          .sds-brand strong {
            display: block;
            font-size: 14px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .sds-brand span {
            display: block;
            margin-top: 3px;
            color: rgba(226, 232, 240, 0.68);
            font-size: 12px;
          }

          .sds-live-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 9px 12px;
            border-radius: 999px;
            background: rgba(34, 197, 94, 0.12);
            border: 1px solid rgba(34, 197, 94, 0.25);
            color: #bbf7d0;
            font-size: 12px;
            font-weight: 900;
            white-space: nowrap;
          }

          .sds-live-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #22c55e;
            box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.14);
          }

          .sds-hero-copy {
            position: relative;
            z-index: 1;
            margin-top: 44px;
          }

          .sds-eyebrow {
            display: inline-flex;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(56, 189, 248, 0.12);
            border: 1px solid rgba(56, 189, 248, 0.20);
            color: #bae6fd;
            font-size: 11px;
            font-weight: 950;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 18px;
          }

          .sds-hero-copy h1 {
            margin: 0;
            max-width: 610px;
            font-size: clamp(42px, 4.8vw, 66px);
            line-height: 0.95;
            letter-spacing: -0.078em;
          }

          .sds-hero-copy p {
            margin: 20px 0 0;
            max-width: 575px;
            color: rgba(226, 232, 240, 0.72);
            font-size: 15px;
            line-height: 1.7;
          }

          .sds-testing-note {
            margin-top: 22px;
            max-width: 590px;
            display: flex;
            gap: 12px;
            align-items: flex-start;
            padding: 15px;
            border-radius: 22px;
            background: rgba(251, 191, 36, 0.10);
            border: 1px solid rgba(251, 191, 36, 0.24);
            color: #fde68a;
          }

          .sds-testing-note span {
            width: 32px;
            height: 32px;
            border-radius: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(251, 191, 36, 0.14);
            flex: 0 0 auto;
          }

          .sds-testing-note b {
            display: block;
            font-size: 13px;
            color: #fef3c7;
            margin-bottom: 4px;
          }

          .sds-testing-note small {
            display: block;
            font-size: 12px;
            color: rgba(254, 243, 199, 0.78);
            line-height: 1.45;
          }

          .sds-module-orbit {
            position: relative;
            z-index: 1;
            margin-top: 28px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 11px;
          }

          .sds-module-card {
            min-height: 94px;
            padding: 15px;
            border-radius: 23px;
            background: rgba(255, 255, 255, 0.075);
            border: 1px solid rgba(255, 255, 255, 0.10);
            transition: 0.25s ease;
          }

          .sds-module-card:hover {
            transform: translateY(-3px);
            background: rgba(255, 255, 255, 0.11);
          }

          .sds-module-card span {
            display: inline-flex;
            width: 31px;
            height: 31px;
            align-items: center;
            justify-content: center;
            border-radius: 13px;
            background: rgba(255, 255, 255, 0.12);
            margin-bottom: 9px;
            font-size: 14px;
          }

          .sds-module-card b {
            display: block;
            color: #ffffff;
            font-size: 13px;
            margin-bottom: 4px;
          }

          .sds-module-card small {
            color: rgba(226, 232, 240, 0.62);
            line-height: 1.36;
            font-size: 11px;
          }

          .sds-mini-dashboard {
            position: relative;
            z-index: 1;
            margin-top: 24px;
            padding: 15px 16px;
            border-radius: 25px;
            background: rgba(2, 6, 23, 0.36);
            border: 1px solid rgba(255, 255, 255, 0.08);
          }

          .sds-mini-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 14px;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          }

          .sds-mini-row:last-child {
            border-bottom: 0;
          }

          .sds-mini-row strong {
            display: block;
            font-size: 12px;
          }

          .sds-mini-row span {
            display: block;
            margin-top: 3px;
            color: rgba(226, 232, 240, 0.56);
            font-size: 11px;
          }

          .sds-mini-bar {
            width: 106px;
            height: 8px;
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.20);
            overflow: hidden;
          }

          .sds-mini-bar i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #38bdf8, #22c55e);
          }

          .sds-access-panel {
            padding: 14px;
          }

          .sds-login-card {
            height: 100%;
            padding: 32px;
            border-radius: 26px;
            background:
              radial-gradient(circle at top right, rgba(79, 70, 229, 0.10), transparent 34%),
              linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.96));
            color: #0f172a;
            display: flex;
            flex-direction: column;
            justify-content: center;
            overflow: hidden;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95);
          }

          .sds-card-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 24px;
          }

          .sds-card-head small {
            display: inline-flex;
            padding: 7px 10px;
            border-radius: 999px;
            background: #e0f2fe;
            color: #0369a1;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .sds-card-head h2 {
            margin: 13px 0 7px;
            font-size: 34px;
            letter-spacing: -0.065em;
          }

          .sds-card-head p {
            margin: 0;
            color: #64748b;
            line-height: 1.55;
            font-size: 14px;
          }

          .sds-role-badge {
            min-width: 92px;
            padding: 12px;
            border-radius: 19px;
            background:
              radial-gradient(circle at top left, rgba(56, 189, 248, 0.32), transparent 45%),
              #0f172a;
            color: #ffffff;
            text-align: center;
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.17);
          }

          .sds-role-badge span {
            display: block;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.58);
            margin-bottom: 4px;
          }

          .sds-role-badge b {
            display: block;
            font-size: 12px;
          }

          .sds-form {
            display: grid;
            gap: 15px;
          }

          .sds-field label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 12px;
            font-weight: 900;
            color: #334155;
          }

          .sds-field label span {
            color: #94a3b8;
            font-weight: 800;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .sds-input-box {
            position: relative;
          }

          .sds-input-box input {
            width: 100%;
            height: 52px;
            border: 1px solid #dbe4f0;
            border-radius: 18px;
            background: #ffffff;
            color: #0f172a;
            padding: 0 15px 0 46px;
            font-size: 14px;
            outline: none;
            transition: 0.2s ease;
            box-shadow: 0 9px 20px rgba(15, 23, 42, 0.045);
          }

          .sds-input-box input:focus {
            border-color: #0284c7;
            box-shadow: 0 0 0 5px rgba(14, 165, 233, 0.12);
          }

          .sds-input-icon {
            position: absolute;
            left: 14px;
            top: 50%;
            transform: translateY(-50%);
            width: 24px;
            height: 24px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f1f5f9;
            color: #0f172a;
            font-size: 12px;
          }

          .sds-password-toggle {
            position: absolute;
            right: 9px;
            top: 50%;
            transform: translateY(-50%);
            width: 37px;
            height: 37px;
            border: 0;
            border-radius: 14px;
            background: #eff6ff;
            color: #075985;
            cursor: pointer;
            font-size: 15px;
            transition: 0.2s ease;
          }

          .sds-password-toggle:hover {
            background: #dbeafe;
          }

          .sds-input-box.password input {
            padding-right: 56px;
          }

          .sds-alert {
            padding: 12px 14px;
            border-radius: 15px;
            background: #fff1f2;
            border: 1px solid #fecdd3;
            color: #be123c;
            font-size: 12px;
            font-weight: 850;
          }

          .sds-login-btn {
            height: 54px;
            border: 0;
            border-radius: 19px;
            background:
              linear-gradient(135deg, #0f172a, #164e63 48%, #0284c7);
            color: #ffffff;
            font-weight: 950;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 20px 42px rgba(14, 116, 144, 0.25);
            transition: 0.22s ease;
            position: relative;
            overflow: hidden;
          }

          .sds-login-btn::after {
            content: "";
            position: absolute;
            top: 0;
            left: -70%;
            width: 60%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.26), transparent);
            transform: skewX(-18deg);
            transition: 0.45s ease;
          }

          .sds-login-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 24px 48px rgba(14, 116, 144, 0.31);
          }

          .sds-login-btn:hover:not(:disabled)::after {
            left: 120%;
          }

          .sds-login-btn:disabled {
            opacity: 0.75;
            cursor: not-allowed;
          }

          .sds-login-meta {
            margin-top: 18px;
            padding: 15px;
            border-radius: 20px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            display: grid;
            gap: 11px;
          }

          .sds-login-meta-row {
            display: flex;
            gap: 10px;
            align-items: flex-start;
            color: #475569;
            font-size: 12px;
            line-height: 1.45;
          }

          .sds-login-meta-row i {
            width: 24px;
            height: 24px;
            border-radius: 10px;
            background: #eef2ff;
            color: #4338ca;
            display: flex;
            align-items: center;
            justify-content: center;
            font-style: normal;
            flex: 0 0 auto;
          }

          .sds-login-meta-row b {
            display: block;
            color: #0f172a;
            margin-bottom: 2px;
          }

          .sds-security-note {
            margin-top: 18px;
            color: #64748b;
            font-size: 11px;
            line-height: 1.48;
          }

          .sds-security-note b {
            color: #0f172a;
          }

          @media (max-width: 1100px) {
            .sds-login-stage {
              grid-template-columns: 0.95fr 1.05fr;
            }

            .sds-hero-copy h1 {
              font-size: 48px;
            }

            .sds-module-orbit {
              grid-template-columns: 1fr;
            }

            .sds-module-card {
              min-height: auto;
            }
          }

          @media (max-width: 900px) {
            .sds-login-page {
              height: auto;
              min-height: 100vh;
              overflow-y: auto;
            }

            .sds-login-stage {
              min-height: calc(100vh - 44px);
              grid-template-columns: 1fr;
            }

            .sds-command-panel {
              min-height: auto;
            }

            .sds-module-orbit {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 680px) {
            .sds-login-page {
              padding: 12px;
              align-items: flex-start;
            }

            .sds-login-stage {
              min-height: calc(100vh - 24px);
            }

            .sds-command-panel,
            .sds-access-panel {
              border-radius: 24px;
            }

            .sds-command-panel {
              padding: 22px;
            }

            .sds-login-card {
              padding: 21px;
            }

            .sds-topbar,
            .sds-card-head {
              flex-direction: column;
              align-items: flex-start;
            }

            .sds-hero-copy {
              margin-top: 28px;
            }

            .sds-hero-copy h1 {
              font-size: 37px;
            }

            .sds-hero-copy p {
              font-size: 14px;
            }

            .sds-module-orbit {
              grid-template-columns: 1fr;
            }

            .sds-live-pill {
              display: none;
            }

            .sds-mini-row {
              grid-template-columns: 1fr;
            }

            .sds-mini-bar {
              width: 100%;
            }

            .sds-role-badge {
              width: 100%;
              text-align: left;
            }
          }

          @media (max-height: 720px) and (min-width: 901px) {
            .sds-login-page {
              padding: 12px;
            }

            .sds-login-stage {
              min-height: calc(100vh - 24px);
            }

            .sds-command-panel {
              padding: 22px;
            }

            .sds-access-panel {
              padding: 12px;
            }

            .sds-login-card {
              padding: 23px;
            }

            .sds-hero-copy {
              margin-top: 24px;
            }

            .sds-eyebrow {
              margin-bottom: 12px;
            }

            .sds-hero-copy h1 {
              font-size: 46px;
            }

            .sds-hero-copy p {
              margin-top: 14px;
              font-size: 14px;
              line-height: 1.5;
            }

            .sds-testing-note {
              margin-top: 16px;
              padding: 12px;
            }

            .sds-module-orbit {
              margin-top: 18px;
            }

            .sds-module-card {
              min-height: 74px;
              padding: 11px;
            }

            .sds-module-card span {
              width: 26px;
              height: 26px;
              margin-bottom: 7px;
            }

            .sds-mini-dashboard {
              margin-top: 14px;
              padding: 10px 14px;
            }

            .sds-mini-row {
              padding: 7px 0;
            }

            .sds-card-head {
              margin-bottom: 14px;
            }

            .sds-card-head h2 {
              font-size: 29px;
              margin-top: 8px;
            }

            .sds-card-head p {
              font-size: 13px;
            }

            .sds-form {
              gap: 10px;
            }

            .sds-input-box input {
              height: 45px;
              border-radius: 15px;
            }

            .sds-login-btn {
              height: 47px;
              border-radius: 16px;
            }

            .sds-login-meta {
              margin-top: 12px;
              padding: 12px;
              gap: 8px;
            }

            .sds-security-note {
              display: none;
            }
          }
        `}
      </style>

      <div className="sds-orb one" />
      <div className="sds-orb two" />
      <div className="sds-orb three" />

      <main className="sds-login-stage">
        <section className="sds-command-panel">
          <div>
            <div className="sds-topbar">
              <div className="sds-brand">
                <div className="sds-logo">SDS</div>
                <div>
                  <strong>Sayanant Group&apos;s HRMS</strong>
                  <span>Human Resource Management System</span>
                </div>
              </div>

              <div className="sds-live-pill">
                <i className="sds-live-dot" />
                Secure Access
              </div>
            </div>

            <div className="sds-hero-copy">
              <span className="sds-eyebrow">Workforce Command Centre</span>
              <h1>One workspace for people, attendance and approvals.</h1>
              <p>
                Manage attendance, leave, employee records, performance, projects,
                support tickets and reporting through secure role-based dashboards
                designed for SDS operations.
              </p>

              <div className="sds-testing-note">
                <span>⚠</span>
                <div>
                  <b>Testing phase notice</b>
                  <small>
                    This HRMS is currently in the testing phase. If you find any
                    bug, wrong data, login issue or workflow problem, please inform
                    the IT team immediately.
                  </small>
                </div>
              </div>
            </div>

            <div className="sds-module-orbit">
              <div className="sds-module-card">
                <span>⏱</span>
                <b>Attendance</b>
                <small>Office, work from home and field attendance workflows.</small>
              </div>

              <div className="sds-module-card">
                <span>🧾</span>
                <b>Approvals</b>
                <small>Leave, expenses, tickets and internal approval tracking.</small>
              </div>

              <div className="sds-module-card">
                <span>📈</span>
                <b>Performance</b>
                <small>Team visibility, project progress and employee review data.</small>
              </div>
            </div>
          </div>

          <div className="sds-mini-dashboard">
            <div className="sds-mini-row">
              <div>
                <strong>Employee Records</strong>
                <span>Profile, department, designation and hierarchy mapping.</span>
              </div>
              <div className="sds-mini-bar">
                <i style={{ width: '84%' }} />
              </div>
            </div>

            <div className="sds-mini-row">
              <div>
                <strong>HR Workflows</strong>
                <span>Approvals, reports and real-time administrative control.</span>
              </div>
              <div className="sds-mini-bar">
                <i style={{ width: '72%' }} />
              </div>
            </div>

            <div className="sds-mini-row">
              <div>
                <strong>Team Visibility</strong>
                <span>Manager, team leader and reporting officer dashboards.</span>
              </div>
              <div className="sds-mini-bar">
                <i style={{ width: '91%' }} />
              </div>
            </div>
          </div>
        </section>

        <section className="sds-access-panel">
          <div className="sds-login-card">
            <div className="sds-card-head">
              <div>
                <small>Access Portal</small>
                <h2>Sign in</h2>
                <p>
                  Enter your official credentials to open your assigned HRMS
                  dashboard.
                </p>
              </div>

              <div className="sds-role-badge">
                <span>Status</span>
                <b>Testing</b>
              </div>
            </div>

            <form className="sds-form" onSubmit={submit} noValidate>
              <div className="sds-field">
                <label>
                  Email Address
                  <span>required</span>
                </label>
                <div className="sds-input-box">
                  <i className="sds-input-icon">✉</i>
                  <input
                    type="email"
                    value={form.email}
                    autoComplete="email"
                    placeholder="Enter email address"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        email: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="sds-field">
                <label>
                  Password
                  <span>secure</span>
                </label>
                <div className="sds-input-box password">
                  <i className="sds-input-icon">⌘</i>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        password: e.target.value,
                      })
                    }
                  />

                  <button
                    type="button"
                    className="sds-password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>


              <button type="submit" className="sds-login-btn" disabled={loading}>
                {loading ? 'Opening dashboard...' : 'Enter Dashboard'}
              </button>
            </form>

            <div className="sds-login-meta">
              <div className="sds-login-meta-row">
                <i>🔐</i>
                <div>
                  <b>Secure role-based login</b>
                  Your dashboard access depends on your assigned HRMS role and
                  permissions.
                </div>
              </div>

              <div className="sds-login-meta-row">
                <i>🧪</i>
                <div>
                  <b>Testing phase</b>
                  Please report bugs, incorrect records or workflow issues to the IT
                  team for correction.
                </div>
              </div>
            </div>

            <div className="sds-security-note">
              <b>Session handling:</b> after login, the app refreshes the current
              session before opening the dashboard so employee name, role and
              profile photo load correctly.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}