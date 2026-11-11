import type { PropsWithChildren } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { seedConfirmedInitialPlan } from '@/application/data/confirmedInitialPlan';
import { AppText } from '@/presentation/components/AppText';
import { useTheme } from '@/presentation/theme/tokens';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DataContext } from './DataContext';
import { createWebGrowthStore, ensureWebJourney, openWebDatabase, type WebDataSpace } from './webDatabase';
import { ensureDemoDatabase, resetDemoDatabase } from './demoDatabase';
import { DemoContext } from './DemoContext';
import { acquireDemoSession } from './demoSession';
import { Button } from '@/presentation/components/Button';
import { createId } from '@/shared/id';
import { readSpaceMetadata, isBusinessConnectionCurrent, subscribeSpaceChanges } from './webLifecycle';
import { createWebTimeOperations } from './webTimeOperations';
import { TimeOperationsContext } from './TimeOperationsContext';
import type { TimeOperationAdapter } from '@/application/replan/TimeOperationAdapter';
import { bindReflectionStore } from '@/application/reflection/backgroundReflection';
import { CreationDraftContext } from '@/application/hooks/useCreationDraft';

type Selection = { space: WebDataSpace; reset: boolean; revision: number };
const SESSION_KEY = 'growai-data-space';

export function WebDataProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  const [store, setStore] = useState<GrowthStore | null>(null);
  const [timeOperations, setTimeOperations] = useState<TimeOperationAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const previousSession = useRef<Promise<void>>(Promise.resolve());
  const [sessionId] = useState(() => createId('demo_session'));
  const currentRevision = useRef(0);
  const providerAlive = useRef(true);
  const reflectionSpaces = useRef(new Map<WebDataSpace, { identity: string; scopes: Parameters<typeof bindReflectionStore>[1] }>());
  const drafts = useRef(new Map<string, Record<string, string | boolean>>());
  const [draftIdentity, setDraftIdentity] = useState('');

  useEffect(() => {
    let space: WebDataSpace = 'personal';
    try { if (sessionStorage.getItem(SESSION_KEY) === 'demo') space = 'demo'; } catch { /* private browsing: personal by default */ }
    setSelection({ space, reset: false, revision: 0 });
  }, []);

  function select(space: WebDataSpace, reset = false) {
    currentRevision.current++;
    setStore(null); setTimeOperations(null); setError(null);
    try { sessionStorage.setItem(SESSION_KEY, space); } catch { /* switching still works without persistence */ }
    setSelection((previous) => ({ space, reset, revision: (previous?.revision ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!selection) return;
    let active = true;
    let connection: IDBDatabase | null = null;
    let releaseSession: (() => Promise<void>) | null = null;
    let unsubscribe: (() => void) | null = null;
    let detachReflections: (() => void) | undefined;
    let stopFocusCheck: (() => void) | null = null;
    let invalidating = false;
    let dispose!: () => void;
    const disposed = new Promise<void>((resolve) => { dispose = resolve; });
    const previous = previousSession.current;
    // Cleanup cannot await in React. The next effect waits for this lifecycle,
    // including pending initialization, DB work and actual Web Lock release.
    previousSession.current = (async () => {
      await previous;
      if (!active) return;
      try {
        if (selection.space === 'demo') {
          releaseSession = await acquireDemoSession();
          if (!active) return;
        }
        const db = await openWebDatabase(selection.space);
        connection = db;
        if (!active) return;
        if (selection.space === 'demo') {
          if (selection.reset) await resetDemoDatabase(db);
          else { await ensureDemoDatabase(db); await ensureWebJourney(db); }
        } else await ensureWebJourney(db);
        if ((await readSpaceMetadata(db)).state !== 'READY') throw new Error('数据空间尚未就绪，已禁止写入');
        const growthStore = createWebGrowthStore(db);
        if (selection.space === 'personal' && !(await readSpaceMetadata(db)).suppressInitialSeed) {
          try { await seedConfirmedInitialPlan(growthStore); }
          catch (error) { console.error('GrowAI 初始规划导入失败，已保留现有数据。', error); }
        }
        if ((await readSpaceMetadata(db)).state !== 'READY') throw new Error('初始化期间数据空间已变化，请重试或显式恢复');
        const refreshIfStale = () => {
          void isBusinessConnectionCurrent(db).then(current => {
            if (active && !current && !invalidating) { invalidating = true; select(selection.space); }
          }).catch(() => { if (active && !invalidating) { invalidating = true; select(selection.space); } });
        };
        unsubscribe = subscribeSpaceChanges(db, refreshIfStale);
        if (typeof window !== 'undefined') {
          window.addEventListener('focus', refreshIfStale);
          stopFocusCheck = () => window.removeEventListener('focus', refreshIfStale);
        }
        refreshIfStale();
        if (active) {
          const metadata = await readSpaceMetadata(db);
          if (!active) return;
          const identity = JSON.stringify([selection.space, metadata.databaseInstanceId, metadata.epoch]);
          let entry = reflectionSpaces.current.get(selection.space);
          if (entry?.identity !== identity) {
            entry = { identity, scopes: new Map() };
            reflectionSpaces.current.set(selection.space, entry);
          }
          detachReflections = bindReflectionStore(growthStore, entry.scopes);
          setDraftIdentity(identity);
          setTimeOperations(selection.space === 'personal' ? createWebTimeOperations(db) : null);
          setStore(growthStore);
        }
        await disposed;
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : '无法初始化本地数据');
      } finally {
        detachReflections?.();
        unsubscribe?.();
        stopFocusCheck?.();
        connection?.close();
        await releaseSession?.();
      }
    })();
    return () => { active = false; dispose(); };
  }, [selection]);

  useEffect(() => { providerAlive.current = true; return () => { providerAlive.current = false; }; }, []);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <AppText variant="heading">本地数据无法启动</AppText>
        <AppText muted>{error}</AppText>
        {selection?.space === 'demo' && selection.reset ? <AppText muted>重试会重建演示样本，不影响个人数据。</AppText> : null}
        <Button label="重试当前数据空间" onPress={() => select(selection?.space ?? 'personal', selection?.reset ?? false)} />
        {selection?.space === 'demo' ? <Button label="返回个人数据" variant="quiet" onPress={() => select('personal')} /> : null}
        {selection?.space === 'demo' ? <Button label="显式重建演示数据（不影响个人数据）" onPress={() => select('demo', true)} /> : null}
      </View>
    );
  }
  if (!store) {
    return <View style={[styles.center, { backgroundColor: theme.background }]}><ActivityIndicator color={theme.primary} /></View>;
  }
  return <DemoContext.Provider value={{ active: selection?.space === 'demo',
    sessionId, resetEpoch: selection?.revision,
    isCurrentSession: () => providerAlive.current && selection?.space === 'demo' && currentRevision.current === selection.revision,
    enterDemo: () => select('demo'), leaveDemo: () => select('personal'), resetDemo: () => select('demo', true) }}>
    <CreationDraftContext.Provider value={{ identity: draftIdentity, drafts: drafts.current }}>
    <View style={{ flex: 1 }} key={`${selection?.space}:${selection?.revision}`}>
      {selection?.space === 'demo' ? <View style={{ padding: 8, backgroundColor: theme.surfaceStrong }}>
        <AppText variant="caption">DEMO · 独立演示数据 · 初始记录为样本 · 不影响个人数据</AppText>
      </View> : null}
      <DataContext.Provider value={store}><TimeOperationsContext.Provider value={timeOperations}>{children}</TimeOperationsContext.Provider></DataContext.Provider>
    </View>
    </CreationDraftContext.Provider>
  </DemoContext.Provider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: '100%', padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
