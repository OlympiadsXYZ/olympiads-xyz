import { graphql } from 'gatsby';
import * as React from 'react';
import styled from 'styled-components';
import tw from 'twin.macro';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';
import { useTranslation } from 'react-i18next';
import { ArchiveSection, ArchiveSubsection, ArchiveItem, ARCHIVE_DATA } from '../../archive/archiveOrdering';
import { RecentlyViewed } from '../components/Archive/RecentlyViewed';
import Breadcrumbs, { BreadcrumbItem } from '../components/Archive/Breadcrumbs';
import { useEffect } from 'react';

// First, let's create a unified type for all section items
type SectionProps = {
  name: string;
  items?: ArchiveItem[];
  subsections?: { name: string; items?: ArchiveItem[]; subsections?: any[] }[];
  onOpen?: (path: string[]) => void;
  path: string[];
  highlightedPath?: string;
  isExpanded?: boolean;
};

const HEADER_HEIGHT = 100; // Adjust this value based on your actual header height

// First, let's add a utility function to generate consistent IDs
const generateSectionId = (pathParts: string[]) => {
  const id = `section-${pathParts.join('-').toLowerCase().replace(/\s+/g, '-')}`;
  console.log('Generated ID:', id); // Debug log
  return id;
};

// Add the controls component
const ArchiveControls: React.FC<{
  onExpandAll: () => void;
  onCollapseAll: () => void;
}> = ({ onExpandAll, onCollapseAll }) => {
  const { t } = useTranslation();

  return (
    <div className="flex justify-end space-x-4 mb-6">
      <button
        onClick={onExpandAll}
      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 
        hover:text-gray-900 dark:hover:text-white transition-colors
        flex items-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <span>{t('expand-all')}</span>
    </button>
    <button
      onClick={onCollapseAll}
      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 
        hover:text-gray-900 dark:hover:text-white transition-colors
        flex items-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
      <span>{t('collapse-all')}</span>
    </button>
    </div>
  );
};

// Add a type for search matches
type SearchMatch = {
  section: any;
  matches: SearchMatches;
};

type SearchMatches = {
  sectionName?: boolean;
  items?: string[];
  subsections?: { name: string; matches: SearchMatches }[];
};

// Update the filter function to return match information
const findMatches = (section: any, term: string): SearchMatch | null => {
  const searchLower = term.toLowerCase();
  const matches: SearchMatches = {};
  let hasMatches = false;

  // Check section name
  if (section.name.toLowerCase().includes(searchLower)) {
    matches.sectionName = true;
    // When section matches, include ALL content but don't mark them as direct matches
    if (section.items?.length) {
      matches.items = section.items.map(item => item.title);
    }
    if (section.subsections?.length) {
      matches.subsections = section.subsections.map(sub => ({
        name: sub.name,
        matches: {
          items: sub.items?.map(item => item.title),
          subsections: sub.subsections?.map(deepSub => ({
            name: deepSub.name,
            matches: {
              items: deepSub.items?.map(item => item.title)
            }
          }))
        },
        section: sub
      }));
    }
    hasMatches = true;
  } else {
    // Only check for direct matches if section name doesn't match
    if (section.items?.length) {
      const matchingItems = section.items.filter(item => 
        item.title.toLowerCase().includes(searchLower)
      );
      if (matchingItems.length) {
        matches.items = matchingItems.map(item => item.title);
        hasMatches = true;
      }
    }

    if (section.subsections?.length) {
      const matchingSubsections = section.subsections
        .map(sub => ({ 
          name: sub.name, 
          match: findMatches(sub, searchLower),
          original: sub
        }))
        .filter(sub => sub.match !== null);

      if (matchingSubsections.length) {
        matches.subsections = matchingSubsections.map(sub => ({
          name: sub.name,
          matches: sub.match!.matches,
          section: sub.original
        }));
        hasMatches = true;
      }
    }
  }

  return hasMatches ? { section, matches } : null;
};

// Add a component to highlight matched text
const HighlightedText: React.FC<{ text: string; searchTerm: string }> = ({ text, searchTerm }) => {
  if (!searchTerm) return <>{text}</>;
  
  const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'));
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === searchTerm.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 dark:bg-yellow-900">{part}</span>
        ) : (
          part
        )
      )}
    </>
  );
};

// Add a helper function to check if a section or any of its subsections have matches
const hasMatchesInSubtree = (matches?: SearchMatches): boolean => {
  if (!matches) return false;
  
  if (matches.sectionName || matches.items?.length) return true;
  
  return !!matches.subsections?.some(sub => hasMatchesInSubtree(sub.matches));
};

