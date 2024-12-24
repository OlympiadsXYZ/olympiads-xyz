import React from 'react';
// TODO: change this to olympiads-xyz.firebaseio.com

export const useAnalyticsEffect = () => {
  React.useEffect(() => {
    if ((window as any).ga && (window as any).ga.create) {
      // google analytics loaded
    } else {
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
    }
    fetch('https://olympiads-xyz-default-rtdb.europe-west1.firebasedatabase.app/pageviews.json', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
    });
  }, []);
};
