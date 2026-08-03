import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { api, setSession, refreshCurrentSession, currentUser } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import AuthPageFooter from '../components/AuthPageFooter';
import Brand from '../components/Brand';
import Icon from '../components/Icon';
import '../styles/auth-pages.css';

const employeeAccessSteps = [
  ['01', 'Sign in', 'Use the employee account issued by your organisation.'],
  ['02', 'Check in', 'Record attendance from the correct work mode.'],
  ['03', 'Take action', 'Review leave, approvals, projects and assigned work.'],
  ['04', 'Stay updated', 'Access payslips, documents, support and Saya guidance.'],
];

// SaaS trial: 15-day full-access trial after Superadmin approval.
export default function Login({ onLogin }) {
  const alerts = useCustomAlert();

  const [form, setForm] = useState({
    email: '',
    password: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function openWebsite() {
    window.location.href = '/';
  }

  function openDemoRegistration() {
    window.location.href = '/apply-demo-registration';
  }

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
    <BrowserRouter>
      <div className="app-page auth-premium-page login-page yc-employee-login-page">
      <header className="auth-premium-header">
        <button
          type="button"
          className="auth-mobile-back-link"
          aria-label="Back to website"
          onClick={openWebsite}
        >
          <span aria-hidden="true">←</span>
        </button>

        <Brand compact />

        <div>
          <button
            type="button"
            className="auth-premium-link"
            onClick={openWebsite}
          >
            Back to website
          </button>

          <button
            type="button"
            className="button button-primary button-small"
            onClick={openDemoRegistration}
          >
            Request a demo <Icon name="arrow" />
          </button>
        </div>
      </header>

      <main className="auth-premium-shell auth-login-shell yc-employee-login-shell">
        <section className="auth-premium-story auth-login-story yc-login-onboarding-story">
          <div className="auth-premium-story-copy yc-login-onboarding-copy">
            <h1>
              Your workday,
              <em>ready when you are.</em>
            </h1>

            <p>
              Sign in once to manage attendance, requests, assigned work and
              personal documents from one secure workspace.
            </p>

            <div
              className="demo-premium-facts yc-login-access-facts"
              aria-label="Employee workspace benefits"
            >
              <span>
                <Icon name="attendance" />
                <b>Attendance</b>
                <small>Check in and view records</small>
              </span>

              <span>
                <Icon name="calendar" />
                <b>Requests</b>
                <small>Leave and approvals</small>
              </span>

              <span>
                <Icon name="project" />
                <b>My workspace</b>
                <small>Tasks, files and support</small>
              </span>
            </div>
          </div>

          <div className="auth-workflow-canvas auth-workflow-canvas-demo yc-login-access-canvas">
            <div className="auth-demo-stage-grid yc-login-access-grid">
              {employeeAccessSteps.map(([number, title, copy], index) => (
                <article
                  className={`auth-demo-stage auth-demo-stage-${index + 1}`}
                  key={number}
                >
                  <b>{number}</b>

                  <div>
                    <strong>{title}</strong>
                    <small>{copy}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="yc-login-access-help">
            <span>
              <Icon name="help" />
            </span>

            <p>
              <strong>Unable to access your account?</strong>
              <small>
                Contact your organisation’s HR or IT team for account
                assistance.
              </small>
            </p>
          </div>

          <aside
            className="yc-login-testing-notice"
            aria-label="Testing phase notice"
          >
            <span className="yc-login-testing-notice-icon" aria-hidden="true">
              <Icon name="warning" />
            </span>

            <div>
              <strong>Testing phase notice</strong>
              <p>
                This HRMS is currently in the testing phase. If you find any
                bug, wrong data, login issue or workflow problem, please inform
                the IT team immediately.
              </p>
            </div>
          </aside>
        </section>

        <section className="auth-premium-form-panel">
          <div className="auth-premium-form-card">
            <header>
             <div className="yc-login-heading-copy">
  <small>Employee sign in</small>

  <h2 className="yc-login-heading">
    <span>WELCOME</span>
    <span>BACK</span>
  </h2>

  <p>Use the account shared by your organisation.</p>
</div>

              <div
                className="yc-login-header-statuses"
                aria-label="Login security and environment status"
              >
                <span className="auth-status-badge">
                  <i /> Protected
                </span>

                <span className="yc-login-testing-status">
                  <small>Status</small>
                  <strong>Testing</strong>
                </span>
              </div>
            </header>

            <form
              className="auth-premium-form"
              onSubmit={submit}
              noValidate
            >
              <label>
                <span>Official email address</span>

                <div className="auth-premium-input">
                  <Icon name="email" />

                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    placeholder="name@company.com"
                    autoComplete="email"
                    required
                    disabled={loading}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        email: e.target.value,
                      })
                    }
                  />
                </div>
              </label>

              <label>
                <span>Password</span>

                <div className="auth-premium-input">
                  <Icon name="lock" />

                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    disabled={loading}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        password: e.target.value,
                      })
                    }
                  />

                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    disabled={loading}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                  </button>
                </div>
              </label>

              <button
                className="button button-primary auth-premium-submit"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? 'Opening your workspace…'
                  : 'Enter your workspace'}

                <Icon name="arrow" />
              </button>
            </form>

            <div className="auth-premium-security-row">
              <span>
                <Icon name="shield" /> Role-based access
              </span>

              <span>
                <Icon name="lock" /> Protected workspace
              </span>
            </div>

            <button
              type="button"
              className="auth-premium-demo-card"
              aria-label="Start demo request"
              onClick={openDemoRegistration}
            >
              <div>
                <small>Here to evaluate YourComate?</small>
                <strong>
                  Book a guided walkthrough for your organisation.
                </strong>
              </div>

              <span className="auth-premium-demo-card-action">
                Start demo request <Icon name="arrow" />
              </span>
            </button>
          </div>
        </section>
      </main>

        <AuthPageFooter />
      </div>
    </BrowserRouter>
  );
}
