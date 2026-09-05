import type { StateModel } from '@json-render/core';
import type { SetState } from '@json-render/react';

/**
 * Encode the values under `/form` the way a native form post would, so the
 * host's `parseFormData` sees the same shape as before: arrays append one
 * entry per item, `true` submits as "true", and `false`, `null`, and
 * `undefined` are omitted like an unchecked checkbox.
 */
export function toFormData(form: Record<string, unknown>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(form)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (entry === undefined || entry === null || entry === false) continue;
      body.append(name, String(entry));
    }
  }
  return body;
}

/**
 * The `submitForm` action: POST `/form` to the page's form action, then
 * record the outcome at `/submitted` or `/submitError`. Skipped while
 * `validateForm` (which runs first) reports invalid fields.
 */
export function createSubmitForm(formAction: string | null) {
  return async (
    params: Record<string, unknown> | undefined,
    setState: SetState,
    state: StateModel
  ) => {
    const validation = state.formValidation as { valid?: boolean } | undefined;
    if (validation?.valid === false) return;
    if (!formAction) {
      setState((prev) => ({
        ...prev,
        submitError: 'This page has nowhere to submit to.',
      }));
      return;
    }

    setState((prev) => ({ ...prev, submitting: true, submitError: undefined }));
    const response = await fetch(formAction, {
      method: 'POST',
      body: toFormData((state.form as Record<string, unknown>) ?? {}),
    });
    setState((prev) => ({
      ...prev,
      submitting: false,
      submitted: response.ok,
      submitError: response.ok
        ? undefined
        : `Submission failed (${response.status}). Try again.`,
    }));
  };
}
