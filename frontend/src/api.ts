type ErrorBody={error?:unknown};
function isErrorBody(value:unknown):value is ErrorBody{return typeof value==='object'&&value!==null&&'error' in value;}
export async function readApiResponse(response:Response):Promise<unknown>{const text=await response.text();let body:unknown=null;if(text.trim()){try{body=JSON.parse(text);}catch{return Promise.reject(new Error(response.ok?'Server returned an unexpected response.':`Server unavailable (HTTP ${response.status}).`));}}if(!response.ok){if(isErrorBody(body)&&typeof body.error==='string')throw new Error(body.error);throw new Error(`Request failed (HTTP ${response.status}).`);}if(body===null)throw new Error('Server returned an empty response.');return body;}
const API_BASE=(import.meta.env.VITE_API_URL||'https://zen-ledger-website-by-e-zentix.onrender.com').replace(/\/$/,'');
const nativeFetch=window.fetch.bind(window);
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  if(typeof input==='string'&&input.startsWith('/api/')) return nativeFetch(`${API_BASE}${input}`,init);
  return nativeFetch(input,init);
}) as typeof window.fetch;
export async function api<T=unknown>(path:string,opts:RequestInit={}):Promise<T>{const token=localStorage.getItem('token');const response=await fetch(`${API_BASE}${path}`,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});return await readApiResponse(response) as T;}
