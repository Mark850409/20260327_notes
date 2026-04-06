module.exports = ({ env }) => ({
  'users-permissions': {
    config: {
      // 與 Flask notes_auth（Strapi /api/auth/local 回傳的 jwt）一致；勿改 refresh 模式除非一併改登入流程。
      jwtManagement: 'legacy-support',
      jwt: {
        // 預設 90 天；過期後瀏覽器仍可能留著舊 Cookie，導致 SSR 一直 401。可用環境變數覆寫（例：30d、365d）。
        expiresIn: env('STRAPI_USERS_JWT_EXPIRES_IN', '90d'),
      },
    },
  },
  plausible: {
    enabled: env.bool('ENABLE_STRAPI_PLAUSIBLE', false),
    config: {
      // Example: https://plausible.io/share/xxxx?auth=xxxx
      sharedLink: env('PLAUSIBLE_SHARED_LINK', ''),
    },
  },
  tagsinput: {
    enabled: true,
  },
});
