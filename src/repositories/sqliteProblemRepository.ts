/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatabasePort } from '../db/sqliteDatabase.js';
import type {
  ProblemRepository,
  ListProblemsFilter,
  EnrollProblemAtomicParams,
} from './problemRepository.js';
import type {
  Platform,
  Difficulty,
  ProblemStatus,
  ReviewStage,
  Problem,
  Note,
  Review,
  ProblemAggregate,
  Approach,
} from '../domain/index.js';
import { NotFoundError, ValidationError } from '../domain/index.js';

interface ProblemRow {
  id: string;
  user_id: string;
  platform: string;
  slug: string;
  title: string;
  difficulty: string;
  url: string;
  solved_at: string;
  status: string;
  enrolled_at: string | null;
  deleted_at: string | null;
}

interface NoteRow {
  problem_id: string;
  approaches_json: string;
  updated_at: string;
}

interface ReviewRow {
  problem_id: string;
  stage: number;
  due_date: string;
  completed_at: string | null;
}

function assertValidUserId(userId?: string | null, operation = 'operation'): string {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new ValidationError(`User ID is required for ${operation}.`);
  }
  return userId.trim();
}

function mapRowToProblem(row: ProblemRow): Problem {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform as Platform,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty as Difficulty,
    url: row.url,
    solvedAt: row.solved_at,
    status: row.status as ProblemStatus,
    enrolledAt: row.enrolled_at,
    deletedAt: row.deleted_at,
  };
}

function mapRowToNote(row: NoteRow): Note {
  let approaches: Approach[] = [];
  try {
    approaches = JSON.parse(row.approaches_json) as Approach[];
  } catch {
    approaches = [];
  }
  return {
    problemId: row.problem_id,
    approaches,
    updatedAt: row.updated_at,
  };
}

function mapRowToReview(row: ReviewRow): Review {
  return {
    problemId: row.problem_id,
    stage: row.stage as ReviewStage,
    dueDate: row.due_date,
    completedAt: row.completed_at,
  };
}

export class SqliteProblemRepository implements ProblemRepository {
  constructor(private readonly db: DatabasePort) {}

  public async findById(id: string, userId?: string): Promise<Problem | null> {
    const validUserId = assertValidUserId(userId, 'findById');
    const row = await this.db
      .prepare<ProblemRow>('SELECT * FROM problems WHERE id = ? AND user_id = ?')
      .get(id, validUserId);
    return row ? mapRowToProblem(row) : null;
  }

  public async findByPlatformAndSlug(
    platform: Platform,
    slug: string,
    userId?: string
  ): Promise<Problem | null> {
    const validUserId = assertValidUserId(userId, 'findByPlatformAndSlug');
    const row = await this.db
      .prepare<ProblemRow>(
        'SELECT * FROM problems WHERE platform = ? AND slug = ? AND user_id = ?'
      )
      .get(platform, slug, validUserId);
    return row ? mapRowToProblem(row) : null;
  }

