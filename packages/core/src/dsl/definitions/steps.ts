import type { STATUS } from '../constants.js';
import type { JsonPatch } from '../types.js';

export interface SerializedStep {
  title: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  id: string;
  patch?: JsonPatch;
  innerSteps?: SerializedStep[]; // For nested brain steps (recursive)
}

// Type for Step Status Event, omitting the patch
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

// Type for brain structure
export interface BrainStructure {
  title: string;
  description?: string;
  steps: Array<{
    type: 'step' | 'brain' | 'agent';
    title: string;
    innerBrain?: BrainStructure;
  }>;
}
