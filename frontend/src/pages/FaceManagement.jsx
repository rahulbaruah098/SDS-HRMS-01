import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  LoaderCircle,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { faceRequest } from '../api/faceAttendance';
import FaceDialog from '../components/FaceDialog';
import FaceEnrollmentStudio from '../components/FaceEnrollmentStudio';
import '../styles/face-attendance.css';

const dateLabel = (value) =>
  value &&
  new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
async function preparePhoto(file) {
  if (
    !['image/png', 'image/jpeg'].includes(file.type) ||
    file.size > 15 * 1024 * 1024
  )
    throw new Error('Choose JPEG or PNG photographs under 15 MiB each.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 800 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    if (Math.min(canvas.width, canvas.height) < 120)
      throw new Error('Choose a larger photograph.');
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
function EmployeeDialog({ employee, close, saved }) {
  const [tab, setTab] = useState('Enrollment'),
    [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [events, setEvents] = useState(null);
  const [pending, setPending] = useState(null), [reason, setReason] = useState('');
  const [reference, setReference] = useState(''),
    [days, setDays] = useState(1),
    [category, setCategory] = useState('device');
  const [confirm, setConfirm] = useState(false);
  const base = `employees/${employee.id}`;
  useEffect(() => {
    if (tab !== 'History') return;
    let alive = true;
    faceRequest(base + '/history')
      .then((r) => {
        if (alive) setEvents(r.events);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [tab, base]);
  useEffect(() => {
    if (tab !== 'Verification') return;
    let alive = true;
    setPending(null);
    faceRequest(base + '/pending').then(r=>{if(alive)setPending(r)}).catch(e=>{if(alive)setError(e.message)});
    return ()=>{alive=false};
  }, [base, tab]);
  async function review(decision) {
    if (busy) return;
    setBusy(decision==='approve'?'Approving…':'Rejecting…');setError('');
    try {
      const r=await faceRequest(base + '/review',{decision,reason,revision:employee.revision});
      window.dispatchEvent(new Event('face-enrollment-updated'));
      saved({...employee,...r.record},'review');
    } catch(e) {setError(e.message);} finally {setBusy('');}
  }
  async function pick(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (photos.length + files.length > 5) {
      setError('Choose up to five photographs. Remove a view to replace it.');
      return;
    }
    setError('');
    setBusy('Preparing photographs…');
    try {
      const pending = await Promise.all(files.map(preparePhoto));
      setPhotos((p) => [...p, ...pending]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  async function save(path, data, message) {
    setBusy(message);
    setError('');
    try {
      const r = await faceRequest(base + '/' + path, {
        ...data,
        revision: employee.revision,
      });
      saved({ ...employee, ...r.record }, path);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  return (
    <FaceDialog title={employee.name} onClose={close} busy={Boolean(busy)}>
      <div className="yf-body">
        <small>
          {[employee.code, employee.department, employee.status]
            .filter(Boolean)
            .join(' · ')}
        </small>
        <div className="yf-tabs">
          {['Enrollment', 'Verification', 'Exception', 'History'].map((t) => (
            <button
              key={t}
              disabled={Boolean(busy)}
              aria-pressed={tab === t}
              onClick={() => {
                setTab(t);
                setError('');
                setConfirm(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'Enrollment' && (
          <>
            <p>
              <ShieldCheck size={16} />{' '}
              {employee.consented
                ? 'Employee consent recorded'
                : 'Ask the employee to record consent under Attendance → Facial attendance privacy.'}
            </p>
            <p>
              Choose 3–5 clear photographs showing this employee alone. Include
              a front view and slightly different angles.
            </p>
            <FaceEnrollmentStudio
              photos={photos}
              setPhotos={setPhotos}
              onUpload={pick}
              disabled={Boolean(busy) || !employee.consented}
            />
            {employee.valid_until && (
              <small>Template expiry · {dateLabel(employee.valid_until)}</small>
            )}
            {confirm && (
              <p role="alert">
                Revoking enrollment deletes this employee’s template.
              </p>
            )}
          </>
        )}
        {tab === 'Verification' && (
          <div className="yf-verification-review">
            {pending ? <>
              <p>One reference photo submitted by the employee. Compare it with the verified employee profile before approving.</p>
              <img src={pending.reference} alt="Employee verification photograph" style={{maxWidth:230,maxHeight:260,borderRadius:12}} />
              <small>Submitted: {dateLabel(pending.submitted_at)}</small>
              <label>Rejection reason <input value={reason} onChange={e=>setReason(e.target.value)} maxLength={250} placeholder="Reason if requesting re-enrollment" /></label>
              <div className="yf-actions">
                <button type="button" disabled={Boolean(busy)} onClick={()=>review('approve')}>Approve face enrollment</button>
                <button type="button" disabled={Boolean(busy)||reason.trim().length<5} onClick={()=>review('reject')}>Reject and request recapture</button>
              </div>
            </> : <p>No pending request is loaded for this employee.</p>}
          </div>
        )}
        {tab === 'Exception' && (
          <>
            <p>
              Approve online attendance without a camera for a limited time. Use
              an HR case reference and keep medical details out of this record.
            </p>
            {employee.exception_until && (
              <p>
                Current approval expires {dateLabel(employee.exception_until)}.
              </p>
            )}
            <label>
              Reason
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="device">Camera unavailable</option>
                <option value="accessibility">Accessibility need</option>
                <option value="temporary">Other temporary arrangement</option>
              </select>
            </label>
            <label>
              HR reference
              <input
                placeholder="HR-123"
                value={reference}
                maxLength={64}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label>
              Days
              <input
                type="number"
                min="1"
                max="30"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
          </>
        )}
        {tab === 'History' &&
          (!events ? (
            <p>Loading history…</p>
          ) : events.length ? (
            <ul className="yf-history">
              {events.map((event, i) => (
                <li key={i}>
                  <strong>{event.action.replaceAll('_', ' ')}</strong>
                  <small>
                    {new Date(event.at).toLocaleString()} · {event.actor_id}{' '}
                    {event.reference} {event.outcome}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No recorded actions yet.</p>
          ))}
        {error && (
          <p role="alert" className="yf-error-text">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="yf-progress">
            <LoaderCircle size={17} /> {busy}
          </p>
        )}
      </div>
      <footer className="yf-actions">
        {tab === 'Enrollment' && (
          <>
            {employee.status !== 'Not Registered' && (
              <button
                className="yf-danger"
                disabled={Boolean(busy)}
                onClick={() =>
                  confirm
                    ? save('revoke', {}, 'Deleting template…')
                    : setConfirm(true)
                }
              >
                {confirm ? 'Confirm revoke' : 'Revoke'}
              </button>
            )}
            <button
              className="yf-primary"
              disabled={
                Boolean(busy) || photos.length < 3 || !employee.consented
              }
              onClick={() =>
                save(
                  'enroll',
                  { photos: photos.map((p) => p.split(',')[1]) },
                  'Checking photographs and creating the template…',
                )
              }
            >
              <Camera size={16} />
              {employee.status === 'Not Registered'
                ? 'Register face'
                : 'Update enrollment'}
            </button>
          </>
        )}
        {tab === 'Exception' && (
          <>
            {employee.exception_until && (
              <button
                disabled={Boolean(busy)}
                onClick={() =>
                  save('exception', { decision: 'end' }, 'Ending exception…')
                }
              >
                End exception
              </button>
            )}
            <button
              className="yf-primary"
              disabled={
                Boolean(busy) ||
                reference.trim().length < 3 ||
                !Number.isInteger(Number(days)) ||
                Number(days) < 1 ||
                Number(days) > 30
              }
              onClick={() =>
                save(
                  'exception',
                  {
                    decision: 'grant',
                    category,
                    days: Number(days),
                    reference: reference.trim(),
                  },
                  'Saving approval…',
                )
              }
            >
              Approve exception
            </button>
          </>
        )}
        {tab === 'History' && <button onClick={close}>Close</button>}
      </footer>
    </FaceDialog>
  );
}
export default function FaceManagement({ setPage }) {
  const [q, setQ] = useState(''),
    [pages, setPages] = useState(['']),
    [next, setNext] = useState(null),
    [rows, setRows] = useState([]);
  const [employee, setEmployee] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0);
  const cursor = pages[pages.length - 1];
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const r = await faceRequest(
          'employees?q=' +
            encodeURIComponent(q) +
            '&after=' +
            encodeURIComponent(cursor),
        );
        if (alive) {
          setRows(r.roster);
          setNext(r.next_after);
        }
      } catch (e) {
        if (alive) {
          setRows([]);
          setNext(null);
          setError(e.message);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, cursor, reload]);
  return (
    <section className="yc-face yf-management">
      <header className="yf-pagehead">
        <div>
          <button className="yf-back" onClick={() => setPage('dashboard')}>
            <ArrowLeft size={15} /> Dashboard
          </button>
          <h1>Employee Face Training</h1>
          <p>Dedicated enrollment studio for employee photographs, identity verification and temporary exceptions.</p>
        </div>
        <ShieldCheck size={40} />
      </header>
      <div className="yf-studio-intro" aria-label="Enrollment steps" style={{display:'flex',flexWrap:'wrap',gap:12,margin:'12px 0 20px'}} >
        <span><strong>01</strong> Employee accepts consent in Attendance</span>
        <span><strong>02</strong> HR captures 3–5 distinct photographs</span>
        <span><strong>03</strong> Register face to validate and train model</span>
      </div>
      <div className="yf-panel">
        <label className="yf-search">
          <Search size={18} />
          <input
            aria-label="Search employees"
            placeholder="Search employee name or code"
            value={q}
            maxLength={100}
            onChange={(e) => {
              setQ(e.target.value);
              setPages(['']);
            }}
          />
        </label>
        {notice && (
          <p className="yf-info" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="yf-error-text" role="alert">
            {error}{' '}
            <button onClick={() => setReload((n) => n + 1)}>Retry</button>
          </p>
        )}
        {loading ? (
          <p>Loading employees…</p>
        ) : (
          !error &&
          (rows.length ? (
            <div>
              {rows.map((r) => (
                <button
                  className="yf-person"
                  key={r.id}
                  onClick={() => setEmployee(r)}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {[r.code, r.department].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <i data-status={r.status}>{r.status}</i>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <p>No employees found.</p>
          ))
        )}
        {(next || pages.length > 1) && (
          <div className="yf-actions">
            <button
              disabled={loading || pages.length === 1}
              onClick={() => setPages(pages.slice(0, -1))}
            >
              Previous
            </button>
            <button
              disabled={loading || !next}
              onClick={() => setPages([...pages, next])}
            >
              Next
            </button>
          </div>
        )}
      </div>
      {employee && (
        <EmployeeDialog
          employee={employee}
          close={() => {
            setEmployee(null);
            setReload((n) => n + 1);
          }}
          saved={(r, path) => {
            setEmployee(null);
            setRows((items) => items.map((a) => (a.id === r.id ? r : a)));
            setNotice(
              r.name +
                ' · ' +
                (path === 'exception' ? 'Exception updated' : r.status),
            );
          }}
        />
      )}
    </section>
  );
}
