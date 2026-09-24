import { getFunctions, httpsCallable } from 'firebase/functions';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirebaseApp } from './useFirebase';

export default function useContactFormAction() {
  const firebaseApp = useFirebaseApp();
  const { t } = useTranslation();

  return useCallback(
    async ({ name, email, moduleName, url, lang, topic, message, includeNameInIssue }) => {
      if (!name) {
        throw new Error(t('contact-form_error-name'));
      }
      if (!email) {
        throw new Error(t('contact-form_error-email'));
      }
      if (!topic) {
        throw new Error(t('contact-form_error-topic'));
      }
      if (!message) {
        throw new Error(t('contact-form_error-message'));
      }
      if (!firebaseApp) {
        throw new Error(t('contact-form_error-too-fast'));
      }
      const submitProblemSuggestion = httpsCallable(
        getFunctions(firebaseApp),
        'submitContactForm'
      );

      return submitProblemSuggestion({
        name,
        email,
        moduleName,
        url,
        lang,
        topic,
        message,
        includeNameInIssue
      });
    },
    [firebaseApp, t]
  );
}
