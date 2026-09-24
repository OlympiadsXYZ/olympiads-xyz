import React from 'react';
// TODO: change this to olympiads-xyz.firebaseio.com

export const useAnalyticsEffect = () => {
  React.useEffect(() => {
    // window.ga (Universal Analytics) never exists with gatsby-plugin-google-gtag, so every view was counted as
    // "GA blocked"; window.gtag is the inline stub, defined even when gtag.js is blocked. gtag.js itself defines
    // google_tag_manager, and as a parser-inserted async script it has loaded or failed by the window load event.
    const countIfBlocked = () => {
      if ((window as any).google_tag_manager) return; // google analytics loaded
      // google analytics got blocked
      fetch(
        'https://olympiads-xyz-default-rtdb.europe-west1.firebasedatabase.app/analytics/no_ga_pageviews.json',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ '.sv': { increment: 1 } }),
        }
      );
    };
    if (document.readyState === 'complete') countIfBlocked();
    else window.addEventListener('load', countIfBlocked, { once: true });
    fetch('https://olympiads-xyz-default-rtdb.europe-west1.firebasedatabase.app/pageviews.json', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
    });
  }, []);
};
