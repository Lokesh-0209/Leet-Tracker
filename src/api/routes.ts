/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  DifficultySchema,
  ProblemStatusSchema,
  ReviewStageSchema,
  SaveNoteInputSchema,
  ManualAddProblemInputSchema,
  SettingsSchema,
  ValidationError,
  NotFoundError,
  type Clock,
} from '../domain/index.js';
import type { ProblemRepository } from '../repositories/problemRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { ProblemService } from '../services/problemService.js';
import type { SyncService } from '../services/syncService.js';
import type { BackupService } from '../services/backupService.js';

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

export interface ApiDependencies {
  readonly problemRepository: ProblemRepository;
  readonly settingsRepository: SettingsRepository;
  readonly problemService: ProblemService;
  readonly syncService: SyncService;
  readonly backupService?: BackupService;
  readonly clock: Clock;
}

export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();
  const { problemRepository, settingsRepository, problemService, syncService, backupService, clock } = deps;

  /* -------------------------------------------------------------------------- */
  /* HEALTH CHECK                                                               */
  /* -------------------------------------------------------------------------- */
  router.get('/health', (_req, res) => {
    res.json({ ok: true });
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
  router.get('/problems/deleted', async (_req, res, next) => {
    try {
      const aggregates = await problemRepository.listAggregates({
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

      const aggregate = await problemRepository.getAggregate(paramParse.data);
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

      const problem = await problemService.manualAdd(bodyParse.data);
      const aggregate = await problemRepository.getAggregate(problem.id);
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

      const result = await syncService.sync(bodyParse.data.username);
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
      const items = await problemRepository.getDueOrOverdueReviews(today);

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

      const aggregate = await problemService.completeReview(idParse.data, stageParse.data);
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

      const aggregate = await problemService.undoReview(idParse.data, stageParse.data);
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
        req.userTimeZone
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

      await problemService.softDelete(idParse.data);
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

      await problemService.restore(idParse.data);
      const aggregate = await problemRepository.getAggregate(idParse.data);
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

      await problemService.hardDelete(idParse.data);
      res.json({ success: true, id: idParse.data });
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* SETTINGS                                                                   */
  /* -------------------------------------------------------------------------- */

  // GET /api/settings/username - Get configured LeetCode username
  router.get('/settings/username', async (_req, res, next) => {
    try {
      const username = await settingsRepository.getLeetCodeUsername();
      res.json({ username });
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

      await settingsRepository.setLeetCodeUsername(bodyParse.data.leetcodeUsername);
      res.json({ username: bodyParse.data.leetcodeUsername });
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* BACKUP EXPORT & RESTORE                                                    */
  /* -------------------------------------------------------------------------- */

  // GET /api/backup - Export full backup JSON
  router.get('/backup', async (_req, res, next) => {
    try {
      if (!backupService) {
        throw new Error('Backup service is not configured');
      }
      const backupData = await backupService.exportBackup();
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
      const result = await backupService.restoreBackup(req.body);
      res.json({ ok: true, restoredCount: result.restoredCount });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
