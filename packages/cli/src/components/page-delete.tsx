import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete } from '../hooks/useApi.js';
import { useTypeYesConfirm } from '../hooks/useTypeYesConfirm.js';

interface PageDeleteProps {
  slug: string;
  force: boolean;
}

export const PageDelete = ({ slug, force }: PageDeleteProps) => {
  const [deleted, setDeleted] = useState(false);
  const isDeleting = useRef(false);

  const { execute: deletePage, loading, error } = useApiDelete('page');
  const { confirmed, input } = useTypeYesConfirm(force);

  useEffect(() => {
    if (confirmed && !deleted && !isDeleting.current) {
      isDeleting.current = true;
      deletePage(`/pages/${encodeURIComponent(slug)}`)
        .then(() => {
          setDeleted(true);
        })
        .catch(() => {
          // Error is already handled by useApiDelete
        })
        .finally(() => {
          isDeleting.current = false;
        });
    }
  }, [confirmed, deleted, slug]);

  if (error) {
    // Check if it's a 404 error
    if (error.message?.includes('404')) {
      return (
        <Box flexDirection="column">
          <Text color="red">Page not found</Text>
          <Box marginTop={1} paddingLeft={2}>
            <Text>No page found with slug: {slug}</Text>
          </Box>
        </Box>
      );
    }
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Deleting page...</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box flexDirection="column">
        <Text color="green">Page deleted successfully!</Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>Slug: {slug}</Text>
        </Box>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">
          Warning: This will permanently delete the page
        </Text>
        <Box
          marginTop={1}
          marginBottom={1}
          paddingLeft={2}
          flexDirection="column"
        >
          <Text>Slug: {slug}</Text>
          <Text dimColor>The page will no longer be accessible.</Text>
        </Box>
        <Text>Type "yes" to confirm deletion: {input}</Text>
      </Box>
    );
  }

  return null;
};
