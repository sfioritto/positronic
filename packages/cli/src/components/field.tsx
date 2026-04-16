import React from 'react';
import { Box, Text } from 'ink';

// Component to display a labeled field
export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <Box>
    <Box width={14}>
      <Text dimColor>{label}:</Text>
    </Box>
    <Box flexGrow={1}>{children}</Box>
  </Box>
);
