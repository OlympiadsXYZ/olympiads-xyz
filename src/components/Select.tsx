import React from 'react';
import Select from 'react-select';
import { useDarkMode } from '../context/DarkModeContext';
export default function StyledSelect(props) {
  const darkMode = useDarkMode();
  return (
    <Select
      className={`tw-forms-disable text-left ${props.className}`}
      styles={
        !darkMode
          ? undefined
          : {
              control: provided => ({
                ...provided,
                backgroundColor: '#111827',
                borderColor: '#374151',
              }),
              menuList: provided => ({
                ...provided,
                borderColor: '#374151',
                borderWidth: '1px',
                borderRadius: '6px',
              }),
              menu: provided => ({
                ...provided,
                backgroundColor: '#111827',
              }),
              indicatorSeparator: provided => ({
                ...provided,
                backgroundColor: '#374151',
              }),
              // the chevron and the clear cross: gray-400, readable on the dark control
              indicatorsContainer: provided => ({
                ...provided,
                color: '#9ca3af',
              }),
              dropdownIndicator: provided => ({
                ...provided,
                color: '#9ca3af',
              }),
              clearIndicator: provided => ({
                ...provided,
                color: '#9ca3af',
              }),
              // the chips of a multi-select: gray-700 with light text, not the light default
              multiValue: provided => ({
                ...provided,
                backgroundColor: '#374151',
              }),
              multiValueLabel: provided => ({
                ...provided,
                color: 'rgba(255, 255, 255, 0.87)',
              }),
              multiValueRemove: provided => ({
                ...provided,
                color: '#9ca3af',
                ':hover': { backgroundColor: '#4b5563', color: '#ffffff' },
              }),
              singleValue: provided => ({
                ...provided,
                color: 'rgba(255, 255, 255, 0.87)',
              }),
              input: provided => ({
                ...provided,
                color: 'rgba(255, 255, 255, 0.87)',
              }),
              option: (provided, { isFocused, isSelected }) => ({
                ...provided,
                ...(isFocused
                  ? {
                      backgroundColor: '#4d94ff',
                    }
                  : isSelected
                  ? { backgroundColor: '#0063e6' }
                  : {}),
              }),
            }
      }
      {...props}
    />
  );
}
