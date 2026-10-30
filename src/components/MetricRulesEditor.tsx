import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import {
  Button,
  ColorPicker,
  Combobox,
  ComboboxOption,
  Field,
  IconButton,
  Input,
  RadioButtonGroup,
  Stack,
  UnitPicker,
  useStyles2,
} from '@grafana/ui';

import { DEFAULT_THRESHOLDS } from '../data/tiles';
import { AlertThreshold, ClusterAlertOptions, MetricKind, MetricRule } from '../types';

type Props = StandardEditorProps<MetricRule[], unknown, ClusterAlertOptions>;

/** A threshold step value changed (`to`) or was removed (`to` undefined). */
interface StepChange {
  from: number;
  to?: number;
}

function getTriggerOptions(steps: AlertThreshold[]): Array<ComboboxOption<string>> {
  const levels = steps
    .filter((s) => s.value != null && Number.isFinite(s.value))
    .sort((a, b) => a.value - b.value)
    .map((s) => ({ label: `≥ ${s.value}`, value: String(s.value), description: s.color }));
  return [{ label: 'Any', value: 'any', description: 'Any returned value triggers' }, ...levels];
}

const kindOptions: Array<{ label: string; value: MetricKind; description: string }> = [
  { label: 'Instant', value: 'instant', description: 'Single value, shown as-is' },
  { label: 'Series', value: 'series', description: 'Rate of change per $__interval' },
];

export const MetricRulesEditor = ({ value, onChange, context }: Props) => {
  const styles = useStyles2(getStyles);
  const rules = value ?? [];

  const refIds = new Set<string>(context.data.map((frame) => frame.refId ?? '').filter(Boolean));
  rules.forEach((rule) => rule.refId && refIds.add(rule.refId));
  const refIdOptions: Array<ComboboxOption<string>> = [...refIds].sort().map((id) => ({ label: id, value: id }));

  const update = (index: number, patch: Partial<MetricRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const add = () =>
    onChange([
      ...rules,
      { refId: refIdOptions[0]?.value ?? 'A', kind: 'instant', thresholds: structuredClone(DEFAULT_THRESHOLDS) },
    ]);

  return (
    <Stack direction="column" gap={2}>
      {rules.map((rule, index) => (
        <div key={index} className={styles.rule}>
          <Stack justifyContent="space-between" alignItems="center">
            <strong>
              {rule.refId || '?'} · {rule.kind}
            </strong>
            <IconButton
              name="trash-alt"
              tooltip="Remove rule"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
            />
          </Stack>
          <Field label="Query">
            <Combobox
              options={refIdOptions}
              value={rule.refId}
              createCustomValue
              onChange={(option) => update(index, { refId: option.value })}
            />
          </Field>
          <Field label="Result type">
            <RadioButtonGroup
              options={kindOptions}
              value={rule.kind}
              onChange={(kind) => update(index, { kind })}
              fullWidth
            />
          </Field>
          <Field label="Display name" description="Use \n for a line break.">
            <Input
              defaultValue={rule.displayName ?? ''}
              placeholder={rule.refId}
              onBlur={(e) => update(index, { displayName: e.currentTarget.value || undefined })}
            />
          </Field>
          <Field label="Unit">
            <UnitPicker value={rule.unit} onChange={(unit) => update(index, { unit })} />
          </Field>
          <Field label="Decimals">
            <Input
              type="number"
              min={0}
              defaultValue={rule.decimals ?? ''}
              placeholder="auto"
              onBlur={(e) => {
                const n = parseInt(e.currentTarget.value, 10);
                update(index, { decimals: Number.isNaN(n) ? undefined : n });
              }}
            />
          </Field>
          <Field
            label="Thresholds"
            description="Optional message per step, e.g. {{value}} over 50% on {{instance}}. Placeholders: {{value}}, {{name}}, {{refId}}, {{interval}}, {{tile}}, or any label. Use \n for a line break."
          >
            <ThresholdSteps
              steps={rule.thresholds?.steps ?? DEFAULT_THRESHOLDS.steps}
              onChange={(steps, change) => {
                const patch: Partial<MetricRule> = { thresholds: { ...DEFAULT_THRESHOLDS, ...rule.thresholds, steps } };
                // Keep the trigger pointing at the same step when its value is edited or removed.
                if (change && rule.trigger === change.from) {
                  patch.trigger = change.to;
                }
                update(index, patch);
              }}
            />
          </Field>
          <Field
            label="Trigger"
            description="Results count as triggering (sorted first and cycled on the tile) from this threshold upwards."
          >
            <Combobox
              options={getTriggerOptions(rule.thresholds?.steps ?? [])}
              value={rule.trigger == null ? 'any' : String(rule.trigger)}
              onChange={(option) =>
                update(index, { trigger: option.value === 'any' ? undefined : Number(option.value) })
              }
            />
          </Field>
        </div>
      ))}
      <Button icon="plus" variant="secondary" size="sm" onClick={add}>
        Add query rule
      </Button>
    </Stack>
  );
};

interface ThresholdStepsProps {
  steps: AlertThreshold[];
  onChange: (steps: AlertThreshold[], change?: StepChange) => void;
}

/** Minimal absolute-thresholds editor (Grafana's own ThresholdsEditor isn't exported to plugins). */
const ThresholdSteps = ({ steps, onChange }: ThresholdStepsProps) => {
  const sorted = [...steps].sort((a, b) => (a.value ?? -Infinity) - (b.value ?? -Infinity));
  // Display highest first, matching Grafana's built-in editor.
  const display = [...sorted].reverse();

  const replace = (step: AlertThreshold, patch: Partial<AlertThreshold>) =>
    onChange(
      sorted.map((s) => (s === step ? { ...s, ...patch } : s)),
      patch.value !== undefined ? { from: step.value, to: patch.value } : undefined
    );

  const addStep = () => {
    const top = sorted[sorted.length - 1];
    const next = Number.isFinite(top?.value) ? top.value + 10 : 0;
    onChange([...sorted, { value: next, color: 'orange' }]);
  };

  return (
    <Stack direction="column" gap={1}>
      <Button icon="plus" variant="secondary" size="sm" onClick={addStep} fill="text">
        Add threshold
      </Button>
      {display.map((step, i) => {
        const isBase = !Number.isFinite(step.value);
        return (
          <Stack key={`${i}-${step.value}`} direction="column" gap={0.5}>
            <Stack alignItems="center" gap={1}>
              <ColorPicker color={step.color} onChange={(color) => replace(step, { color })} />
              {isBase ? (
                <Input value="Base" disabled />
              ) : (
                <Input
                  type="number"
                  defaultValue={step.value}
                  onBlur={(e) => {
                    const n = parseFloat(e.currentTarget.value);
                    if (!Number.isNaN(n) && n !== step.value) {
                      replace(step, { value: n });
                    }
                  }}
                />
              )}
              {!isBase && (
                <IconButton
                  name="trash-alt"
                  tooltip="Remove threshold"
                  onClick={() =>
                    onChange(
                      sorted.filter((s) => s !== step),
                      { from: step.value }
                    )
                  }
                />
              )}
            </Stack>
            <Input
              defaultValue={step.format ?? ''}
              placeholder="Message, e.g. {{value}} on {{instance}}"
              aria-label="Threshold message"
              onBlur={(e) => {
                const format = e.currentTarget.value || undefined;
                if (format !== step.format) {
                  replace(step, { format });
                }
              }}
            />
          </Stack>
        );
      })}
    </Stack>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  rule: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
  }),
});
