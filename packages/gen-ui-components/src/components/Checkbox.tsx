import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface CheckboxProps {
  name: string;
  label: string;
  defaultChecked?: boolean;
}

const CheckboxComponent = ({ name, label, defaultChecked }: CheckboxProps) => (
  <div className="field checkbox">
    <label>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
      />
      {label}
    </label>
  </div>
);

export const Checkbox: UIComponent<CheckboxProps> = {
  component: CheckboxComponent,
  tool: {
    description: `A checkbox for boolean yes/no choices. Returns true/false in form data. Use for single toggles, confirmations, opt-ins.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data'),
      label: z.string().describe('Label displayed next to checkbox'),
      defaultChecked: z.boolean().optional().describe('Whether checkbox is checked by default'),
    }),
  },
};
