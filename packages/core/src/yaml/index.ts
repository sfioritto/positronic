/**
 * YAML-based UI generation module.
 *
 * Provides parsing, validation, and type inference for YAML UI templates.
 */

export * from './types.js';
export { parseTemplate, stringifyTemplate } from './parser.js';
export {
  inferDataType,
  resolvePathType,
  validateDataBindings,
} from './data-validator.js';
export {
  extractFormSchema,
  fieldsToShape,
  validateAgainstZod,
} from './schema-extractor.js';
export { describeDataShape, inferTypeWithExamples } from './type-inference.js';
