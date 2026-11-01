import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{const env=loadEnv(mode,process.cwd(),'');const apiTarget=env.VITE_API_TARGET||'http://localhost:4000';return {plugins:[react()],server:{port:5173,proxy:{'/api':apiTarget}},build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{main:'index.html',salesman:'salesman.html',salesmenAdmin:'salesmen-admin.html'}}}};});

