import { courseChangesSchema, createCourseSchema, type Course, type CourseChanges, type CreateCourseInput } from '@/domain/courses/types';

export interface CourseRepository {
  create(input: CreateCourseInput): Promise<Course>;
  getById(periodId: string, id: string): Promise<Course | null>;
  list(periodId: string): Promise<Course[]>;
  update(periodId: string, id: string, changes: CourseChanges): Promise<Course>;
  delete(periodId: string, id: string): Promise<void>;
}

export class CourseApplicationService {
  constructor(private readonly repository: CourseRepository) {}

  createCourse(input: CreateCourseInput) { return this.repository.create(createCourseSchema.parse(input)); }
  getCourse(periodId: string, id: string) { return this.repository.getById(periodId, id); }
  listCourses(periodId: string) { return this.repository.list(periodId); }
  updateCourse(periodId: string, id: string, changes: CourseChanges) {
    return this.repository.update(periodId, id, courseChangesSchema.parse(changes));
  }
  deleteCourse(periodId: string, id: string) { return this.repository.delete(periodId, id); }
}
