/**
 * Bundle entry point for client-side rendering.
 *
 * This file is bundled by esbuild into dist/components.js which exposes
 * React components to window.PositronicComponents for use by the page
 * bootstrap runtime.
 *
 * Note: This only exports the React component functions, not the tool
 * definitions (those are used at generation time by core, not at runtime).
 */

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

// Extract the React component from each UIComponent and expose to window
const PositronicComponents = {
  Input: Input.component,
  TextArea: TextArea.component,
  Checkbox: Checkbox.component,
  Select: Select.component,
  MultiTextInput: MultiTextInput.component,
  Button: Button.component,
  Text: Text.component,
  Heading: Heading.component,
  Container: Container.component,
  Form: Form.component,
  HiddenInput: HiddenInput.component,
};

// Expose to window for client-side rendering
(window as unknown as { PositronicComponents: typeof PositronicComponents }).PositronicComponents =
  PositronicComponents;

export { PositronicComponents };
