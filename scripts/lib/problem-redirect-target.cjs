// The meta-redirect plugin appends a slash to relative URLs, including after
// their fragment. Absolute targets preserve the section anchor unchanged.
module.exports = function problemRedirectTarget(toPath, siteUrl) {
  return new URL(toPath, siteUrl).href;
};
