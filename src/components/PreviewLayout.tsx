import React from 'react';
import Info from './markdown/Info';
import Warning from './markdown/Warning';
import Optional from './markdown/Optional';
import TextTooltip from './Tooltip/TextTooltip';
import Asterisk from './Tooltip/Asterisk';
import { DarkModeContext } from '../context/DarkModeContext';
import { MarkdownProblemListsProvider } from '../context/MarkdownProblemListsContext';
import MarkdownLayoutContext from '../context/MarkdownLayoutContext';
import { ContactUsSlideoverProvider } from '../context/ContactUsSlideoverContext';
import { ProblemSuggestionModalProvider } from '../context/ProblemSuggestionModalContext';
import MobileSideNav from './MarkdownLayout/MobileSideNav';
import TableOfContentsBlock from './MarkdownLayout/TableOfContents/TableOfContentsBlock';
import DesktopSidebar from './MarkdownLayout/DesktopSidebar';
import MobileAppBar from './MarkdownLayout/MobileAppBar';
import NotSignedInWarning from './MarkdownLayout/NotSignedInWarning';
import ModuleHeaders from './MarkdownLayout/ModuleHeaders/ModuleHeaders';
import ModuleProgressUpdateBanner from './MarkdownLayout/ModuleProgressUpdateBanner';

// Import your CSS
import '../styles/main.css';

// Add all your custom components
export const components = {
    Info,
    Warning,
    Optional,
    TextTooltip,
    Asterisk,
    // Add other components as needed
  };

const PreviewLayout = ({ children }) => {
  // Provide required contexts
  return (
    <MarkdownLayoutContext.Provider
      value={{
        markdownLayoutInfo: {
          id: '',
          title: '',
          section: 'general',
          body: '',
          author: '',
          contributors: '',
          prerequisites: [],
          description: '',
          frequency: 0,
          toc: { cpp: [], java: [], py: [] },
          fileRelativePath: '',
          gitAuthorTime: null,
          url: '/general/',
          cppOc: 0,
          javaOc: 0,
          pyOc: 0
        },
        sidebarLinks: [],
        activeIDs: [],
        uniqueID: null, // legacy, remove when classes is removed
        isMobileNavOpen: false,
        setIsMobileNavOpen: () => {},
        moduleProgress: 'Not Started',
        handleCompletionChange: () => {},
      }}
    >


          <div className="w-full">

              <NotSignedInWarning />

              <ModuleHeaders moduleLinks={[]} />

              {children}

              <ModuleProgressUpdateBanner />

              {/* <ForumCTA /> */}

              {/*<div className="my-8">*/}
              {/*  <ModuleFeedback markdownData={markdownData} />*/}
              {/*</div>*/}
          </div>
    </MarkdownLayoutContext.Provider>
  );
};



export default PreviewLayout;