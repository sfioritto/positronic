import React from 'react';
import { Text, Box, useStdout, useInput } from 'ink';
import type { BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import type { StoredEvent } from './events-view.js';

interface EventDetailProps {
  stored: StoredEvent;
  scrollOffset: number;
  onScrollChange: (offset: number) => void;
  isActive?: boolean;
}

function formatFullTimestamp(timestamp: Date): string {
  return timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'complete':
      return '✓';
    case 'skipped':
      return '-';
    case 'running':
      return '•';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

function getEventSymbol(event: BrainEvent): { symbol: string; color: string } {
  switch (event.type) {
    case BRAIN_EVENTS.START:
      return { symbol: '[>]', color: 'yellow' };
    case BRAIN_EVENTS.COMPLETE:
      return { symbol: '[ok]', color: 'green' };
    case BRAIN_EVENTS.ERROR:
      return { symbol: '[!!]', color: 'red' };
    case BRAIN_EVENTS.CANCELLED:
      return { symbol: '[x]', color: 'red' };
    case BRAIN_EVENTS.STEP_START:
      return { symbol: '[.]', color: 'yellow' };
    case BRAIN_EVENTS.STEP_COMPLETE:
      return { symbol: '[+]', color: 'green' };
    case BRAIN_EVENTS.STEP_RETRY:
      return { symbol: '[?]', color: 'yellow' };
    case BRAIN_EVENTS.STEP_STATUS:
      return { symbol: '[-]', color: 'gray' };
    case BRAIN_EVENTS.WEBHOOK:
      return { symbol: '[~]', color: 'cyan' };
    case BRAIN_EVENTS.WEBHOOK_RESPONSE:
      return { symbol: '[<]', color: 'cyan' };
    case BRAIN_EVENTS.AGENT_START:
      return { symbol: '[A]', color: 'yellow' };
    case BRAIN_EVENTS.AGENT_ITERATION:
      return { symbol: '[#]', color: 'gray' };
    case BRAIN_EVENTS.AGENT_TOOL_CALL:
      return { symbol: '[T]', color: 'white' };
    case BRAIN_EVENTS.AGENT_TOOL_RESULT:
      return { symbol: '[R]', color: 'white' };
    case BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE:
      return { symbol: '[M]', color: 'white' };
    case BRAIN_EVENTS.AGENT_COMPLETE:
      return { symbol: '[A]', color: 'green' };
    case BRAIN_EVENTS.AGENT_TOKEN_LIMIT:
      return { symbol: '[!]', color: 'red' };
    case BRAIN_EVENTS.AGENT_ITERATION_LIMIT:
      return { symbol: '[!]', color: 'red' };
    case BRAIN_EVENTS.AGENT_WEBHOOK:
      return { symbol: '[W]', color: 'cyan' };
    default:
      return { symbol: '[?]', color: 'gray' };
  }
}

function getEventDetailContent(event: BrainEvent): string {
  switch (event.type) {
    case BRAIN_EVENTS.AGENT_TOOL_CALL:
      return [
        `Tool: ${event.toolName}`,
        `Tool Call ID: ${event.toolCallId}`,
        `Step: ${event.stepTitle}`,
        '',
        'Input:',
        JSON.stringify(event.input, null, 2),
      ].join('\n');

    case BRAIN_EVENTS.AGENT_TOOL_RESULT:
      return [
        `Tool: ${event.toolName}`,
        `Tool Call ID: ${event.toolCallId}`,
        `Step: ${event.stepTitle}`,
        '',
        'Result:',
        formatValue(event.result),
      ].join('\n');

    case BRAIN_EVENTS.ERROR:
      return [
        `Brain: ${event.brainTitle}`,
        '',
        `Error: ${event.error.name}`,
        `Message: ${event.error.message}`,
        '',
        'Stack Trace:',
        event.error.stack || '(no stack trace)',
      ].join('\n');

    case BRAIN_EVENTS.AGENT_COMPLETE:
      return [
        `Step: ${event.stepTitle}`,
        `Terminal Tool: ${event.terminalToolName}`,
        `Total Iterations: ${event.totalIterations}`,
        `Total Tokens: ${event.totalTokens.toLocaleString()}`,
        '',
        'Result:',
        JSON.stringify(event.result, null, 2),
      ].join('\n');

    case BRAIN_EVENTS.AGENT_ITERATION:
      return [
        `Step: ${event.stepTitle}`,
        `Iteration: ${event.iteration}`,
        `Tokens This Iteration: ${event.tokensThisIteration.toLocaleString()}`,
        `Total Tokens So Far: ${event.totalTokens.toLocaleString()}`,
      ].join('\n');

    case BRAIN_EVENTS.STEP_COMPLETE:
      return [
        `Step: ${event.stepTitle}`,
        `Step ID: ${event.stepId}`,
        '',
        'State Patch:',
        JSON.stringify(event.patch, null, 2),
      ].join('\n');

    case BRAIN_EVENTS.AGENT_START:
      return [
        `Step: ${event.stepTitle}`,
        `Step ID: ${event.stepId}`,
        '',
        'Tools:',
        ...(event.tools && event.tools.length > 0
          ? event.tools.map((t) => `  • ${t}`)
          : ['  (none)']),
        '',
        'Prompt:',
        event.prompt,
        ...(event.system ? ['', 'System Prompt:', event.system] : []),
      ].join('\n');

    case BRAIN_EVENTS.START:
      return [
        `Brain: ${event.brainTitle}`,
        ...(event.brainDescription ? [`Description: ${event.brainDescription}`] : []),
        `Run ID: ${event.brainRunId}`,
        '',
        'Options:',
        JSON.stringify(event.options, null, 2),
      ].join('\n');

    case BRAIN_EVENTS.AGENT_TOKEN_LIMIT:
      return [
        `Step: ${event.stepTitle}`,
        `Total Tokens: ${event.totalTokens.toLocaleString()}`,
        `Max Tokens: ${event.maxTokens.toLocaleString()}`,
        '',
        'Token limit exceeded. Agent stopped.',
      ].join('\n');

    case BRAIN_EVENTS.AGENT_ITERATION_LIMIT:
      return [
        `Step: ${event.stepTitle}`,
        `Iteration: ${event.iteration}`,
        `Max Iterations: ${event.maxIterations}`,
        `Total Tokens: ${event.totalTokens.toLocaleString()}`,
        '',
        'Iteration limit reached. Agent stopped.',
      ].join('\n');

    case BRAIN_EVENTS.STEP_STATUS:
      return ['Steps:', ...event.steps.map((s) => `  ${getStatusIcon(s.status)} ${s.title}`)].join('\n');

    case BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE:
      return [`Step: ${event.stepTitle}`, '', 'Message:', event.content].join('\n');

    case BRAIN_EVENTS.STEP_START:
      return [`Step: ${event.stepTitle}`, `Step ID: ${event.stepId}`].join('\n');

    case BRAIN_EVENTS.STEP_RETRY:
      return [`Step: ${event.stepTitle}`, `Step ID: ${event.stepId}`, `Attempt: ${event.attempt}`].join('\n');

    case BRAIN_EVENTS.COMPLETE:
      return [`Brain: ${event.brainTitle}`, '', 'Brain completed successfully.'].join('\n');

    case BRAIN_EVENTS.CANCELLED:
      return [`Brain: ${event.brainTitle}`, '', 'Brain was cancelled.'].join('\n');

    case BRAIN_EVENTS.WEBHOOK:
      return [
        'Waiting for webhook response...',
        '',
        'Wait For:',
        JSON.stringify(event.waitFor, null, 2),
      ].join('\n');

    case BRAIN_EVENTS.WEBHOOK_RESPONSE:
      return ['Webhook Response:', JSON.stringify(event.response, null, 2)].join('\n');

    case BRAIN_EVENTS.AGENT_WEBHOOK:
      return [
        `Step: ${event.stepTitle}`,
        `Tool: ${event.toolName}`,
        `Tool Call ID: ${event.toolCallId}`,
        '',
        'Agent waiting for webhook response...',
      ].join('\n');

    default:
      // Show all fields for any event type
      return JSON.stringify(event, null, 2);
  }
}

export const EventDetail = ({ stored, scrollOffset, onScrollChange, isActive = true }: EventDetailProps) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const maxLines = Math.max(5, terminalHeight - 8);

  const content = getEventDetailContent(stored.event);
  const lines = content.split('\n');
  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - maxLines);

  // Handle scrolling
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.upArrow || input === 'k') {
        onScrollChange(Math.max(0, scrollOffset - 1));
      } else if (key.downArrow || input === 'j') {
        onScrollChange(Math.min(maxScroll, scrollOffset + 1));
      }
    },
    { isActive }
  );

  const visibleLines = lines.slice(scrollOffset, scrollOffset + maxLines);
  const { symbol, color } = getEventSymbol(stored.event);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={color}>{symbol} </Text>
        <Text bold>{stored.event.type}</Text>
        <Text dimColor> • {formatFullTimestamp(stored.timestamp)}</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" marginLeft={2}>
        {visibleLines.map((line, i) => (
          <Text key={scrollOffset + i}>{line}</Text>
        ))}
      </Box>

      {/* Scroll indicator */}
      {totalLines > maxLines && (
        <Box marginTop={1}>
          <Text dimColor>
            Lines {scrollOffset + 1}-{Math.min(scrollOffset + maxLines, totalLines)} of {totalLines}
          </Text>
        </Box>
      )}
    </Box>
  );
};
