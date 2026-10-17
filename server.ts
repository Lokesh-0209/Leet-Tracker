/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bundlePath = path.join(__dirname, 'dist', 'server.mjs');

// In production or when the server has been compiled, execute the standalone bundle.
// In development mode (npm run dev), load the TypeScript serverApp via tsx.
if (
  fs.existsSync(bundlePath) &&
  (process.env.NODE_ENV === 'production' || !process.env.npm_lifecycle_event?.includes('dev'))
) {
  await import(pathToFileURL(bundlePath).href);
} else {
  await import('./src/serverApp.js');
}
