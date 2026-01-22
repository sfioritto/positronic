import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const HiddenInputPropsSchema = z.object({
  name: z.string().describe('Form field name, used as key in submitted data'),
  value: z.string().describe('The value to submit with the form'),
});

export type HiddenInputProps = z.infer<typeof HiddenInputPropsSchema>;

const HiddenInputComponent = ({ name, value }: HiddenInputProps) => (
  <input type="hidden" name={name} value={value} />
);

export const HiddenInput: UIComponent<HiddenInputProps> = {
  component: HiddenInputComponent,
  description: `A hidden form field for passing data that shouldn't be visible to users. Use to include IDs, tokens, or other metadata in form submissions.`,
  propsSchema: HiddenInputPropsSchema,
};
