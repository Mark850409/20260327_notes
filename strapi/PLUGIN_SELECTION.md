# Strapi 5 Plugin Selection

This project is pinned to Strapi 5 and uses the following plugin choices:

1. `strapi-plugin-tagsinput` (tag input UX for editors)
2. Plausible via backend integration (no admin plugin by default)

## Why this selection

- `strapi-plugin-plausible` may fail admin build in some Strapi 5 setups due to legacy imports.
- Plausible is integrated through backend/widget APIs; admin plugin is opt-in via env flag.
- tagsinput improves content editing speed for tag-heavy article workflows.

## Required environment variables

- `PLAUSIBLE_SHARED_LINK`: Plausible shared dashboard URL
- Optional API variables used by backend widget aggregation:
  - `PLAUSIBLE_API_KEY`
  - `PLAUSIBLE_SITE_ID`

## Notes

- After dependency installation, rebuild Strapi admin:
  - `npm install`
  - `npm run build`
  - `npm run develop`
- If your deployment uses CSP restrictions, ensure `plausible.io` is allowed for iframe embedding.
