import { createContext, useContext } from 'react';
import type { TimeOperationAdapter } from '@/application/replan/TimeOperationAdapter';

// Capability comes from the active DB composition, not a UI flag or model field.
export const TimeOperationsContext = createContext<TimeOperationAdapter | null>(null);
export const useTimeOperations = () => useContext(TimeOperationsContext);
