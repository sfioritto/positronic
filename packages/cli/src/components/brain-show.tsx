import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { BrainResolver } from './brain-resolver.js';

// Types for brain structure from API
interface BrainStep {
  type: 'step' | 'brain' | 'loop';
  title: string;
  innerBrain?: BrainStructure;
}

interface BrainStructure {
  title: string;
  description?: string;
  steps: BrainStep[];
  options?: {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
}

interface Schedule {
  id: string;
  brainTitle: string;
  cronExpression: string;
  enabled: boolean;
}

interface SchedulesResponse {
  schedules: Schedule[];
}

// Component to display a labeled field
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
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

// Recursive component for rendering step tree
interface StepTreeProps {
  steps: BrainStep[];
  depth?: number;
}

const StepTree = ({ steps, depth = 0 }: StepTreeProps) => {
  return (
    <Box flexDirection="column" marginLeft={depth > 0 ? 2 : 0}>
      {steps.map((step, index) => (
        <Box key={index} flexDirection="column">
          <Box marginLeft={1}>
            <Text color="gray">○ {step.title}</Text>
            {step.type === 'loop' && <Text dimColor> (loop)</Text>}
          </Box>
          {step.innerBrain && (
            <Box marginLeft={2} marginTop={0}>
              <Box flexDirection="column">
                <Text dimColor>└─ Inner Brain: {step.innerBrain.title}</Text>
                <StepTree steps={step.innerBrain.steps} depth={depth + 1} />
              </Box>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};

// Component for rendering options
const OptionsSection = ({
  options,
  brainTitle,
}: {
  options: NonNullable<BrainStructure['options']>;
  brainTitle: string;
}) => {
  const { properties, required } = options;

  if (!properties || Object.keys(properties).length === 0) {
    return null;
  }

  const entries = Object.entries(properties);
  const requiredSet = new Set(required || []);

  const flags = entries
    .map(([name, prop]) => `-o ${name}=<${prop.type || 'any'}>`)
    .join(' ');

  return (
    <>
      <Box flexDirection="column">
        <Text bold>Options:</Text>
        <Box marginLeft={2} flexDirection="column">
          {entries.map(([name, prop]) => {
            const isRequired = requiredSet.has(name);
            return (
              <Box key={name}>
                <Text>
                  {name}
                  <Text dimColor>
                    {' '}
                    {prop.type || 'any'}
                    {isRequired ? ', required' : ''}
                  </Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text bold>Example:</Text>
        <Box marginLeft={2}>
          <Text dimColor>
            px run {brainTitle} {flags}
          </Text>
        </Box>
      </Box>
    </>
  );
};

// Main component that displays brain info after resolution
interface BrainInfoProps {
  brainTitle: string;
  showSteps: boolean;
}

const BrainInfo = ({ brainTitle, showSteps }: BrainInfoProps) => {
  const {
    data: brain,
    loading: brainLoading,
    error: brainError,
  } = useApiGet<BrainStructure>(`/brains/${encodeURIComponent(brainTitle)}`);

  const { data: schedulesData, loading: schedulesLoading } =
    useApiGet<SchedulesResponse>('/brains/schedules');

  if (brainLoading || schedulesLoading) {
    return (
      <Box>
        <Text>Loading brain info...</Text>
      </Box>
    );
  }

  if (brainError) {
    return <ErrorComponent error={brainError} />;
  }

  if (!brain) {
    return (
      <Box>
        <Text color="red">Brain not found</Text>
      </Box>
    );
  }

  // Filter schedules for this brain
  const brainSchedules =
    schedulesData?.schedules.filter((s) => s.brainTitle === brainTitle) || [];

  return (
    <Box flexDirection="column" gap={1}>
      {/* Header info */}
      <Box flexDirection="column">
        <Field label="Brain">
          <Text bold>{brain.title}</Text>
        </Field>
        {brain.description && (
          <Field label="Description">
            <Text>{brain.description}</Text>
          </Field>
        )}
      </Box>

      {/* Options */}
      {brain.options && (
        <OptionsSection options={brain.options} brainTitle={brain.title} />
      )}

      {/* Steps (only if --steps flag) */}
      {showSteps && brain.steps.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Steps:</Text>
          <StepTree steps={brain.steps} />
        </Box>
      )}

      {/* Schedules */}
      {brainSchedules.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Schedules:</Text>
          <Box marginLeft={2} flexDirection="column">
            {brainSchedules.map((schedule) => (
              <Box key={schedule.id}>
                <Text>
                  {schedule.enabled ? '•' : '○'} {schedule.cronExpression}
                  {!schedule.enabled && <Text dimColor> (disabled)</Text>}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* No schedules message */}
      {brainSchedules.length === 0 && (
        <Box>
          <Text dimColor>No schedules configured.</Text>
        </Box>
      )}
    </Box>
  );
};

// Props for the exported component
interface BrainShowProps {
  identifier: string;
  showSteps: boolean;
}

// Exported component that uses BrainResolver for fuzzy matching
export const BrainShow = ({ identifier, showSteps }: BrainShowProps) => {
  return (
    <BrainResolver identifier={identifier}>
      {(resolvedBrainTitle) => (
        <BrainInfo brainTitle={resolvedBrainTitle} showSteps={showSteps} />
      )}
    </BrainResolver>
  );
};
