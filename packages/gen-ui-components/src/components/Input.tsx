import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface InputProps {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'number' | 'password';
  defaultValue?: string;
}

const InputComponent = ({
  name,
  label,
  placeholder,
  required,
  type = 'text',
  defaultValue,
}: InputProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={name} className="text-sm font-medium text-gray-700">{label}</label>
    <input
      id={name}
      name={name}
      type={type}
      placeholder={placeholder}
      required={required}
      defaultValue={defaultValue}
      className="px-3 py-2 border border-gray-300 rounded-md text-base w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  </div>
);

export const Input: UIComponent<InputProps> = {
  component: InputComponent,
  tool: {
    description: `A single-line text input field. Use for short text like names, emails, titles. For longer text, use TextArea instead.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data'),
      label: z.string().describe('Label displayed above the input'),
      placeholder: z.string().optional().describe('Placeholder text when empty'),
      required: z.boolean().optional().describe('Whether field is required'),
      type: z
        .enum(['text', 'email', 'number', 'password'])
        .optional()
        .describe('Input type, defaults to text'),
      defaultValue: z.string().optional().describe('Default value for the input'),
    }),
  },
};
