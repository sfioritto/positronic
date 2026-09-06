import { definePageCatalog } from '@positronic/core/page';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import * as z from 'zod';

/**
 * Component definitions for Positronic pages: a subset of shadcn/ui plus
 * two Positronic additions. Server-safe (no React); the browser side lives
 * in the package root.
 *
 * Overlays (Dialog, Drawer, Popover, Tooltip, DropdownMenu, Carousel) are
 * left out to keep the prompt short. Add one by spreading it into a
 * project's own `definePageCatalog` call.
 */
const {
  Card,
  Stack,
  Grid,
  Separator,
  Heading,
  Text,
  Badge,
  Alert,
  Table,
  Input,
  Textarea,
  Select,
  Radio,
  Switch,
  Button,
  Link,
} = shadcnComponentDefinitions;

/**
 * shadcn's Checkbox plus a `value` prop so that, inside a repeat, checked
 * boxes collect their values into one array at the bound path.
 */
export const Checkbox = {
  ...shadcnComponentDefinitions.Checkbox,
  props: shadcnComponentDefinitions.Checkbox.props.extend({
    value: z
      .string()
      .nullable()
      .describe(
        'Inside a repeat: the item value ({ "$item": "id" }) this box adds to the array at the bound path when checked.'
      ),
  }),
  description:
    'Checkbox. Bind checked with $bindState. Alone it yields true/false. Inside a repeat, give it a value and every checked value is collected into an array at the bound path.',
};

export const MultiTextInput = {
  props: z.object({
    label: z.string(),
    name: z.string(),
    value: z.array(z.string()).nullable(),
    placeholder: z.string().nullable(),
    addLabel: z.string().nullable(),
  }),
  description:
    'A growable list of short text values (tags, emails, names). Bind value with $bindState; each entry is submitted separately.',
  example: { label: 'Tags', name: 'tags', placeholder: 'Add a tag' },
};

export const definitions = {
  Card,
  Stack,
  Grid,
  Separator,
  Heading,
  Text,
  Badge,
  Alert,
  Table,
  Input,
  Textarea,
  Select,
  Checkbox,
  Radio,
  Switch,
  MultiTextInput,
  Button,
  Link,
};

export const actions = {
  submitForm: {
    description:
      'Submit the values under /form to the host and show a confirmation. Run validateForm first.',
  },
};

export type CheckboxProps = z.infer<typeof Checkbox.props>;
export type MultiTextInputProps = z.infer<typeof MultiTextInput.props>;

/**
 * The default catalog. Projects that add components build their own with
 * `definePageCatalog({ components: { ...definitions, Mine }, actions })`.
 */
export const catalog = definePageCatalog({ components: definitions, actions });
