import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';

interface BrainStep {
  type: 'step' | 'brain';
  title: string;
  innerBrain?: {
    title: string;
    description?: string;
    steps: BrainStep[];
  };
}

interface BrainDetails {
  name: string;
  title: string;
  description?: string;
  steps: BrainStep[];
}

interface BrainShowProps {
  brainName: string;
}

const StepDisplay: React.FC<{ step: BrainStep; indent?: number }> = ({ step, indent = 0 }) => {
  const indentStr = '  '.repeat(indent);
  
  if (step.type === 'step') {
    return (
      <Text>
        {indentStr}• {step.title}
      </Text>
    );
  } else {
    // Nested brain
    return (
      <Box flexDirection="column">
        <Text>
          {indentStr}▸ {step.title} <Text dimColor>(nested brain)</Text>
        </Text>
        {step.innerBrain?.steps.map((innerStep, idx) => (
          <StepDisplay key={idx} step={innerStep} indent={indent + 1} />
        ))}
      </Box>
    );
  }
};

export const BrainShow = ({ brainName }: BrainShowProps) => {
  const { data, loading, error } = useApiGet<BrainDetails>(`/brains/${encodeURIComponent(brainName)}`);

  if (loading) {
    return (
      <Box>
        <Text>🧠 Loading brain details...</Text>
      </Box>
    );
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (!data) {
    return (
      <Box flexDirection="column">
        <Text color="red">Brain '{brainName}' not found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>{data.title}</Text>
      
      {data.description && (
        <Text dimColor>{data.description}</Text>
      )}
      
      <Box flexDirection="column">
        <Text bold>Steps:</Text>
        <Box flexDirection="column" marginLeft={1}>
          {data.steps.map((step: BrainStep, idx: number) => (
            <StepDisplay key={idx} step={step} />
          ))}
        </Box>
      </Box>
    </Box>
  );
};