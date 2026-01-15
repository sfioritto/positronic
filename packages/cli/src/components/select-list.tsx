import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export interface SelectListItem {
  id: string;
  label: string;
  description?: string;
  extra?: React.ReactNode;
}

export interface SelectListProps {
  items: SelectListItem[];
  header: string;
  onSelect: (item: SelectListItem, index: number) => void;
  onCancel?: () => void;
  initialIndex?: number;
  footer?: string;
}

/**
 * SelectList - A reusable component for keyboard-navigable list selection.
 *
 * Manages its own selectedIndex state and handles keyboard navigation.
 * Use arrow keys to navigate, Enter to select, q/Escape to cancel.
 */
export const SelectList = ({
  items,
  header,
  onSelect,
  onCancel,
  initialIndex = 0,
  footer = 'Use arrow keys to navigate, Enter to select, q to quit',
}: SelectListProps) => {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % items.length);
    } else if (key.return) {
      onSelect(items[selectedIndex], selectedIndex);
    } else if (input === 'q' || key.escape) {
      if (onCancel) {
        onCancel();
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{header}</Text>
      <Box marginTop={1} flexDirection="column">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={item.id} flexDirection="column" marginBottom={item.description ? 1 : 0}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '▶ ' : '  '}
                <Text bold>{item.label}</Text>
                {item.extra}
              </Text>
              {item.description && (
                <Text dimColor>
                  {'    '}
                  {item.description}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{footer}</Text>
      </Box>
    </Box>
  );
};
