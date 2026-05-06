const API_BASE=import.meta.env.VITE_API_BASE||'http://127.0.0.1:5000/api/v1';
export function getToken(){return localStorage.getItem('sds_hrms_token')}
export function setSession(d){localStorage.setItem('sds_hrms_token',d.token);localStorage.setItem('sds_hrms_user',JSON.stringify(d.user||{}));localStorage.setItem('sds_hrms_employee',JSON.stringify(d.employee||{}))}
export function clearSession(){localStorage.removeItem('sds_hrms_token');localStorage.removeItem('sds_hrms_user');localStorage.removeItem('sds_hrms_employee')}
export function currentUser(){try{return JSON.parse(localStorage.getItem('sds_hrms_user')||'{}')}catch{return {}}}
export async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};const t=getToken();if(t)headers.Authorization=`Bearer ${t}`;const res=await fetch(`${API_BASE}${path}`,{...opt,headers});let data={};try{data=await res.json()}catch{} if(!res.ok)throw new Error(data.message||`API Error ${res.status}`);return data}
