import { router } from 'expo-router';
import { useGrowthData } from '@/application/hooks/useGrowthData';
import { Screen } from '@/presentation/components/Screen';
import { PageHeader } from '@/presentation/components/ui/Layout';
import { Button } from '@/presentation/components/Button';
import { LongTermGoalsPanel } from '@/presentation/components/LongTermGoalsPanel';
export default function GoalsScreen() {
  const growth = useGrowthData();
  return <Screen>
    <Button label="返回我的" variant="quiet" onPress={() => {
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
    }} />
    <PageHeader eyebrow="长期方向" title="目标与真实进展" subtitle="不把预计投入当作实际用时，不用虚假百分比表示成长。" />
    <LongTermGoalsPanel growth={growth} />
  </Screen>;
}
