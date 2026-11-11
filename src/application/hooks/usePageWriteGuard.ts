import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
/** UI freshness only. Application/Repository authorization and transactions remain mandatory. */
export function usePageWriteGuard(blocked: boolean, store: object, scope: string) {
  const latest = useRef({ blocked, store, scope });
  const epoch = useRef(0);
  const [, setFocusEpoch] = useState(0);
  if (latest.current.store !== store || latest.current.scope !== scope) epoch.current++;
  latest.current = { blocked, store, scope };
  const active = useRef(true);
  useFocusEffect(useCallback(() => {
    epoch.current++;
    active.current = true;
    setFocusEpoch(epoch.current);
    return () => { active.current = false; epoch.current++; };
  }, []));
  const capturedEpoch = epoch.current;
  return () => {
    if (!active.current || capturedEpoch !== epoch.current || latest.current.blocked || latest.current.store !== store || latest.current.scope !== scope) {
      throw new Error('当前数据尚未验证，暂不能保存或完成操作；请刷新成功后再试');
    }
  };
}
