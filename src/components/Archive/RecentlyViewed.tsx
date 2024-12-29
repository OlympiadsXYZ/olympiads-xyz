import * as React from 'react';
import { useTranslation } from 'react-i18next';

type RecentItem = {
  title: string;
  path: string;
  timestamp: number;
};

export const RecentlyViewed: React.FC = () => {
  const { t } = useTranslation();
  const [recentItems, setRecentItems] = React.useState<RecentItem[]>([]);

  React.useEffect(() => {
    const stored = localStorage.getItem('recentlyViewedArchiveItems');
    if (stored) {
      setRecentItems(JSON.parse(stored));
    }
  }, []);

  if (!recentItems.length) return null;

  return (
    <div className="mb-6 relative overflow-hidden">
      {/* Gradient background with border */}
      <div className="
        bg-gradient-to-r from-blue-50 to-purple-50 
        dark:from-blue-900/20 dark:to-purple-900/20 
        rounded-lg p-4 shadow-md
        border border-blue-100 dark:border-blue-800
      ">
        {/* Header with icon */}
        <div className="flex items-center mb-4">
          <svg 
            className="h-5 w-5 text-blue-500 dark:text-blue-400 mr-2" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
          <h3 className="text-lg font-medium bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
            {t('recently-viewed')}
          </h3>
        </div>

        {/* Items list with hover effects */}
        <div className="space-y-2">
          {recentItems.slice(0, 5).map((item, idx) => (
            <a
              key={idx}
              href={process.env.NODE_ENV === 'development' 
                ? `http://localhost:8000${item.path}`
                : item.path}
              target="_blank"
              rel="noopener noreferrer"
              className="
                block text-sm text-gray-700 dark:text-gray-200 
                hover:bg-white/50 dark:hover:bg-white/5
                rounded-md px-3 py-2 transition-all duration-200
                hover:shadow-sm hover:translate-x-1
                border border-transparent hover:border-blue-100 dark:hover:border-blue-800
              "
            >
              <div className="flex items-center">
                <svg 
                  className="h-4 w-4 text-gray-400 dark:text-gray-500 mr-2" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
                  />
                </svg>
                {item.title}
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};