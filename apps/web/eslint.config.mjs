import base from '@pulseops/config/eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

// base goes after Next so the typescript-eslint parser takes precedence.
export default defineConfig([...nextVitals, ...base, globalIgnores(['next-env.d.ts'])]);
