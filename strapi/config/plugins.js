module.exports = ({ env }) => ({
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
