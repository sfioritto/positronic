import type { UIComponent } from '@positronic/core';

import { Input } from './components/Input.js';
import { TextArea } from './components/TextArea.js';
import { Checkbox } from './components/Checkbox.js';
import { Select } from './components/Select.js';
import { MultiTextInput } from './components/MultiTextInput.js';
import { Button } from './components/Button.js';
import { Text } from './components/Text.js';
import { Heading } from './components/Heading.js';
import { Container } from './components/Container.js';
import { Form } from './components/Form.js';

// Re-export the pre-bundled component JavaScript (generated at build time)
export { componentBundle } from './generated-bundle.js';

/**
 * Default UI components for Positronic generative UI.
 * Pass these to your BrainRunner via .withComponents() to enable UI generation.
 *
 * @example
 * ```typescript
 * import { defaultComponents, componentBundle } from '@positronic/gen-ui-components';
 *
 * const runner = new BrainRunner()
 *   .withComponents(defaultComponents, componentBundle);
 * ```
 */
export const defaultComponents: Record<string, UIComponent<any>> = {
  Input,
  TextArea,
  Checkbox,
  Select,
  MultiTextInput,
  Button,
  Text,
  Heading,
  Container,
  Form,
};

// Re-export individual components for custom composition
export {
  Input,
  TextArea,
  Checkbox,
  Select,
  MultiTextInput,
  Button,
  Text,
  Heading,
  Container,
  Form,
};

// Re-export prop types for TypeScript users
export type {
  InputProps,
  TextAreaProps,
  CheckboxProps,
  SelectProps,
  MultiTextInputProps,
  ButtonProps,
  TextProps,
  HeadingProps,
  ContainerProps,
  FormProps,
} from './components/index.js';