// Add a helper function to check if this section is a parent of a match
const isParentOfMatch = (matches?: SearchMatches): boolean => {
  if (!matches) return false;
  
  // Don't count this section if it's the one that matches
  if (matches.sectionName) return false;
  
  // Check if any direct items match
  if (matches.items?.length) return true;
  
  // Check if any subsections or their children match
  return !!matches.subsections?.some(sub => 
    sub.matches.sectionName || 
    sub.matches.items?.length || 
    isParentOfMatch(sub.matches)
  );
};

// Add a helper function to check if this section should be expanded
const shouldExpandSection = (matches?: SearchMatches, isParentSection = false): boolean => {
  if (!matches) return false;
  
  // Don't auto-expand sections that match directly (keep them collapsed)
  if (matches.sectionName === true) return false;
  
  // Only expand the immediate parent section that contains direct matches
  return isParentSection && Boolean(matches.items && matches.items.length > 0);
  // Removed the recursive subsection check to prevent auto-expanding deeper levels
};

// Update the Section component to handle search results
const Section: React.FC<SectionProps & { 
  searchTerm?: string;
  searchMatches?: SearchMatches;
  isExpanded: boolean;
}> = ({ 
  name, 
  items, 
  subsections, 
  onOpen,
  path,
  highlightedPath,
  isExpanded = false,
  searchTerm,
  searchMatches
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const initializedRef = React.useRef(false);
  const [contentHeight, setContentHeight] = React.useState(0);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const resizeTimeoutRef = React.useRef<NodeJS.Timeout>();
  const currentPath = path.join('-');
  const isHighlighted = highlightedPath === currentPath;

  // Only set the initial state once when search results change
  React.useEffect(() => {
    if (!initializedRef.current && searchTerm) {
      const shouldExpand = isExpanded || shouldExpandSection(searchMatches, true);
      setIsOpen(shouldExpand);
      initializedRef.current = true;
    }
  }, [searchTerm, searchMatches, isExpanded]);

  // Reset initialization when search term changes
  React.useEffect(() => {
    initializedRef.current = false;
  }, [searchTerm]);

  // Handle manual expand/collapse
  React.useEffect(() => {
    setIsOpen(isExpanded);
    initializedRef.current = false;
  }, [isExpanded]);

  // Height animation effect
  React.useEffect(() => {
    if (isOpen && contentRef.current) {
      const updateHeight = () => {
        if (contentRef.current) {
          setContentHeight(contentRef.current.scrollHeight);
        }
      };

      updateHeight();
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
        resizeTimeoutRef.current = setTimeout(updateHeight, 50);
      });

      resizeObserver.observe(contentRef.current);
      return () => {
        resizeObserver.disconnect();
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    } else {
      setContentHeight(0);
    }
  }, [isOpen]);

  const handleClick = () => {
    setIsOpen(!isOpen);
    if (!isOpen && onOpen) {
      onOpen(path);
    }
  };

  // If we're searching and this section has no matches, don't render
  if (searchTerm && !searchMatches) {
    return null;
  }

  // Calculate total matches for this section
  const totalMatches = (searchMatches?.items?.length || 0) + 
    (searchMatches?.subsections?.length || 0);

  const { t } = useTranslation();

  // Render section with subsections
  return (
    <div 
      className={`
        mb-4 relative
        ${isHighlighted ? 'animate-pulse-subtle' : ''}
      `}
      id={currentPath}
    >
      <button
        onClick={handleClick}
        className={`
          w-full flex justify-between items-center 
          px-4 py-3 text-left 
          bg-white dark:bg-gray-800 
          rounded-lg
          transition-all duration-200
          ${isHighlighted ? 'ring-2 ring-blue-500 dark:ring-blue-400' : 'hover:shadow-md'}
          ${path.length > 1 ? 'text-sm' : 'text-base'}
        `}
      >
        <div className="flex items-center space-x-3">
          <svg
            className={`
              w-5 h-5 
              text-gray-400 dark:text-gray-500
              transition-transform duration-200
              ${isOpen ? 'transform rotate-90' : ''}
            `}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          
          <span className="font-medium text-gray-900 dark:text-gray-100">
            <HighlightedText text={name} searchTerm={searchTerm || ''} />
            {searchMatches?.sectionName && (
              <span className="ml-2 text-sm text-blue-500 dark:text-blue-400">
                ({t('section-match')})
              </span>
            )}
            {totalMatches > 0 && !searchMatches?.sectionName && (
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                ({totalMatches} {t('matches')})
              </span>
            )}
          </span>
        </div>
      </button>

      <div
        className="transition-all duration-200 ease-in-out"
        style={{
          height: isOpen ? `${contentHeight}px` : '0',
          opacity: isOpen ? 1 : 0,
          overflow: 'hidden',
        }}
      >
        <div 
          ref={contentRef}
          className={`
            py-2
            ${path.length > 1 ? `
              ml-6
              pl-6
              border-l-2 
              border-gray-200 dark:border-gray-700
              hover:border-blue-500 dark:hover:border-blue-400
              transition-colors duration-200
            ` : ''}
          `}
          style={{
            marginLeft: path.length > 1 ? '1.5rem' : '1rem',
            paddingLeft: path.length > 1 ? '1rem' : '0',
          }}
        >
          {items && (
            <div className="space-y-2 mb-4">
              {items.map(item => {
                if (searchTerm && !searchMatches?.items?.includes(item.title)) {
                  return null;
                }
                return (
                  // <a
                  //   key={item.path}
                  //   href={process.env.NODE_ENV === 'development' 
                  //     ? `http://localhost:8000${item.path}`
                  //     : item.path}
                  //   target="_blank"
                  //   rel="noopener noreferrer"
                  //   className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                  // >
                  //   <HighlightedText text={item.title} searchTerm={searchTerm || ''} />
                  // </a>

                  <a
                    key={item.path}
                    href={process.env.NODE_ENV === 'development' 
                      ? `http://localhost:8000${item.path}`
                      : item.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="
                      group flex items-center
                      w-full px-4 py-2.5
                      text-sm text-gray-700 dark:text-gray-200
                      bg-gray-50 dark:bg-gray-800/50
                      hover:bg-blue-50 dark:hover:bg-blue-900/20
                      border border-gray-100 dark:border-gray-700/50
                      hover:border-blue-200 dark:hover:border-blue-800
                      rounded-md
                      transition-all duration-200
                      hover:translate-x-1
                    "
                    onClick={() => {
                      const recentItems = JSON.parse(localStorage.getItem('recentlyViewedArchiveItems') || '[]');
                      const newItem = {
                        title: item.title,
                        path: item.path,
                        timestamp: Date.now()
                      };
                      const updatedItems = [
                        newItem,
                        ...recentItems.filter(i => i.path !== item.path)
                      ].slice(0, 10);
                      localStorage.setItem('recentlyViewedArchiveItems', JSON.stringify(updatedItems));
                    }}
                  >
                    <svg 
                      className="h-4 w-4 text-gray-400 dark:text-gray-500 mr-3 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" 
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
                    <HighlightedText text={item.title} searchTerm={searchTerm || ''} />
                  </a>
                );
              })}
            </div>
          )}
          
          <div className="space-y-3">
            {subsections?.map(subsection => {
              const subMatch = searchMatches?.subsections?.find(
                sub => sub.name === subsection.name
              );
              
              // If searching, only render matching subsections
              if (searchTerm && !subMatch) {
                return null;
              }

              return (
                <Section
                  key={subsection.name}
                  {...subsection}
                  path={[...path, subsection.name]}
                  onOpen={onOpen}
                  highlightedPath={highlightedPath}
                  isExpanded={isExpanded}
                  searchTerm={searchTerm}
                  searchMatches={subMatch?.matches}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Add this new component for the search box
const ArchiveSearch: React.FC<{
  onSearch: (term: string) => void;
}> = ({ onSearch }) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = React.useState('');

  // Debounce search to avoid too many updates
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, onSearch]);

  return (
    <div className="relative mb-6">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <svg
          className="h-5 w-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="search"
        className="block w-full pl-12 pr-4 py-3 rounded-lg bg-white dark:bg-gray-800 
          text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400
          border border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 
          focus:border-transparent transition-all duration-200"
        placeholder={t('search_archive')}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
    </div>
  );
};

const ArchiveContent: React.FC<{ data: ArchiveSection }> = ({ data }) => {
  const [breadcrumbs, setBreadcrumbs] = React.useState<BreadcrumbItem[]>([
    { name: data.name }
  ]);
  const [highlightedPath, setHighlightedPath] = React.useState<string>();
  const [expandAll, setExpandAll] = React.useState<boolean>();
  const [forceUpdateKey, setForceUpdateKey] = React.useState(0);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<SearchMatch[]>([]);

  // Filter function for sections and items
  const filterSection = (section: any, term: string): boolean => {
    const searchLower = term.toLowerCase();
    
    // Check if section name matches
    if (section.name.toLowerCase().includes(searchLower)) return true;
    
    // Check items
    if (section.items?.some(item => 
      item.title.toLowerCase().includes(searchLower)
    )) return true;
    
    // Check subsections recursively
    if (section.subsections?.some(sub => filterSection(sub, searchLower))) {
      return true;
    }
    
    return false;
  };

  // Filter sections based on search term
  const filteredSections = React.useMemo(() => {
    if (!searchTerm) return data.sections;
    
    return data.sections.filter(section => filterSection(section, searchTerm));
  }, [data.sections, searchTerm]);

  const handleExpandAll = () => {
    setExpandAll(true);
    setForceUpdateKey(prev => prev + 1);
  };

  const handleCollapseAll = () => {
    setExpandAll(false);
    setForceUpdateKey(prev => prev + 1);
  };

  const handleSectionOpen = (path: string[]) => {
    setBreadcrumbs([
      { name: data.name },
      ...path.map(name => ({ name }))
    ]);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) return;

    const path = breadcrumbs.slice(1, index + 1).map(b => b.name).join('-');
    const element = document.getElementById(path);

    if (element) {
      const offset = element.getBoundingClientRect().top + window.pageYOffset - 120;
      window.scrollTo({ top: offset, behavior: 'smooth' });

      // Smooth highlight effect
      setHighlightedPath(path);
      setTimeout(() => {
        setHighlightedPath(undefined);
      }, 2000); // Increased to 2 seconds for a more noticeable effect
    }
  };

  // Update search handling
  const handleSearch = (term: string) => {
    setSearchTerm(term);
    if (term) {
      const results = data.sections
        .map(section => findMatches(section, term))
        .filter((match): match is SearchMatch => match !== null);
      setSearchResults(results);

      // This is not it.
      //setExpandAll(false);
    } else {
      setSearchResults([]);
      //setExpandAll(false);
    }
  };

  return (
    <div>
      <Breadcrumbs items={breadcrumbs.map((item, index) => ({
        ...item,
        onClick: () => handleBreadcrumbClick(index)
      }))} />
      <ArchiveSearch onSearch={handleSearch} />
      <ArchiveControls
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
      />
      <RecentlyViewed />
      <div className="space-y-6" key={forceUpdateKey}>
        {(searchTerm ? searchResults.map(r => r.section) : data.sections).map(section => (
          <Section
            key={section.name}
            {...section}
            path={[section.name]}
            onOpen={handleSectionOpen}
            highlightedPath={highlightedPath}
            isExpanded={expandAll}
            searchTerm={searchTerm}
            searchMatches={searchResults.find(r => r.section.name === section.name)?.matches}
          />
        ))}
      </div>
    </div>
  );
};

export default function ArchiveTemplate({ pageContext }) {
  const { t } = useTranslation();
  const { subject } = pageContext;

  // If no subject is provided, show the main archive page with subject selection
  if (!subject) {
    return (
      <Layout>
        <SEO title={t('archive')} />
        <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
          <TopNavigationBar />
          <div className="py-16 bg-blue-600 dark:bg-blue-900 px-5">
            <div className="max-w-3xl mx-auto mb-6">
              <h1 className="text-center text-3xl sm:text-5xl font-bold text-white dark:text-dark-high-emphasis mb-6">
                {t('archive')}
              </h1>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(ARCHIVE_DATA).map(([key, value]) => (
                <a
                  key={key}
                  href={`/archive/${key}`}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-black/5 dark:shadow-white/5 p-6 hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-white/10 transition-shadow"
                >
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {value.name}
                  </h2>
                </a>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const archiveData = ARCHIVE_DATA[subject];

  if (!archiveData) {
    return <div>404 - Subject not found</div>;
  }

  return (
    <Layout>
      <SEO title={`${archiveData.name} - ${t('archive')}`} />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <div className="py-16 bg-blue-600 dark:bg-blue-900 px-5">
          <div className="max-w-3xl mx-auto mb-6">
            <h1 className="text-center text-3xl sm:text-5xl font-bold text-white dark:text-dark-high-emphasis mb-6">
              {t('archive')} - {archiveData.name}
            </h1>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ArchiveContent data={archiveData} />
        </div>
      </div>
    </Layout>
  );
}

export const query = graphql`
  query ArchiveQuery {
    allFile(
      filter: { sourceInstanceName: { eq: "archive" } }
      sort: { fields: name }
    ) {
      edges {
        node {
          relativePath
          name
          extension
        }
      }
    }
  }
`;
