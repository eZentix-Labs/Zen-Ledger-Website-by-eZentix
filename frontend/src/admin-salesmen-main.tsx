import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

const API=(import.meta.env.VITE_API_URL||'http://localhost:4000').replace(/\/$/,'');
type Salesman={id:string;name:string;phone:string};

function App(){
  const [salesmen,setSalesmen]=useState<Salesman[]>([]); const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function load(){const r=await fetch(`${API}/api/users`,{headers:{Authorization:`Bearer ${localStorage.getItem('token')||''}`}}); if(r.status===401||r.status===403) throw new Error('Please sign in as the owner/admin first.'); const b=await r.json(); if(!r.ok) throw new Error(b.error||'Could not load salesmen'); setSalesmen(b);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function create(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);try{const r=await fetch(`${API}/api/users`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('token')||''}`},body:JSON.stringify({name,phone,password})});const b=await r.json();if(!r.ok)throw new Error(b.error||'Could not create salesman');setSalesmen(v=>[b,...v]);setName('');setPhone('');setPassword('');}catch(e){setError(e instanceof Error?e.message:'Could not create salesman')}finally{setBusy(false)}}
  return <main className="page-shell"><section className="content-card"><h1>Salesmen</h1><p>Create phone-based accounts for the separate salesman deployment.</p><form onSubmit={create} className="modal-form"><label>Name<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} required/></label><label>Initial password<input value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy?'Creating…':'Create salesman'}</button></form><div className="sales-order-list">{salesmen.map(s=><article className="sales-order-card" key={s.id}><h3>{s.name}</h3><p>{s.phone}</p></article>)}</div></section></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
