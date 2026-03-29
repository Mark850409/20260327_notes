/** SSR：把瀏覽器 Cookie（含 notes_auth）轉給 Flask，以通過 Strapi 權限。 */
export function backendFetchInit(request: Request): RequestInit {
  const cookie = request.headers.get('cookie');
  return cookie ? { headers: { Cookie: cookie } } : {};
}
