import { useState } from 'react';
import { View } from 'react-native';
import { useDemoControls } from '@/infrastructure/data/DemoContext';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

export function DemoPanel() {
  const demo = useDemoControls();
  const [confirmReset, setConfirmReset] = useState(false);
  if (!demo) return null;
  return <View style={{ gap: 12 }}>
    <AppText variant="heading">Demo 演示环境</AppText>
    <AppText muted>独立演示数据库，不覆盖个人数据。初始完成记录与用户偏好均为明确标注的演示样本。</AppText>
    {!demo.active ? <Button label="进入 Demo" variant="secondary" onPress={demo.enterDemo} /> : <>
      <Notice title="正在使用演示数据">
        今日查看任务 → AI Coach 查看本周状态 → 调整本周 → 逐项确认与读库 → 今日完成任务 → AI Coach 本周复盘与记忆候选。
        AI 使用真实后端与模型，不保证生成固定建议或记忆候选。演示请仅打开一个标签页。
      </Notice>
      <Button label="Reset Demo" variant="secondary" onPress={() => setConfirmReset(true)} />
      {confirmReset ? <View style={{ gap: 8 }}>
        <AppText>这是演示数据重置，不影响真实数据。将清除本轮演示操作，按今天日期重建初始数据。确定重置？</AppText>
        <Button label="确认重置演示数据" onPress={demo.resetDemo} />
        <Button label="取消" variant="quiet" onPress={() => setConfirmReset(false)} />
      </View> : null}
      <Button label="返回个人数据" variant="quiet" onPress={demo.leaveDemo} />
    </>}
  </View>;
}
