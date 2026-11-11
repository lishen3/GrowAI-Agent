import { categoryRegistrySQL } from './repositories/categoryRepository';
import type { DatabaseLike } from './types';

type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'long_term_growth_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS growth_journey (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        current_period_id TEXT REFERENCES period(id),
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS period (
        id TEXT PRIMARY KEY NOT NULL,
        journey_id TEXT NOT NULL REFERENCES growth_journey(id),
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('SEMESTER','WINTER_BREAK','SUMMER_BREAK','INTERNSHIP','EXAM','JOB_SEARCH','CUSTOM')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PLANNED','ACTIVE','COMPLETED')),
        description TEXT,
        week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK(week_starts_on IN (1,7)),
        current_week_override INTEGER CHECK(current_week_override IS NULL OR current_week_override > 0),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        CHECK(date(end_date) >= date(start_date))
      );

      CREATE TABLE IF NOT EXISTS long_term_goal (
        id TEXT PRIMARY KEY NOT NULL,
        journey_id TEXT NOT NULL REFERENCES growth_journey(id),
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK(category IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM')),
        start_date TEXT NOT NULL,
        target_description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS period_goal (
        id TEXT PRIMARY KEY NOT NULL,
        period_id TEXT NOT NULL REFERENCES period(id),
        long_term_goal_id TEXT REFERENCES long_term_goal(id),
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL CHECK(priority IN ('S','A','B','C')),
        status TEXT NOT NULL CHECK(status IN ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
        success_criteria TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS weekly_goal (
        id TEXT PRIMARY KEY NOT NULL,
        period_id TEXT NOT NULL REFERENCES period(id),
        period_goal_id TEXT NOT NULL REFERENCES period_goal(id),
        week_index INTEGER NOT NULL CHECK(week_index > 0),
        title TEXT NOT NULL,
        success_criteria TEXT,
        status TEXT NOT NULL CHECK(status IN ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS ix_period_journey_dates ON period(journey_id, start_date, end_date);
      CREATE INDEX IF NOT EXISTS ix_long_term_goal_journey_status ON long_term_goal(journey_id, status);
      CREATE INDEX IF NOT EXISTS ix_period_goal_period_status ON period_goal(period_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_goal_period_week_title ON weekly_goal(period_id, week_index, title);
    `,
  },
  {
    version: 2,
    name: 'phase_2a_planning_goal_fields',
    sql: `
      ALTER TABLE period_goal ADD COLUMN category TEXT NOT NULL DEFAULT 'CUSTOM'
        CHECK(category IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW'));
      ALTER TABLE period_goal ADD COLUMN learning_path_json TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE weekly_goal ADD COLUMN description TEXT;
      ALTER TABLE weekly_goal ADD COLUMN category TEXT NOT NULL DEFAULT 'CUSTOM'
        CHECK(category IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW'));
      ALTER TABLE weekly_goal ADD COLUMN priority TEXT NOT NULL DEFAULT 'B'
        CHECK(priority IN ('S','A','B','C'));
      ALTER TABLE weekly_goal ADD COLUMN target_value REAL CHECK(target_value IS NULL OR target_value >= 0);
      ALTER TABLE weekly_goal ADD COLUMN target_unit TEXT;

      CREATE INDEX IF NOT EXISTS ix_weekly_goal_period_week
        ON weekly_goal(period_id, week_index, status);
    `,
  },
  {
    version: 3,
    name: 'phase_a_execution_loop',
    sql: `
      CREATE TABLE IF NOT EXISTS task (
        id TEXT PRIMARY KEY NOT NULL,
        period_id TEXT NOT NULL REFERENCES period(id),
        period_goal_id TEXT REFERENCES period_goal(id),
        weekly_goal_id TEXT REFERENCES weekly_goal(id),
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK(category IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW')),
        priority TEXT NOT NULL CHECK(priority IN ('S','A','B','C')),
        status TEXT NOT NULL CHECK(status IN ('TODO','DOING','DONE','DELAYED','CANCELLED')),
        planned_date TEXT,
        estimated_minutes INTEGER CHECK(estimated_minutes IS NULL OR estimated_minutes >= 0),
        deadline TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_execution (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES task(id),
        started_at TEXT,
        completed_at TEXT NOT NULL,
        planned_minutes_snapshot INTEGER CHECK(planned_minutes_snapshot IS NULL OR planned_minutes_snapshot >= 0),
        actual_minutes INTEGER CHECK(actual_minutes IS NULL OR actual_minutes >= 0),
        completion_note TEXT,
        learned TEXT,
        result TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS achievement (
        id TEXT PRIMARY KEY NOT NULL,
        journey_id TEXT NOT NULL REFERENCES growth_journey(id),
        period_id TEXT REFERENCES period(id),
        source_type TEXT NOT NULL CHECK(source_type IN ('TASK')),
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK(category IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW')),
        occurred_at TEXT NOT NULL,
        planned_duration_snapshot INTEGER CHECK(planned_duration_snapshot IS NULL OR planned_duration_snapshot >= 0),
        actual_duration INTEGER CHECK(actual_duration IS NULL OR actual_duration >= 0),
        summary TEXT,
        result TEXT,
        is_milestone INTEGER NOT NULL DEFAULT 0 CHECK(is_milestone IN (0,1)),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ix_task_period_date ON task(period_id, planned_date);
      CREATE INDEX IF NOT EXISTS ix_task_weekly_goal ON task(weekly_goal_id);
      CREATE INDEX IF NOT EXISTS ix_task_execution_task ON task_execution(task_id);
      CREATE INDEX IF NOT EXISTS ix_achievement_journey_time ON achievement(journey_id, occurred_at);
      CREATE INDEX IF NOT EXISTS ix_achievement_period_time ON achievement(period_id, occurred_at);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_achievement_task_source
        ON achievement(source_type, source_id) WHERE source_type = 'TASK';
    `,
  },
  {
    version: 4,
    name: 'phase_e_memory_reflection',
    sql: `
      CREATE TABLE reflection (
        id TEXT PRIMARY KEY NOT NULL,
        journey_id TEXT NOT NULL REFERENCES growth_journey(id),
        period_id TEXT NOT NULL REFERENCES period(id),
        record_json TEXT NOT NULL
      );
      CREATE TABLE memory (
        id TEXT PRIMARY KEY NOT NULL,
        journey_id TEXT NOT NULL REFERENCES growth_journey(id),
        type TEXT NOT NULL CHECK(type IN ('PREFERENCE','PATTERN','STRATEGY','CONSTRAINT','LESSON')),
        normalized_content TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(journey_id, type, normalized_content)
      );
      CREATE INDEX ix_reflection_journey ON reflection(journey_id);
    `,
  },
  {
    version: 5,
    name: 'scheduling_foundation',
    sql: `CREATE TABLE schedule_event (
      id TEXT PRIMARY KEY NOT NULL,
      period_id TEXT NOT NULL REFERENCES period(id),
      task_id TEXT REFERENCES task(id),
      date TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX ix_schedule_period_date ON schedule_event(period_id,date);`,
  },
  {
    version: 6,
    name: 'course_recurrence_foundation',
    sql: `CREATE TABLE course (
      id TEXT PRIMARY KEY NOT NULL,
      period_id TEXT NOT NULL REFERENCES period(id),
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      CHECK(start_time < end_time),
      CHECK(date(valid_from) IS NOT NULL AND date(valid_until) IS NOT NULL AND date(valid_from) <= date(valid_until))
    );
    CREATE INDEX ix_course_period_weekday_time ON course(period_id,weekday,start_time);`,
  },
  {
    version: 7,
    name: 'course_semester_import_fields',
    sql: `ALTER TABLE course ADD COLUMN teacher TEXT;
      ALTER TABLE course ADD COLUMN location TEXT;
      ALTER TABLE course ADD COLUMN weeks_json TEXT NOT NULL DEFAULT '[]';`,
  },
  { version: 8, name: 'local_agent_conversations', sql: `
    CREATE TABLE agent_conversation (
      id TEXT PRIMARY KEY NOT NULL,
      journey_id TEXT NOT NULL,
      period_id TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX ix_conversation_scope ON agent_conversation(journey_id,period_id);
  ` },
  { version: 9, name: 'dynamic_action_categories', sql: categoryRegistrySQL + `
    ALTER TABLE task ADD COLUMN category_id TEXT;
    ALTER TABLE achievement ADD COLUMN category_id TEXT;
    UPDATE task SET category_id=category;
    UPDATE achievement SET category_id=category;
    CREATE TRIGGER category_no_delete BEFORE DELETE ON action_category BEGIN SELECT RAISE(ABORT,'archive categories instead'); END;
    CREATE TRIGGER task_category_insert BEFORE INSERT ON task WHEN NEW.category_id IS NOT NULL AND NEW.category_id NOT IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW','STUDY_GROWTH') BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM action_category c JOIN period p ON p.journey_id=c.journey_id WHERE p.id=NEW.period_id AND c.id=NEW.category_id AND json_extract(c.record_json,'$.status')='ACTIVE') THEN RAISE(ABORT,'unregistered task category') END;
    END;
    CREATE TRIGGER task_category_update BEFORE UPDATE OF category_id ON task WHEN NEW.category_id IS NOT OLD.category_id AND NEW.category_id IS NOT NULL AND NEW.category_id NOT IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW','STUDY_GROWTH') BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM action_category c JOIN period p ON p.journey_id=c.journey_id WHERE p.id=NEW.period_id AND c.id=NEW.category_id AND json_extract(c.record_json,'$.status')='ACTIVE') THEN RAISE(ABORT,'unregistered task category') END;
    END;
    CREATE TRIGGER achievement_category_insert BEFORE INSERT ON achievement WHEN NEW.category_id IS NOT NULL AND NEW.category_id NOT IN ('ENGLISH','PROFESSIONAL','CAREER','PROJECT','FITNESS','COURSE','LIFE','CUSTOM','INTERNSHIP','REVIEW','STUDY_GROWTH') BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM action_category c WHERE c.journey_id=NEW.journey_id AND c.id=NEW.category_id) THEN RAISE(ABORT,'unregistered achievement category') END;
    END;
  ` },
  { version: 10, name: 'personal_event_completion', sql: `
    UPDATE schedule_event SET record_json=json_set(record_json,'$.completed',json('false'))
    WHERE json_extract(record_json,'$.type')='PERSONAL' AND json_extract(record_json,'$.completed') IS NULL;
  ` },
  { version: 11, name: 'optional_goal_planning', sql: `ALTER TABLE long_term_goal ADD COLUMN planning_json TEXT;` },
];

export async function migrateDatabase(db: DatabaseLike): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    const applied = await db.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_migration WHERE version = ?',
      migration.version,
    );

    if (applied) continue;

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
  }
}
