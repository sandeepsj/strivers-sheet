// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// SITE / BASE_PATH are set by the GitHub Pages workflow (e.g. https://user.github.io + /repo).
export default defineConfig({
  site: process.env.SITE,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  integrations: [react()],
});
