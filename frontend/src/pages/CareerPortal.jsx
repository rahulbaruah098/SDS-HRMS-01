import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../career-portal.css';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Globe2,
  Loader2,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Search,
  ShieldCheck,
  UploadCloud,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import {
  applyToPublicRecruitmentJob,
  getApiBase,
  getPublicRecruitmentJob,
  getPublicRecruitmentJobs,
  getPublicRecruitmentJoiningPortal,
  getPublicRecruitmentOffer,
  previewPublicRecruitmentResume,
  respondToPublicRecruitmentOffer,
  uploadPublicRecruitmentJoiningDocument,
} from '../api/client';

const EMPTY_APPLICATION = {
  full_name: '',
  email: '',
  phone: '',
  alternate_phone: '',
  location: '',
  current_designation: '',
  current_employer: '',
  total_experience_years: '',
  notice_period: '',
  expected_salary: '',
  linkedin_url: '',
  portfolio_url: '',
  cover_letter: '',
  source_detail: '',
  consent_accepted: false,
};

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replace(/\s+/g, '_');
}

function displayLabel(value) {
  const key = normalizeKey(value);
  if (!key) return '—';

  const aliases = {
    ready_to_join: 'Ready to Join',
    documents_pending: 'Documents Pending',
    needs_correction: 'Needs Correction',
    joining_deferred: 'Joining Deferred',
    did_not_join: 'Did Not Join',
    not_required: 'Not Required',
    work_from_home: 'Work from Home',
  };

  if (aliases[key]) return aliases[key];

  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function listPayload(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function responseMessage(error, fallback = 'The request could not be completed.') {
  return (
    error?.message ||
    error?.data?.message ||
    error?.response?.message ||
    error?.error ||
    fallback
  );
}

function dateText(value) {
  if (!value) return 'Not specified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function currencyText(value, currency = 'INR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not specified';

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toLocaleString('en-IN')}`;
  }
}

function recordId(record) {
  return String(record?._id || record?.id || '').trim();
}

function companyInitials(name) {
  const words = String(name || 'YourComate')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return `${words[0]?.[0] || 'Y'}${words.length > 1 ? words.at(-1)?.[0] || '' : 'C'}`.toUpperCase();
}

function statusTone(status) {
  const key = normalizeKey(status);
  if (['accepted', 'joined', 'ready_to_join', 'clear', 'received'].includes(key)) {
    return 'success';
  }
  if (['declined', 'expired', 'rejected', 'did_not_join'].includes(key)) {
    return 'danger';
  }
  if (['pending', 'documents_pending', 'needs_correction', 'joining_deferred'].includes(key)) {
    return 'warning';
  }
  return 'neutral';
}

function resolveCompanyLogo(value) {
  const logo = String(value || '').trim();
  if (!logo) return '';

  if (/^(https?:|data:|blob:)/i.test(logo)) return logo;

  const apiBase = String(getApiBase?.() || '').replace(/\/api\/v1\/?$/i, '');
  if (logo.startsWith('/')) return `${apiBase}${logo}`;
  return `${apiBase}/${logo.replace(/^\/+/, '')}`;
}

function parseRoute(props = {}) {
  const pathname =
    typeof window === 'undefined' ? '' : window.location.pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);

  if (props.mode === 'offer' || parts[0] === 'careers' && parts[1] === 'offers') {
    return {
      mode: 'offer',
      responseToken: props.responseToken || parts[2] || '',
      companyKey: '',
      jobSlug: '',
      accessToken: '',
    };
  }

  if (props.mode === 'joining' || parts[0] === 'careers' && parts[1] === 'joining') {
    return {
      mode: 'joining',
      accessToken: props.accessToken || parts[2] || '',
      companyKey: '',
      jobSlug: '',
      responseToken: '',
    };
  }

  const companyKey = props.companyKey || parts[1] || '';
  let jobSlug = props.jobSlug || '';
  if (!jobSlug && parts[2] === 'jobs') jobSlug = parts[3] || '';

  return {
    mode: props.mode || (jobSlug ? 'job' : 'jobs'),
    companyKey,
    jobSlug,
    responseToken: '',
    accessToken: '',
  };
}

function navigateTo(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function componentPercent(component = {}) {
  if (Number.isFinite(Number(component.ratio_percent))) {
    return clampPercent(component.ratio_percent);
  }

  const score = Number(component.score);
  const maximum = Number(component.max_score);
  if (Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0) {
    return clampPercent((score / maximum) * 100);
  }

  return 0;
}

function firstPreviewValue(...values) {
  for (const value of values) {
    if (value === 0) return 0;

    if (Array.isArray(value)) {
      const found = value.find((item) => String(item || '').trim());
      if (found !== undefined) return found;
      continue;
    }

    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }

  return '';
}

function previewFields(response = {}) {
  const candidates = [
    response.fields,
    response.parser_result?.fields,
    response.parsed_resume?.fields,
    response.resume_parser?.fields,
    response.resume?.fields,
  ];

  return candidates.find(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  ) || {};
}

function previewMatch(response = {}) {
  return (
    response.resume_match ||
    response.match ||
    response.score_result ||
    response.application?.resume_match ||
    null
  );
}

function usePublicNotice() {
  const [notice, setNotice] = useState(null);
  const timerRef = useRef(null);

  const clearNotice = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback(
    (type, title, message, duration = 5200) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      setNotice({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: normalizeKey(type || 'info'),
        title: String(title || 'Recruitment update'),
        message: String(message || ''),
      });

      timerRef.current = window.setTimeout(() => {
        setNotice(null);
        timerRef.current = null;
      }, duration);
    },
    [],
  );

  useEffect(() => clearNotice, [clearNotice]);

  return { notice, showNotice, clearNotice };
}

function PublicToast({ notice, onDismiss }) {
  if (!notice) return null;

  const type = normalizeKey(notice.type);
  const Icon =
    type === 'success'
      ? CheckCircle2
      : type === 'error'
        ? AlertCircle
        : type === 'warning'
          ? Clock3
          : ShieldCheck;

  return (
    <div
      className="yc-career-toast-region"
      role="region"
      aria-label="Career page notifications"
      aria-live="polite"
    >
      <article className={`yc-career-toast is-${type || 'info'}`}>
        <span className="yc-career-toast-icon">
          <Icon size={17} />
        </span>
        <span className="yc-career-toast-copy">
          <strong>{notice.title}</strong>
          {notice.message ? <p>{notice.message}</p> : null}
        </span>
        <button
          type="button"
          className="yc-career-toast-close"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </article>
    </div>
  );
}

function ResumeMatchCard({ match }) {
  if (!match || typeof match !== 'object') return null;

  const score = clampPercent(match.score);
  const components = [
    ['Skills', match.components?.skills],
    ['Experience', match.components?.experience],
    ['Qualification', match.components?.qualification],
    ['Role evidence', match.components?.role_evidence],
  ].filter(([, component]) => component?.available !== false);

  const matchedSkills = Array.isArray(match.matched_skills)
    ? match.matched_skills
    : [];
  const missingSkills = Array.isArray(match.missing_skills)
    ? match.missing_skills
    : [];

  return (
    <section className="yc-career-match" aria-label="Indicative resume match">
      <div
        className="yc-career-match-score"
        style={{ '--yc-score-angle': `${score * 3.6}deg` }}
      >
        <div>
          <strong>{Math.round(score)}%</strong>
          <span>Role match</span>
        </div>
      </div>

      <div className="yc-career-match-copy">
        <h4>{match.label || displayLabel(match.band || 'role match')}</h4>
        <p>
          {match.candidate_message ||
            'This comparison is indicative and will be reviewed by the recruitment team.'}
        </p>

        {components.length ? (
          <div className="yc-career-match-breakdown">
            {components.map(([label, component]) => {
              const percent = componentPercent(component);

              return (
                <div className="yc-career-match-row" key={label}>
                  <span>{label}</span>
                  <span className="yc-career-match-bar">
                    <span style={{ '--yc-match-width': `${percent}%` }} />
                  </span>
                  <strong>{Math.round(percent)}%</strong>
                </div>
              );
            })}
          </div>
        ) : null}

        {matchedSkills.length || missingSkills.length ? (
          <div className="yc-career-skill-groups" style={{ marginTop: 15 }}>
            <div className="yc-career-skill-group">
              <h5>Skills detected</h5>
              {matchedSkills.length ? (
                matchedSkills.map((skill) => (
                  <span
                    className="yc-career-skill-tag is-matched"
                    key={`matched-${skill}`}
                  >
                    {skill}
                  </span>
                ))
              ) : (
                <span className="yc-career-skill-tag">None confirmed yet</span>
              )}
            </div>

            <div className="yc-career-skill-group">
              <h5>Skills to verify</h5>
              {missingSkills.length ? (
                missingSkills.map((skill) => (
                  <span
                    className="yc-career-skill-tag is-missing"
                    key={`missing-${skill}`}
                  >
                    {skill}
                  </span>
                ))
              ) : (
                <span className="yc-career-skill-tag is-matched">
                  No configured skill gaps detected
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div className="yc-career-human-review" style={{ marginTop: 14 }}>
          <ShieldCheck size={15} />
          <span>
            This score supports review only. It does not automatically approve,
            reject, shortlist or select any candidate.
          </span>
        </div>
      </div>
    </section>
  );
}

function startPublicNavigation(
  path,
  setTransitioning,
  setTransitionMessage,
  message = 'Opening the selected page…',
) {
  setTransitionMessage(message);
  setTransitioning(true);

  window.setTimeout(() => {
    navigateTo(path);
  }, 180);
}

function CompanyBrand({ company, onNavigate }) {
  const name = company?.company_name || 'Company Careers';
  const logo = resolveCompanyLogo(company?.company_logo);

  return (
    <button
      type="button"
      className="yc-career-brand"
      onClick={() => {
        const slug = company?.career_slug;
        if (!slug) return;

        const path = `/careers/${encodeURIComponent(slug)}`;
        if (onNavigate) onNavigate(path, 'Returning to open positions…');
        else navigateTo(path);
      }}
      style={{
        border: 0,
        padding: 0,
        background: 'transparent',
        textAlign: 'left',
      }}
    >
      <span className="yc-career-logo">
        {logo ? <img src={logo} alt={`${name} logo`} /> : companyInitials(name)}
      </span>
      <span className="yc-career-brand-copy">
        <strong>{name}</strong>
        <span>Careers</span>
      </span>
    </button>
  );
}

function PublicLayout({
  company,
  children,
  notice,
  onDismissNotice,
  transitioning = false,
  transitionMessage = '',
  onNavigate,
}) {
  return (
    <div className="yc-career-page">
      {transitioning ? <div className="yc-career-route-progress" /> : null}

      {transitioning && transitionMessage ? (
        <div className="yc-career-transition-note">
          <Loader2 size={13} />
          <span>{transitionMessage}</span>
        </div>
      ) : null}

      <PublicToast notice={notice} onDismiss={onDismissNotice} />

      <header className="yc-career-topbar">
        <div className="yc-career-shell yc-career-topbar-inner">
          <CompanyBrand company={company} onNavigate={onNavigate} />
          <span className="yc-career-powered">
            <ShieldCheck size={14} />
            Recruitment powered by YourComate
          </span>
        </div>
      </header>

      <div
        className={`yc-career-route-stage${
          transitioning ? ' is-leaving' : ''
        }`}
      >
        {children}
      </div>

<footer className="yc-career-footer">
  <div className="yc-career-shell yc-career-footer-inner">
    <span className="yc-career-footer-left">
      Recruitment records are handled privately.
    </span>

    <span className="yc-career-footer-center">
      Powered and developed by Sayanant Group IT CELL
    </span>

    <span className="yc-career-footer-right">
      © {new Date().getFullYear()}{' '}
      {company?.company_name || 'Company'}
    </span>
  </div>
</footer>
    </div>
  );
}

function LoadingState({ message = 'Loading career information…' }) {
  return (
    <div className="yc-career-loading">
      <div>
        <div className="yc-career-loader" />
        <strong>{message}</strong>
      </div>
    </div>
  );
}

function EmptyState({ title, message, icon: Icon = BriefcaseBusiness }) {
  return (
    <div className="yc-career-empty">
      <div>
        <div className="yc-career-empty-icon">
          <Icon size={23} />
        </div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

function JobMeta({ job }) {
  return (
    <div className="yc-career-meta">
      <span>
        <Building2 size={13} />
        {job.department || 'Department not specified'}
      </span>
      <span>
        <MapPin size={13} />
        {job.work_location || 'Location not specified'}
      </span>
      <span>
        <Globe2 size={13} />
        {displayLabel(job.work_mode || 'office')}
      </span>
      <span>
        <BriefcaseBusiness size={13} />
        {displayLabel(job.employment_type || 'permanent')}
      </span>
    </div>
  );
}


function lockCareerPortalBackgroundScroll() {
  const root = document.documentElement;
  const body = document.body;
  const page = document.querySelector('.yc-career-page');
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const lockedElements = new Set([root, body]);

  let ancestor = page?.parentElement || null;
  while (ancestor) {
    const styles = window.getComputedStyle(ancestor);
    const canScroll =
      ancestor.scrollHeight > ancestor.clientHeight &&
      ['auto', 'scroll', 'overlay'].includes(styles.overflowY);

    if (canScroll) lockedElements.add(ancestor);
    ancestor = ancestor.parentElement;
  }

  [
    '.app-main',
    '.app-content',
    '.main-content',
    '.dashboard-content',
    '.content-wrapper',
    '.page-content',
    '.layout-content',
    '.layout-main',
    '[data-scroll-container]',
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLElement) lockedElements.add(element);
    });
  });

  const previousStyles = new Map();

  lockedElements.forEach((element) => {
    previousStyles.set(element, {
      overflow: element.style.overflow,
      overflowX: element.style.overflowX,
      overflowY: element.style.overflowY,
      overscrollBehavior: element.style.overscrollBehavior,
      touchAction: element.style.touchAction,
    });

    element.style.overflow = 'hidden';
    element.style.overflowX = 'hidden';
    element.style.overflowY = 'hidden';
    element.style.overscrollBehavior = 'none';
    element.style.touchAction = 'none';
  });

  const previousBodyPosition = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = `-${scrollX}px`;
  body.style.right = '0';
  body.style.width = '100%';

  const isPopupScrollTarget = (target) =>
    target instanceof Element &&
    Boolean(target.closest('.yc-career-modal-body'));

  const preventBackgroundScroll = (event) => {
    if (isPopupScrollTarget(event.target)) return;
    event.preventDefault();
  };

  window.addEventListener('wheel', preventBackgroundScroll, {
    passive: false,
    capture: true,
  });
  window.addEventListener('touchmove', preventBackgroundScroll, {
    passive: false,
    capture: true,
  });

  return () => {
    window.removeEventListener('wheel', preventBackgroundScroll, {
      capture: true,
    });
    window.removeEventListener('touchmove', preventBackgroundScroll, {
      capture: true,
    });

    lockedElements.forEach((element) => {
      const previous = previousStyles.get(element);
      if (!previous) return;

      element.style.overflow = previous.overflow;
      element.style.overflowX = previous.overflowX;
      element.style.overflowY = previous.overflowY;
      element.style.overscrollBehavior = previous.overscrollBehavior;
      element.style.touchAction = previous.touchAction;
    });

    body.style.position = previousBodyPosition.position;
    body.style.top = previousBodyPosition.top;
    body.style.left = previousBodyPosition.left;
    body.style.right = previousBodyPosition.right;
    body.style.width = previousBodyPosition.width;

    window.scrollTo(scrollX, scrollY);
  };
}

function ApplicationModal({
  companyKey,
  job,
  onClose,
  onSuccess,
  onNotify,
}) {
  const [form, setForm] = useState(EMPTY_APPLICATION);
  const [resumeFile, setResumeFile] = useState(null);
  const [resumePreview, setResumePreview] = useState(null);
  const [screeningAnswers, setScreeningAnswers] = useState({});
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parserError, setParserError] = useState('');
  const busyRef = useRef(busy);
  const parsingRef = useRef(parsing);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    parsingRef.current = parsing;
  }, [parsing]);

  const dynamicFields = Array.isArray(job.application_form_fields)
    ? job.application_form_fields
    : [];

  useEffect(() => {
    const unlockBackgroundScroll = lockCareerPortalBackgroundScroll();

    return () => {
      unlockBackgroundScroll();
    };
  }, []);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const fillExtractedFields = useCallback((response) => {
    const fields = previewFields(response);

    const mapped = {
      full_name: firstPreviewValue(
        fields.full_name,
        fields.name,
        fields.candidate_name,
      ),
      email: firstPreviewValue(
        fields.email,
        fields.primary_email,
        fields.alternate_emails,
      ),
      phone: firstPreviewValue(
        fields.phone,
        fields.primary_phone,
        fields.alternate_phones,
      ),
      location: firstPreviewValue(fields.location, fields.city),
      current_designation: firstPreviewValue(
        fields.current_designation,
        fields.designation,
        fields.current_role,
      ),
      current_employer: firstPreviewValue(
        fields.current_employer,
        fields.employer,
        fields.company,
      ),
      total_experience_years: firstPreviewValue(
        fields.total_experience_years,
        fields.total_experience,
        fields.experience_years,
      ),
      notice_period: firstPreviewValue(fields.notice_period),
      expected_salary: firstPreviewValue(fields.expected_salary),
      linkedin_url: firstPreviewValue(fields.linkedin_url),
      portfolio_url: firstPreviewValue(
        fields.portfolio_url,
        fields.github_url,
      ),
    };

    setForm((current) => {
      const next = { ...current };

      Object.entries(mapped).forEach(([key, value]) => {
        const currentValue = current[key];

        if (
          value !== '' &&
          value !== undefined &&
          value !== null &&
          (currentValue === '' || currentValue === null || currentValue === undefined)
        ) {
          next[key] = String(value);
        }
      });

      return next;
    });
  }, []);

  const handleResumeSelection = async (file) => {
    setResumeFile(file || null);
    setResumePreview(null);
    setParserError('');
    setError('');

    if (!file) return;

    setParsing(true);
    onNotify?.(
      'info',
      'Reading your resume',
      'YourComate is extracting role-related information. Please keep this form open.',
      7000,
    );

    try {
      const response = await previewPublicRecruitmentResume(
        companyKey,
        job.public_slug,
        file,
        {
          job_reference: job.reference_no,
        },
      );

      setResumePreview(response || {});
      fillExtractedFields(response || {});

      const warnings = Array.isArray(response?.warnings)
        ? response.warnings.filter(Boolean)
        : [];

      onNotify?.(
        warnings.length ? 'warning' : 'success',
        'Resume details extracted',
        warnings.length
          ? 'Your details were filled where possible. Review every field because some information needs confirmation.'
          : 'Your application fields were filled from the resume. Review and correct them before submitting.',
        7000,
      );
    } catch (previewError) {
      const message = responseMessage(
        previewError,
        'The resume could not be read. Check the file format and try again.',
      );

      setParserError(message);
      onNotify?.(
        'error',
        'Resume extraction failed',
        message,
        7500,
      );
    } finally {
      setParsing(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (parsing) {
      setError('Please wait until resume extraction is complete.');
      return;
    }

    if (!resumeFile) {
      setError('Please attach your resume before submitting.');
      return;
    }

    if (!form.email.trim() && !form.phone.trim()) {
      setError('Please enter either an email address or a phone number.');
      return;
    }

    if (!form.consent_accepted) {
      setError('Please confirm the recruitment data consent.');
      return;
    }

    setBusy(true);

    try {
      const match = previewMatch(resumePreview || {});
      const response = await applyToPublicRecruitmentJob(
        companyKey,
        job.public_slug,
        {
          ...form,
          total_experience_years:
            form.total_experience_years === ''
              ? null
              : Number(form.total_experience_years),
          consent: {
            accepted: true,
            text_version: 'yourcomate-career-v2',
          },
          consent_accepted: true,
          candidate_reviewed_extracted_fields: Boolean(resumePreview),
          resume_match_preview_score: match?.score ?? null,
          screening_answers: dynamicFields.map((field, index) => {
            const key = String(
              field.key || field.name || `question_${index + 1}`,
            );
            return {
              field_key: key,
              label: field.label || field.question || displayLabel(key),
              answer: screeningAnswers[key] || '',
            };
          }),
        },
        resumeFile,
      );

      onNotify?.(
        'success',
        'Application submitted',
        response?.message ||
          'Your application was recorded successfully. Keep the reference number for follow-up.',
        7000,
      );
      onSuccess(response);
    } catch (submissionError) {
      const message = responseMessage(
        submissionError,
        'Your application could not be submitted. Please review the details and try again.',
      );

      setError(message);
      onNotify?.('error', 'Application not submitted', message, 7500);
    } finally {
      setBusy(false);
    }
  };

  const match = previewMatch(resumePreview || {});
  const extracted = previewFields(resumePreview || {});
  const extractedCount = Object.values(extracted).filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') {
      return Object.keys(value).length > 0;
    }
    return value !== undefined && value !== null && String(value).trim();
  }).length;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="yc-career-modal-backdrop"
      role="presentation"
    >
      <section
        className="yc-career-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Apply for ${job.job_title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="yc-career-modal-head">
          <div>
            <h2>Apply for {job.job_title}</h2>
            <p>
              {job.department || 'Department'} ·{' '}
              {job.reference_no || 'Vacancy'}
            </p>
          </div>
          <button
            type="button"
            className="yc-career-icon-btn"
            onClick={onClose}
            disabled={busy || parsing}
            aria-label="Close application form"
          >
            <X size={17} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="yc-career-modal-body">
            <div className="yc-career-form">
              <div className="yc-career-alert">
                <ShieldCheck size={17} />
                <span>
                  Your details and resume are shared only with the company
                  recruitment team for this application.
                </span>
              </div>

              {error ? (
                <div className="yc-career-alert yc-career-alert-danger">
                  <AlertCircle size={17} />
                  <span>{error}</span>
                </div>
              ) : null}

              <section
                className={`yc-career-resume-workbench${
                  parsing ? ' is-parsing' : ''
                }`}
              >
                <div className="yc-career-resume-head">
                  <div>
                    <h3>Start with your resume</h3>
                    <p>
                      Upload PDF, DOCX or TXT. The form will be filled from
                      detected information and remain editable.
                    </p>
                  </div>
                  {resumeFile ? (
                    <span className="yc-career-badge">
                      <Paperclip size={12} />
                      {resumeFile.name}
                    </span>
                  ) : null}
                </div>

                <label className="yc-career-upload">
                  <input
                    required
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={(event) =>
                      handleResumeSelection(event.target.files?.[0] || null)
                    }
                    disabled={busy || parsing}
                  />
                  <span className="yc-career-upload-icon">
                    {parsing ? (
                      <Loader2 size={21} />
                    ) : (
                      <UploadCloud size={21} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {resumeFile
                        ? 'Choose another resume'
                        : 'Choose your resume'}
                    </strong>
                    <span>
                      Maximum file size follows this company’s recruitment
                      settings.
                    </span>
                  </span>
                </label>

                {parsing ? (
                  <div className="yc-career-parser-status">
                    <Loader2 size={17} />
                    <span>
                      Extracting contact details, experience, education and
                      skills…
                    </span>
                  </div>
                ) : null}

                {parserError ? (
                  <div className="yc-career-parser-status is-error">
                    <AlertCircle size={17} />
                    <span>{parserError}</span>
                  </div>
                ) : null}

                {resumePreview && !parserError ? (
                  <div className="yc-career-extracted-banner">
                    <FileCheck2 size={18} />
                    <span>
                      <strong>
                        Resume extraction completed
                        {extractedCount
                          ? ` · ${extractedCount} information groups detected`
                          : ''}
                      </strong>
                      <p>
                        Review every populated field below. Resume extraction
                        can miss or misread information.
                      </p>
                    </span>
                  </div>
                ) : null}

                <ResumeMatchCard match={match} />
              </section>

              <div className="yc-career-form-grid">
                <div className="yc-career-field">
                  <label>
                    Full name <span className="yc-career-required">*</span>
                  </label>
                  <input
                    required
                    value={form.full_name}
                    onChange={(event) =>
                      update('full_name', event.target.value)
                    }
                  />
                </div>

                <div className="yc-career-field">
                  <label>Email address</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </div>

                <div className="yc-career-field">
                  <label>Phone number</label>
                  <input
                    value={form.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </div>

                <div className="yc-career-field">
                  <label>Current location</label>
                  <input
                    value={form.location}
                    onChange={(event) => update('location', event.target.value)}
                  />
                </div>

                <div className="yc-career-field">
                  <label>Current designation</label>
                  <input
                    value={form.current_designation}
                    onChange={(event) =>
                      update('current_designation', event.target.value)
                    }
                  />
                </div>

                <div className="yc-career-field">
                  <label>Current employer</label>
                  <input
                    value={form.current_employer}
                    onChange={(event) =>
                      update('current_employer', event.target.value)
                    }
                  />
                </div>

                <div className="yc-career-field">
                  <label>Total experience in years</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.total_experience_years}
                    onChange={(event) =>
                      update('total_experience_years', event.target.value)
                    }
                  />
                </div>

                <div className="yc-career-field">
                  <label>Notice period</label>
                  <input
                    value={form.notice_period}
                    onChange={(event) =>
                      update('notice_period', event.target.value)
                    }
                    placeholder="Example: 30 days"
                  />
                </div>

                <div className="yc-career-field">
                  <label>Expected salary</label>
                  <input
                    value={form.expected_salary}
                    onChange={(event) =>
                      update('expected_salary', event.target.value)
                    }
                  />
                </div>

                <div className="yc-career-field">
                  <label>LinkedIn profile</label>
                  <input
                    type="url"
                    value={form.linkedin_url}
                    onChange={(event) =>
                      update('linkedin_url', event.target.value)
                    }
                    placeholder="https://"
                  />
                </div>

                <div className="yc-career-field">
                  <label>Portfolio or GitHub</label>
                  <input
                    type="url"
                    value={form.portfolio_url}
                    onChange={(event) =>
                      update('portfolio_url', event.target.value)
                    }
                    placeholder="https://"
                  />
                </div>

                <div className="yc-career-field yc-career-field-full">
                  <label>Cover note</label>
                  <textarea
                    value={form.cover_letter}
                    onChange={(event) =>
                      update('cover_letter', event.target.value)
                    }
                    placeholder="Briefly explain your interest and suitability for the role."
                  />
                </div>
              </div>

              {dynamicFields.length ? (
                <div className="yc-career-form-grid">
                  {dynamicFields.map((field, index) => {
                    const key = String(
                      field.key || field.name || `question_${index + 1}`,
                    );
                    const label =
                      field.label || field.question || displayLabel(key);
                    const required = field.required === true;
                    const type = normalizeKey(field.type || 'text');

                    return (
                      <div
                        className={`yc-career-field${
                          type === 'textarea'
                            ? ' yc-career-field-full'
                            : ''
                        }`}
                        key={key}
                      >
                        <label>
                          {label}
                          {required ? (
                            <span className="yc-career-required"> *</span>
                          ) : null}
                        </label>

                        {type === 'textarea' ? (
                          <textarea
                            required={required}
                            value={screeningAnswers[key] || ''}
                            onChange={(event) =>
                              setScreeningAnswers((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        ) : type === 'select' &&
                          Array.isArray(field.options) ? (
                          <select
                            required={required}
                            value={screeningAnswers[key] || ''}
                            onChange={(event) =>
                              setScreeningAnswers((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Choose an option</option>
                            {field.options.map((option) => (
                              <option
                                key={String(option.value || option)}
                                value={String(option.value || option)}
                              >
                                {String(option.label || option)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            required={required}
                            value={screeningAnswers[key] || ''}
                            onChange={(event) =>
                              setScreeningAnswers((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <label className="yc-career-checkbox">
                <input
                  type="checkbox"
                  checked={form.consent_accepted}
                  onChange={(event) =>
                    update('consent_accepted', event.target.checked)
                  }
                />
                <span>
                  I consent to this company collecting and using my submitted
                  details and resume for recruitment and, if selected, joining
                  activities. I confirm that I reviewed the extracted fields and
                  that the information provided is correct.
                </span>
              </label>
            </div>
          </div>

          <footer className="yc-career-modal-foot">
            <button
              type="button"
              className="yc-career-btn yc-career-btn-neutral"
              onClick={onClose}
              disabled={busy || parsing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="yc-career-btn yc-career-btn-primary"
              disabled={busy || parsing}
            >
              {busy ? <Loader2 size={15} /> : <ArrowRight size={15} />}
              {parsing ? 'Reading resume…' : 'Submit application'}
            </button>
          </footer>
        </form>
      </section>
    </div>
    ,
    document.body,
  );
}

function CareerJobsView({ companyKey, jobSlug }) {
  const [company, setCompany] = useState({});
  const [jobs, setJobs] = useState([]);
  const [job, setJob] = useState(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showApplication, setShowApplication] = useState(false);
  const [applicationResult, setApplicationResult] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState('');
  const { notice, showNotice, clearNotice } = usePublicNotice();

  const goTo = useCallback((path, message) => {
    startPublicNavigation(
      path,
      setTransitioning,
      setTransitionMessage,
      message,
    );
  }, []);

  const loadJobs = useCallback(async () => {
    if (!companyKey) {
      setError('The company career page address is incomplete.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await getPublicRecruitmentJobs(companyKey, {
        search: appliedSearch,
        page_size: 100,
      });

      const receivedJobs = listPayload(response);
      setCompany(response?.company || {});
      setJobs(receivedJobs);

      if (appliedSearch) {
        showNotice(
          receivedJobs.length ? 'success' : 'warning',
          receivedJobs.length
            ? 'Matching positions found'
            : 'No matching position',
          receivedJobs.length
            ? `${receivedJobs.length} open ${
                receivedJobs.length === 1 ? 'position matches' : 'positions match'
              } your search.`
            : 'Try another role, department or skill.',
          4200,
        );
      }
    } catch (loadError) {
      const message = responseMessage(
        loadError,
        'This company career page is currently unavailable.',
      );
      setError(message);
      showNotice('error', 'Career page unavailable', message, 7000);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, companyKey, showNotice]);

  const loadJob = useCallback(async () => {
    if (!companyKey || !jobSlug) {
      setError('The job opening address is incomplete.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await getPublicRecruitmentJob(companyKey, jobSlug);
      setCompany(response?.company || {});
      setJob(response?.item || response?.job || null);
    } catch (loadError) {
      const message = responseMessage(
        loadError,
        'This job opening is not available.',
      );
      setError(message);
      showNotice('error', 'Position unavailable', message, 7000);
    } finally {
      setLoading(false);
    }
  }, [companyKey, jobSlug, showNotice]);

  useEffect(() => {
    if (jobSlug) loadJob();
    else loadJobs();
  }, [jobSlug, loadJob, loadJobs]);

  const careerPath = `/careers/${encodeURIComponent(
    company?.career_slug || companyKey,
  )}`;

  const layoutProps = {
    company,
    notice,
    onDismissNotice: clearNotice,
    transitioning,
    transitionMessage,
    onNavigate: goTo,
  };

  if (loading) {
    return (
      <PublicLayout {...layoutProps}>
        <main className="yc-career-main">
          <div className="yc-career-shell">
            <LoadingState
              message={
                jobSlug
                  ? 'Preparing the position details…'
                  : 'Preparing current opportunities…'
              }
            />
          </div>
        </main>
      </PublicLayout>
    );
  }

  if (error) {
    return (
      <PublicLayout {...layoutProps}>
        <main className="yc-career-main">
          <div className="yc-career-shell">
            <EmptyState
              icon={AlertCircle}
              title="Career page unavailable"
              message={error}
            />
          </div>
        </main>
      </PublicLayout>
    );
  }

  if (jobSlug && job) {
    const submittedMatch = previewMatch(applicationResult || {});

    return (
      <PublicLayout {...layoutProps}>
        <main className="yc-career-main">
          <div className="yc-career-shell">
            <button
              type="button"
              className="yc-career-back"
              onClick={() =>
                goTo(careerPath, 'Returning to all open positions…')
              }
            >
              <ArrowLeft size={15} />
              All open positions
            </button>

            <div className="yc-career-detail-layout">
              <article className="yc-career-panel">
                <span className="yc-career-eyebrow">
                  <BriefcaseBusiness size={14} />
                  Open position
                </span>
                <h1 className="yc-career-detail-title">{job.job_title}</h1>
                <span className="yc-career-detail-ref">
                  {job.reference_no || 'Vacancy reference not specified'}
                </span>

                <div style={{ marginTop: 18 }}>
                  <JobMeta job={job} />
                </div>

                <div className="yc-career-detail-content-grid">
                  <section className="yc-career-section">
                    <h3>About the role</h3>
                    <p>
                      {job.description ||
                        'Role description is not available.'}
                    </p>
                  </section>

                  {Array.isArray(job.responsibilities) &&
                  job.responsibilities.length ? (
                    <section className="yc-career-section">
                      <h3>Responsibilities</h3>
                      <ul className="yc-career-list">
                        {job.responsibilities.map((item) => (
                          <li key={String(item)}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {job.qualification ? (
                    <section className="yc-career-section">
                      <h3>Qualification</h3>
                      <p>{job.qualification}</p>
                    </section>
                  ) : null}

                  {Array.isArray(job.required_skills) &&
                  job.required_skills.length ? (
                    <section className="yc-career-section">
                      <h3>Required skills</h3>
                      <div className="yc-career-chip-list">
                        {job.required_skills.map((skill) => (
                          <span
                            className="yc-career-chip"
                            key={String(skill)}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </article>

              <aside className="yc-career-panel yc-career-panel-sticky">
                <div className="yc-career-panel-head">
                  <h3>Position summary</h3>
                  <p>Review the main details before applying.</p>
                </div>

                <div className="yc-career-summary-content">
                  <dl className="yc-career-summary-list">
                    <div className="yc-career-summary-row">
                      <dt>Department</dt>
                      <dd>{job.department || 'Not specified'}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Employment</dt>
                      <dd>{displayLabel(job.employment_type)}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Work mode</dt>
                      <dd>{displayLabel(job.work_mode)}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Location</dt>
                      <dd>{job.work_location || 'Not specified'}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Experience</dt>
                      <dd>{job.required_experience || 'Not specified'}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Vacancies</dt>
                      <dd>{job.vacancies || 1}</dd>
                    </div>
                    <div className="yc-career-summary-row">
                      <dt>Apply by</dt>
                      <dd>{dateText(job.closing_date)}</dd>
                    </div>
                    {job.salary_visible ? (
                      <div className="yc-career-summary-row">
                        <dt>Salary range</dt>
                        <dd>
                          {currencyText(job.salary_min, job.currency)} –{' '}
                          {currencyText(job.salary_max, job.currency)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <button
                    type="button"
                    className="yc-career-btn yc-career-btn-primary yc-career-summary-apply"
                    onClick={() => {
                      setShowApplication(true);
                      showNotice(
                        'info',
                        'Application form opened',
                        'Upload your resume first. Detected details will fill the form and remain editable.',
                        5200,
                      );
                    }}
                  >
                    Apply for this position
                    <ArrowRight size={15} />
                  </button>

                  <div className="yc-career-alert yc-career-summary-alert">
                    <ShieldCheck size={16} />
                    <span>
                      Resume extraction and the match score support human review.
                      They do not automatically decide your application.
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </main>

        {showApplication ? (
          <ApplicationModal
            companyKey={companyKey}
            job={job}
            onNotify={showNotice}
            onClose={() => setShowApplication(false)}
            onSuccess={(response) => {
              setShowApplication(false);
              setApplicationResult(response);
            }}
          />
        ) : null}

        {applicationResult ? (
          <div className="yc-career-modal-backdrop">
            <section
              className="yc-career-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Application submitted"
            >
              <div className="yc-career-modal-body">
                <div
                  className="yc-career-state-card"
                  style={{
                    boxShadow: 'none',
                    border: 0,
                    width: '100%',
                  }}
                >
                  <div
                    className="yc-career-state-icon"
                    style={{
                      borderColor: '#b9dac9',
                      background: '#e7f1ed',
                      color: '#285a4a',
                    }}
                  >
                    <CheckCircle2 size={25} />
                  </div>
                  <h2>Application submitted</h2>
                  <p>
                    Your application for{' '}
                    <strong>
                      {applicationResult?.application?.job_title ||
                        job.job_title}
                    </strong>{' '}
                    has been recorded successfully.
                  </p>

                  <div className="yc-career-offer-details">
                    <div className="yc-career-offer-row">
                      <span>Application reference</span>
                      <strong>
                        {applicationResult?.application?.reference_no ||
                          'Reference will be shared by email'}
                      </strong>
                    </div>
                    <div className="yc-career-offer-row">
                      <span>Current status</span>
                      <strong>
                        {displayLabel(
                          applicationResult?.application?.status ||
                            'applied',
                        )}
                      </strong>
                    </div>
                    {applicationResult?.application
                      ?.resume_match_score !== undefined ? (
                      <div className="yc-career-offer-row">
                        <span>Indicative role match</span>
                        <strong>
                          {applicationResult.application.resume_match_score}%
                        </strong>
                      </div>
                    ) : null}
                  </div>

                  <ResumeMatchCard match={submittedMatch} />

                  <div
                    className="yc-career-alert yc-career-alert-success"
                    style={{ marginTop: 16, textAlign: 'left' }}
                  >
                    <BadgeCheck size={17} />
                    <span>
                      {applicationResult?.candidate_message ||
                        'The recruitment team will review the complete application and contact you about the next step.'}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="yc-career-btn yc-career-btn-primary"
                    onClick={() => {
                      setApplicationResult(null);
                      goTo(
                        careerPath,
                        'Returning to other open positions…',
                      );
                    }}
                  >
                    View other positions
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </PublicLayout>
    );
  }

  return (
    <PublicLayout {...layoutProps}>
      <main className="yc-career-main">
        <div className="yc-career-shell">
          <section className="yc-career-hero">
            <div className="yc-career-hero-content">
              <span className="yc-career-eyebrow">
                <span aria-hidden="true">👋</span>
                Join our team
              </span>

              <h1>
                Build meaningful work with{' '}
                {company.company_name || 'us'}.
              </h1>

              <p className="yc-career-hero-description">
                Discover open opportunities, understand each role clearly and
                apply directly to the team responsible for hiring.
              </p>

              <div className="yc-career-hero-highlights">
                <div className="yc-career-hero-highlight">
                  <span aria-hidden="true">📄</span>
                  <div>
                    <strong>Resume-assisted application</strong>
                    <p>
                      Upload your resume to prefill editable application details.
                    </p>
                  </div>
                </div>

                <div className="yc-career-hero-highlight">
                  <span aria-hidden="true">✨</span>
                  <div>
                    <strong>Clear role-match preview</strong>
                    <p>
                      Review an explainable match summary before submitting.
                    </p>
                  </div>
                </div>

                <div className="yc-career-hero-highlight">
                  <span aria-hidden="true">🤝</span>
                  <div>
                    <strong>Human-led hiring</strong>
                    <p>
                      Every application and hiring decision is reviewed by people.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="yc-career-toolbar">
            <div className="yc-career-heading">
              <h2>Open positions</h2>
              <p>
                {jobs.length}{' '}
                {jobs.length === 1 ? 'vacancy' : 'vacancies'} currently
                available
              </p>
            </div>

            <form
              className="yc-career-search"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }}
            >
              <Search size={16} />
              <input
                className="yc-career-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search role, department or skill"
                aria-label="Search open positions"
              />
            </form>
          </div>

          {jobs.length ? (
            <section className="yc-career-jobs">
              {jobs.map((item) => (
                <article
                  className="yc-career-job-card"
                  key={recordId(item) || item.public_slug}
                >
                  <div className="yc-career-job-head">
                    <div>
                      <h3>{item.job_title}</h3>
                      <span className="yc-career-job-ref">
                        {item.reference_no || 'Open position'}
                      </span>
                    </div>
                    <span className="yc-career-badge">
                      {item.vacancies || 1}{' '}
                      {Number(item.vacancies || 1) === 1
                        ? 'opening'
                        : 'openings'}
                    </span>
                  </div>

                  <JobMeta job={item} />

                  <p>
                    {item.description ||
                      'Open this vacancy to review the complete role details.'}
                  </p>

                  {Array.isArray(item.required_skills) &&
                  item.required_skills.length ? (
                    <div className="yc-career-chip-list">
                      {item.required_skills.slice(0, 5).map((skill) => (
                        <span
                          className="yc-career-chip"
                          key={String(skill)}
                        >
                          {skill}
                        </span>
                      ))}
                      {item.required_skills.length > 5 ? (
                        <span className="yc-career-chip">
                          +{item.required_skills.length - 5}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="yc-career-card-foot">
                    <small>
                      {item.closing_date
                        ? `Apply by ${dateText(item.closing_date)}`
                        : 'Applications currently open'}
                    </small>
                    <button
                      type="button"
                      className="yc-career-btn yc-career-btn-primary"
                      onClick={() =>
                        goTo(
                          `${careerPath}/jobs/${encodeURIComponent(
                            item.public_slug,
                          )}`,
                          `Opening ${item.job_title}…`,
                        )
                      }
                    >
                      View role
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <EmptyState
              title="No open positions"
              message={
                appliedSearch
                  ? 'No current vacancy matches your search. Try another role, department or skill.'
                  : 'There are no published vacancies at the moment. Please check this page again later.'
              }
            />
          )}
        </div>
      </main>
    </PublicLayout>
  );
}

function OfferResponseView({ responseToken }) {
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const {
    notice: toastNotice,
    showNotice,
    clearNotice,
  } = usePublicNotice();

  const loadOffer = useCallback(async () => {
    if (!responseToken) {
      setError('The offer link is incomplete.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await getPublicRecruitmentOffer(responseToken);
      setOffer(response?.offer || response?.item || null);
    } catch (loadError) {
      setError(responseMessage(loadError, 'The offer link is invalid or unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [responseToken]);

  useEffect(() => {
    loadOffer();
  }, [loadOffer]);

  const respond = async (responseStatus) => {
    setBusy(responseStatus);
    setError('');

    try {
      const response = await respondToPublicRecruitmentOffer(responseToken, {
        response: responseStatus,
        reason: responseStatus === 'declined' ? declineReason.trim() : '',
      });

      const message =
        response?.message ||
        `Your offer has been ${responseStatus}.`;

      setResultMessage(message);
      showNotice(
        responseStatus === 'accepted' ? 'success' : 'warning',
        responseStatus === 'accepted'
          ? 'Offer accepted'
          : 'Offer declined',
        message,
        7000,
      );
      setOffer(
        response?.offer || {
          ...offer,
          status: responseStatus,
          response_status: responseStatus,
        },
      );
    } catch (responseError) {
      const message = responseMessage(
        responseError,
        'Your response could not be recorded.',
      );
      setError(message);
      showNotice('error', 'Offer response not recorded', message, 7500);
    } finally {
      setBusy('');
    }
  };

  const terms = offer?.terms || {};
  const status = normalizeKey(offer?.status || offer?.response_status);
  const canRespond = status === 'sent';

  return (
    <PublicLayout
      company={{
        company_name: terms.company_name || 'Company Recruitment',
      }}
      notice={toastNotice}
      onDismissNotice={clearNotice}
    >
      <main className="yc-career-state-wrap">
        <div className="yc-career-shell">
          {loading ? (
            <LoadingState message="Loading your offer…" />
          ) : error && !offer ? (
            <EmptyState
              icon={AlertCircle}
              title="Offer unavailable"
              message={error}
            />
          ) : (
            <section className="yc-career-state-card">
              <div className="yc-career-state-icon">
                <FileCheck2 size={25} />
              </div>
              <h1>Employment offer</h1>
              <p>
                Dear {offer?.candidate_name || 'Candidate'}, review the approved offer details below before recording your response.
              </p>

              {error ? (
                <div className="yc-career-alert yc-career-alert-danger" style={{ marginTop: 18, textAlign: 'left' }}>
                  <AlertCircle size={17} />
                  <span>{error}</span>
                </div>
              ) : null}

              {resultMessage ? (
                <div className="yc-career-alert yc-career-alert-success" style={{ marginTop: 18, textAlign: 'left' }}>
                  <CheckCircle2 size={17} />
                  <span>{resultMessage}</span>
                </div>
              ) : null}

              <div className="yc-career-offer-details">
                <div className="yc-career-offer-row">
                  <span>Offer reference</span>
                  <strong>{offer?.reference_no || '—'}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Position</span>
                  <strong>{terms.designation || offer?.job_title || '—'}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Department</span>
                  <strong>{terms.department || '—'}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Work location</span>
                  <strong>{terms.work_location || '—'}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Employment type</span>
                  <strong>{displayLabel(terms.employment_type)}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Joining date</span>
                  <strong>{dateText(terms.joining_date)}</strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Salary</span>
                  <strong>
                    {terms.salary_summary ||
                      currencyText(terms.gross_salary, terms.currency)}
                  </strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Response deadline</span>
                  <strong>
                    {dateText(
                      terms.response_deadline ||
                        terms.expiry_date ||
                        offer?.response_deadline,
                    )}
                  </strong>
                </div>
                <div className="yc-career-offer-row">
                  <span>Status</span>
                  <strong>
                    <span
                      className="yc-career-status"
                      data-tone={statusTone(status)}
                    >
                      {displayLabel(status)}
                    </span>
                  </strong>
                </div>
              </div>

              {canRespond ? (
                <>
                  <div className="yc-career-field" style={{ textAlign: 'left', marginBottom: 16 }}>
                    <label>Reason when declining</label>
                    <textarea
                      value={declineReason}
                      onChange={(event) => setDeclineReason(event.target.value)}
                      placeholder="Required only when declining the offer"
                    />
                  </div>

                  <div className="yc-career-state-actions">
                    <button
                      type="button"
                      className="yc-career-btn yc-career-btn-success"
                      disabled={Boolean(busy)}
                      onClick={() => respond('accepted')}
                    >
                      {busy === 'accepted' ? (
                        <Loader2 size={15} />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      Accept offer
                    </button>
                    <button
                      type="button"
                      className="yc-career-btn yc-career-btn-danger"
                      disabled={Boolean(busy) || !declineReason.trim()}
                      onClick={() => respond('declined')}
                    >
                      {busy === 'declined' ? (
                        <Loader2 size={15} />
                      ) : (
                        <XCircle size={15} />
                      )}
                      Decline offer
                    </button>
                  </div>
                </>
              ) : (
                <div className="yc-career-alert" style={{ textAlign: 'left' }}>
                  <BadgeCheck size={17} />
                  <span>
                    This offer already has a recorded status of {displayLabel(status)}. Contact the recruitment team if a correction is required.
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </PublicLayout>
  );
}

function JoiningPortalView({ accessToken }) {
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const {
    notice: toastNotice,
    showNotice,
    clearNotice,
  } = usePublicNotice();

  const loadPortal = useCallback(async () => {
    if (!accessToken) {
      setError('The pre-joining link is incomplete.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await getPublicRecruitmentJoiningPortal(accessToken);
      setPortal(response || {});
    } catch (loadError) {
      setError(
        responseMessage(
          loadError,
          'The pre-joining link is invalid, expired or unavailable.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  const uploadDocument = async (document, file, candidateNote) => {
    const key = document.document_key;
    setBusyKey(key);
    setError('');
    setNotice('');

    try {
      const response = await uploadPublicRecruitmentJoiningDocument(
        accessToken,
        key,
        file,
        { candidate_note: candidateNote },
      );

      const message =
        response?.message ||
        `${document.document_label || displayLabel(key)} submitted successfully.`;

      setNotice(message);
      showNotice(
        'success',
        'Document uploaded',
        message,
        6000,
      );
      await loadPortal();
    } catch (uploadError) {
      const message = responseMessage(
        uploadError,
        'The document could not be uploaded.',
      );
      setError(message);
      showNotice('error', 'Document upload failed', message, 7500);
    } finally {
      setBusyKey('');
    }
  };

  const application = portal?.application || {};
  const documents = Array.isArray(portal?.documents) ? portal.documents : [];
  const readiness = portal?.readiness || {};

  return (
    <PublicLayout
      company={{ company_name: 'Company Recruitment' }}
      notice={toastNotice}
      onDismissNotice={clearNotice}
    >
      <main className="yc-career-main">
        <div className="yc-career-shell">
          {loading ? (
            <LoadingState message="Loading your pre-joining checklist…" />
          ) : error && !portal ? (
            <EmptyState
              icon={AlertCircle}
              title="Pre-joining page unavailable"
              message={error}
            />
          ) : (
            <div className="yc-career-detail-layout">
              <section className="yc-career-panel">
                <span className="yc-career-eyebrow">
                  <FileCheck2 size={14} />
                  Pre-joining documents
                </span>
                <h1 className="yc-career-detail-title">
                  Welcome, {application.candidate_name || 'Candidate'}
                </h1>
                <p style={{ margin: '13px 0 0', color: '#64748b', lineHeight: 1.65 }}>
                  Submit the documents requested for your joining. HR will review each item and contact you if a correction is needed.
                </p>

                {error ? (
                  <div
                    className="yc-career-alert yc-career-alert-danger"
                    style={{ marginTop: 16 }}
                  >
                    <AlertCircle size={17} />
                    <span>{error}</span>
                  </div>
                ) : null}

                {notice ? (
                  <div
                    className="yc-career-alert yc-career-alert-success"
                    style={{ marginTop: 16 }}
                  >
                    <CheckCircle2 size={17} />
                    <span>{notice}</span>
                  </div>
                ) : null}

                <div className="yc-career-document-list">
                  {documents.map((document) => (
                    <JoiningDocumentItem
                      key={recordId(document) || document.document_key}
                      document={document}
                      busy={busyKey === document.document_key}
                      onUpload={uploadDocument}
                    />
                  ))}
                </div>

                {!documents.length ? (
                  <EmptyState
                    icon={FileText}
                    title="No document checklist"
                    message="There are no joining documents to submit through this link."
                  />
                ) : null}
              </section>

              <aside className="yc-career-panel yc-career-panel-sticky">
                <div className="yc-career-panel-head">
                  <h3>Joining summary</h3>
                  <p>Your current pre-joining status.</p>
                </div>

                <dl className="yc-career-summary-list" style={{ marginTop: 12 }}>
                  <div className="yc-career-summary-row">
                    <dt>Application</dt>
                    <dd>{application.reference_no || '—'}</dd>
                  </div>
                  <div className="yc-career-summary-row">
                    <dt>Position</dt>
                    <dd>{application.job_title || '—'}</dd>
                  </div>
                  <div className="yc-career-summary-row">
                    <dt>Department</dt>
                    <dd>{application.department || '—'}</dd>
                  </div>
                  <div className="yc-career-summary-row">
                    <dt>Joining date</dt>
                    <dd>{dateText(application.joining_date)}</dd>
                  </div>
                  <div className="yc-career-summary-row">
                    <dt>Status</dt>
                    <dd>
                      <span
                        className="yc-career-status"
                        data-tone={statusTone(
                          application.joining_status || readiness.status,
                        )}
                      >
                        {displayLabel(
                          application.joining_status || readiness.status,
                        )}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div
                  className={`yc-career-alert${
                    readiness.ready_to_join
                      ? ' yc-career-alert-success'
                      : ' yc-career-alert-warning'
                  }`}
                  style={{ marginTop: 16 }}
                >
                  {readiness.ready_to_join ? (
                    <CheckCircle2 size={17} />
                  ) : (
                    <Clock3 size={17} />
                  )}
                  <span>
                    {readiness.ready_to_join
                      ? 'All required documents and checks are complete. HR will confirm the next step.'
                      : 'Some required documents or company verification checks are still pending.'}
                  </span>
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>
    </PublicLayout>
  );
}

function JoiningDocumentItem({ document, busy, onUpload }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const status = normalizeKey(document.status || 'pending');
  const canUpload = !['accepted', 'not_required'].includes(status);

  return (
    <article className="yc-career-document">
      <div className="yc-career-document-main">
        <span className="yc-career-document-icon">
          <FileText size={17} />
        </span>
        <span className="yc-career-document-copy">
          <strong>
            {document.document_label || displayLabel(document.document_key)}
            {document.required ? ' *' : ''}
          </strong>
          <small>
            {document.file_name ||
              document.review_note ||
              (document.required ? 'Required document' : 'Optional document')}
          </small>
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8, minWidth: 190 }}>
        <span
          className="yc-career-status"
          data-tone={statusTone(status)}
          style={{ justifySelf: 'end' }}
        >
          {displayLabel(status)}
        </span>

        {canUpload ? (
          <>
            <input
              className="yc-career-input"
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              aria-label={`Choose ${document.document_label || document.document_key}`}
            />
            <input
              className="yc-career-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional note"
            />
            <button
              type="button"
              className="yc-career-btn yc-career-btn-primary"
              disabled={!file || busy}
              onClick={() => onUpload(document, file, note)}
            >
              {busy ? <Loader2 size={14} /> : <UploadCloud size={14} />}
              {status === 'needs_correction' ? 'Upload correction' : 'Upload'}
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}




export default function CareerPortal(props) {
  const route = useMemo(
    () => parseRoute(props),
    [
      props.mode,
      props.companyKey,
      props.jobSlug,
      props.responseToken,
      props.accessToken,
    ],
  );

  if (route.mode === 'offer') {
    return <OfferResponseView responseToken={route.responseToken} />;
  }

  if (route.mode === 'joining') {
    return <JoiningPortalView accessToken={route.accessToken} />;
  }

  return (
    <CareerJobsView
      companyKey={route.companyKey}
      jobSlug={route.jobSlug}
    />
  );
}