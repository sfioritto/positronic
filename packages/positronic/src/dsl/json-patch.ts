import pkg from 'fast-json-patch';
const { compare, applyPatch } = pkg;
import { JsonPatch, State } from './types.js';

/**
 * Creates a JSON Patch that describes the changes needed to transform prevState into nextState.
 */
export function createPatch(prevState: State, nextState: State): JsonPatch {
  // Filter out non-standard operations and ensure type safety
  return compare(prevState, nextState).filter(op =>
    ['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(op.op)
  ) as JsonPatch;
}

/**
 * Applies one or more JSON Patches to a state object and returns the resulting state.
 * If multiple patches are provided, they are applied in sequence.
 */
export function applyPatches(state: State, patches: JsonPatch | JsonPatch[]): State {
  const patchArray = Array.isArray(patches[0]) ? patches as JsonPatch[] : [patches as JsonPatch];

  // Apply patches in sequence, creating a new state object each time
  return patchArray.reduce((currentState, patch) => {
    const { newDocument } = applyPatch(currentState, patch as any[], true, false);
    return newDocument;
  }, { ...state });
}