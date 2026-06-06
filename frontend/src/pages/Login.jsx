import React, { useEffect, useMemo, useState } from 'react';
import { api, setSession, refreshCurrentSession, currentUser } from '../api/client';

const demoLogins = [
  {
    label: 'Super Admin',
    email: 'superadmin@sdshr.in',
    password: 'Super@123',
    tone: 'System',
  },
  {
    label: 'SDS Admin',
    email: 'admin@sdshr.in',
    password: '12345678',
    tone: 'Admin',
  },
  {
    label: 'HR',
    email: 'hr@sdshr.in',
    password: '12345678',
    tone: 'People',
  },
  {
    label: 'Finance',
    email: 'finance@sdshr.in',
    password: '12345678',
    tone: 'Payroll',
  },
  {
    label: 'Manager',
    email: 'manager@sdshr.in',
    password: '12345678',
    tone: 'Team',
  },
  {
    label: 'Employee',
    email: 'employee@sdshr.in',
    password: '12345678',
    tone: 'Self',
  },
  {
    label: 'Demo Company Admin',
    email: 'clientadmin@example.com',
    password: 'Client@123',
    tone: 'Client',
  },
];

export default function Login({ onLogin }) {
  const [form, setForm] = useState({
    email: 'superadmin@sdshr.in',
    password: 'Super@123',
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const selectedDemo = useMemo(
    () => demoLogins.find((item) => item.email === form.email) || demoLogins[0],
    [form.email],
  );

  function chooseDemo(item) {
    setForm({
      email: item.email,
      password: item.password,
    });
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!form.email.trim()) {
      setError('Email is required');
      return;
    }

    if (!form.password) {
      setError('Password is required');
      return;
    }

    try {
      setLoading(true);

      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
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
      setError(err.message || 'Unable to login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sds-login-page">
      <style>
        {`
          .sds-login-page {
            height: 100vh;
            width: 100%;
            padding: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            background:
              linear-gradient(120deg, rgba(2, 6, 23, 0.96), rgba(15, 23, 42, 0.95)),
              radial-gradient(circle at 82% 82%, rgba(34, 197, 94, 0.18), transparent 30%);
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
            background-size: 46px 46px;
            pointer-events: none;
          }

          .sds-orb {
            position: absolute;
            border-radius: 999px;
            filter: blur(4px);
            opacity: 0.55;
            animation: sdsFloat 9s ease-in-out infinite;
            pointer-events: none;
          }

          .sds-orb.two {
            width: 220px;
            height: 220px;
            right: 5%;
            bottom: 4%;
            background: rgba(34, 197, 94, 0.12);
          }

          .sds-orb.three {
            width: 105px;
            height: 105px;
            right: 28%;
            top: 8%;
            background: rgba(251, 191, 36, 0.1);
            animation-delay: 2.2s;
          }

          @keyframes sdsFloat {
            0%, 100% {
              transform: translate3d(0, 0, 0) scale(1);
            }
            50% {
              transform: translate3d(0, 14px, 0) scale(1.03);
            }
          }

          .sds-login-stage {
            width: min(1200px, 100%);
            height: min(680px, calc(100vh - 36px));
            position: relative;
            z-index: 2;
            display: grid;
            grid-template-columns: 1.04fr 0.96fr;
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
            border: 1px solid rgba(148, 163, 184, 0.22);
            background: rgba(15, 23, 42, 0.58);
            backdrop-filter: blur(22px);
            border-radius: 30px;
            overflow: hidden;
            box-shadow: 0 26px 80px rgba(0, 0, 0, 0.3);
          }

          .sds-command-panel {
            padding: 28px;
            color: #f8fafc;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
          }

          .sds-command-panel::after {
            display: none;
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
          }

          .sds-logo {
            width: 52px;
            height: 52px;
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            background:
              linear-gradient(135deg, rgba(255,255,255,0.98), rgba(219,234,254,0.92));
            color: #0f172a;
            font-weight: 950;
            letter-spacing: -0.08em;
            box-shadow:
              0 14px 34px rgba(14, 165, 233, 0.18),
              inset 0 -8px 18px rgba(15, 23, 42, 0.06);
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
            font-weight: 800;
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
            margin-top: 34px;
          }

          .sds-eyebrow {
            display: inline-flex;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(56, 189, 248, 0.12);
            border: 1px solid rgba(56, 189, 248, 0.18);
            color: #bae6fd;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 16px;
          }

          .sds-hero-copy h1 {
            margin: 0;
            max-width: 590px;
            font-size: clamp(40px, 4.8vw, 64px);
            line-height: 0.96;
            letter-spacing: -0.075em;
          }

          .sds-hero-copy p {
            margin: 18px 0 0;
            max-width: 560px;
            color: rgba(226, 232, 240, 0.72);
            font-size: 15px;
            line-height: 1.65;
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
            min-height: 88px;
            padding: 14px;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.075);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: 0.25s ease;
          }

          .sds-module-card:hover {
            transform: translateY(-3px);
            background: rgba(255, 255, 255, 0.105);
          }

          .sds-module-card span {
            display: inline-flex;
            width: 30px;
            height: 30px;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.12);
            margin-bottom: 9px;
            font-size: 14px;
          }

          .sds-module-card b {
            display: block;
            color: #ffffff;
            font-size: 13px;
            margin-bottom: 3px;
          }

          .sds-module-card small {
            color: rgba(226, 232, 240, 0.62);
            line-height: 1.35;
            font-size: 11px;
          }

          .sds-mini-dashboard {
            position: relative;
            z-index: 1;
            margin-top: 20px;
            padding: 14px 16px;
            border-radius: 24px;
            background: rgba(2, 6, 23, 0.34);
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
            background: rgba(148, 163, 184, 0.2);
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
            padding: 28px;
            border-radius: 24px;
            background: rgba(248, 250, 252, 0.96);
            color: #0f172a;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .sds-card-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 21px;
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
            margin: 12px 0 6px;
            font-size: 31px;
            letter-spacing: -0.06em;
          }

          .sds-card-head p {
            margin: 0;
            color: #64748b;
            line-height: 1.5;
            font-size: 14px;
          }

          .sds-role-badge {
            min-width: 82px;
            padding: 11px;
            border-radius: 18px;
            background: #0f172a;
            color: #ffffff;
            text-align: center;
            box-shadow: 0 16px 32px rgba(15, 23, 42, 0.16);
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
            gap: 14px;
          }

          .sds-field label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 7px;
            font-size: 12px;
            font-weight: 900;
            color: #334155;
          }

          .sds-field label span {
            color: #94a3b8;
            font-weight: 700;
            font-size: 10px;
          }

          .sds-input-box {
            position: relative;
          }

          .sds-input-box input {
            width: 100%;
            height: 50px;
            border: 1px solid #dbe4f0;
            border-radius: 17px;
            background: #ffffff;
            color: #0f172a;
            padding: 0 15px 0 45px;
            font-size: 14px;
            outline: none;
            transition: 0.2s ease;
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.045);
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
            width: 23px;
            height: 23px;
            border-radius: 9px;
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
            width: 36px;
            height: 36px;
            border: 0;
            border-radius: 13px;
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
            padding-right: 54px;
          }

          .sds-alert {
            padding: 11px 13px;
            border-radius: 14px;
            background: #fff1f2;
            border: 1px solid #fecdd3;
            color: #be123c;
            font-size: 12px;
            font-weight: 800;
          }

          .sds-login-btn {
            height: 52px;
            border: 0;
            border-radius: 18px;
            background:
              linear-gradient(135deg, #0f172a, #164e63 48%, #0284c7);
            color: #ffffff;
            font-weight: 950;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 18px 38px rgba(14, 116, 144, 0.24);
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
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.24), transparent);
            transform: skewX(-18deg);
            transition: 0.45s ease;
          }

          .sds-login-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 22px 44px rgba(14, 116, 144, 0.3);
          }

          .sds-login-btn:hover:not(:disabled)::after {
            left: 120%;
          }

          .sds-login-btn:disabled {
            opacity: 0.75;
            cursor: not-allowed;
          }

          .sds-demo-strip {
            margin-top: 17px;
          }

          .sds-demo-strip-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
          }

          .sds-demo-strip-head b {
            font-size: 12px;
            color: #0f172a;
          }

          .sds-demo-strip-head span {
            font-size: 10px;
            color: #64748b;
          }

          .sds-demo-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .sds-demo-card {
            border: 1px solid #e2e8f0;
            background: #ffffff;
            border-radius: 15px;
            padding: 10px 11px;
            cursor: pointer;
            text-align: left;
            transition: 0.2s ease;
          }

          .sds-demo-card:hover {
            transform: translateY(-2px);
            border-color: #bae6fd;
            box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
          }

          .sds-demo-card.active {
            border-color: #0284c7;
            background: #f0f9ff;
          }

          .sds-demo-card strong {
            display: block;
            color: #0f172a;
            font-size: 11px;
            margin-bottom: 3px;
          }

          .sds-demo-card span {
            display: block;
            color: #64748b;
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .sds-security-note {
            margin-top: auto;
            padding-top: 14px;
            color: #64748b;
            font-size: 11px;
            line-height: 1.45;
          }

          .sds-security-note b {
            color: #0f172a;
          }

          @media (max-width: 1100px) {
            .sds-login-stage {
              width: 100%;
              height: calc(100vh - 36px);
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
              height: auto;
              min-height: calc(100vh - 36px);
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
              padding: 20px;
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
              font-size: 36px;
            }

            .sds-hero-copy p {
              font-size: 14px;
            }

            .sds-module-orbit,
            .sds-demo-grid {
              grid-template-columns: 1fr;
            }

            .sds-live-pill {
              display: none;
            }
          }

          @media (max-height: 720px) and (min-width: 901px) {
            .sds-login-page {
              padding: 12px;
            }

            .sds-login-stage {
              height: calc(100vh - 24px);
            }

            .sds-command-panel {
              padding: 22px;
            }

            .sds-access-panel {
              padding: 12px;
            }

            .sds-login-card {
              padding: 22px;
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

            .sds-module-orbit {
              margin-top: 20px;
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
              font-size: 28px;
              margin-top: 8px;
            }

            .sds-card-head p {
              font-size: 13px;
            }

            .sds-form {
              gap: 10px;
            }

            .sds-input-box input {
              height: 44px;
              border-radius: 15px;
            }

            .sds-login-btn {
              height: 46px;
              border-radius: 16px;
            }

            .sds-demo-strip {
              margin-top: 12px;
            }

            .sds-demo-grid {
              gap: 6px;
            }

            .sds-demo-card {
              padding: 8px 10px;
              border-radius: 13px;
            }

            .sds-security-note {
              display: none;
            }
          }
        `}
      </style>

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
                Secure Login
              </div>
            </div>

            <div className="sds-hero-copy">
              <span className="sds-eyebrow">Workforce Command Centre</span>
              <h1>Your people operations, inside one intelligent workspace.</h1>
              <p>
                Track attendance, approvals, employee records, payroll workflows,
                performance reviews and reports through role-based dashboards built
                for SDS operations.
              </p>
            </div>

            <div className="sds-module-orbit">
              <div className="sds-module-card">
                <span>⏱</span>
                <b>Attendance</b>
                <small>Office and field mode tracking with verification.</small>
              </div>

              <div className="sds-module-card">
                <span>🧾</span>
                <b>Approvals</b>
                <small>Leave, expense, tickets and internal workflows.</small>
              </div>

              <div className="sds-module-card">
                <span>📈</span>
                <b>Performance</b>
                <small>Weekly ratings with monthly and yearly analytics.</small>
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
                <span>Approvals, reports and real-time admin control.</span>
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
                  Enter your credentials to open your assigned HRMS dashboard.
                </p>
              </div>

              <div className="sds-role-badge">
                <span>Mode</span>
                <b>{selectedDemo.tone}</b>
              </div>
            </div>

            <form className="sds-form" onSubmit={submit}>
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

              {error ? <div className="sds-alert">{error}</div> : null}

              <button type="submit" className="sds-login-btn" disabled={loading}>
                {loading ? 'Opening dashboard...' : 'Enter Dashboard'}
              </button>
            </form>

            <div className="sds-demo-strip">
              <div className="sds-demo-strip-head">
                <b>Quick login presets</b>
                <span>Click to fill credentials</span>
              </div>

              <div className="sds-demo-grid">
                {demoLogins.map((item) => (
                  <button
                    type="button"
                    key={item.email}
                    className={`sds-demo-card ${form.email === item.email ? 'active' : ''}`}
                    onClick={() => chooseDemo(item)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.email}</span>
                  </button>
                ))}
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