/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createApiRouter, type ApiDependencies } from './routes.js';
import { timezoneMiddleware } from './timezoneMiddleware.js';
import { errorHandler } from './errorMiddleware.js';
import { csrfMiddleware } from './csrfMiddleware.js';
import { createSessionMiddleware } from './sessionMiddleware.js';

export function configureProxyTrust(app: express.Application): void {
  const trustProxyEnv = process.env.TRUST_PROXY;
  if (trustProxyEnv !== undefined) {
    const lower = trustProxyEnv.trim().toLowerCase();
    if (lower === 'true') {
      app.set('trust proxy', true);
    } else if (lower === 'false') {
      app.set('trust proxy', false);
    } else if (!Number.isNaN(Number(trustProxyEnv))) {
      app.set('trust proxy', Number(trustProxyEnv));
    } else {
      app.set('trust proxy', trustProxyEnv);
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In production (Render, Cloud Run, standard reverse proxies), trust the 1st upstream hop
    app.set('trust proxy', 1);
  } else {
    // In local development/testing, do not trust proxy headers by default
    app.set('trust proxy', false);
  }
}

export function createApiApp(deps: ApiDependencies): express.Application {
  const app = express();

  // Configure reverse proxy trust for secure req.ip determination
  configureProxyTrust(app);

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

  // Session authentication middleware
  if (deps.authService) {
    app.use(createSessionMiddleware(deps.authService));
  }

  // Mount API router under /api
  app.use('/api', createApiRouter(deps));

  // Central error handling middleware (must be registered last)
  app.use(errorHandler);

  return app;
}
