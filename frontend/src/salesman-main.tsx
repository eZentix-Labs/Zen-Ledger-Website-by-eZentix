import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SalesmanApp} from './salesman';
import './styles.css';

type Session={id:string;name:string;phone?:string;role:string};
const API=(import.meta.env.VITE_API_URL||'http://localhost:4000').replace(/\/$/,'');

function SalesmanLogin(){
  const [phone,setPhone]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault(); setError(''); setBusy(true);
    try{
      const response=await fetch(`${API}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password})});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error||'Login failed');
      if(body.user?.role!=='salesman') throw new Error('This login is for salesmen only');
      localStorage.setItem('token',body.token); localStorage.setItem('salesmanUser',JSON.stringify(body.user));
      window.location.reload();
    }catch(e){setError(e instanceof Error?e.message:'Login failed');}finally{setBusy(false);}
  }
  return <main className="login-shell"><section className="login-card"><div className="brand-mark">Z</div><h1>Salesman Login</h1><p>Sign in with the phone number and password provided by your admin.</p><form onSubmit={submit}><label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone number" autoComplete="username" required/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password" required/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></section></main>;
}

function App(){
  const [user,setUser]=useState<Session|null>(()=>{try{return JSON.parse(localStorage.getItem('salesmanUser')||'null')}catch{return null}});
  const [theme,setTheme]=useState('light');
  useEffect(()=>{if(!user)localStorage.removeItem('token');},[user]);
  if(!user) return <SalesmanLogin/>;
  return <SalesmanApp user={user} theme={theme} setTheme={setTheme} onSignOut={()=>{localStorage.removeItem('token');localStorage.removeItem('salesmanUser');setUser(null)}}/>;
}

createRoot(document.getElementById('root')!).render(<App/>);
