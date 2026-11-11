import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTheme } from '@/presentation/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icons: Record<string, { active: IconName; idle: IconName }> = {
  today: { active: 'sunny', idle: 'sunny-outline' },
  plan: { active: 'calendar', idle: 'calendar-outline' },
  coach: { active: 'chatbubble', idle: 'chatbubble-outline' },
  profile: { active: 'person', idle: 'person-outline' },
};

export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: theme.tab,
          borderTopColor: theme.border,
          height: 62,
          paddingTop: 7,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
        tabBarIcon: ({ color, size, focused }) => {
          const icon = icons[route.name] ?? icons.today;
          return <Ionicons name={focused ? icon.active : icon.idle} size={size} color={color as string} />;
        },
      })}
    >
      <Tabs.Screen name="today" options={{ title: '今日' }} />
      <Tabs.Screen name="plan" options={{ title: '计划' }} />
      <Tabs.Screen name="coach" options={{ title: '智能体' }} />
      <Tabs.Screen name="profile" options={{ title: '我的' }} />
      <Tabs.Screen name="period" options={{ href: null }} />
      <Tabs.Screen name="growth" options={{ href: null }} />
      <Tabs.Screen name="projects" options={{ href: null }} />
    </Tabs>
  );
}
