module.exports = {
  ci: {
    collect: {
      staticDistDir: './public',
      url: [
        'http://localhost/',
        'http://localhost/dashboard/',
        'http://localhost/general/',
        'http://localhost/archive/',
      ],
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
