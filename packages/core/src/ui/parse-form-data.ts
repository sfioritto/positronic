/**
 * Parse form data into a plain object, handling array fields.
 * Extracts and strips the __positronic_token CSRF field.
 * Supports:
 * - name[] syntax for explicit arrays
 * - Multiple values with same key (converted to array)
 */
export function parseFormData(formData: FormData): { data: Record<string, unknown>; token: string | null } {
  const result: Record<string, unknown> = {};
  let token: string | null = null;

  for (const [key, value] of formData.entries()) {
    // Extract CSRF token and exclude from response data
    if (key === '__positronic_token') {
      token = value as string;
      continue;
    }

    // Handle array fields (e.g., name[] for multi-select)
    if (key.endsWith('[]')) {
      const baseKey = key.slice(0, -2);
      if (!result[baseKey]) {
        result[baseKey] = [];
      }
      (result[baseKey] as unknown[]).push(value);
    } else if (result[key] !== undefined) {
      // Convert to array if same key appears multiple times
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]];
      }
      (result[key] as unknown[]).push(value);
    } else {
      result[key] = value;
    }
  }

  return { data: result, token };
}
