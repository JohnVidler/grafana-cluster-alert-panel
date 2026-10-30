import React, { useEffect, useMemo, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';

import { buildTiles, expandNewlines, Tile, TileMetric } from '../data/tiles';
import { ClusterAlertOptions } from '../types';

interface Props extends PanelProps<ClusterAlertOptions> {}

interface Frame {
  primary: string;
  secondary: string;
}

function describeLabels(metric: TileMetric): string {
  return Object.entries(metric.labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');
}

/** The collapsed tile cycles through its title, then each triggering stat. */
function getFrames(tile: Tile): Frame[] {
  return [
    { primary: tile.label, secondary: `${tile.triggeringCount} triggering` },
    ...tile.metrics.filter((m) => m.triggering).map((m) => ({ primary: m.name, secondary: m.message ?? m.display })),
  ];
}

export const ClusterAlertPanel: React.FC<Props> = ({ options, data, width, height }) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  const tiles = useMemo(
    () =>
      buildTiles(data.series, {
        groupByLabels: options.groupByLabels ?? [],
        rules: options.metricRules ?? [],
        intervalMs: data.request?.intervalMs,
        interval: data.request?.interval,
        sortBy: options.sortBy,
      }),
    [
      data.series,
      data.request?.intervalMs,
      data.request?.interval,
      options.groupByLabels,
      options.metricRules,
      options.sortBy,
    ]
  );

  const shouldCycle = options.cycleSeconds > 0 && tiles.some((t) => !expanded.has(t.key) && t.triggeringCount > 0);
  useEffect(() => {
    if (!shouldCycle) {
      return;
    }
    const timer = setInterval(() => setTick((t) => t + 1), options.cycleSeconds * 1000);
    return () => clearInterval(timer);
  }, [shouldCycle, options.cycleSeconds]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (tiles.length === 0) {
    return (
      <div className={styles.empty} style={{ width, height }} data-testid="cluster-alert-empty">
        {expandNewlines(options.noAlertsText ?? '')}
      </div>
    );
  }

  const columns = Math.max(1, options.maxColumns || 1);
  const gap = theme.spacing.gridSize;
  const basis = `calc((100% - ${columns - 1} * ${gap}px) / ${columns})`;
  // Without a fixed height, make tiles square to the column width.
  const tileHeight = options.tileHeight || Math.max(0, (width - (columns - 1) * gap) / columns);
  const tileSize = {
    flexBasis: basis,
    // When tiles wrap, cap their width so the last row lines up with the rows above it.
    maxWidth: tiles.length > columns ? basis : undefined,
    height: tileHeight,
  };

  // Undefined falls back to the theme sizes in the styles below.
  const titleStyle = { fontSize: options.titleSize || undefined };
  const textStyle = { fontSize: options.textSize || undefined };

  const renderTile = (tile: Tile) => {
    const background = theme.visualization.getColorByName(tile.worst.threshold.color);
    const isOpen = expanded.has(tile.key);
    const frames = getFrames(tile);
    const active = options.cycleSeconds > 0 ? tick % frames.length : 0;

    return (
      <button
        key={tile.key}
        type="button"
        className={styles.tile}
        style={{ ...tileSize, background, color: theme.colors.getContrastText(background) }}
        onClick={() => toggle(tile.key)}
        aria-expanded={isOpen}
        aria-label={isOpen ? undefined : `${tile.label}: ${tile.triggeringCount} triggering`}
        data-testid="cluster-alert-tile"
      >
        {isOpen ? (
          <>
            <div className={styles.label} style={titleStyle}>
              {tile.label}
            </div>
            <dl className={styles.metrics} style={textStyle}>
              {tile.metrics.map((metric, i) => (
                <React.Fragment key={`${metric.refId}-${i}`}>
                  <dt title={describeLabels(metric)}>{metric.name}</dt>
                  <dd>{metric.message ?? metric.display}</dd>
                </React.Fragment>
              ))}
            </dl>
          </>
        ) : (
          // Every frame is rendered into the same grid cell so the tile is sized to the tallest
          // one and doesn't jump as the text cycles.
          <div className={styles.frames} aria-hidden>
            {frames.map((frame, i) => (
              <div
                key={i}
                className={i === active ? styles.activeFrame : styles.hiddenFrame}
                data-testid={i === active ? 'cluster-alert-frame' : undefined}
              >
                <div className={styles.label} style={titleStyle}>
                  {frame.primary}
                </div>
                <div className={styles.secondary} style={textStyle}>
                  {frame.secondary}
                </div>
              </div>
            ))}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className={styles.container} style={{ width, height }}>
      {tiles.map(renderTile)}
    </div>
  );
};

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(4px)' },
  to: { opacity: 1, transform: 'none' },
});

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: theme.spacing(1),
    overflow: 'auto',
  }),
  tile: css({
    flexGrow: 1,
    minWidth: 0,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1, 1.5),
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    // `safe` falls back to top alignment when the expanded stats overflow, so they can scroll.
    justifyContent: 'safe center',
    overflow: 'auto',
    cursor: 'pointer',
    font: 'inherit',
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      outlineOffset: 2,
    },
  }),
  label: css({
    fontSize: theme.typography.md.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
  }),
  secondary: css({
    fontSize: theme.typography.sm.fontSize,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
  }),
  frames: css({
    display: 'grid',
  }),
  activeFrame: css({
    gridArea: '1 / 1',
    animation: `${fadeIn} 400ms ease-out`,
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  }),
  hiddenFrame: css({
    gridArea: '1 / 1',
    visibility: 'hidden',
  }),
  metrics: css({
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    justifyContent: 'center',
    columnGap: theme.spacing(1),
    margin: theme.spacing(1, 0, 0),
    fontSize: theme.typography.sm.fontSize,
    dt: { fontWeight: theme.typography.fontWeightMedium, textAlign: 'left', whiteSpace: 'pre-line' },
    dd: { margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre-line' },
  }),
  empty: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
    whiteSpace: 'pre-line',
    textAlign: 'center',
  }),
});
