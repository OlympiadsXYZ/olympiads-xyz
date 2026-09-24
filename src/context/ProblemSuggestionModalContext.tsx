import * as React from 'react';
import { createContext, useContext, useState } from 'react';
// Loaded when first opened: the modal brings react-select and emotion (~200 KB of script), and this provider wraps
// every problem and module page.
const ProblemSuggestionModal = React.lazy(
  () => import('../components/ProblemSuggestionModal')
);
import { EditorContext } from './EditorContext';
import { useFirebaseUser } from './UserDataContext/UserDataContext';

const ProblemSuggestionModalContext = createContext<{
  openProblemSuggestionModal: (listName: string) => void;
}>({
  openProblemSuggestionModal: () => {},
});

export default ProblemSuggestionModalContext;

export const ProblemSuggestionModalProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [listName, setListName] = useState<string>('');
  const firebaseUser = useFirebaseUser();
  const { inEditor } = useContext(EditorContext);
  const openProblemSuggestionModal = (listName: string) => {
    if (!firebaseUser && !inEditor) {
      alert('Трябва да влезете в профила си, за да предлагате задачи.');
      return;
    }
    setListName(listName);
    setEverOpened(true);
    setIsOpen(true);
  };

  React.useEffect(() => {
    if (isOpen) document.body.classList.add('overflow-hidden');
    else document.body.classList.remove('overflow-hidden');
  }, [isOpen]);

  return (
    <ProblemSuggestionModalContext.Provider
      value={{
        openProblemSuggestionModal,
      }}
    >
      {children}

      {everOpened && (
        <React.Suspense fallback={null}>
          <ProblemSuggestionModal
            listName={listName}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
          />
        </React.Suspense>
      )}
    </ProblemSuggestionModalContext.Provider>
  );
};
