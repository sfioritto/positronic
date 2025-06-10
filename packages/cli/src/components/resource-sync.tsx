import React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { ErrorComponent } from './error.js';
import { useApiGet, useApiPost } from '../hooks/useApi.js';
import { ResourceEntry } from '@positronic/core';

interface SyncStats {
  uploadCount: number;
  skipCount: number;
  errorCount: number;
  totalCount: number;
  currentFile?: string;
  currentAction?: 'connecting' | 'uploading' | 'checking' | 'done' | 'error';
  errors: Array<{ file: string; message: string }>;
}

interface ApiResourceEntry extends ResourceEntry {
  size: number;
  lastModified: string;
}

interface ResourcesResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

interface ResourceSyncProps {
  localResources: ResourceEntry[];
  resourcesDir: string | null;
  textExtensions: Set<string>;
}

export const ResourceSync = ({
  localResources,
  resourcesDir,
  textExtensions
}: ResourceSyncProps) => {
  const [stats, setStats] = useState<SyncStats>({
    uploadCount: 0,
    skipCount: 0,
    errorCount: 0,
    totalCount: localResources.length,
    errors: [],
    currentAction: 'connecting'
  });

  // Use the hook to fetch resources
  const {
    data: serverResourcesData,
    error: fetchError
  } = useApiGet<ResourcesResponse>('/resources');
  const { execute: uploadResource } = useApiPost<any>('/resources');

  useEffect(() => {
    if (!resourcesDir || !serverResourcesData) {
      return;
    }

    const performSync = async () => {
      const serverResourceMap = new Map(
        serverResourcesData.resources.map((r) => [r.key, r])
      );

      if (localResources.length === 0) {
        setStats(prev => ({
          ...prev,
          currentAction: 'done',
          totalCount: 0
        }));
        return;
      }

      // Initialize stats
      setStats({
        uploadCount: 0,
        skipCount: 0,
        errorCount: 0,
        totalCount: localResources.length,
        errors: [],
        currentAction: 'checking',
      });

      // Step 2: Compare and sync
      let uploadCount = 0;
      let skipCount = 0;
      let errorCount = 0;
      const errors: Array<{ file: string; message: string }> = [];

      for (const resource of localResources) {
        setStats({
          uploadCount,
          skipCount,
          errorCount,
          totalCount: localResources.length,
          currentFile: resource.key,
          currentAction: 'checking',
          errors,
        });

        const fileStats = fs.statSync(resource.path);
        const serverResource = serverResourceMap.get(resource.key);

        // Check if we need to upload (new or modified)
        let shouldUpload = !serverResource;

        if (serverResource && serverResource.size !== fileStats.size) {
          // Size mismatch indicates file has changed
          shouldUpload = true;
        } else if (serverResource) {
          // For same-size files, check modification time if available
          const localModTime = fileStats.mtime.toISOString();
          if (localModTime > serverResource.lastModified) {
            shouldUpload = true;
          }
        }

        if (shouldUpload) {
          try {
            setStats({
              uploadCount,
              skipCount,
              errorCount,
              totalCount: localResources.length,
              currentFile: resource.key,
              currentAction: 'uploading',
              errors,
            });

            const fileContent = fs.readFileSync(resource.path);
            const formData = new FormData();

            formData.append(
              'file',
              new Blob([fileContent]),
              path.basename(resource.path)
            );
            formData.append('type', resource.type);
            formData.append('path', resource.key);
            formData.append('key', resource.key);

            await uploadResource(formData);
            uploadCount++;
          } catch (error: any) {
            errorCount++;
            errors.push({ file: resource.key, message: error.details || error.message });
          }
        } else {
          skipCount++;
        }
      }

      // Final update
      setStats({
        uploadCount,
        skipCount,
        errorCount,
        totalCount: localResources.length,
        currentAction: 'done',
        errors,
      });
    };

    performSync();
  }, [localResources, resourcesDir, textExtensions, serverResourcesData, uploadResource]);

  const {
    uploadCount,
    skipCount,
    errorCount,
    totalCount,
    currentFile,
    currentAction,
    errors,
  } = stats;

  const processedCount = uploadCount + skipCount + errorCount;

  if (fetchError) {
    return <ErrorComponent error={fetchError} />;
  }

  if (currentAction === 'connecting' && !serverResourcesData) {
    return (
      <Box>
        <Text>🔌 Connecting to server...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {currentAction !== 'done' && currentFile && (
        <Box>
          <Text>{currentAction === 'uploading' ? '⬆️  Uploading' : '🔍 Checking'} {currentFile}...</Text>
        </Box>
      )}

      {totalCount > 0 && (
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
          {errors.map((error, i) => (
            <Box key={i} paddingLeft={2}>
              <Text color="red">❌ {error.file}: {error.message}</Text>
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
            {errorCount > 0 && (
              <Text color="red">  • Errors: {errorCount}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};