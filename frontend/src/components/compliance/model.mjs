export const monthNow = () => today().slice(0,7);
export const today = () => { const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date()); const v = Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`; };
export const ratio = (balance, allocated) => allocated > 0 ? Math.min(100, Math.max(0, Number(balance) / Number(allocated) * 100)) : 0;
export const hours = value => `${Math.floor(Number(value || 0) / 60)}h ${Number(value || 0) % 60}m`;
export const label = key => key.replaceAll('_', ' ').replace(/^\w/, c=>c.toUpperCase());
export function connectionState(policy) { return policy?.connected ? 'Connected' : 'Disconnected'; }
export function canEnforce(policy) { return Boolean(policy?.enabled && policy?.connected && policy?.enforce); }
export function validation(policy) { if (policy.enforce && (!policy.shortage_model || !policy.final_point_boundary || !policy.wage_codes?.length || !(Number(policy.deduction_cap_percent)>0))) return 'Choose the shortage model, final-point boundary, eligible wage components and deduction cap before enforcement.'; return ''; }
export const newComponent = () => ({code:'', name:'', category:'earning', calculation_type:'fixed', amount:0, basis:'gross_salary', formula:'', condition:'', enabled:true, minimum:'', maximum:'', sequence:200, effective_from:today(), tax_treatment:'review_required', eligibility:{}, rounding:'two_decimals'});
