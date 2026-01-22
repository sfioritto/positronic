import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const CheckboxPropsSchema = z.object({
  name: z.string().describe('Form field name, used as key in submitted data'),
  label: z.string().describe('Label displayed next to checkbox'),
  value: z.string().optional().describe('Value submitted when checked. Use with Lists to identify which items are selected (e.g., item ID)'),
  defaultChecked: z.boolean().optional().describe('Whether checkbox is checked by default'),
});

export type CheckboxProps = z.infer<typeof CheckboxPropsSchema>;

const CheckboxComponent = ({ name, label, value, defaultChecked }: CheckboxProps) => (
  <div className="flex items-center gap-2">
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
      />
      {label}
    </label>
  </div>
);

export const Checkbox: UIComponent<CheckboxProps> = {
  component: CheckboxComponent,
  description: `A checkbox for selecting items. When used in a List, set value to the item's ID so the form returns an array of selected IDs. For simple boolean toggles, omit value.`,
  propsSchema: CheckboxPropsSchema,
};
