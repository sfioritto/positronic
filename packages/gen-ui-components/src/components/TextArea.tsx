import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface TextAreaProps {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  defaultValue?: string;
}

const TextAreaComponent = ({
  name,
  label,
  placeholder,
  required,
  rows = 4,
  defaultValue,
}: TextAreaProps) => (
  <div className="field">
    <label htmlFor={name}>{label}</label>
    <textarea
      id={name}
      name={name}
      placeholder={placeholder}
      required={required}
      rows={rows}
      defaultValue={defaultValue}
    />
  </div>
);

export const TextArea: UIComponent<TextAreaProps> = {
  component: TextAreaComponent,
  tool: {
    description: `A multi-line text input field. Use for longer text like descriptions, comments, messages. For short single-line text, use Input instead.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data'),
      label: z.string().describe('Label displayed above the textarea'),
      placeholder: z.string().optional().describe('Placeholder text when empty'),
      required: z.boolean().optional().describe('Whether field is required'),
      rows: z.number().optional().describe('Number of visible text rows, defaults to 4'),
      defaultValue: z.string().optional().describe('Default value for the textarea'),
    }),
  },
};
