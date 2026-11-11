import type { GrowthJourney } from '@/domain/journey/types';
import { createId } from '@/shared/id';
import { todayIso } from '@/shared/date';
import type { DatabaseLike } from '../types';

type JourneyRow = {
  id: string;
  name: string;
  current_period_id: string | null;
  started_at: string;
  created_at: string;
  updated_at: string;
};

function mapJourney(row: JourneyRow): GrowthJourney {
  return {
    id: row.id,
    name: row.name,
    currentPeriodId: row.current_period_id,
    startedAt: row.started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getJourney(db: DatabaseLike): Promise<GrowthJourney | null> {
  const row = await db.getFirstAsync<JourneyRow>('SELECT * FROM growth_journey LIMIT 1');
  return row ? mapJourney(row) : null;
}

export async function ensureJourney(db: DatabaseLike): Promise<GrowthJourney> {
  const existing = await getJourney(db);
  if (existing) return existing;

  const id = createId('journey');
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO growth_journey
      (id, name, current_period_id, started_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?)`,
    id,
    '我的成长旅程',
    todayIso(),
    now,
    now,
  );

  return (await getJourney(db))!;
}

export async function setCurrentPeriod(
  db: DatabaseLike,
  journeyId: string,
  periodId: string,
): Promise<void> {
  const belongs = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM period WHERE id = ? AND journey_id = ?',
    periodId,
    journeyId,
  );
  if (!belongs) throw new Error('该阶段不属于当前成长旅程');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE period
       SET status = CASE WHEN status = 'PLANNED' THEN 'ACTIVE' ELSE status END
       WHERE id = ?`,
      periodId,
    );
    await db.runAsync(
      'UPDATE growth_journey SET current_period_id = ?, updated_at = ? WHERE id = ?',
      periodId,
      new Date().toISOString(),
      journeyId,
    );
  });
}
