import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import DynamicMarkdownRenderer from '../../DynamicMarkdownRenderer/DynamicMarkdownRenderer';

export default function CollapsibleMarkdown({
  markdown,
  isDarkMode,
}: {
  markdown: string;
  isDarkMode: boolean;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(true);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [mdxContent, setMdxContent] = useState(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const checkHeight = () => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight;
      setShouldCollapse(height > 150);
    }
  };

  useEffect(() => {
    if (mdxContent) {
      // Wait a bit for the content to be properly rendered
      const timer = setTimeout(checkHeight, 100);
      return () => clearTimeout(timer);
    }
  }, [mdxContent]);

  const handleContentLoaded = (content: any) => {
    setMdxContent(content);
  };

  return (
    <div className="relative">
      <div 
        ref={contentRef}
        className="markdown-content transition-all duration-200"
        style={collapsed && shouldCollapse ? { maxHeight: '150px', overflow: 'hidden' } : undefined}
      >
        <DynamicMarkdownRenderer
          markdown={markdown}
          problems=""
          onContentLoaded={handleContentLoaded}
        />
      </div>

      {shouldCollapse && (
        <div
          className={`${
            collapsed ? 'h-full' : 'h-12'
          } absolute inset-x-0 bottom-0 flex items-end justify-center group cursor-pointer`}
          onClick={() => setCollapsed(!collapsed)}
        >
          <div
            className={`${
              collapsed ? 'h-20' : 'h-12'
            } absolute inset-x-0 bottom-0 flex items-end justify-center`}
            style={
              collapsed
                ? {
                    background: isDarkMode
                      ? 'linear-gradient(0deg, rgba(31,41,55,1) 0%, rgba(31,41,55,0) 100%)'
                      : 'linear-gradient(0deg, rgba(243,244,246,1) 0%, rgba(243,244,246,0) 100%)',
                  }
                : undefined
            }
          >
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              className={`w-6 h-6 transform group-hover:-translate-y-2 transition mb-2 ${
                collapsed ? '' : 'rotate-180 '
              } ${isDarkMode ? 'text-white' : 'text-black'}`}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}