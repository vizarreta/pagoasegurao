export function generateRequestId(): Uint8Array {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateNonce(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

export function base64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
