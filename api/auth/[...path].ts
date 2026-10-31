import {app,ensureInitialized} from '../../apps/api/src/server.js';

export default async function handler(req:any,res:any){
  try{await ensureInitialized();return app(req,res);}catch(error){console.error('API startup failed:',error);return res.status(500).json({error:'API unavailable'});}
}
