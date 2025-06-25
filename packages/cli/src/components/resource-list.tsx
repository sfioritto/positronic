import React from 'react';
import { Box, Text } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { ResourceEntry } from '@positronic/core';

interface ApiResourceEntry extends ResourceEntry {
  size: number;
  lastModified: string;
  local: boolean;
}

interface ResourcesResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

interface TreeNode {
  name: string;
  type: 'directory' | 'file';
  resource?: ApiResourceEntry;
  children: Map<string, TreeNode>;
}

export const ResourceList = () => {
  const { data, loading, error } = useApiGet<ResourcesResponse>('/resources');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return <Text>Loading resources...</Text>;
  }

  if (!data || data.resources.length === 0) {
    return <Text>No resources found in the project.</Text>;
  }

  const { resources, truncated } = data;

  // Build tree structure
  const root: TreeNode = {
    name: 'resources',
    type: 'directory',
    children: new Map(),
  };

  // Build the tree from flat resources
  resources.forEach((resource) => {
    const parts = resource.key.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          type: isLast ? 'file' : 'directory',
          resource: isLast ? resource : undefined,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }
  });

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>
        Found {resources.length} resource{resources.length === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1}>
        <TreeView node={root} />
      </Box>

      {truncated && (
        <Box marginTop={1}>
          <Text color="yellow">⚠️  Results truncated. More resources exist than shown.</Text>
        </Box>
      )}
    </Box>
  );
};

interface TreeViewProps {
  node: TreeNode;
  prefix?: string;
  isLast?: boolean;
  depth?: number;
}

const TreeView: React.FC<TreeViewProps> = ({ node, prefix = '', isLast = true, depth = 0 }) => {
  const children = Array.from(node.children.entries()).sort(([a], [b]) => {
    // Sort directories first, then alphabetically
    const aIsDir = node.children.get(a)!.type === 'directory';
    const bIsDir = node.children.get(b)!.type === 'directory';
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  // Don't render the root node itself, just its children
  if (node.name === 'resources' && node.type === 'directory') {
    return (
      <Box flexDirection="column">
        {children.map(([name, child], index) => (
          <React.Fragment key={name}>
            {index > 0 && <Box><Text> </Text></Box>}
            <TreeView
              node={child}
              prefix=""
              isLast={index === children.length - 1}
              depth={0}
            />
          </React.Fragment>
        ))}
      </Box>
    );
  }

  const connector = isLast ? '└── ' : '├── ';
  const extension = isLast ? '    ' : '│   ';
  const isTopLevel = depth === 0;

  return (
    <Box flexDirection="column">
      <Box>
        {!isTopLevel && <Text dimColor>{prefix}{connector}</Text>}
        <Text>
          {node.name}
          {node.resource && (
            <Text dimColor> ({formatSize(node.resource.size)})</Text>
          )}
        </Text>
      </Box>
      {children.map(([name, child], index) => (
        <TreeView
          key={name}
          node={child}
          prefix={prefix + (isTopLevel ? '' : extension)}
          isLast={index === children.length - 1}
          depth={depth + 1}
        />
      ))}
    </Box>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}