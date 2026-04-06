/** SSR：把瀏覽器 Cookie 與反向代理相關標頭轉給 Flask（與瀏覽器直連 /api 時行為一致）。 */
const FORWARD_HEADER_NAMES = [
  'cookie',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-for',
  'host',
] as const;

export function backendFetchInit(request: Request): RequestInit {
  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADER_NAMES) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  return Object.keys(headers).length > 0 ? { headers } : {};
}
