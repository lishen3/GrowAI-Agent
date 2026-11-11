import { courseSchema, type Course } from '@/domain/courses/types';
import { isoDateSchema } from '@/domain/tasks/dateOnly';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { calculatePeriodWeek } from '@/shared/date';

export type ProjectedCourseOccurrence = ScheduleEvent & { courseId: string };

export type CourseWeekOptions = {
  /** Period start date, required when a Course carries explicit semester week numbers. */
  periodStart?: string;
  weekStartsOn?: 1 | 7;
};

function dateOrdinal(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function isoWeekday(value: string): number {
  const weekday = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function projectCoursesForWeek(
  courses: Course[],
  weekStart: string,
  weekEnd: string,
  options: CourseWeekOptions = {},
): ProjectedCourseOccurrence[] {
  isoDateSchema.parse(weekStart);
  isoDateSchema.parse(weekEnd);
  const start = dateOrdinal(weekStart);
  const end = dateOrdinal(weekEnd);
  if (end < start || end - start > 6 * 24 * 60 * 60 * 1000) throw new Error('周查询必须在七天范围内');
  const validCourses = courseSchema.array().parse(courses);
  if (validCourses.some((course) => course.weeks?.length && !options.periodStart)) {
    throw new Error('课程含学期周次，但缺少阶段起始日期，无法投影本周课程');
  }
  const events: ProjectedCourseOccurrence[] = [];
  for (const course of validCourses) {
    for (let ordinal = start; ordinal <= end; ordinal += 24 * 60 * 60 * 1000) {
      const date = isoDate(ordinal);
      if (date < course.validFrom || date > course.validUntil || isoWeekday(date) !== course.weekday) continue;
      if (course.weeks?.length) {
        const weekIndex = calculatePeriodWeek(
          options.periodStart!, course.validUntil, date, options.weekStartsOn ?? 1,
        );
        if (!course.weeks.includes(weekIndex)) continue;
      }
      events.push({ id: `course:${course.id}:${date}`, courseId: course.id, periodId: course.periodId, taskId: null,
        type: 'COURSE', title: course.name, date, startTime: course.startTime, endTime: course.endTime, source: 'SYSTEM' });
    }
  }
  return events.sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
}
