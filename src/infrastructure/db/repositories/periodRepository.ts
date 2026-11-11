import type { CreatePeriodInput, Period } from '@/domain/periods/types';
import { validatePeriodInput } from '@/domain/periods/rules';
import { createId } from '@/shared/id';
import type { DatabaseLike } from '../types';

type PeriodRow = {
  id: string;
  journey_id: string;
  name: string;
  type: Period['type'];
  start_date: string;
  end_date: string;
  status: Period['status'];
  description: string | null;
  week_starts_on: 1 | 7;
  current_week_override: number | null;
  created_at: string;
  completed_at: string | null;
};

function mapPeriod(row: PeriodRow): Period {
  return {
    id: row.id,
    journeyId: row.journey_id,
    name: row.name,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    description: row.description,
    weekStartsOn: row.week_starts_on,
    currentWeekOverride: row.current_week_override,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function listPeriods(db: DatabaseLike, journeyId: string): Promise<Period[]> {
  const rows = await db.getAllAsync<PeriodRow>(
    `SELECT * FROM period
     WHERE journey_id = ?
     ORDER BY start_date DESC, created_at DESC`,
    journeyId,
  );
  return rows.map(mapPeriod);
}

export async function getPeriod(db: DatabaseLike, periodId: string): Promise<Period | null> {
  const row = await db.getFirstAsync<PeriodRow>('SELECT * FROM period WHERE id = ?', periodId);
  return row ? mapPeriod(row) : null;
}

export async function createPeriod(db: DatabaseLike, input: CreatePeriodInput): Promise<Period> {
  const errors = validatePeriodInput(input);
  if (errors.length) throw new Error(errors[0]);

  const journey = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM growth_journey WHERE id = ?',
    input.journeyId,
  );
  if (!journey) throw new Error('成长旅程不存在');

  const id = createId('period');
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO period
      (id, journey_id, name, type, start_date, end_date, status, description,
       week_starts_on, current_week_override, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PLANNED', ?, 1, NULL, ?, NULL)`,
    id,
    input.journeyId,
    input.name.trim(),
    input.type,
    input.startDate,
    input.endDate,
    input.description?.trim() || null,
    now,
  );

  return (await getPeriod(db, id))!;
}
