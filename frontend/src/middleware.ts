import type { MiddlewareHandler } from 'astro';

/** 不需登入即可存取的 path（其餘導向 /login） */
const PUBLIC_PREFIXES = ['/login', '/_astro/', '/_image', '/favicon.svg', '/favicon.ico'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  return PUBLIC_PREFIXES.some((p) => p !== '/login' && pathname.startsWith(p));
}

/** 與後端 strapi_proxy 一致：必須有非空的 notes_auth 值（僅 notes_auth= 會誤判為已登入）。 */
function hasValidNotesAuthCookie(cookieHeader: string): boolean {
  for (const part of cookieHeader.split(';')) {
    const p = part.trim();
    if (!p.startsWith('notes_auth=')) continue;
    const token = p.split('=', 2)[1]?.trim() ?? '';
    if (token.length > 0) return true;
  }
  return false;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const path = context.url.pathname;
  if (isPublicPath(path)) {
    return next();
  }
  const cookie = context.request.headers.get('cookie') || '';
  if (!hasValidNotesAuthCookie(cookie)) {
    // Node 的 Response.redirect() 無法解析相對路徑（會 throw → 整頁 500），改用手動 Location。
    // 相對 Location 由瀏覽器依目前網址列解析，可保留對外 host:port（例如 :9080）。
    const nextPath = path + context.url.search;
    const qs = new URLSearchParams({ next: nextPath });
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?${qs.toString()}` },
    });
  }
  return next();
};
