import { useState } from 'react';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { CategoryApplicationService } from '@/application/categories/CategoryApplicationService';
import { useCategories } from '@/application/hooks/useCategories';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Field } from './Field';
import { ChoiceChip } from './ChoiceChip';
export function CategoryPicker({ store, journeyId, value = 'CUSTOM', onChange, disabled = false, manage = false }: {
  store: GrowthStore; journeyId: string; value?: string; onChange?: (id: string) => void; disabled?: boolean; manage?: boolean;
}) {
  const categories = useCategories(store,journeyId);
  const [name,setName] = useState(''); const [editing,setEditing] = useState<string | null>(null);
  const [busy,setBusy] = useState(false); const [error,setError] = useState<string | null>(null);
  const guard = usePageWriteGuard(disabled || busy || categories.loading || !!categories.error,store,journeyId);
  async function save(archiveId?: string) {
    try {
      guard(); setBusy(true); setError(null);
      if (!store.categories) throw new Error('分类存储不可用');
      const service = new CategoryApplicationService(store.categories);
      if (archiveId) await service.archive(journeyId,archiveId);
      else if (editing) await service.rename(journeyId,editing,name);
      else { const created = await service.create(journeyId,name); onChange?.(created.id); }
      setName(''); setEditing(null); categories.reload();
    } catch(error) { setError(error instanceof Error ? error.message : '分类保存未确认'); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <AppText variant="label">行动分类（可不选，与目标关联无关）</AppText>
    {categories.rows.filter(row => manage || row.status === 'ACTIVE').map(row => <View key={row.id}>
      <ChoiceChip label={row.name + (row.status === 'ARCHIVED' ? ' · 已归档' : '')} selected={value === row.id}
        onPress={() => { if (!disabled && !busy && !categories.loading && !categories.error && row.status === 'ACTIVE') onChange?.(row.id); }} />
      {manage && !row.system ? <>
        <Button label={'重命名：' + row.name} variant="quiet" disabled={disabled || busy} onPress={() => { setEditing(row.id); setName(row.name); }} />
        <Button label={'归档：' + row.name} variant="quiet" disabled={disabled || busy || row.status === 'ARCHIVED'} onPress={() => void save(row.id)} />
      </> : null}
    </View>)}
    <Field label={editing ? '新的分类名称' : '新建自定义分类'} value={name} onChangeText={setName} editable={!disabled && !busy} maxLength={80} />
    <Button label={editing ? '保存分类名称' : '保存新分类'} disabled={disabled || busy || categories.loading || !!categories.error || !name.trim()} onPress={() => void save()} />
    {error || categories.error ? <AppText>{error ?? categories.error}</AppText> : null}
  </View>;
}
