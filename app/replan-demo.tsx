import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { DemoPlanningService } from '@/application/replan/DemoPlanningService';
import { PlanningPreviewBackendClient } from '@/infrastructure/ai/PlanningPreviewBackendClient';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { useDemoControls } from '@/infrastructure/data/DemoContext';
import { PlanningPreviewError, type DemoPlanningSnapshot, type PlanningPreview } from '@/domain/replan/planningPreview';
import { ReplanDemoPlanningView, type PlanningPageState } from '@/presentation/components/ReplanDemoPlanningView';
import { DemoApprovalService } from '@/application/replan/DemoApprovalService';
import { DemoApprovalBackendClient } from '@/infrastructure/ai/DemoApprovalBackendClient';
import type { DemoApprovalRequest } from '@/domain/replan/approval';
import type { ApprovedChangeSet, ExecutionResult } from '@/domain/replan/execution';
import { createDemoExecutionService } from '@/infrastructure/ai/DemoExecutionApprovalGateway';

export default function ReplanDemoScreen() {
  const store = useGrowthStore();
  const demo = useDemoControls();
  const demoActive = demo?.active === true;
  const service = useMemo(() => new DemoPlanningService(store, new PlanningPreviewBackendClient(), undefined,
    () => demo?.sessionId !== undefined && demo.resetEpoch !== undefined
      ? { sessionId: demo.sessionId, resetEpoch: demo.resetEpoch } : undefined), [store, demo?.sessionId, demo?.resetEpoch]);
  const approvals = useMemo(() => new DemoApprovalService(service, new DemoApprovalBackendClient()), [service]);
  const sessionGuard = useRef<() => boolean>(() => false);
  sessionGuard.current = () => demo?.isCurrentSession?.() === true;
  const execution = useMemo(() => createDemoExecutionService(store, service, new DemoApprovalBackendClient(),
    () => sessionGuard.current()), [store, service]);
  const [state, setState] = useState<PlanningPageState>('READY');
  const [snapshot, setSnapshot] = useState<DemoPlanningSnapshot | null>(null);
  const [preview, setPreview] = useState<PlanningPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowedDate, setAllowedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<number | null>(null);
  const [approval, setApproval] = useState<DemoApprovalRequest | null>(null);
  const [approved, setApproved] = useState<ApprovedChangeSet | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const revision = useRef(0);
  const lock = useRef(false);

  useEffect(() => {
    sessionGuard.current = () => demo?.isCurrentSession?.() === true;
    const token = ++revision.current;
    setLoading(true); setPreview(null); setSnapshot(null); setError(null); setState('READY');
    setSelectedAction(null); setApproval(null); setApproved(null);
    setExecutionResult(null);
    void service.load(demoActive).then((next) => {
      if (token === revision.current) setSnapshot(next);
    }).catch((caught) => {
      if (token !== revision.current) return;
      setError(caught instanceof Error ? caught.message : 'Demo Context 读取失败');
      setState(caught instanceof PlanningPreviewError && caught.blocked ? 'BLOCKED' : 'FAILED');
    }).finally(() => { if (token === revision.current) setLoading(false); });
    return () => { revision.current++; sessionGuard.current = () => false; };
  }, [service, demoActive]);

  async function generate() {
    if (lock.current || loading || !demoActive || !allowedDate || !['READY', 'PROPOSAL_READY', 'BLOCKED', 'FAILED'].includes(state)) return;
    lock.current = true;
    const token = revision.current;
    setPreview(null); setError(null); setState('GENERATING');
    setSelectedAction(null); setApproval(null); setApproved(null);
    try {
      const next = await service.generate(demoActive, allowedDate);
      if (token !== revision.current) return;
      setSnapshot(next.snapshot); setPreview(next.preview); setState('PROPOSAL_READY');
    } catch (caught) {
      if (token !== revision.current) return;
      setError(caught instanceof PlanningPreviewError ? `${caught.message} · ${caught.stage}/${caught.code}`
        : caught instanceof Error ? caught.message : 'Planning 返回失败');
      setState(caught instanceof PlanningPreviewError && caught.blocked ? 'BLOCKED' : 'FAILED');
    } finally { lock.current = false; }
  }

  async function execute() {
    if (lock.current || !demoActive || loading || state !== 'APPROVED' || !approved) return;
    lock.current = true; setState('EXECUTING'); setError(null);
    const token = revision.current;
    try {
      const result = await execution.execute(approved);
      if (token !== revision.current) return;
      setExecutionResult(result);
      setState(result.status === 'SUCCESS' ? 'EXECUTED_SUCCESS' : 'EXECUTION_FAILED');
    } finally { lock.current = false; }
  }

  async function approvalAction(confirm: boolean) {
    if (lock.current || !demoActive || loading) return;
    if (confirm ? state !== 'AWAITING_APPROVAL' || !approval
      : state !== 'PROPOSAL_READY' || !preview || !snapshot || selectedAction === null) return;
    lock.current = true; setApprovalBusy(true); setError(null);
    const token = revision.current;
    try {
      if (confirm) {
        const next = await approvals.approve(demoActive, approval!);
        if (token !== revision.current) return;
        setApproved(next); setState('APPROVED');
      } else {
        const next = await approvals.submit(demoActive, preview!, snapshot!, selectedAction!, allowedDate);
        if (token !== revision.current) return;
        setApproval(next); setState('AWAITING_APPROVAL');
      }
    } catch (caught) {
      if (token !== revision.current) return;
      setApproved(null); setError(caught instanceof Error ? caught.message : '授权请求失败，未执行');
      setState(caught instanceof PlanningPreviewError && caught.blocked ? 'BLOCKED' : 'FAILED');
    } finally { lock.current = false; setApprovalBusy(false); }
  }

  return <ReplanDemoPlanningView state={state} snapshot={snapshot} preview={preview} error={error}
    allowedDate={allowedDate} loading={loading} onGenerate={() => void generate()}
    selectedAction={selectedAction} approval={approval} approved={approved} approvalBusy={approvalBusy}
    executionResult={executionResult} onExecute={() => void execute()}
    onSelectAction={(index) => { if (!lock.current && state === 'PROPOSAL_READY') setSelectedAction(index); }}
    onSubmitApproval={() => void approvalAction(false)} onApprove={() => void approvalAction(true)}
    onDateChange={(value) => {
      if (lock.current || !['READY', 'PROPOSAL_READY', 'BLOCKED', 'FAILED'].includes(state)) return;
      setAllowedDate(value); setPreview(null); setError(null); setState(snapshot ? 'READY' : 'BLOCKED');
    }} onBack={() => router.replace('/coach')} />;
}
