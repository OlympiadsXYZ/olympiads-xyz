import React from 'react';
import { useTranslation } from 'react-i18next';
import Select from '../Select';

export type SelectionOption = {
  /** Label shown in the dropdown. */
  label: string;
  /** The value(s) this option selects. Grouped options (e.g. sections) map to several. */
  value: string | string[];
};

export type SelectionProps = {
  /** Identifies the facet; used as a React key and for difficulty label translation. */
  attribute: string;
  placeholder: string;
  searchable: boolean;
  isMulti: boolean;
  /** Options to show. Previously derived from Algolia refinements; now computed from the static index. */
  items: SelectionOption[];
  transformLabel?: (label: string) => string;
  /** Currently selected values, flattened. */
  selected: string[];
  onChange: (values: string[]) => void;
};

/**
 * One facet dropdown. Purely controlled — the page owns the filter state and
 * does the filtering; this no longer talks to Algolia.
 */
export default function Selection({
  attribute,
  placeholder,
  searchable,
  isMulti,
  items,
  transformLabel: transform,
  selected,
  onChange,
}: SelectionProps) {
  const { t } = useTranslation();

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

  const options = items.map(item => ({
    ...item,
    label: transformDifficultyLabel(item.label),
  }));
  const selectedSet = new Set(selected);
  const isSelected = (item: SelectionOption) => {
    const values = Array.isArray(item.value) ? item.value : [item.value];
    return values.length > 0 && values.every(v => selectedSet.has(v));
  };
  const value = isMulti
    ? options.filter(isSelected)
    : options.find(isSelected) ?? null;

  return (
    <Select
      onChange={(items: any) => {
        if (isMulti) {
          onChange(
            ((items ?? []) as SelectionOption[]).map(i => i.value).flat()
          );
        } else if (items) {
          onChange([items.value].flat());
        } else {
          onChange([]);
        }
      }}
      value={value}
      isClearable
      placeholder={placeholder}
      isMulti={isMulti}
      isSearchable={searchable}
      options={options}
      className="text-black dark:text-white"
      classNamePrefix="select"
    />
  );
}
