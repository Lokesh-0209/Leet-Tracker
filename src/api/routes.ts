/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  DifficultySchema,
  ProblemStatusSchema,
  ReviewStageSchema,
  SaveNoteInputSchema,
  ManualAddProblemInputSchema,
  SettingsSchema,
  StartVerificationInputSchema,
  VerifyCodeInputSchema,
  RegisterInputSchema,
  PasswordResetInputSchema,
  LoginInputSchema,
  ValidationError,
  NotFoundError,
  type Clock,
  type User,
} from '../domain/index.js';
import type { ProblemRepository } from '../repositories/problemRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { ProblemService } from '../services/problemService.js';
import type { SyncService } from '../services/syncService.js';
import type { BackupService } from '../services/backupService.js';
import type { AuthService } from '../services/authService.js';
import { serializeCookie } from './sessionMiddleware.js';

const UUIDParamSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid problem ID format. Expected UUID.'
  );

const ListProblemsQuerySchema = z.object({
  status: ProblemStatusSchema.optional(),
  difficulty: DifficultySchema.optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const SyncBodySchema = z.object({
  username: z.string().trim().min(1).optional(),
});

function getClientIp(req: Request): string {
  // Rely on Express's req.ip which correctly evaluates trusted proxy hops.
  // Never manually parse untrusted X-Forwarded-For headers to prevent spoofing.
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export interface ApiDependencies {
  readonly problemRepository: ProblemRepository;
  readonly settingsRepository: SettingsRepository;
  readonly problemService: ProblemService;
  readonly syncService: SyncService;
  readonly backupService?: BackupService;
  readonly authService?: AuthService;
  readonly defaultTestUser?: User;
  readonly clock: Clock;
}

export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();

  if (deps.defaultTestUser) {
    router.use((req, _res, next) => {
      if (!req.user) {
        req.user = deps.defaultTestUser;
      }
      next();
    });
  }
  const {
    problemRepository,
    settingsRepository,
    problemService,
    syncService,
    backupService,
    authService,
    clock,
  } = deps;

  /* -------------------------------------------------------------------------- */
  /* HEALTH CHECK (PUBLIC)                                                      */
  /* -------------------------------------------------------------------------- */
  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  /* -------------------------------------------------------------------------- */
  /* AUTHENTICATION ROUTES (PUBLIC)                                             */
  /* -------------------------------------------------------------------------- */
  if (authService) {
    router.post('/auth/password-reset/start', async (req, res, next) => {
      try {
        const body = StartVerificationInputSchema.safeParse(req.body);
        if (!body.success) throw new ValidationError('Invalid recovery request', body.error.format());
        res.json(await authService.startPasswordReset(body.data.username, getClientIp(req)));
      } catch (err) { next(err); }
    });

    router.post('/auth/password-reset/complete', async (req, res, next) => {
      try {
        const body = PasswordResetInputSchema.safeParse(req.body);
        if (!body.success) throw new ValidationError('Invalid password reset request', body.error.format());
        const result = await authService.resetPassword({ ...body.data, clientIp: getClientIp(req) });
        res.json({ ok: true, username: result.username });
      } catch (err) { next(err); }
    });

    // POST /api/auth/verification/start - Initiate LeetCode profile ownership challenge
    router.post('/auth/verification/start', async (req, res, next) => {
      try {
        const bodyParse = StartVerificationInputSchema.safeParse(req.body);
        if (!bodyParse.success) {
          throw new ValidationError('Invalid verification request', bodyParse.error.format());
        }

        const clientIp = getClientIp(req);
        const result = await authService.startVerification(bodyParse.data.username, clientIp);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    // POST /api/auth/verification/verify - Check "About Me" on LeetCode for 6-digit code
    router.post('/auth/verification/verify', async (req, res, next) => {
      try {
        const bodyParse = VerifyCodeInputSchema.safeParse(req.body);
        if (!bodyParse.success) {
          throw new ValidationError('Invalid verification parameters', bodyParse.error.format());
        }

        const clientIp = getClientIp(req);
        const result = await authService.verifyCode(
          bodyParse.data.challengeId,
          bodyParse.data.code,
          clientIp
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    // POST /api/auth/register - Create password and user account
    router.post('/auth/register', async (req, res, next) => {
      try {
        const bodyParse = RegisterInputSchema.safeParse(req.body);
        if (!bodyParse.success) {
          throw new ValidationError('Invalid registration parameters', bodyParse.error.format());
        }

        const clientIp = getClientIp(req);
        const { user, sessionToken } = await authService.register({
          ...bodyParse.data,
          clientIp,
        });

        // Set HTTP-only secure session cookie (7 days)
        res.setHeader(
          'Set-Cookie',
          serializeCookie('leet_session', sessionToken, {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60,
            secure: process.env.NODE_ENV === 'production',
          })
        );

        // Security fix: Never expose sessionToken in response JSON body
        res.status(201).json({ user });
      } catch (err) {
        next(err);
      }
    });

    // POST /api/auth/login - Existing user login with password
    router.post('/auth/login', async (req, res, next) => {
      try {
        const bodyParse = LoginInputSchema.safeParse(req.body);
        if (!bodyParse.success) {
          throw new ValidationError('Invalid login credentials format', bodyParse.error.format());
        }

        const clientIp = getClientIp(req);
        const { user, sessionToken } = await authService.login(
          bodyParse.data.username,
          bodyParse.data.password,
          clientIp
        );

        // Set HTTP-only secure session cookie (7 days)
        res.setHeader(
          'Set-Cookie',
          serializeCookie('leet_session', sessionToken, {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60,
            secure: process.env.NODE_ENV === 'production',
          })
        );

        // Security fix: Never expose sessionToken in response JSON body
        res.json({ user });
      } catch (err) {
        next(err);
      }
    });

    // POST /api/auth/logout - Invalidate session and clear cookie
    router.post('/auth/logout', async (req, res, next) => {
      try {
        if (req.sessionToken) {
          await authService.logout(req.sessionToken);
        }

        res.setHeader(
          'Set-Cookie',
          serializeCookie('leet_session', '', {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
          })
        );

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    });

    // GET /api/auth/me - Current authenticated user
    router.get('/auth/me', (req, res) => {
      if (!req.user) {
        res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
          retryable: false,
        });
        return;
      }
      res.json({ user: req.user });
    });
  }

  /* -------------------------------------------------------------------------- */
  /* AUTHENTICATION GUARD MIDDLEWARE FOR PROTECTED ROUTES                       */
  /* -------------------------------------------------------------------------- */
  // Security fix: Require a valid server-side session for every protected route.
  // Insecure Basic/Bearer Authorization header bypasses are completely eliminated.
  router.use((req, res, next) => {
    if (!req.user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        retryable: false,
      });
      return;
    }
    next();
  });

  /* -------------------------------------------------------------------------- */
  /* PROBLEMS LIST & DETAILS                                                    */
  /* -------------------------------------------------------------------------- */

  // GET /api/problems - List problems matching filters with aggregate notes & reviews
  router.get('/problems', async (req, res, next) => {
    try {
      const queryParse = ListProblemsQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        throw new ValidationError('Invalid query parameters', queryParse.error.format());
      }

      const { status, difficulty, q, limit, offset } = queryParse.data;
      const aggregates = await problemRepository.listAggregates({
        userId: req.user!.id,
        status,
        difficulty,
        search: q,
        limit,
        offset,
        includeDeleted: false,
      });

      res.json({ problems: aggregates });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/problems/deleted - List soft-deleted problems (for Settings > Deleted section)
  router.get('/problems/deleted', async (req, res, next) => {
    try {
      const aggregates = await problemRepository.listAggregates({
        userId: req.user!.id,
        onlyDeleted: true,
      });
      res.json({ problems: aggregates });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/problems/:id - Single problem aggregate
  router.get('/problems/:id', async (req, res, next) => {
    try {
      const paramParse = UUIDParamSchema.safeParse(req.params.id);
      if (!paramParse.success) {
        throw new ValidationError('Invalid problem ID format. Expected UUID.');
      }

      const aggregate = await problemRepository.getAggregate(paramParse.data, req.user!.id);
      if (!aggregate) {
        throw new NotFoundError('Problem', paramParse.data);
      }

      res.json(aggregate);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/problems/manual - Manually add problem by URL or slug
  router.post('/problems/manual', async (req, res, next) => {
    try {
      const bodyParse = ManualAddProblemInputSchema.safeParse(req.body);
      if (!bodyParse.success) {
        throw new ValidationError('Invalid manual add payload', bodyParse.error.format());
      }

      const problem = await problemService.manualAdd(bodyParse.data, req.user!.id);
      const aggregate = await problemRepository.getAggregate(problem.id, req.user!.id);
      res.status(201).json(aggregate || { problem, note: null, reviews: [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/problems/sync - Synchronize solved problems from LeetCode
  router.post('/problems/sync', async (req, res, next) => {
    try {
      const bodyParse = SyncBodySchema.safeParse(req.body || {});
      if (!bodyParse.success) {
        throw new ValidationError('Invalid sync payload', bodyParse.error.format());
      }

      // Security fix: Do not trust frontend username. Verify it matches verified user account
      if (
        bodyParse.data.username &&
        bodyParse.data.username.toLowerCase() !== req.user!.leetcodeUsername.toLowerCase()
      ) {
        throw new ValidationError(
          'Cannot synchronize another LeetCode account. Synchronization is locked to your verified account.'
        );
      }

      const result = await syncService.sync(req.user!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* REVIEWS QUEUE & ACTIONS                                                    */
  /* -------------------------------------------------------------------------- */

  // GET /api/reviews/today - Today's due and overdue reviews with total count
  router.get('/reviews/today', async (req, res, next) => {
    try {
      const today = clock.today(req.userTimeZone);
      const items = await problemRepository.getDueOrOverdueReviews(today, req.user!.id);

      res.json({
        today,
        count: items.length,
        items,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/problems/:id/reviews/:stage/complete - Complete review stage
  router.post('/problems/:id/reviews/:stage/complete', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      const stageParse = ReviewStageSchema.safeParse(Number(req.params.stage));
      if (!stageParse.success) {
        throw new ValidationError('Review stage must be 1, 2, or 3.');
      }

      const aggregate = await problemService.completeReview(
        idParse.data,
        stageParse.data,
        req.user!.id
      );
      res.json(aggregate);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/problems/:id/reviews/:stage/undo - Undo completed review stage
  router.post('/problems/:id/reviews/:stage/undo', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      const stageParse = ReviewStageSchema.safeParse(Number(req.params.stage));
      if (!stageParse.success) {
        throw new ValidationError('Review stage must be 1, 2, or 3.');
      }

      const aggregate = await problemService.undoReview(
        idParse.data,
        stageParse.data,
        req.user!.id
      );
      res.json(aggregate);
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* NOTES & ENROLLMENT GATE                                                    */
  /* -------------------------------------------------------------------------- */

  // POST /api/problems/:id/note - Save notes and trigger atomic enrollment if INBOX
  router.post('/problems/:id/note', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      const bodyParse = SaveNoteInputSchema.safeParse(req.body);
      if (!bodyParse.success) {
        throw new ValidationError('Invalid note payload', bodyParse.error.format());
      }

      const aggregate = await problemService.saveNote(
        idParse.data,
        bodyParse.data.approaches,
        req.userTimeZone,
        req.user!.id
      );

      res.json(aggregate);
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* SOFT DELETE, RESTORE & HARD DELETE                                         */
  /* -------------------------------------------------------------------------- */

  // DELETE /api/problems/:id - Soft delete
  router.delete('/problems/:id', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      await problemService.softDelete(idParse.data, req.user!.id);
      res.json({ success: true, id: idParse.data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/problems/:id/restore - Restore soft-deleted problem
  router.post('/problems/:id/restore', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      await problemService.restore(idParse.data, req.user!.id);
      const aggregate = await problemRepository.getAggregate(idParse.data, req.user!.id);
      res.json({ success: true, aggregate });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/problems/:id/permanent - Permanently delete problem
  router.delete('/problems/:id/permanent', async (req, res, next) => {
    try {
      const idParse = UUIDParamSchema.safeParse(req.params.id);
      if (!idParse.success) {
        throw new ValidationError('Invalid problem ID format.');
      }

      await problemService.hardDelete(idParse.data, req.user!.id);
      res.json({ success: true, id: idParse.data });
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* SETTINGS                                                                   */
  /* -------------------------------------------------------------------------- */

  // GET /api/settings/username - Get configured LeetCode username
  router.get('/settings/username', async (req, res, next) => {
    try {
      const username = await settingsRepository.getLeetCodeUsername(req.user!.id);
      res.json({ username: username ?? req.user!.leetcodeUsername });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/settings/username - Update configured LeetCode username
  router.put('/settings/username', async (req, res, next) => {
    try {
      const bodyParse = SettingsSchema.safeParse(req.body);
      if (!bodyParse.success) {
        throw new ValidationError('Invalid settings payload', bodyParse.error.format());
      }

      const newUsername = bodyParse.data.leetcodeUsername.trim();

      // Security fix: Changing a linked LeetCode account requires fresh ownership verification
      if (req.user!.leetcodeUsername.toLowerCase() !== newUsername.toLowerCase()) {
        throw new ValidationError(
          'Changing a linked LeetCode account requires ownership verification.'
        );
      }

      await settingsRepository.setLeetCodeUsername(newUsername, req.user!.id);
      res.json({ username: newUsername });
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* BACKUP EXPORT & RESTORE                                                    */
  /* -------------------------------------------------------------------------- */

  // GET /api/backup - Export full backup JSON
  router.get('/backup', async (req, res, next) => {
    try {
      if (!backupService) {
        throw new Error('Backup service is not configured');
      }
      const backupData = await backupService.exportBackup(req.user!.id);
      res.json(backupData);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/backup/restore - Atomically restore database from backup JSON
  router.post('/backup/restore', async (req, res, next) => {
    try {
      if (!backupService) {
        throw new Error('Backup service is not configured');
      }
      const result = await backupService.restoreBackup(req.body, req.user!.id);
      res.json({ ok: true, restoredCount: result.restoredCount });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
