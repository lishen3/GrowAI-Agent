export function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}_${random}`;
}

/** Reflection handles grant access to the result, so never use the local record ID fallback. */
export function createReflectionRequestId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return 'request_' + crypto.randomUUID();
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `request_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (globalThis.navigator?.product === 'ReactNative' && globalThis.expo?.uuidv4) {
    return 'request_' + globalThis.expo.uuidv4();
  }
  throw new Error('当前环境无法安全创建复盘请求。请使用 HTTPS、本机 localhost 或更新后的应用。');
}

/** Durable identity for retries of one user creation request; never a title-based Task identity. */
export function requestRecordId(kind: 'task' | 'schedule', requestId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error('INVALID_CREATION_REQUEST');
  return `${kind}_request_${requestId}`;
}
