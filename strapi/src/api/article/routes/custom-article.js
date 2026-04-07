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
    {
      method: 'POST',
      path: '/upload/inline-image',
      handler: 'article.uploadInlineImage',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/upload/paste-minio',
      handler: 'article.uploadPasteMinio',
      config: {
        auth: false,
      },
    },
  ],
};

