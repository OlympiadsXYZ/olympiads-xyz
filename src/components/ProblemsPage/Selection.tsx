import React, { useEffect, useState } from 'react';
import {
  UseRefinementListProps,
  useInstantSearch,
  useRefinementList,
} from 'react-instantsearch';
import Select from '../Select';
import { useTranslation } from 'react-i18next';

export type SelectionProps = UseRefinementListProps & {
  placeholder: string;
  searchable: boolean;
  isMulti: boolean;
  transformLabel?: (label: string) => string;
  items?: { label: string; value: string | string[] }[];
};

export default function Selection({
  attribute,
  limit,
  placeholder,
  searchable,
  isMulti,
  transformLabel: transform,
  items,
  ...props
}: SelectionProps) {
  const { t } = useTranslation();
  const { items: refineItems } = useRefinementList({
    attribute,
    limit,
    ...props,
  });
  if (!items) items = refineItems;
  for (const key in items) {
    if (items[key].value instanceof Array) {
      (items[key].value as string[]).push('null');
    }
  }
  const [refinements, setRefinements] = useState<string[]>([]);
  const { setIndexUiState } = useInstantSearch();
  useEffect(() => {
    setIndexUiState(prevIndexUiState => ({
      refinementList: {
        ...prevIndexUiState.refinementList,
        [attribute]: refinements,
      },
    }));
  }, [refinements]);

  const transformDifficultyLabel = (label: string) => {
    if (attribute === 'difficulty') {
      switch (label) {
        case 'Very Easy':
          return t('very-easy');
        case 'Easy':
          return t('easy');
        case 'Normal':
          return t('normal');
        case 'Hard':
          return t('hard');
        case 'Very Hard':
          return t('very-hard');
        case 'Insane':
          return t('insane');
        case 'N/A':
          return t('n/a');
        default:
          return label;
      }
    }
    return transform ? transform(label) : label;
  };

  return (
    <Select
      onChange={(items: any) => {
        if (isMulti) setRefinements(items.map(item => item.value).flat());
        else if (items) setRefinements([items.value]);
        else setRefinements([]);
      }}
      isClearable
      placeholder={placeholder}
      isMulti={isMulti}
      isSearchable={searchable}
      options={items.map(item => ({
        ...item,
        label: transformDifficultyLabel(item.label),
      }))}
      className="text-black dark:text-white"
      classNamePrefix="select"
    />
  );
}
