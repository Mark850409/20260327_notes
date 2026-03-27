'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/upload/inline-image',
      handler: 'article.uploadInlineImage',
      config: {
        auth: false,
      },
    },
  ],
};

