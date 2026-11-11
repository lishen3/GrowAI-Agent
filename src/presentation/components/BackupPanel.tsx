import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Notice } from './Notice';
import { useTheme } from '../theme/tokens';

function backupFilename() {
  return `growai-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export function BackupPanel() {
  const theme = useTheme();
  const store = useGrowthStore();
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    if (Platform.OS !== 'web') return;
    setBusy(true);
    try {
      const snapshot = await store.exportSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFilename();
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      Alert.alert('导出失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup() {
    if (Platform.OS !== 'web' || !store.importSnapshot) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!window.confirm('恢复会覆盖计划和执行数据，合并记忆与复盘。会话、待确认建议和执行回执不在备份内，原建议将失效。继续恢复？')) return;
      setBusy(true);
      try {
        const snapshot = JSON.parse(await file.text());
        await store.importSnapshot?.(snapshot);
        window.alert('备份已恢复，GrowAI 将重新载入。');
        window.location.reload();
      } catch (error) {
        window.alert(`恢复失败：${error instanceof Error ? error.message : '文件内容无效'}`);
        setBusy(false);
      }
    };
    input.click();
  }

  if (Platform.OS !== 'web') {
    return <Notice title="数据保存在这台手机">原生版使用 SQLite 本地保存。网页备份功能可在 PWA 版本中使用。</Notice>;
  }

  return (
    <View style={styles.stack}>
      <Notice title="数据保存在这台设备">
        备份包含计划、执行、记忆和复盘。会话、待确认建议和执行回执仅保存在当前设备。删除网站数据前请先导出。
      </Notice>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={exportBackup}
          style={({ pressed }) => [styles.button, { borderColor: theme.text, opacity: pressed || busy ? 0.55 : 1 }]}
        >
          <AppText variant="label">导出 JSON 备份</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={restoreBackup}
          style={({ pressed }) => [styles.button, { borderColor: theme.border, opacity: pressed || busy ? 0.55 : 1 }]}
        >
          <AppText variant="label" muted>从备份恢复</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 999 },
});
