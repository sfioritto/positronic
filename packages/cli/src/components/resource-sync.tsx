import React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { syncResources, generateTypes, type SyncProgressCallback } from '../commands/helpers.js';
import { ResourceEntry } from '@positronic/core';

interface SyncStats {
  uploadCount: number;
  skipCount: number;
  errorCount: number;
  totalCount: number;
  deleteCount: number;
  currentFile?: string;
  currentAction?: 'connecting' | 'uploading' | 'checking' | 'deleting' | 'done' | 'error';
  errors: Array<{ file: string; message: string }>;
}

interface ResourceSyncProps {
  localResources: ResourceEntry[];
  resourcesDir: string | null;
}

export const ResourceSync = ({
  localResources,
  resourcesDir
}: ResourceSyncProps) => {
  const [stats, setStats] = useState<SyncStats>({
    uploadCount: 0,
    skipCount: 0,
    errorCount: 0,
    totalCount: localResources.length,
    deleteCount: 0,
    errors: [],
    currentAction: 'connecting'
  });
  const [error, setError] = useState<{ title: string; message: string; details?: string } | null>(null);

  useEffect(() => {
    if (!resourcesDir) {
      return;
    }

    const performSync = async () => {
      try {
        // Get the project root path (parent of resources dir)
        const projectRootPath = resourcesDir.replace(/[/\\]resources$/, '');

        const onProgress: SyncProgressCallback = (progress) => {
          setStats({
            uploadCount: progress.stats.uploadCount || 0,
            skipCount: progress.stats.skipCount || 0,
            errorCount: progress.stats.errorCount || 0,
            totalCount: progress.stats.totalCount || localResources.length,
            deleteCount: progress.stats.deleteCount || 0,
            errors: progress.stats.errors || [],
            currentFile: progress.currentFile,
            currentAction: progress.action,
          });
        };

        const result = await syncResources(projectRootPath, undefined, onProgress);

        // Update final stats with done status
        setStats({
          ...result,
          currentAction: 'done',
        });

        // Generate types after successful sync
        try {
          await generateTypes(projectRootPath);
        } catch (typeError) {
          // Don't fail the sync if type generation fails
          console.error('Failed to generate types:', typeError);
        }
      } catch (err: any) {
        setError({
          title: 'Sync Failed',
          message: err.message || 'An unknown error occurred',
          details: err.code === 'ECONNREFUSED'
            ? "Please ensure the server is running ('positronic server' or 'px s')"
            : undefined,
        });
        setStats(prev => ({ ...prev, currentAction: 'error' }));
      }
    };

    performSync();
  }, [localResources, resourcesDir]);

  const {
    uploadCount,
    skipCount,
    errorCount,
    totalCount,
    deleteCount,
    currentFile,
    currentAction,
    errors,
  } = stats;

  const processedCount = uploadCount + skipCount + errorCount;

  // Maintain consistent Box wrapper to help Ink properly calculate
  // terminal clearing between renders (prevents appending instead of overwriting)
  return (
    <Box flexDirection="column">
      {error ? (
        <ErrorComponent error={error} />
      ) : currentAction === 'connecting' ? (
        <Text>🔌 Connecting to server...</Text>
      ) : (
        <>
          {currentAction !== 'done' && currentFile && (
            <Box>
              <Text>
                {currentAction === 'uploading' ? '⬆️  Uploading' :
                 currentAction === 'deleting' ? '🗑️  Deleting' :
                 '🔍 Checking'} {currentFile}...
              </Text>
            </Box>
          )}

          {totalCount > 0 && currentAction !== 'done' && (
            <Box marginTop={1}>
              <Text dimColor>Progress: {processedCount}/{totalCount} files processed</Text>
            </Box>
          )}

          {totalCount === 0 && currentAction === 'done' && (
            <Box flexDirection="column">
              <Text>📁 No files found in the resources directory.</Text>
              <Text dimColor>Resources directory has been created and is ready for use.</Text>
            </Box>
          )}

          {errors.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red" bold>Errors:</Text>
              {errors.map((err, i) => (
                <Box key={i} paddingLeft={2}>
                  <Text color="red">❌ {err.file}: {err.message}</Text>
                </Box>
              ))}
            </Box>
          )}

          {currentAction === 'done' && totalCount > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>📊 Sync Summary:</Text>
              <Box paddingLeft={2} flexDirection="column">
                <Text color="green">  • Uploaded: {uploadCount}</Text>
                <Text color="blue">  • Skipped (up to date): {skipCount}</Text>
                {deleteCount > 0 && (
                  <Text color="yellow">  • Deleted: {deleteCount}</Text>
                )}
                {errorCount > 0 && (
                  <Text color="red">  • Errors: {errorCount}</Text>
                )}
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};