import { categoryIdSchema, categoryNameSchema, type CategoryRepository } from '@/domain/categories/types';

export class CategoryApplicationService {
  constructor(private readonly repository: CategoryRepository) {}
  list(journeyId: string) { return this.repository.list(journeyId); }
  async create(journeyId: string, name: string) { return this.repository.create(journeyId, categoryNameSchema.parse(name)); }
  async rename(journeyId: string, id: string, name: string) {
    return this.repository.update(journeyId, categoryIdSchema.parse(id), { name: categoryNameSchema.parse(name) });
  }
  async archive(journeyId: string, id: string) {
    return this.repository.update(journeyId, categoryIdSchema.parse(id), { status: 'ARCHIVED' });
  }
  async requireActive(journeyId: string, id: string) {
    categoryIdSchema.parse(id);
    const category = (await this.repository.list(journeyId)).find(row => row.id === id);
    if (!category || category.status !== 'ACTIVE') throw new Error('分类不存在或已归档');
    return category;
  }
}
