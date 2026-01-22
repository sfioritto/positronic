import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const SelectPropsSchema = z.object({
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
});

export type SelectProps = z.infer<typeof SelectPropsSchema>;

const SelectComponent = ({
  name,
  label,
  options,
  required,
  defaultValue,
}: SelectProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={name} className="text-sm font-medium text-gray-700">{label}</label>
    <select id={name} name={name} required={required} defaultValue={defaultValue} className="px-3 py-2 border border-gray-300 rounded-md text-base w-full bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
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
  description: `A dropdown select menu for choosing one option from a list. Use for mutually exclusive choices like categories, statuses, or types.`,
  propsSchema: SelectPropsSchema,
};
