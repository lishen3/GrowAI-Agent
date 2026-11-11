import type { PropsWithChildren } from 'react';
import { NativeDataProvider } from './NativeDataProvider';

export function DataProvider({ children }: PropsWithChildren) {
  return <NativeDataProvider>{children}</NativeDataProvider>;
}
