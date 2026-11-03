import {useEffect, useState, type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import './admin-salesman-management.css';

const API=import.meta.env.DEV?'':(import.meta.env.VITE_API_URL||'https://zen-ledger-website-by-ezentix.onrender.com').replace(/\/$/,'');
type Salesman={id:string;name:string;phone?:string;email?:string;role:string};

function AdminSalesmanManagement(){
  const [salesmen,setSalesmen]=useState<Salesman[]>([]);
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const token=localStorage.getItem('token')||'';
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};

  const load=async()=>{
    const response=await fetch(`${API}/api/users`,{headers});
    const body=await response.json();
    if(!response.ok) throw new Error(body.error||'Unable to load salesmen');
    setSalesmen(body);
  };
  useEffect(()=>{load().catch(error=>setMessage(error instanceof Error?error.message:'Unable to load salesmen'));},[]);

  const submit=async(event:FormEvent)=>{
    event.preventDefault(); setMessage(''); setBusy(true);
    try{
      const response=await fetch(`${API}/api/users`,{method:'POST',headers,body:JSON.stringify({name,phone,password})});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error||'Unable to create salesman');
      setSalesmen(current=>[body,...current]); setName(''); setPhone(''); setPassword('');
      setMessage('Salesman account created successfully.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to create salesman');}
    finally{setBusy(false);}
  };

  if(!token) return <main className="login-shell"><section className="login-card"><h1>Admin login required</h1><p>Open the Admin portal and sign in first, then open this page again.</p><a className="primary wide" href="/">Go to Admin login</a></section></main>;
  return <main className="admin-shell"><header className="topbar"><div className="brand"><div className="brand-mark">Z</div><strong>Zen Ledger</strong></div><a className="ghost" href="/">Back to Admin</a></header><section className="admin-content"><div className="page-title"><div><span className="eyebrow">ADMINISTRATION</span><h1>Salesman Management</h1><p className="muted">Create individual salesman logins for the mobile catalogue and order portal.</p></div></div><div className="admin-grid"><section className="card"><h2>Add salesman</h2><form onSubmit={submit}><label>Name<input value={name} onChange={event=>setName(event.target.value)} minLength={2} required/></label><label>Phone number<input value={phone} onChange={event=>setPhone(event.target.value)} minLength={5} required/></label><label>Temporary password<input value={password} onChange={event=>setPassword(event.target.value)} type="password" minLength={8} required/></label><button className="primary wide" disabled={busy}>{busy?'Creating…':'Create salesman'}</button></form>{message&&<p className="sales-message">{message}</p>}</section><section className="card"><div className="section-head"><h2>Existing salesmen</h2><button className="ghost" onClick={()=>load().catch(error=>setMessage(error instanceof Error?error.message:'Unable to refresh'))}>Refresh</button></div>{salesmen.length?<div className="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Status</th></tr></thead><tbody>{salesmen.map(salesman=><tr key={salesman.id}><td>{salesman.name}</td><td>{salesman.phone||salesman.email||'—'}</td><td><span className="badge success">Active</span></td></tr>)}</tbody></table></div>:<div className="empty">No salesman accounts yet.</div>}</section></div></section></main>;
}

createRoot(document.getElementById('root')!).render(<AdminSalesmanManagement/>);
