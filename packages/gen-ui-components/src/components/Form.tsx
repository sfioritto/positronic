import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

export interface FormProps {
  children?: ReactNode;
  submitLabel?: string;
}

const FormComponent = ({ children, submitLabel = 'Submit' }: FormProps) => (
  <form className="form" method="POST">
    {children}
    <div className="form-actions">
      <button type="submit" className="btn btn-primary">
        {submitLabel}
      </button>
    </div>
  </form>
);

export const Form: UIComponent<FormProps> = {
  component: FormComponent,
  tool: {
    description: `A form container that wraps form fields and provides a submit button. Place Input, TextArea, Checkbox, Select, and other form fields inside. The form will POST data when submitted.`,
    parameters: z.object({
      submitLabel: z
        .string()
        .optional()
        .describe('Text for the submit button, defaults to "Submit"'),
    }),
  },
};
