import { useGrowthData } from '@/application/hooks/useGrowthData';
import { PERIOD_TYPES, PERIOD_TYPE_LABELS, type PeriodType } from '@/domain/periods/types';
import { todayIso } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { PeriodRow } from '@/presentation/components/PeriodRow';
import { Screen, ScreenSection } from '@/presentation/components/Screen';
import { Card, EmptyState, PageHeader, SectionHeader } from '@/presentation/components/ui/Layout';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

function dateMonthsFromNow(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return todayIso(date);
}

export default function PeriodScreen() {
  const { store, journey, periods, currentPeriod, error, reload } = useGrowthData();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<PeriodType>('SEMESTER');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(dateMonthsFromNow(4));
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!journey) return;
    try {
      setSaving(true);
      const created = await store.createPeriod({ journeyId: journey.id, name, type, startDate, endDate, description });
      if (!journey.currentPeriodId) await store.setCurrentPeriod(journey.id, created.id);
      setName(''); setDescription(''); setShowForm(false);
      await reload();
    } catch (caught) {
      Alert.alert('无法创建阶段', caught instanceof Error ? caught.message : '请稍后重试');
    } finally { setSaving(false); }
  }

  async function makeCurrent(periodId: string, completed: boolean) {
    if (!journey || completed || journey.currentPeriodId === periodId) return;
    try {
      await store.setCurrentPeriod(journey.id, periodId);
      await reload();
    } catch (caught) {
      Alert.alert('无法切换阶段', caught instanceof Error ? caught.message : '请稍后重试');
    }
  }

  return <Screen>
    <PageHeader eyebrow="阶段" title="这段时间，专注什么" subtitle="学期、假期、实习期都会保留在同一条成长旅程里。" />

    {error ? <Notice title="读取失败">{error}</Notice> : null}

    <ScreenSection>
      <SectionHeader title={currentPeriod ? '当前阶段' : '开始新的阶段'}
        subtitle={currentPeriod?.name ?? '先建立第一个阶段'}
        action={<Button label={showForm ? '收起' : '＋ 新建'} variant="quiet" onPress={() => setShowForm((value) => !value)} />} />
      {showForm ? <Card>
        <Field label="阶段名称" value={name} onChangeText={setName} placeholder="例如：2026 大三上" maxLength={80} />
        <AppText variant="label">阶段类型</AppText>
        <View style={styles.chips}>{PERIOD_TYPES.map((item) => <ChoiceChip key={item}
          label={PERIOD_TYPE_LABELS[item]} selected={type === item} onPress={() => setType(item)} />)}</View>
        <View style={styles.dates}>
          <View style={styles.grow}><Field label="开始日期" value={startDate} onChangeText={setStartDate} maxLength={10} /></View>
          <View style={styles.grow}><Field label="结束日期" value={endDate} onChangeText={setEndDate} maxLength={10} /></View>
        </View>
        <Field label="阶段说明（可选）" value={description} onChangeText={setDescription} multiline
          placeholder="这一阶段为什么重要？" />
        <Button label="保存阶段" onPress={() => void submit()} loading={saving} disabled={saving || !name.trim()} />
      </Card> : null}
    </ScreenSection>

    <ScreenSection>
      <SectionHeader title="全部阶段" subtitle={`${periods.length} 个`} />
      {periods.length ? periods.map((period) => <PeriodRow key={period.id} period={period}
        current={journey?.currentPeriodId === period.id}
        onMakeCurrent={() => void makeCurrent(period.id, period.status === 'COMPLETED')} />) : (
        <EmptyState title="阶段历史会一直保留" body="完成一个阶段不会删除数据。未来的寒假、实习期、求职期都可以继续连接同一条成长旅程。"
          actionLabel="新建阶段" onAction={() => setShowForm(true)} />
      )}
    </ScreenSection>
  </Screen>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dates: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
