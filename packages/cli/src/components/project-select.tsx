import React, { useState, useEffect } from 'react';
import { Box, Text, useStdin } from 'ink';
import { SelectList } from './select-list.js';
import type { Project, ProjectConfigManager } from '../commands/project-config-manager.js';

interface ProjectSelectProps {
  name?: string;
  projectConfig: ProjectConfigManager;
}

// Separate component for interactive selection
const InteractiveProjectSelect = ({
  projects,
  currentProject,
  projectConfig,
}: {
  projects: Project[];
  currentProject: string | null;
  projectConfig: ProjectConfigManager;
}) => {
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // If selection was made, show success
  if (result && result.success && selectedProject) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Project switched successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Current project:</Text> {selectedProject.name}
          </Text>
          <Text>
            <Text bold>URL:</Text> {selectedProject.url}
          </Text>
        </Box>
      </Box>
    );
  }

  const currentIndex = projects.findIndex((p) => p.name === currentProject);

  return (
    <SelectList
      items={projects.map((p) => ({
        id: p.name,
        label: p.name,
        extra: p.name === currentProject ? <Text color="green"> (current)</Text> : undefined,
      }))}
      header="Select a project:"
      initialIndex={currentIndex >= 0 ? currentIndex : 0}
      onSelect={(item) => {
        const project = projects.find((p) => p.name === item.label);
        if (project) {
          setSelectedProject(project);
          const selectResult = projectConfig.selectProject(project.name);
          setResult(selectResult);
        }
      }}
    />
  );
};

export const ProjectSelect = ({ name, projectConfig }: ProjectSelectProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [isInteractive] = useState(!name);
  const { isRawModeSupported } = useStdin();

  useEffect(() => {
    const { projects: projectList, current } = projectConfig.listProjects();
    setProjects(projectList);
    setCurrentProject(current);

    // If name is provided, select it directly
    if (name) {
      const selectResult = projectConfig.selectProject(name);
      setResult(selectResult);
    }
  }, [name, projectConfig]);

  // Handle no projects case
  if (projects.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">❌ No projects configured</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Add a project first with "px project add &lt;name&gt; --url &lt;url&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Direct selection mode - show result
  if (!isInteractive && result) {
    if (result.success) {
      const selectedProject = projects.find(p => p.name === name);
      return (
        <Box flexDirection="column">
          <Text color="green">✅ Project switched successfully!</Text>
          <Box marginTop={1} paddingLeft={2} flexDirection="column">
            <Text>
              <Text bold>Current project:</Text> {name}
            </Text>
            {selectedProject && (
              <Text>
                <Text bold>URL:</Text> {selectedProject.url}
              </Text>
            )}
          </Box>
        </Box>
      );
    } else {
      return (
        <Box flexDirection="column">
          <Text color="red">❌ Failed to select project</Text>
          <Box paddingLeft={2}>
            <Text color="red">{result.error}</Text>
          </Box>
          {projects.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text>Available projects:</Text>
              {projects.map(p => (
                <Box key={p.name} paddingLeft={2}>
                  <Text dimColor>• {p.name}</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
  }

  // Interactive selection mode
  if (isInteractive) {
    // If raw mode is not supported (e.g., in tests), show a non-interactive list
    if (!isRawModeSupported) {
      return (
        <Box flexDirection="column">
          <Text bold>Available projects:</Text>
          <Box marginTop={1} flexDirection="column">
            {projects.map((project) => {
              const isCurrent = project.name === currentProject;
              return (
                <Box key={project.name} paddingLeft={2}>
                  <Text>
                    • {project.name}
                    {isCurrent && <Text color="green"> (current)</Text>}
                  </Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Interactive mode not available. Use "px project select &lt;name&gt;" to select a project.
            </Text>
          </Box>
        </Box>
      );
    }

    // Use the interactive component that has useInput
    return <InteractiveProjectSelect
      projects={projects}
      currentProject={currentProject}
      projectConfig={projectConfig}
    />;
  }

  return <Text>Processing...</Text>;
};