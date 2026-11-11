import { createContext, useContext } from 'react';

export type DemoControls = {
  active: boolean;
  sessionId?: string;
  resetEpoch?: number;
  isCurrentSession?: () => boolean;
  enterDemo: () => void;
  leaveDemo: () => void;
  resetDemo: () => void;
};
// Native SQLite deliberately stays in the personal space.
export const DemoContext = createContext<DemoControls | null>(null);
export function useDemoControls() { return useContext(DemoContext); }
