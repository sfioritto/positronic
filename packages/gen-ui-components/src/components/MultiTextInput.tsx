import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface MultiTextInputProps {
  name: string;
  label: string;
  placeholder?: string;
  defaultValues?: string[];
}

const MultiTextInputComponent = ({
  name,
  label,
  placeholder,
  defaultValues = [],
}: MultiTextInputProps) => (
  <div className="field multi-text-input" data-name={name} data-default={JSON.stringify(defaultValues)}>
    <label>{label}</label>
    <div className="multi-text-items">
      {defaultValues.map((value, index) => (
        <div key={index} className="multi-text-item">
          <input
            type="text"
            name={`${name}[]`}
            defaultValue={value}
            placeholder={placeholder}
          />
          <button type="button" className="remove-item">Remove</button>
        </div>
      ))}
    </div>
    <button type="button" className="add-item" data-placeholder={placeholder}>
      Add item
    </button>
  </div>
);

export const MultiTextInput: UIComponent<MultiTextInputProps> = {
  component: MultiTextInputComponent,
  tool: {
    description: `A dynamic list of text inputs where users can add or remove items. Use for collecting multiple values like tags, email addresses, or list items. Returns an array of strings.`,
    parameters: z.object({
      name: z.string().describe('Form field name, used as key in submitted data (will be an array)'),
      label: z.string().describe('Label displayed above the input list'),
      placeholder: z.string().optional().describe('Placeholder text for each input'),
      defaultValues: z.array(z.string()).optional().describe('Initial list of values'),
    }),
  },
};
