import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface SelectProps {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  defaultValue?: string;
}

const SelectComponent = ({
  name,
  label,
  options,
  required,
  defaultValue,
}: SelectProps) => (
  <div className="field">
    <label htmlFor={name}>{label}</label>
    <select id={name} name={name} required={required} defaultValue={defaultValue}>
      <option value="">Select...</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

export const Select: UIComponent<SelectProps> = {
  component: SelectComponent,
  tool: {
    description: `A dropdown select menu for choosing one option from a list. Use for mutually exclusive choices like categories, statuses, or types.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data'),
      label: z.string().describe('Label displayed above the select'),
      options: z
        .array(
          z.object({
            value: z.string().describe('The value submitted when this option is selected'),
            label: z.string().describe('The text displayed for this option'),
          })
        )
        .describe('List of options to choose from'),
      required: z.boolean().optional().describe('Whether a selection is required'),
      defaultValue: z.string().optional().describe('Value of the initially selected option'),
    }),
  },
};
