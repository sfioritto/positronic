import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const TextAreaPropsSchema = z.object({
  name: z.string().describe('Form field name, used as key in submitted data'),
  label: z.string().describe('Label displayed above the textarea'),
  placeholder: z.string().optional().describe('Placeholder text when empty'),
  required: z.boolean().optional().describe('Whether field is required'),
  rows: z.number().optional().describe('Number of visible text rows, defaults to 4'),
  defaultValue: z.string().optional().describe('Default value for the textarea'),
});

export type TextAreaProps = z.infer<typeof TextAreaPropsSchema>;

const TextAreaComponent = ({
  name,
  label,
  placeholder,
  required,
  rows = 4,
  defaultValue,
}: TextAreaProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={name} className="text-sm font-medium text-gray-700">{label}</label>
    <textarea
      id={name}
      name={name}
      placeholder={placeholder}
      required={required}
      rows={rows}
      defaultValue={defaultValue}
      className="px-3 py-2 border border-gray-300 rounded-md text-base w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  </div>
);

export const TextArea: UIComponent<TextAreaProps> = {
  component: TextAreaComponent,
  description: `A multi-line text input field. Use for longer text like descriptions, comments, messages. For short single-line text, use Input instead.`,
  propsSchema: TextAreaPropsSchema,
};
