import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { monthCalendar, tenantHolidayMap } from '../utils/sprintWorkingCalendar.mjs';

/** Read-only schedule from saved monthly sheet rows; no mutation or approval operations. */
export default function SprintMonthlyDailyReview({ month, rows = [], heading = 'Day-wise Tasks & Targets' }) {
  const [calendar, setCalendar] = useState({month:'',state:'loading',holidays:{},message:''});
  useEffect(() => {
    let active = true;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
      setCalendar({month,state:'error',holidays:{},message:'Invalid planning month'});
      return () => {active=false;};
    }
    setCalendar({month,state:'loading',holidays:{},message:''});
    const [y,m]=month.split('-').map(Number);
    const last=String(new Date(y,m,0).getDate()).padStart(2,'0');
    api(`/attendance/holidays?date_from=${month}-01&date_to=${month}-${last}`)
      .then(data => {
        if (!active) return;
        if (!data?.default_state) throw new Error('Employee state not available for holiday filtering');
        setCalendar({month,state:'ready',holidays:tenantHolidayMap(data?.items||[],data.default_state),message:''});
      })
      .catch(error => {
        if (active) setCalendar({month,state:'error',holidays:{},message:error?.message||'Holiday service unavailable'});
      });
    return () => {active=false;};
  },[month]);
  const daily = useMemo(() => {
    const result=new Map();
    for (const [rowIndex,row] of (Array.isArray(rows)?rows:[]).entries()) {
      for (const target of (Array.isArray(row?.daily_targets)?row.daily_targets:[])) {
        const date=String(target?.date||target?.scheduled_date||'').slice(0,10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${month}-`)) continue;
        const entry={task:String(target.title||target.task||target.activity||''),target:String(target.target||target.daily_target||target.measurable_target||''),objective:String(row.objective||row.activity||''),rowIndex};
        result.set(date,[...(result.get(date)||[]),entry]);
      }
    }
    return result;
  },[rows,month]);
  const ready=calendar.month===month && calendar.state==='ready';
  const dates=monthCalendar(month,ready?calendar.holidays:{});
  return <section className="smr-calendar" aria-label={heading} style={{marginTop:16,border:'1px solid var(--border,#dce2ef)',borderRadius:12,padding:14}}>
    <h4 style={{margin:'0 0 6px',fontSize:15}}>{heading}</h4>
    <p style={{fontSize:12,color:'var(--text-muted,#64748b)',margin:'0 0 10px'}}>
      {daily.size} scheduled date(s). The full month is shown, including non-working dates. Review actual saved tasks before approval.
    </p>
    {!ready && <p role={calendar.state==='error'?'alert':'status'} style={{fontSize:12,color:'#a16207'}}>
      {calendar.state==='error' ? `Tenant holiday calendar unavailable: ${calendar.message}. Weekly offs are displayed, but declared holidays are not verified.` : 'Loading tenant holiday calendar…'}
    </p>}
    <div style={{maxHeight:400,overflowY:'auto',border:'1px solid var(--border,#dce2ef)',borderRadius:8}}>
      {dates.map(day=>{
        const entries=daily.get(day.date)||[];
        return <div key={day.date} style={{padding:'9px 12px',borderBottom:'1px solid var(--border,#e2e8f0)',background:day.working?'transparent':'rgba(205,92,92,.06)'}}>
          <strong style={{fontSize:12}}>{day.date} — {day.label}</strong>
          {entries.length ? entries.map((entry,index)=><div key={`${entry.rowIndex}-${index}`} style={{paddingTop:4,fontSize:13,overflowWrap:'anywhere'}}>
            <b>Task:</b> {entry.task||'—'} · <b>Target:</b> {entry.target||'—'} <span style={{color:'var(--text-muted,#64748b)'}}>({entry.objective||'Monthly activity'})</span>
            {!day.working && <strong style={{color:'#b45309'}}> · Scheduled on a non-working day</strong>}
          </div>):<div style={{fontSize:12,color:'var(--text-muted,#64748b)'}}>No scheduled activity</div>}
        </div>;
      })}
    </div>
    {!daily.size && <p role="status" style={{fontSize:12,color:'#a16207'}}>No date-wise tasks were found in the saved sheet. Review the original submission before approving.</p>}
  </section>;
}
