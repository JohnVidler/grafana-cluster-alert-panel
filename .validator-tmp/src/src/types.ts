import { Threshold, ThresholdsMode } from '@grafana/data';

/**
 * How a query result is interpreted:
 * - `instant`: a single value (e.g. a Prometheus instant query), shown as-is.
 * - `series`: multiple values over time, shown as the rate of change per `$__interval`.
 */
export type MetricKind = 'instant' | 'series';

export interface AlertThreshold extends Threshold {
  /**
   * Message template shown while this step is active, using legend-style `{{name}}` placeholders:
   * `{{value}}`, `{{name}}`, `{{refId}}`, `{{interval}}`, `{{tile}}`, or any label on the result.
   * A literal `\n` becomes a line break.
   */
  format?: string;
}

export interface AlertThresholdsConfig {
  mode: ThresholdsMode;
  steps: AlertThreshold[];
}

/** Display settings for one `(query, kind)` pair. */
export interface MetricRule {
  refId: string;
  kind: MetricKind;
  /** Optional name shown in the tile instead of the refId. */
  displayName?: string;
  unit?: string;
  decimals?: number;
  thresholds: AlertThresholdsConfig;
  /**
   * Threshold step value at or above which a result counts as triggering (counted for sorting and
   * cycled on the tile). Undefined means any returned value triggers.
   */
  trigger?: number;
}

export type TileSort = 'count' | 'severity' | 'label';

export interface ClusterAlertOptions {
  /** Labels used to merge results into a single tile, e.g. `instance` or `service`. */
  groupByLabels: string[];
  sortBy: TileSort;
  maxColumns: number;
  /** Fixed tile height in px; undefined makes tiles square based on the column width. */
  tileHeight?: number;
  /** Font size in px for tile titles and stat names while cycling; undefined uses the theme size. */
  titleSize?: number;
  /** Font size in px for the secondary line and stats table; undefined uses the theme size. */
  textSize?: number;
  /** Seconds between cycling frames on collapsed tiles; 0 disables cycling. */
  cycleSeconds: number;
  noAlertsText: string;
  metricRules: MetricRule[];
}
