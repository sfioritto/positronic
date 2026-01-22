/**
 * Type inference for generating readable data shape descriptions.
 *
 * Used to describe available data to the LLM in a TypeScript-like format
 * with inline examples for better template generation.
 */

/**
 * Infer a type description for a value.
 * Returns a simple type string like "string", "number", etc.
 */
export function inferTypeDescription(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'unknown[]';
    }
    const elementType = inferTypeDescription(value[0]);
    return `${elementType}[]`;
  }

  if (typeof value === 'object') {
    return 'object';
  }

  return 'unknown';
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format a value as an example (for inline comments).
 */
function formatExample(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return `"${truncate(value, 30)}"`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '...';
}

/**
 * Infer a type description with inline examples.
 * Makes it easier for the LLM to understand the data shape.
 *
 * @param value - The sample value to describe
 * @param indent - Current indentation level
 * @returns Multi-line string describing the type with examples
 */
export function inferTypeWithExamples(value: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    return `string // e.g., ${formatExample(value)}`;
  }

  if (typeof value === 'number') {
    return `number // e.g., ${value}`;
  }

  if (typeof value === 'boolean') {
    return `boolean // e.g., ${value}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'unknown[] // empty array';
    }

    const firstElement = value[0];
    const elementType = inferTypeWithExamples(firstElement, indent + 1);

    // For primitive arrays, keep it compact
    if (
      typeof firstElement === 'string' ||
      typeof firstElement === 'number' ||
      typeof firstElement === 'boolean'
    ) {
      return `Array<${inferTypeDescription(firstElement)}> // ${value.length} items, e.g., ${formatExample(firstElement)}`;
    }

    // For object arrays, show the structure
    return `Array<${elementType}> // ${value.length} items`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }

    const lines = ['{'];
    for (const [key, val] of entries) {
      const valType = inferTypeWithExamples(val, indent + 1);
      lines.push(`${spaces}  ${key}: ${valType}`);
    }
    lines.push(`${spaces}}`);
    return lines.join('\n');
  }

  return 'unknown';
}

/**
 * Describe the shape of data in a readable TypeScript-like format.
 * This is the main entry point for generating data descriptions for the LLM.
 *
 * @param data - The data object to describe
 * @returns A multi-line string describing the data shape with examples
 *
 * @example
 * ```typescript
 * const data = {
 *   emails: [
 *     { id: "1", subject: "Hello", from: "alice@example.com" }
 *   ],
 *   sessionId: "abc123"
 * };
 *
 * console.log(describeDataShape(data));
 * // Output:
 * // {
 * //   emails: Array<{
 * //     id: string // e.g., "1"
 * //     subject: string // e.g., "Hello"
 * //     from: string // e.g., "alice@example.com"
 * //   }> // 1 items
 * //   sessionId: string // e.g., "abc123"
 * // }
 * ```
 */
export function describeDataShape(data: Record<string, unknown>): string {
  return inferTypeWithExamples(data, 0);
}
