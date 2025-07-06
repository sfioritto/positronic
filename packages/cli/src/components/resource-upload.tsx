import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { uploadFileWithPresignedUrl, generateTypes } from '../commands/helpers.js';
import * as fs from 'fs';
import * as path from 'path';

interface ResourceUploadProps {
  filePath: string;
  customKey?: string;
  projectRootPath?: string;
}

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export const ResourceUpload = ({ filePath, customKey, projectRootPath }: ResourceUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; details?: string } | null>(null);
  const [resourceKey, setResourceKey] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    performUpload();
    return () => {
      // Cleanup: abort upload if component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const performUpload = async () => {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        setError({
          title: 'File Not Found',
          message: `The file "${filePath}" does not exist.`,
        });
        return;
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        setError({
          title: 'Invalid Path',
          message: `"${filePath}" is not a file.`,
        });
        return;
      }

      // Determine resource key
      const key = customKey || path.basename(filePath);
      setResourceKey(key);

      setUploading(true);
      setProgress({
        loaded: 0,
        total: stats.size,
        percentage: 0,
      });

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

            // Use presigned URL upload with progress callback
      await uploadFileWithPresignedUrl(
        filePath,
        key,
        undefined, // Use default apiClient
        (progressInfo) => {
          setProgress(progressInfo);
        },
        abortControllerRef.current?.signal
      );

      setProgress({
        loaded: stats.size,
        total: stats.size,
        percentage: 100,
      });
      setComplete(true);

      // Generate types after successful upload if in local dev mode
      if (projectRootPath) {
        try {
          await generateTypes(projectRootPath);
        } catch (typeError) {
          // Don't fail the upload if type generation fails
          console.error('Failed to generate types:', typeError);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'AbortError') {
        setError({
          title: 'Upload Cancelled',
          message: 'The upload was cancelled.',
        });
      } else if (err.message?.includes('R2 credentials not configured')) {
        setError({
          title: 'R2 Configuration Required',
          message: 'Large file uploads require R2 configuration.',
          details: 'Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, and R2_BUCKET_NAME in your .env file.',
        });
      } else {
        setError({
          title: 'Upload Failed',
          message: err.message || 'An unknown error occurred',
          details: err.code === 'ECONNREFUSED'
            ? "Please ensure the server is running ('positronic server' or 'px s')"
            : undefined,
        });
      }
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  };

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (complete) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Upload complete!</Text>
        <Text dimColor>Resource key: {resourceKey}</Text>
      </Box>
    );
  }

  if (uploading && progress) {
    return (
      <Box flexDirection="column">
        <Text>⬆️  Uploading {path.basename(filePath)}...</Text>
        <Box marginTop={1}>
          <Text dimColor>Size: {formatSize(progress.total)}</Text>
        </Box>
        {progress.total > 1024 * 1024 && ( // Show progress bar for files > 1MB
          <Box marginTop={1}>
            <ProgressBar percentage={progress.percentage} />
          </Box>
        )}
      </Box>
    );
  }

  return <Text>Preparing upload...</Text>;
};

interface ProgressBarProps {
  percentage: number;
}

const ProgressBar = ({ percentage }: ProgressBarProps) => {
  const width = 30;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text>[</Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text>] {percentage.toFixed(0)}%</Text>
    </Box>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}