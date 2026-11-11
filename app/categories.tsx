import { router } from 'expo-router';
import { useGrowthData } from '@/application/hooks/useGrowthData';
import { Screen } from '@/presentation/components/Screen';
import { Button } from '@/presentation/components/Button';
import { CategoryPicker } from '@/presentation/components/CategoryPicker';
export default function CategoriesScreen() {
  const growth = useGrowthData();
  return <Screen><Button label="返回我的" onPress={() => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  }} />
    {growth.journey ? <CategoryPicker store={growth.store} journeyId={growth.journey.id} manage disabled={growth.loading || !!growth.error} /> : null}
  </Screen>;
}
