import { createComponentRegistry } from '@positronic/core';

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
import { HiddenInput } from './components/HiddenInput.js';
import { componentBundle } from './generated-bundle.js';

/**
 * Default UI components for Positronic generative UI with attached bundle.
 * Pass these to your BrainRunner via .withComponents() to enable UI generation.
 *
 * The bundle is attached via a Symbol key, so spread operations preserve it:
 * `{ ...components, MyCustomButton }` keeps the bundle.
 *
 * @example
 * ```typescript
 * import { components } from '@positronic/gen-ui-components';
 *
 * // Simple usage
 * const runner = new BrainRunner({ client, adapters })
 *   .withComponents(components);
 *
 * // Adding custom components (bundle is preserved via spread)
 * .withComponents({ ...components, MyCustomButton });
 * ```
 */
export const components = createComponentRegistry(
  {
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
    HiddenInput,
  },
  componentBundle
);

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
  HiddenInput,
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
  HiddenInputProps,
} from './components/index.js';
