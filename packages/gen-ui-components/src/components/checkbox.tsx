import { useState } from 'react';
import {
  useBoundProp,
  useFieldValidation,
  type BaseComponentProps,
} from '@json-render/react';
import type { CheckboxProps } from '../catalog.js';

const boxClass =
  'size-4 shrink-0 rounded-[4px] border border-input accent-primary shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Checkbox with two binding modes. Without `value` it binds a boolean, like
 * shadcn's. With `value` (a checkbox per repeated item) the bound state is an
 * array and checking the box adds the value to it.
 */
export function Checkbox({
  props,
  bindings,
  emit,
}: BaseComponentProps<CheckboxProps>) {
  const [bound, setBound] = useBoundProp<boolean | string[]>(
    props.checked ?? undefined,
    bindings?.checked
  );
  const [local, setLocal] = useState(!!props.checked);
  const isBound = !!bindings?.checked;
  const groupValue = props.value ?? undefined;

  const selected =
    groupValue !== undefined && Array.isArray(bound) ? bound : undefined;
  const checked = isBound
    ? groupValue !== undefined
      ? (selected ?? []).includes(groupValue)
      : bound === true
    : local;

  const setChecked = (next: boolean) => {
    if (!isBound) {
      setLocal(next);
    } else if (groupValue === undefined) {
      setBound(next);
    } else {
      const current = selected ?? [];
      setBound(
        next
          ? [...current, groupValue]
          : current.filter((item) => item !== groupValue)
      );
    }
  };

  const validateOn = props.validateOn ?? 'change';
  const hasValidation = !!(bindings?.checked && props.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.checked ?? '',
    hasValidation ? { checks: props.checks ?? [], validateOn } : undefined
  );

  const id =
    groupValue === undefined ? props.name : `${props.name}-${groupValue}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={id}
          name={props.name}
          value={groupValue}
          className={boxClass}
          checked={checked}
          onChange={(event) => {
            setChecked(event.target.checked);
            if (hasValidation && validateOn === 'change') validate();
            emit('change');
          }}
        />
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {props.label}
        </label>
      </div>
      {errors.length > 0 && (
        <p className="text-sm text-destructive">{errors[0]}</p>
      )}
    </div>
  );
}
