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
import { Link } from './components/Link.js';

/**
 * Default UI components for Positronic generative UI.
 * Pass these to your Brain via .withComponents() to enable UI generation.
 *
 * @example
 * ```typescript
 * import { components } from '@positronic/gen-ui-components';
 *
 * const myBrain = brain('example')
 *   .withComponents(components)
 *   .uiStep('Show Form', ...);
 *
 * // Adding custom components
 * .withComponents({ ...components, MyCustomButton });
 * ```
 */
export const components = {
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
  Link,
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
  HiddenInput,
  Link,
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
  LinkProps,
} from './components/index.js';
