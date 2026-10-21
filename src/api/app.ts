/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createApiRouter, type ApiDependencies } from './routes.js';
import { timezoneMiddleware } from './timezoneMiddleware.js';
import { errorHandler } from './errorMiddleware.js';
import { csrfMiddleware } from './csrfMiddleware.js';

export function createApiApp(deps: ApiDependencies): express.Application {
  const app = express();

  // Same-origin only: no wildcard CORS, JSON body size limit of 10MB for backup data
  app.use(express.json({ limit: '10mb' }));

  // Security headers: restrict MIME sniffing without blocking iframe embedding
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // CSRF protection middleware for mutating requests
  app.use(csrfMiddleware);

  // Timezone resolution middleware
  app.use(timezoneMiddleware);

  // Mount API router under /api
  app.use('/api', createApiRouter(deps));

  // Central error handling middleware (must be registered last)
  app.use(errorHandler);

  return app;
}
