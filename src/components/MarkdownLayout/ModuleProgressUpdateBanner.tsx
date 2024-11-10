import * as React from 'react';
import { useMarkdownLayout } from '../../context/MarkdownLayoutContext';
import { ModuleInfo } from '../../models/module';
import TextTooltip from '../Tooltip/TextTooltip';
import MarkCompleteButton from './MarkCompleteButton';
import { useTranslation } from 'react-i18next';

export default function ModuleProgressUpdateBanner() {
  const {
    markdownLayoutInfo: markdownData,
    handleCompletionChange,
    moduleProgress,
  } = useMarkdownLayout();
  const { t } = useTranslation();
  if (markdownData instanceof ModuleInfo) {
    return (
      <h3 className="text-lg leading-6 font-medium text-gray-900 text-center mb-8 border-t border-b border-gray-200 py-8 dark:border-gray-800 dark:text-dark-high-emphasis flex items-center justify-center">
        <span>
          <TextTooltip content={t('module_progress_tooltip')}>
            {t('module_progress')}
          </TextTooltip>
          :
        </span>
        <span className="ml-4">
          <MarkCompleteButton
            onChange={handleCompletionChange}
            state={moduleProgress}
            dropdownAbove
          />
        </span>
      </h3>
    );
  }
  return null;
}
