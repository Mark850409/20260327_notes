'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/blog-posts',
      handler: 'blog-post.find',
    },
    {
      method: 'GET',
      path: '/blog-posts/:id',
      handler: 'blog-post.findOne',
    },
  ],
};

