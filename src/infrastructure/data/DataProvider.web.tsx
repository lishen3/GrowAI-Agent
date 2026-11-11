import type { PropsWithChildren } from 'react';
import { WebDataProvider } from './WebDataProvider';

export function DataProvider({ children }: PropsWithChildren) {
  return <WebDataProvider>{children}</WebDataProvider>;
}
