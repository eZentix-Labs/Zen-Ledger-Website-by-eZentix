import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
// In dev the app calls its own origin (/api/...) and Vite forwards to the API, so the browser never makes a
// cross-origin request. Login keeps working whichever port Vite lands on (5173, 5174… when another app holds 5173).
export default defineConfig(({mode})=>{const env=loadEnv(mode,'.','');const apiTarget=env.VITE_API_TARGET||'http://localhost:4000';return {plugins:[react()],server:{port:5173,proxy:{'/api':{target:apiTarget,changeOrigin:true,configure:(proxy:any)=>{proxy.on('proxyReq',(req:any)=>req.removeHeader('origin'));}}}},build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{main:'index.html',salesman:'salesman.html',salesmenAdmin:'salesmen-admin.html',salesmanManagement:'admin-salesman-management.html'}}}};});
