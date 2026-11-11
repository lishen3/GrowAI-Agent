import type { CourseRepository } from '@/application/courses/CourseApplicationService';
import { courseChangesSchema, courseSchema, createCourseSchema, type Course } from '@/domain/courses/types';
import { createId } from '@/shared/id';
import { beginBusinessWrite } from './webLifecycle';

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export function createWebCourseRepository(db: IDBDatabase): CourseRepository {
  async function write<T>(work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = await beginBusinessWrite(db, ['courses', 'periods']);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('课程事务失败'));
    });
    try { const result = await work(tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch { /* already closed */ } await done.catch(() => undefined); throw error; }
  }
  async function get(periodId: string, id: string) {
    const course = await read<Course | undefined>(db.transaction('courses', 'readonly').objectStore('courses').get(id));
    return course?.periodId === periodId ? courseSchema.parse(course) : null;
  }
  async function checkPeriod(tx: IDBTransaction, course: Omit<Course, 'id'>) {
    const period = await read<{ id: string; startDate: string; endDate: string } | undefined>(tx.objectStore('periods').get(course.periodId));
    if (!period) throw new Error('课程所属阶段不存在');
    if (course.validFrom < period.startDate || course.validUntil > period.endDate) {
      throw new Error('课程有效日期必须位于所属阶段范围内');
    }
  }
  return {
    async create(input) {
      const value = createCourseSchema.parse(input);
      const course = courseSchema.parse({ ...value, id: createId('course') });
      return write(async (tx) => { await checkPeriod(tx, value); await read(tx.objectStore('courses').add(course)); return course; });
    },
    getById: get,
    async list(periodId) {
      const rows = await read<Course[]>(db.transaction('courses', 'readonly').objectStore('courses').index('periodId').getAll(periodId));
      return rows.map((course) => courseSchema.parse(course)).sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
    },
    async update(periodId, id, changes) {
      const parsed = courseChangesSchema.parse(changes);
      return write(async (tx) => {
        const store = tx.objectStore('courses');
        const current = await read<Course | undefined>(store.get(id));
        if (!current || current.periodId !== periodId) throw new Error('课程不存在');
        const course = courseSchema.parse({ ...current, ...parsed });
        const { id: _id, ...value } = course;
        await checkPeriod(tx, value);
        await read(store.put(course));
        return course;
      });
    },
    async delete(periodId, id) {
      return write(async (tx) => {
        const store = tx.objectStore('courses');
        const current = await read<Course | undefined>(store.get(id));
        if (!current || current.periodId !== periodId) throw new Error('课程不存在');
        courseSchema.parse(current);
        await read(store.delete(id));
      });
    },
  };
}
