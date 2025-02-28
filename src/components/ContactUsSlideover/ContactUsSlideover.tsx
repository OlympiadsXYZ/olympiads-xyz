import * as React from 'react';
import { useContext, useEffect, useState } from 'react';
import { SECTION_LABELS } from '../../../content/ordering';
import MarkdownLayoutContext from '../../context/MarkdownLayoutContext';
import { useFirebaseUser } from '../../context/UserDataContext/UserDataContext';
import { useUserLangSetting } from '../../context/UserDataContext/properties/simpleProperties';
import useContactFormAction from '../../hooks/useContactFormAction';
import useStickyState from '../../hooks/useStickyState';
import { ModuleInfo } from '../../models/module';
import { SolutionInfo } from '../../models/solution';
import SlideoverForm from './SlideoverForm';
import { useTranslation } from 'react-i18next';
import '../../i18n';

// Warning: this file is insanely messy. This should be rewritten soon :)

const Field = ({
  label,
  id,
  value,
  onChange,
  errorMsg = null as string | null,
}) => {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-sm font-medium leading-5 text-gray-900 dark:text-dark-high-emphasis"
      >
        {label}
      </label>
      <div className="relative rounded-md shadow-sm">
        <input
          type="text"
          id={id}
          className={
            'input' +
            (errorMsg
              ? ' pr-10 border-red-300 dark:border-red-300 text-red-900 dark:text-red-300 placeholder-red-300 focus:border-red-300 dark:focus:border-red-300 focus:ring-red-300 dark:focus:ring-red-300'
              : '')
          }
          value={value}
          onChange={onChange}
        />
        {errorMsg && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>
      {errorMsg && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {errorMsg}
        </p>
      )}
    </div>
  );
};

export function validateEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

