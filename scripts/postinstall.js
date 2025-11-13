#!/usr/bin/env node

// Install Playwright browsers only in local development (not in CI)
if (!process.env.CI) {
  console.log('Installing Playwright browsers...');
  require('child_process').execSync('pnpm exec playwright install --with-deps chromium', {
    stdio: 'inherit'
  });
} else {
  console.log('CI environment detected - Skipping Playwright browser installation');
}