  public async list(filter: ListProblemsFilter = {} as ListProblemsFilter): Promise<Problem[]> {
    const validUserId = assertValidUserId(filter?.userId, 'listing problems');

    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [validUserId];

    if (filter.onlyDeleted) {
      conditions.push('deleted_at IS NOT NULL');
    } else if (!filter.includeDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.difficulty) {
      conditions.push('difficulty = ?');
      params.push(filter.difficulty);
    }

    if (filter.search && filter.search.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      conditions.push('(LOWER(title) LIKE ? OR LOWER(slug) LIKE ?)');
      params.push(term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    let query = `SELECT * FROM problems ${whereClause} ORDER BY solved_at DESC, created_at DESC`;

    if (filter.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined) {
        query += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = await this.db.prepare<ProblemRow>(query).all(...params);
    return rows.map(mapRowToProblem);
  }

  public async create(problem: Problem): Promise<Problem> {
    const validUserId = assertValidUserId(problem.userId, 'creating a problem');

    await this.db
      .prepare(
        `INSERT INTO problems (
          id, user_id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        problem.id,
        validUserId,
        problem.platform,
        problem.slug,
        problem.title,
        problem.difficulty,
        problem.url,
        problem.solvedAt,
        problem.status,
        problem.enrolledAt,
        problem.deletedAt
      );

    return { ...problem, userId: validUserId };
  }

  public async update(problem: Problem): Promise<Problem> {
    const validUserId = assertValidUserId(problem.userId, 'updating a problem');

    const result = await this.db
      .prepare(
        `UPDATE problems SET
          title = ?,
          difficulty = ?,
          url = ?,
          solved_at = ?,
          status = ?,
          enrolled_at = ?,
          deleted_at = ?
        WHERE id = ? AND user_id = ?`
      )
      .run(
        problem.title,
        problem.difficulty,
        problem.url,
        problem.solvedAt,
        problem.status,
        problem.enrolledAt,
        problem.deletedAt,
        problem.id,
        validUserId
      );

    if (result.changes === 0) {
      throw new NotFoundError('Problem', problem.id);
    }

    return problem;
  }

  public async softDelete(id: string, deletedAt: string, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'soft-deleting a problem');

    const result = await this.db
      .prepare('UPDATE problems SET deleted_at = ? WHERE id = ? AND user_id = ?')
      .run(deletedAt, id, validUserId);

    if (result.changes === 0) {
      throw new NotFoundError('Problem', id);
    }
  }

  public async restore(id: string, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'restoring a problem');

    const result = await this.db
      .prepare('UPDATE problems SET deleted_at = NULL WHERE id = ? AND user_id = ?')
      .run(id, validUserId);

    if (result.changes === 0) {
      throw new NotFoundError('Problem', id);
    }
  }

  public async hardDelete(id: string, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'permanently deleting a problem');

    const result = await this.db
      .prepare('DELETE FROM problems WHERE id = ? AND user_id = ?')
      .run(id, validUserId);

    if (result.changes === 0) {
      throw new NotFoundError('Problem', id);
    }
  }

  public async getNote(problemId: string, userId?: string): Promise<Note | null> {
    const validUserId = assertValidUserId(userId, 'accessing note');
    const problem = await this.findById(problemId, validUserId);
    if (!problem) return null;

    const row = await this.db
      .prepare<NoteRow>('SELECT * FROM notes WHERE problem_id = ?')
      .get(problemId);
    return row ? mapRowToNote(row) : null;
  }

  public async saveNote(note: Note, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'saving note');
    const problem = await this.findById(note.problemId, validUserId);
    if (!problem) {
      throw new NotFoundError('Problem', note.problemId);
    }

    await this.db
      .prepare(
        `INSERT INTO notes (problem_id, approaches_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(problem_id) DO UPDATE SET
           approaches_json = excluded.approaches_json,
           updated_at = excluded.updated_at`
      )
      .run(note.problemId, JSON.stringify(note.approaches), note.updatedAt);
  }

  public async getReviews(problemId: string, userId?: string): Promise<Review[]> {
    const validUserId = assertValidUserId(userId, 'accessing reviews');
    const problem = await this.findById(problemId, validUserId);
    if (!problem) return [];

    const rows = await this.db
      .prepare<ReviewRow>('SELECT * FROM reviews WHERE problem_id = ? ORDER BY stage ASC')
      .all(problemId);
    return rows.map(mapRowToReview);
  }

  public async saveReviews(reviews: readonly Review[], userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'saving reviews');
    if (reviews.length === 0) return;

    const problem = await this.findById(reviews[0].problemId, validUserId);
    if (!problem) {
      throw new NotFoundError('Problem', reviews[0].problemId);
    }

    await this.db.transaction(async () => {
      const stmt = this.db.prepare(
        `INSERT INTO reviews (problem_id, stage, due_date, completed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(problem_id, stage) DO UPDATE SET
           due_date = excluded.due_date,
           completed_at = excluded.completed_at`
      );

      for (const review of reviews) {
        await stmt.run(review.problemId, review.stage, review.dueDate, review.completedAt);
      }
    });
  }

  public async updateReview(review: Review, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'updating review');
    const problem = await this.findById(review.problemId, validUserId);
    if (!problem) {
      throw new NotFoundError('Problem', review.problemId);
    }

    const result = await this.db
      .prepare(
        `UPDATE reviews SET
           due_date = ?,
           completed_at = ?
         WHERE problem_id = ? AND stage = ?`
      )
      .run(review.dueDate, review.completedAt, review.problemId, review.stage);

    if (result.changes === 0) {
      throw new NotFoundError('Review', `${review.problemId}-stage-${review.stage}`);
    }
  }

  public async getDueOrOverdueReviews(
    today: string,
    userId?: string
  ): Promise<{ problem: Problem; review: Review }[]> {
    const validUserId = assertValidUserId(userId, 'retrieving due reviews');

    const query = `
      SELECT
        p.id as p_id, p.user_id as p_user_id, p.platform as p_platform, p.slug as p_slug, p.title as p_title,
        p.difficulty as p_difficulty, p.url as p_url, p.solved_at as p_solved_at,
        p.status as p_status, p.enrolled_at as p_enrolled_at, p.deleted_at as p_deleted_at,
        r.problem_id as r_problem_id, r.stage as r_stage, r.due_date as r_due_date,
        r.completed_at as r_completed_at
      FROM reviews r
      JOIN problems p ON r.problem_id = p.id
      WHERE p.user_id = ?
        AND p.deleted_at IS NULL
        AND r.completed_at IS NULL
        AND r.due_date <= ?
      ORDER BY r.due_date ASC, r.stage ASC
    `;

    interface JoinedRow {
      p_id: string;
      p_user_id: string;
      p_platform: string;
      p_slug: string;
      p_title: string;
      p_difficulty: string;
      p_url: string;
      p_solved_at: string;
      p_status: string;
      p_enrolled_at: string | null;
      p_deleted_at: string | null;
      r_problem_id: string;
      r_stage: number;
      r_due_date: string;
      r_completed_at: string | null;
    }

    const rows = await this.db.prepare<JoinedRow>(query).all(validUserId, today) as JoinedRow[];

    return rows.map((row) => ({
      problem: mapRowToProblem({
        id: row.p_id,
        user_id: row.p_user_id,
        platform: row.p_platform,
        slug: row.p_slug,
        title: row.p_title,
        difficulty: row.p_difficulty,
        url: row.p_url,
        solved_at: row.p_solved_at,
        status: row.p_status,
        enrolled_at: row.p_enrolled_at,
        deleted_at: row.p_deleted_at,
      }),
      review: mapRowToReview({
        problem_id: row.r_problem_id,
        stage: row.r_stage,
        due_date: row.r_due_date,
        completed_at: row.r_completed_at,
      }),
    }));
  }

  public async getAggregate(problemId: string, userId?: string): Promise<ProblemAggregate | null> {
    const validUserId = assertValidUserId(userId, 'retrieving problem aggregate');
    const problem = await this.findById(problemId, validUserId);
    if (!problem) {
      return null;
    }

    const [note, reviews] = await Promise.all([
      this.getNote(problemId, validUserId),
      this.getReviews(problemId, validUserId),
    ]);

    return {
      problem,
      note,
      reviews,
    };
  }

  public async listAggregates(filter: ListProblemsFilter = {} as ListProblemsFilter): Promise<ProblemAggregate[]> {
    const validUserId = assertValidUserId(filter?.userId, 'listing aggregates');
    const problems = await this.list({ ...filter, userId: validUserId });
    if (problems.length === 0) {
      return [];
    }

    return Promise.all(
      problems.map(async (problem) => {
        const [note, reviews] = await Promise.all([
          this.getNote(problem.id, validUserId),
          this.getReviews(problem.id, validUserId),
        ]);
        return {
          problem,
          note,
          reviews,
        };
      })
    );
  }

  public async enrollProblemAtomic(params: EnrollProblemAtomicParams): Promise<void> {
    const validUserId = assertValidUserId(params.userId, 'enrolling a problem');

    await this.db.transaction(async () => {
      const updateResult = await this.db
        .prepare(
          'UPDATE problems SET status = ?, enrolled_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
        )
        .run(params.status, params.enrolledAt, params.problemId, validUserId);

      if (updateResult.changes === 0) {
        throw new NotFoundError('Problem', params.problemId);
      }

      // 2. Insert 3 reviews
      const insertReviewStmt = this.db.prepare(
        `INSERT INTO reviews (problem_id, stage, due_date, completed_at)
         VALUES (?, ?, ?, ?)`
      );
      for (const review of params.reviews) {
        await insertReviewStmt.run(review.problemId, review.stage, review.dueDate, review.completedAt);
      }

      // 3. Save note
      await this.db
        .prepare(
          `INSERT INTO notes (problem_id, approaches_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(problem_id) DO UPDATE SET
             approaches_json = excluded.approaches_json,
             updated_at = excluded.updated_at`
        )
        .run(params.note.problemId, JSON.stringify(params.note.approaches), params.note.updatedAt);
    });
  }

  public async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return await this.db.transaction(fn);
  }
}
