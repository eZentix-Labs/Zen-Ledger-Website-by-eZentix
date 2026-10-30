import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['apps/api/src/**/*.test.ts'],exclude:['node_modules/**','dist/**']}});