export default function ContactUsSlideover({
  isOpen,
  onClose,
  defaultLocation = '',
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultLocation?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState(defaultLocation);
  const [topic, setTopic] = useStickyState('', 'contact_form_topic');
  const topics = [
    [t('mistake'), t('mistake_examples')],
    [t('unclear_explanation')],
    [t('website_bug')],
    [t('suggestion')],
    [t('request_missing_section_or_solution')],
    [t('other')],
  ];
  const [message, setMessage] = useStickyState('', 'contact_form_message');
  const [showSuccess, setShowSuccess] = useState(false);
  const [issueLink, setIssueLink] = useState('');
  const [submitEnabled, setSubmitEnabled] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [includeNameInIssue, setIncludeNameInIssue] = useState(true);

  const markdownContext = useContext(MarkdownLayoutContext);
  const userLang = useUserLangSetting();
  const submitForm = useContactFormAction();

  React.useEffect(() => {
    if (!defaultLocation) {
      const activeModule = markdownContext?.markdownLayoutInfo;
      if (activeModule && activeModule instanceof ModuleInfo) {
        setLocation(
          `${SECTION_LABELS[activeModule.section]} - ${activeModule.title}`
        );
      } else if (activeModule && activeModule instanceof SolutionInfo) {
        setLocation(`Solution: ${activeModule.title}`);
      } else setLocation('');
    }
  }, [markdownContext?.markdownLayoutInfo]);

  const firebaseUser = useFirebaseUser();
  useEffect(() => {
    if (!firebaseUser) return;
    if (email === '') {
      setEmail(firebaseUser.email!);
    }
    if (name === '') {
      setName(firebaseUser.displayName!);
    }
  }, [firebaseUser]);

  React.useEffect(() => {
    if (isOpen) {
      setShowSuccess(false);
      setShowErrors(false);
      setSubmitEnabled(true);
    }
  }, [isOpen]);

  const handleSubmit = async e => {
    e.preventDefault();

    setShowErrors(true);
    if (
      name === '' ||
      email === '' ||
      !validateEmail(email) ||
      topic === '' ||
      message.length < 10 ||
      message.length > 1200
    ) {
      return;
    }
    setSubmitEnabled(false);
    try {
      const response = await submitForm({
        name,
        includeNameInIssue,
        email,
        moduleName: location,
        url: window.location.href,
        lang: userLang,
        topic,
        message,
      });
      setTopic('');
      setMessage('');
      setShowSuccess(true);
      setIssueLink(response.data as string);
    } catch (e) {
      setSubmitEnabled(true);
      alert('Form submission failed: ' + e.message);
    } finally {
      setShowErrors(false);
    }
  };

  return (
  
    <SlideoverForm
      isOpen={isOpen}
      onClose={onClose}
      title={t('contact_us')}
      subtitle={
        <>
          {t('contact_us_subtitle')} {t('contact_us_subtitle_extra')}{' '}
          <a
            href="https://github.com/OlympiadsXYZ/olympiads-xyz/issues"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Github {t('issue')}
          </a>
          . {t('contact_us_subtitle_further_email')}
          <a
            href="mailto:olympiads.xyz@gmail.com"
            className="underline"
          >
            olympiads.xyz@gmail.com
          </a>
          .
        </>
      }
      footerButtons={
        <>
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="btn" onClick={onClose}>
              {t('cancel')}
            </button>
          </span>
          <span className="inline-flex rounded-md shadow-sm">
            <button
              type="submit"
              disabled={!submitEnabled}
              className={`btn-primary`}
            >
              {t('contact_us')}
            </button>
          </span>
        </>
      }
      onSubmit={handleSubmit}
    >
      {/* <div className="bg-gray-50 dark:bg-gray-900 mb-4">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-200">
            Ask on the USACO Forum!
          </h3>
          <div className="mt-2 max-w-xl text-sm leading-5 text-gray-500 dark:text-gray-400">
            <p>
              Get a faster response by reaching out on the USACO Forum instead.
            </p>
          </div>
          <div className="mt-5">
            <span className="inline-flex rounded-md shadow-sm">
              <a
                href="https://forum.usaco.guide/"
                target="_blank"
                rel="noreferrer"
                className="btn"
              >
                Join Forum
              </a>
            </span>
          </div>
        </div>
      </div> */}
      <div className="px-4 sm:px-6 mt-4">
        {showSuccess && (
          <div className="rounded-md bg-green-50 dark:bg-green-800 p-4">
            <div className="flex">
              <div className="flex-grow-0">
                <svg
                  className="h-5 w-5 text-green-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm leading-5 font-medium text-green-800 dark:text-dark-high-emphasis">
                  {t('message_received')}
                </h3>
                <div className="mt-2 text-sm leading-5 text-green-700 dark:text-dark-high-emphasis">
                  <p>
                    {t('message_received_info')}{' '}
                    <a
                      href={issueLink}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold hover:underline"
                    >
                      {issueLink}
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {!showSuccess && (
          <div className="space-y-6 pb-5">
            <Field
              label={t('name_label')}
              id="contact_name"
              value={name}
              onChange={e => setName(e.target.value)}
              errorMsg={
                showErrors && name === '' ? t('field_required') : null
              }
            />
            <Field
              label={t('email_label')}
              id="contact_email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              errorMsg={
                showErrors
                  ? email === ''
                    ? t('field_required')
                    : !validateEmail(email)
                    ? t('email_invalid')
                    : null
                  : null
              }
            />
            <Field
              label={t('module_or_solution_label')}
              id="contact_module"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
            <fieldset className="space-y-2">
              <legend className="text-sm leading-5 font-medium text-gray-900 dark:text-dark-high-emphasis">
                {t('topic')}
              </legend>
              <div className="text-sm">
                {t('contact_us_warning')}
              </div>
              <div className="space-y-3">
                {topics.map((top, idx) => (
                  <div key={idx}>
                    <div className="relative flex items-start">
                      <div className="absolute flex items-center h-5">
                        <input
                          id={`contact_topic_${idx}`}
                          type="radio"
                          name="type"
                          className="form-radio h-4 w-4 text-blue-600 dark:bg-gray-600 dark:focus:ring-offset-dark-surface"
                          checked={topic === top[0]}
                          onChange={() => setTopic(top[0])}
                        />
                      </div>
                      <div className="pl-7 text-sm leading-5">
                        <label
                          htmlFor={`contact_topic_${idx}`}
                          className="font-medium text-gray-900 dark:text-dark-high-emphasis"
                        >
                          {top[0]} {top.length > 1 ? `(${t('e.g.')} ${top[1]})` : ''}
                        </label>
                        {topic === top[0] && top[0].startsWith(t('mistake')) && (
                          <div>
                            {t('submit_pull_request')}{' '}
                            <a
                              className="hover:underline text-blue-600 dark:text-blue-300"
                              target="_blank"
                              rel="noreferrer"
                              href="https://github.com/OlympiadsXYZ/olympiads-xyz/pulls"
                            >
                              {t('here')}
                            </a>{' '}
                            {t('submit_pull_request_info')}{' '}
                            <a
                              className="hover:underline text-blue-600 dark:text-blue-300"
                              target="_blank"
                              rel="noreferrer"
                              href="/general/contributing"
                            >
                              {t('this_module')}
                            </a>{' '}
                            {t('for_how_to_contribute')}
                          </div>
                        )}
                        {topic === top[0] && top[0].startsWith(t('unclear_explanation')) && (
                          <div>
                            {t('unclear_explanation_info')}
                          </div>
                        )}
                        {topic === top[0] && top[0].includes(t('website_bug')) && (
                          <div>
                            {t('website_bug_info')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {showErrors && topic === '' && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {t('field_required')}
                  </p>
                )}
              </div>
            </fieldset>
            <div className="space-y-1">
              <label
                htmlFor="contact_message"
                className="block text-sm font-medium leading-5 text-gray-900 dark:text-dark-high-emphasis"
              >
                {t('message_markdown-supported')}
              </label>
              <div className="relative rounded-md shadow-sm">
                <textarea
                  id="contact_message"
                  rows={4}
                  className={
                    'textarea ' +
                    (showErrors && (message.length < 10 || message.length > 1200)
                      ? 'border-red-300 dark:border-red-300 text-red-900 dark:text-red-300 placeholder-red-300 focus:border-red-300 dark:focus:border-red-300  focus:ring-red-300 dark:focus:ring-red-300'
                      : '')
                  }
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                <div className="flex justify-end text-sm text-gray-500 dark:text-gray-400 mt-1">
                   <span className={message.length > 1200 ? 'text-red-500' : ''}>
                      {message.length}/1200
                  </span>
                </div>
                {showErrors && (message.length < 10 || message.length > 1200) && (
                  <div className="absolute top-0 pt-2 right-0 pr-3 flex items-center pointer-events-none">
                    <svg
                      className="h-5 w-5 text-red-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
              {showErrors && (message.length < 10 || message.length > 1200) && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {
                    message.length < 10 
                    ? t('message_must_be_at_least_10_chars') 
                    : t('message_must_be_at_most_1200_chars')
                  }
                </p>
              )}
            </div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('include-name-in-issue')}
              </span>
              <button
                type="button"
                className={`${
                  includeNameInIssue ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                } relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
                onClick={() => {
                  setIncludeNameInIssue(!includeNameInIssue);
                }}
              >
                <span
                  className={`${
                    includeNameInIssue ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none relative inline-block h-5 w-5 rounded-full bg-white dark:bg-gray-200 shadow transform ring-0 transition ease-in-out duration-200`}
                >
                  <span
                    className={`${
                      includeNameInIssue
                        ? 'opacity-0 ease-out duration-100'
                        : 'opacity-100 ease-in duration-200'
                    } absolute inset-0 h-full w-full flex items-center justify-center transition-opacity`}
                  >
                    <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 12 12">
                      <path
                        d="M4 8l2-2m0 0l2-2M6 6L4 4m2 2l2 2"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span
                    className={`${
                      includeNameInIssue
                        ? 'opacity-100 ease-in duration-200'
                        : 'opacity-0 ease-out duration-100'
                    } absolute inset-0 h-full w-full flex items-center justify-center transition-opacity`}
                  >
                    <svg className="h-3 w-3 text-blue-600" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M3.707 5.293a1 1 0 00-1.414 1.414l1.414-1.414zM5 8l-.707.707a1 1 0 001.414 0L5 8zm4.707-3.293a1 1 0 00-1.414-1.414l1.414 1.414zm-7.414 2l2 2 1.414-1.414-2-2-1.414 1.414zm3.414 2l4-4-1.414-1.414-4 4 1.414 1.414z" />
                    </svg>
                  </span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </SlideoverForm>
  );
}
