import type { CourseRepository } from '@/application/courses/CourseApplicationService';
import type { ParsedCourseDraft } from '@/domain/courses/parseCourseTableHtml';
import { mapCourseTeachingWeeks } from '@/domain/courses/courseTeachingWeeks';
import type { Course } from '@/domain/courses/types';
import type { Period } from '@/domain/periods/types';
import { calculatePeriodWeek } from '@/shared/date';

export type CourseImportResult = {
  created: Course[];
  skipped: number;
  outsidePeriod: number;
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
};

function courseKey(course: Omit<Course, 'id'>): string {
  return JSON.stringify([course.name.trim(), course.weekday, course.startTime, course.endTime,
    course.teacher?.trim() || '', course.location?.trim() || '', course.validFrom, course.validUntil,
    [...(course.weeks ?? [])].sort((a, b) => a - b)]);
}

export class CourseImportService {
  constructor(private readonly courses: CourseRepository) {}

  async import(period: Period, drafts: ParsedCourseDraft[], assertWritable?: () => void, firstTeachingMonday?: string): Promise<CourseImportResult> {
    const totalWeeks = calculatePeriodWeek(
      period.startDate, period.endDate, period.endDate, period.weekStartsOn,
    );
    const existing = await this.courses.list(period.id);
    const seen = new Set(existing.map(courseKey));
    const created: Course[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    let skipped = 0;
    let outsidePeriod = 0;
    let clippedWeeks = 0;
    for (const draft of drafts) {
      assertWritable?.();
      const weeks = firstTeachingMonday
        ? mapCourseTeachingWeeks(period, draft.weekday, firstTeachingMonday, draft.weeks).weeks
        : draft.weeks.filter((week) => week >= 1 && week <= totalWeeks);
      clippedWeeks += draft.weeks.length - weeks.length;
      if (draft.weeks.length && !weeks.length) {
        skipped += 1;
        outsidePeriod += 1;
        continue;
      }
      const input = {
        periodId: period.id,
        name: draft.name.trim(),
        teacher: draft.teacher?.trim() || undefined,
        location: draft.location?.trim() || undefined,
        weekday: draft.weekday,
        startTime: draft.startTime,
        endTime: draft.endTime,
        validFrom: firstTeachingMonday && firstTeachingMonday > period.startDate ? firstTeachingMonday : period.startDate,
        validUntil: period.endDate,
        weeks: weeks.length ? weeks : undefined,
      };
      if (seen.has(courseKey(input))) { skipped += 1; continue; }
      try {
        const course = await this.courses.create(input);
        seen.add(courseKey(course));
        created.push(course);
      } catch (error) {
        failed.push({ name: draft.name, error: error instanceof Error ? error.message : '导入失败' });
      }
    }
    const warnings: string[] = [];
    if (clippedWeeks > 0) {
      warnings.push(`部分课程的周次超出当前阶段（共 ${totalWeeks} 周），超出部分已忽略`);
    }
    return { created, skipped, outsidePeriod, failed, warnings };
  }
}
