import {
  DataFrame,
  Field,
  FieldType,
  formattedValueToString,
  getActiveThreshold,
  getFieldDisplayName,
  getValueFormat,
  Labels,
  sortThresholds,
  ThresholdsMode,
} from '@grafana/data';

import { AlertThreshold, AlertThresholdsConfig, MetricKind, MetricRule, TileSort } from '../types';

/** Used when no rule matches: the query only returns data when alerting, so presence is red. */
export const DEFAULT_THRESHOLDS: AlertThresholdsConfig = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'red' }],
};

export interface TileMetric {
  refId: string;
  kind: MetricKind;
  name: string;
  /** Instant value, or rate of change per interval for series. Null when it can't be computed. */
  value: number | null;
  labels: Labels;
  rule?: MetricRule;
  threshold: AlertThreshold;
  /** Index of the active threshold step; higher is treated as more severe. */
  severity: number;
  /** Whether this result counts as an alert, per its rule's trigger level (default: any value). */
  triggering: boolean;
  /** Formatted value with unit, plus `/ interval` for series. */
  display: string;
  /** The active threshold step's message template, rendered; undefined if the step has none. */
  message?: string;
}

export interface Tile {
  key: string;
  label: string;
  metrics: TileMetric[];
  /** The metric with the highest severity, which determines the tile colour. */
  worst: TileMetric;
  triggeringCount: number;
}

export interface BuildTilesOptions {
  groupByLabels: string[];
  rules: MetricRule[];
  /** The panel's `$__interval` in milliseconds. */
  intervalMs?: number;
  /** The panel's `$__interval` as text, e.g. `1m`. */
  interval?: string;
  sortBy?: TileSort;
}

interface Point {
  time: number;
  value: number;
}

function getPoints(frame: DataFrame, field: Field): Point[] {
  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  const points: Point[] = [];
  for (let i = 0; i < field.values.length; i++) {
    const value = field.values[i];
    if (value == null || Number.isNaN(value)) {
      continue;
    }
    // Without a time field, fall back to the row index so the rate is "per sample".
    const time = timeField ? Number(timeField.values[i]) : i;
    points.push({ time, value });
  }
  return points.sort((a, b) => a.time - b.time);
}

/**
 * Rate of change per `intervalMs`: compares the last point against the latest point at least one
 * interval older (or the first point, if the series is shorter than an interval).
 */
export function rateOverInterval(points: Point[], intervalMs?: number): number | null {
  if (points.length < 2) {
    return null;
  }
  const last = points[points.length - 1];
  const step = intervalMs && intervalMs > 0 ? intervalMs : last.time - points[points.length - 2].time;

  let ref = points[0];
  for (let i = points.length - 2; i >= 0; i--) {
    if (points[i].time <= last.time - step) {
      ref = points[i];
      break;
    }
  }

  const elapsed = last.time - ref.time;
  if (elapsed <= 0) {
    return null;
  }
  return ((last.value - ref.value) / elapsed) * step;
}

function groupKey(field: Field, frame: DataFrame, frames: DataFrame[], groupByLabels: string[]) {
  const labels = field.labels ?? {};
  const present = groupByLabels.filter((name) => labels[name] !== undefined);
  if (present.length > 0) {
    return {
      key: present.map((name) => `${name}=${labels[name]}`).join(','),
      label: expandNewlines(present.map((name) => labels[name]).join(' / ')),
    };
  }
  // No grouping label on this result: fall back to Grafana's own series name.
  const name = getFieldDisplayName(field, frame, frames);
  return { key: `name=${name}`, label: name };
}

export function evaluateThreshold(value: number | null, thresholds?: AlertThresholdsConfig, trigger?: number) {
  const configured = thresholds?.steps?.length ? thresholds.steps : DEFAULT_THRESHOLDS.steps;
  // Saved dashboards serialise the -Infinity base step as null.
  const steps = sortThresholds(configured.map((s) => ({ ...s, value: s.value ?? -Infinity }))) as AlertThreshold[];
  const threshold = getActiveThreshold(value ?? -Infinity, steps) as AlertThreshold;
  const severity = steps.indexOf(threshold);
  // Loose null check: an unset trigger may be saved as null.
  const triggering = trigger == null || threshold.value >= trigger;
  return { threshold, severity, triggering };
}

/** Option text inputs are single-line, so a typed `\n` stands for a line break. */
export function expandNewlines(text: string): string {
  return text.replace(/\\n/g, '\n');
}

/** Renders legend-style `{{name}}` placeholders; unknown names become empty, like Grafana's legend format. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return expandNewlines(template).replace(/\{\{\s*(.+?)\s*\}\}/g, (_, name: string) => vars[name] ?? '');
}

function formatValue(value: number, rule?: MetricRule): string {
  return formattedValueToString(getValueFormat(rule?.unit || 'none')(value, rule?.decimals));
}

export function buildTiles(frames: DataFrame[], options: BuildTilesOptions): Tile[] {
  const tiles = new Map<string, Pick<Tile, 'key' | 'label' | 'metrics'>>();

  for (const frame of frames) {
    const refId = frame.refId ?? '';
    for (const field of frame.fields) {
      if (field.type !== FieldType.number) {
        continue;
      }
      const points = getPoints(frame, field);
      if (points.length === 0) {
        continue;
      }

      const kind: MetricKind = points.length === 1 ? 'instant' : 'series';
      const value = kind === 'instant' ? points[0].value : rateOverInterval(points, options.intervalMs);
      const rule = options.rules.find((r) => r.refId === refId && r.kind === kind);
      const { threshold, severity, triggering } = evaluateThreshold(value, rule?.thresholds, rule?.trigger);

      const { key, label } = groupKey(field, frame, frames, options.groupByLabels);
      const tile = tiles.get(key) ?? { key, label, metrics: [] };
      const name = expandNewlines(rule?.displayName || refId || field.name);
      const labels = field.labels ?? {};
      const interval = options.interval ?? 'interval';
      const formatted = value === null ? 'n/a' : formatValue(value, rule);
      const message = threshold.format
        ? renderTemplate(threshold.format, {
            ...labels,
            value: formatted,
            name,
            refId,
            interval,
            tile: label,
          })
        : undefined;

      tile.metrics.push({
        refId,
        kind,
        name,
        value,
        labels,
        rule,
        threshold,
        severity,
        triggering,
        display: kind === 'series' && value !== null ? `${formatted} / ${interval}` : formatted,
        message,
      });
      tiles.set(key, tile);
    }
  }

  const result = [...tiles.values()].map((tile) => ({
    ...tile,
    worst: tile.metrics.reduce((a, b) => (b.severity > a.severity ? b : a)),
    triggeringCount: tile.metrics.filter((m) => m.triggering).length,
  }));

  const sortBy = options.sortBy ?? 'count';
  return result.sort((a, b) => {
    if (sortBy === 'count' && a.triggeringCount !== b.triggeringCount) {
      return b.triggeringCount - a.triggeringCount;
    }
    if (sortBy !== 'label' && a.worst.severity !== b.worst.severity) {
      return b.worst.severity - a.worst.severity;
    }
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}
