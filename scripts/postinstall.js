#!/usr/bin/env node

// Install Playwright browsers
console.log('Installing Playwright browsers...');
require('child_process').execSync('pnpm exec playwright install --with-deps chromium', {
  stdio: 'inherit'
});
