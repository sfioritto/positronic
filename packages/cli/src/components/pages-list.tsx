import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';
import { padRight, truncate, formatDate, formatSize } from '../lib/format.js';

interface Page {
  slug: string;
  url: string;
  brainRunId: string;
  persist: boolean;
  ttl?: number;
  createdAt: string;
  size: number;
}

interface PagesResponse {
  pages: Page[];
  count: number;
}

export const PagesList = () => {
  const { data, loading, error } = useApiGet<PagesResponse>('/pages');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Loading pages...</Text>
      </Box>
    );
  }

  if (!data || data.pages.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No pages found.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Pages are created by brains using pages.create() in step actions.
          </Text>
        </Box>
      </Box>
    );
  }

  // Sort pages by creation date (newest first)
  const sortedPages = [...data.pages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Define column widths
  const columns = {
    slug: { header: 'Slug', width: 25 },
    persist: { header: 'Persist', width: 8 },
    size: { header: 'Size', width: 10 },
    brainRunId: { header: 'Brain Run ID', width: 20 },
    created: { header: 'Created', width: 22 },
  };

  // Calculate total width for separator
  const totalWidth =
    Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} page{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">
            {padRight(columns.slug.header, columns.slug.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.persist.header, columns.persist.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.size.header, columns.size.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.brainRunId.header, columns.brainRunId.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.created.header, columns.created.width)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedPages.map((page) => (
          <Box key={page.slug}>
            <Text>
              {padRight(
                truncate(page.slug, columns.slug.width),
                columns.slug.width
              )}
            </Text>
            <Text> </Text>
            <Text color={page.persist ? 'green' : 'yellow'}>
              {padRight(page.persist ? 'Yes' : 'No', columns.persist.width)}
            </Text>
            <Text> </Text>
            <Text>{padRight(formatSize(page.size), columns.size.width)}</Text>
            <Text> </Text>
            <Text dimColor>
              {padRight(
                truncate(page.brainRunId, columns.brainRunId.width),
                columns.brainRunId.width
              )}
            </Text>
            <Text> </Text>
            <Text dimColor>
              {padRight(formatDate(page.createdAt), columns.created.width)}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Tip: View a page URL by visiting your deployment at
          /pages/&lt;slug&gt;
        </Text>
      </Box>
    </Box>
  );
};
