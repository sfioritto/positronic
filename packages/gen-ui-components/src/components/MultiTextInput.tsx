import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const MultiTextInputPropsSchema = z.object({
  name: z.string().describe('Form field name, used as key in submitted data (will be an array)'),
  label: z.string().describe('Label displayed above the input list'),
  placeholder: z.string().optional().describe('Placeholder text for each input'),
  defaultValues: z.array(z.string()).optional().describe('Initial list of values'),
});

export type MultiTextInputProps = z.infer<typeof MultiTextInputPropsSchema>;

const MultiTextInputComponent = ({
  name,
  label,
  placeholder,
  defaultValues = [],
}: MultiTextInputProps) => (
  <div className="flex flex-col gap-1.5" data-name={name} data-default={JSON.stringify(defaultValues)}>
    <label className="text-sm font-medium text-gray-700">{label}</label>
    <div className="flex flex-col gap-2">
      {defaultValues.map((value, index) => (
        <div key={index} className="flex gap-2 items-center">
          <input
            type="text"
            name={`${name}[]`}
            defaultValue={value}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button type="button" className="text-xs text-red-500 hover:text-red-700">Remove</button>
        </div>
      ))}
    </div>
    <button type="button" className="mt-2 text-sm text-blue-500 hover:text-blue-700" data-placeholder={placeholder}>
      Add item
    </button>
  </div>
);

export const MultiTextInput: UIComponent<MultiTextInputProps> = {
  component: MultiTextInputComponent,
  description: `A dynamic list of text inputs where users can add or remove items. Use for collecting multiple values like tags, email addresses, or list items. Returns an array of strings.`,
  propsSchema: MultiTextInputPropsSchema,
};
