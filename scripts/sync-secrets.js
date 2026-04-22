import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_NAME = 'siuchun-portfolio-demo';
const VARS_PATH = path.resolve(process.cwd(), '.dev.vars');

async function syncSecrets() {
  if (!fs.existsSync(VARS_PATH)) {
    console.warn('[Sync] .dev.vars file not found. Skipping secret sync.');
    return;
  }

  console.log(`[Sync] Reading secrets from ${VARS_PATH}...`);
  const content = fs.readFileSync(VARS_PATH, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const [key, ...valueParts] = trimmedLine.split('=');
    const value = valueParts.join('=').trim();

    if (key && value) {
      console.log(`[Sync] Pushing secret: ${key}...`);
      try {
        // Cross-platform way to pipe value into wrangler
        const command = `npx wrangler pages secret put ${key} --project-name ${PROJECT_NAME}`;
        execSync(command, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
        console.log(`[Sync] Successfully updated ${key}`);
      } catch (error) {
        console.error(`[Sync] Failed to update ${key}:`, error.message);
      }
    }
  }

  console.log('[Sync] All secrets processed.');
}

syncSecrets().catch(err => {
  console.error('[Sync] Fatal error:', err);
  process.exit(1);
});
