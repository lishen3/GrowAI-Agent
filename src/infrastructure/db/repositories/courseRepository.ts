import type { CourseRepository } from '@/application/courses/CourseApplicationService';
import { courseChangesSchema, courseSchema, createCourseSchema, type Course } from '@/domain/courses/types';
import { createId } from '@/shared/id';
import type { DatabaseLike } from '../types';

type CourseRow = {
  id: string; period_id: string; name: string; weekday: number;
  start_time: string; end_time: string; valid_from: string; valid_until: string;
  teacher: string | null; location: string | null; weeks_json: string;
};

function parseWeeks(value: string): number[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => !Number.isInteger(item))) throw new Error('invalid weeks');
    return parsed.length ? parsed as number[] : undefined;
  } catch {
    throw new Error('课程周次数据损坏');
  }
}

function mapCourse(row: CourseRow): Course {
  return courseSchema.parse({
    id: row.id, periodId: row.period_id, name: row.name, weekday: row.weekday,
    startTime: row.start_time, endTime: row.end_time, validFrom: row.valid_from, validUntil: row.valid_until,
    teacher: row.teacher ?? undefined, location: row.location ?? undefined,
    weeks: parseWeeks(row.weeks_json ?? '[]'),
  });
}

export function createSQLiteCourseRepository(db: DatabaseLike): CourseRepository {
  async function checkPeriod(course: Omit<Course, 'id'>) {
    const period = await db.getFirstAsync<{ start_date: string; end_date: string }>(
      'SELECT start_date,end_date FROM period WHERE id = ?', course.periodId);
    if (!period) throw new Error('课程所属阶段不存在');
    if (course.validFrom < period.start_date || course.validUntil > period.end_date) {
      throw new Error('课程有效日期必须位于所属阶段范围内');
    }
  }
  async function get(periodId: string, id: string) {
    const row = await db.getFirstAsync<CourseRow>('SELECT * FROM course WHERE period_id = ? AND id = ?', periodId, id);
    return row ? mapCourse(row) : null;
  }
  return {
    async create(input) {
      const value = createCourseSchema.parse(input);
      const course = courseSchema.parse({ ...value, id: createId('course') });
      await db.withTransactionAsync(async () => {
        await checkPeriod(value);
        await db.runAsync(`INSERT INTO course
          (id,period_id,name,weekday,start_time,end_time,valid_from,valid_until,teacher,location,weeks_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, course.id, course.periodId, course.name, course.weekday,
        course.startTime, course.endTime, course.validFrom, course.validUntil,
        course.teacher ?? null, course.location ?? null, JSON.stringify(course.weeks ?? []));
      });
      return course;
    },
    getById: get,
    async list(periodId) {
      const rows = await db.getAllAsync<CourseRow>('SELECT * FROM course WHERE period_id = ? ORDER BY weekday,start_time,id', periodId);
      return rows.map(mapCourse);
    },
    async update(periodId, id, changes) {
      const parsed = courseChangesSchema.parse(changes);
      const current = await get(periodId, id);
      if (!current) throw new Error('课程不存在');
      const course = courseSchema.parse({ ...current, ...parsed });
      const { id: _id, ...value } = course;
      await db.withTransactionAsync(async () => {
        await checkPeriod(value);
        await db.runAsync(`UPDATE course SET name=?,weekday=?,start_time=?,end_time=?,valid_from=?,valid_until=?,
          teacher=?,location=?,weeks_json=? WHERE id=? AND period_id=?`, course.name, course.weekday, course.startTime,
        course.endTime, course.validFrom, course.validUntil, course.teacher ?? null, course.location ?? null,
        JSON.stringify(course.weeks ?? []), id, periodId);
      });
      return course;
    },
    async delete(periodId, id) {
      if (!await get(periodId, id)) throw new Error('课程不存在');
      await db.runAsync('DELETE FROM course WHERE id = ? AND period_id = ?', id, periodId);
    },
  };
}
