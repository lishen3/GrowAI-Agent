import { useGrowthData } from '@/application/hooks/useGrowthData';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { BackupPanel } from '@/presentation/components/BackupPanel';
import { useDemoControls } from '@/infrastructure/data/DemoContext';
import { Screen, ScreenSection } from '@/presentation/components/Screen';
import { Card, PageHeader, SectionHeader } from '@/presentation/components/ui/Layout';
import { calculatePeriodWeek, todayIso } from '@/shared/date';
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable } from 'react-native';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { LocalDataMaintenanceService } from '@/application/data/LocalDataMaintenanceService';


export default function ProfileScreen() {
  const demo = useDemoControls();
  const growth = useGrowthData();
  const { journey, periods, goals, currentPeriod } = growth;
  const [section, setSection] = useState<'privacy' | 'settings' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const clearLock = useRef(false);
  const assertWritable = usePageWriteGuard(growth.loading || !!growth.error || clearing, growth.store, growth.journey?.id ?? 'empty');
  const spaceName = demo?.active ? 'Demo' : '个人';
  const currentWeek = currentPeriod
    ? currentPeriod.currentWeekOverride ?? calculatePeriodWeek(
      currentPeriod.startDate, currentPeriod.endDate, todayIso(), currentPeriod.weekStartsOn,
    )
    : null;

  return <Screen>
    <PageHeader eyebrow="我的" title={journey?.name ?? '我的成长档案'} subtitle="数据保存在这台设备，不需要登录。" />

    <Card tone="soft">
      <AppText variant="eyebrow">当前阶段</AppText>
      <AppText variant="heading">{currentPeriod?.name ?? '还没有当前阶段'}</AppText>
      <AppText muted>{currentPeriod
        ? `${currentPeriod.startDate} — ${currentPeriod.endDate}${currentWeek ? ` · 第 ${currentWeek} 周` : ''}`
        : '先建立一个阶段，再安排每天的行动。'}</AppText>
    </Card>

    <Card>
      <Button label={`长期方向 · ${goals.length} 个目标`} variant="quiet" onPress={() => router.push('/goals')} />
      <Button label={`阶段管理 · ${periods.length} 个阶段`} variant="quiet" onPress={() => router.push('/period')} />
      <Button label="数据与隐私" variant="quiet" onPress={() => setSection(value => value === 'privacy' ? null : 'privacy')} />
      <Button label="设置与安装" variant="quiet" onPress={() => setSection(value => value === 'settings' ? null : 'settings')} />
    </Card>

    {section === 'privacy' ? <ScreenSection>
      <SectionHeader title="数据与隐私" subtitle="记录保存在本机；使用 AI 时会向已配置服务发送所需上下文。" />
      {demo?.active ? <Notice title="Demo 不提供备份导入或导出">
        演示数据与个人数据分开保存，个人记录不会与演示混用。
      </Notice> : <BackupPanel />}
    </ScreenSection> : null}

    {section === 'settings' ? <ScreenSection>
      <SectionHeader title="设置与安装" />
      <AppText muted>GrowAI智能体</AppText>
      <Button label="管理行动分类" variant="quiet" onPress={() => router.push('/categories')} />
      <SectionHeader title="安装到手机" subtitle="PWA 可以像 App 一样打开。" />
      <Notice title="使用 Safari 添加到主屏幕">
        打开 GrowAI 后，点 Safari 的分享按钮，选择“添加到主屏幕”，并保持“作为网页 App 打开”。
      </Notice>
    </ScreenSection> : null}
    {Platform.OS === 'web' && growth.store.clearLocalData ? <ScreenSection>
      <Pressable accessibilityRole="button" disabled={growth.loading || !!growth.error || clearing}
        onPress={() => { setConfirmClear(true); setClearError(null); }} style={{ minHeight: 48, justifyContent: 'center' }}>
        <AppText variant="label" style={{ color: '#a33232' }}>清空当前{spaceName}数据</AppText>
      </Pressable>
      {confirmClear ? <Card>
        <AppText variant="heading">确定清空当前{spaceName}数据？</AppText>
        <AppText>将清空此空间的所有任务、日程、目标、会话与复盘。此操作不可逆，请先备份。另一数据空间不受影响；安全控制信息与历史操作回执保留。</AppText>
        <Button label="确认清空当前数据" loading={clearing} disabled={growth.loading || !!growth.error} onPress={() => {
          const clear = async () => {
            if (clearLock.current) return;
            try {
              assertWritable(); clearLock.current = true; setClearing(true);
              await new LocalDataMaintenanceService(growth.store).clear();
              window.location.reload();
            } catch (error) { clearLock.current = false; setClearError(error instanceof Error ? error.message : '清空失败，数据未重置'); setClearing(false); }
          }; void clear();
        }} />
        <Button label="取消清空" variant="quiet" disabled={clearing} onPress={() => setConfirmClear(false)} />
      </Card> : null}
      {clearError ? <Notice title="清空未完成">{clearError}</Notice> : null}
    </ScreenSection> : null}
    {growth.error ? <ScreenSection><Notice title="档案读取失败">{growth.error}</Notice>
      <Button label="重新读取档案" onPress={() => void growth.reload()} /></ScreenSection> : null}
  </Screen>;
}
