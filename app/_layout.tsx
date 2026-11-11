import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DataProvider } from '@/infrastructure/data/DataProvider';
import { PwaLifecycle } from '@/presentation/components/PwaLifecycle';
import { useTheme } from '@/presentation/theme/tokens';

function BootScreen() {
  const theme = useTheme();
  return (
    <View style={[styles.boot, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="small" color={theme.primary} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Suspense fallback={<BootScreen />}>
        <DataProvider>
          <PwaLifecycle />
          <Head><title>GrowAI智能体</title></Head>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </DataProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
