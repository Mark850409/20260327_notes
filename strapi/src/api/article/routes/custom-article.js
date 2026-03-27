'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/articles/import-markdown',
      handler: 'article.importMarkdown',
      config: {
        auth: false,
      },
    },
  ],
};

