import { FieldType, toDataFrame, ThresholdsMode } from '@grafana/data';

import { MetricRule } from '../types';
import { buildTiles, rateOverInterval, renderTemplate } from './tiles';

const frame = (refId: string, labels: Record<string, string>, times: number[], values: number[]) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      { name: 'Value', type: FieldType.number, values, labels },
    ],
  });

const rule = (refId: string, kind: MetricRule['kind'], steps: Array<[number, string]>): MetricRule => ({
  refId,
  kind,
  thresholds: { mode: ThresholdsMode.Absolute, steps: steps.map(([value, color]) => ({ value, color })) },
});

describe('rateOverInterval', () => {
  it('returns change per interval using the point one interval back', () => {
    const points = [0, 1, 2, 3].map((i) => ({ time: i * 60_000, value: i * 10 }));
    expect(rateOverInterval(points, 60_000)).toBe(10);
    expect(rateOverInterval(points, 120_000)).toBe(20);
  });

  it('scales when the series is shorter than the interval', () => {
    const points = [
      { time: 0, value: 0 },
      { time: 30_000, value: 5 },
    ];
    expect(rateOverInterval(points, 60_000)).toBe(10);
  });

  it('returns null for a single point', () => {
    expect(rateOverInterval([{ time: 0, value: 1 }], 60_000)).toBeNull();
  });
});

describe('renderTemplate', () => {
  it('substitutes placeholders, blanks unknown names and expands \\n', () => {
    expect(renderTemplate('{{value}} over 50% on {{ server }}\\n{{missing}}!', { value: '93%', server: 'db1' })).toBe(
      '93% over 50% on db1\n!'
    );
  });

  it('does not expand \\n inside substituted values', () => {
    expect(renderTemplate('{{a}}', { a: 'x\\ny' })).toBe('x\\ny');
  });
});

describe('buildTiles', () => {
  it('groups results from different queries by label', () => {
    const tiles = buildTiles(
      [
        frame('A', { instance: 'node1', job: 'x' }, [0], [5]),
        frame('B', { instance: 'node1' }, [0], [7]),
        frame('A', { instance: 'node2' }, [0], [1]),
      ],
      { groupByLabels: ['instance'], rules: [] }
    );
    expect(tiles.map((t) => [t.label, t.metrics.map((m) => m.refId)])).toEqual([
      ['node1', ['A', 'B']],
      ['node2', ['A']],
    ]);
  });

  it('classifies instant vs series results and computes the rate for series', () => {
    const [tile] = buildTiles(
      [frame('A', { instance: 'n' }, [0], [42]), frame('B', { instance: 'n' }, [0, 60_000, 120_000], [0, 3, 9])],
      { groupByLabels: ['instance'], rules: [], intervalMs: 60_000 }
    );
    expect(tile.metrics.map((m) => [m.kind, m.value])).toEqual([
      ['instant', 42],
      ['series', 6],
    ]);
  });

  it('applies rules per (refId, kind) and colours the tile by the worst metric', () => {
    const rules = [
      rule('A', 'instant', [
        [-Infinity, 'green'],
        [50, 'red'],
      ]),
      rule('A', 'series', [
        [-Infinity, 'green'],
        [1, 'orange'],
      ]),
    ];
    const [tile] = buildTiles(
      [frame('A', { instance: 'n' }, [0], [10]), frame('A', { instance: 'n' }, [0, 60_000], [0, 5])],
      { groupByLabels: ['instance'], rules, intervalMs: 60_000 }
    );
    expect(tile.metrics.map((m) => m.threshold.color)).toEqual(['green', 'orange']);
    expect(tile.worst.threshold.color).toBe('orange');
  });

  it('treats a null base step (as saved in JSON) as -Infinity', () => {
    const saved = rule('A', 'instant', [[50, 'red']]);
    saved.thresholds.steps.unshift({ value: null as unknown as number, color: 'green' });
    const [tile] = buildTiles([frame('A', { instance: 'n' }, [0], [10])], {
      groupByLabels: ['instance'],
      rules: [saved],
    });
    expect(tile.worst.threshold.color).toBe('green');
  });

  it('defaults to red when no rule matches, and falls back to the series name without group labels', () => {
    const [tile] = buildTiles([frame('A', { service: 'api' }, [0], [1])], { groupByLabels: ['instance'], rules: [] });
    expect(tile.worst.threshold.color).toBe('red');
    expect(tile.label).toContain('api');
  });

  it('sorts by severity, then label', () => {
    const rules = [
      rule('A', 'instant', [
        [-Infinity, 'green'],
        [10, 'red'],
      ]),
    ];
    const tiles = buildTiles(
      [
        frame('A', { instance: 'a' }, [0], [1]),
        frame('A', { instance: 'c' }, [0], [20]),
        frame('A', { instance: 'b' }, [0], [1]),
      ],
      { groupByLabels: ['instance'], rules }
    );
    expect(tiles.map((t) => t.label)).toEqual(['c', 'a', 'b']);
  });

  it('renders the active threshold message with value, unit and labels', () => {
    const r = rule('B', 'instant', [
      [-Infinity, 'green'],
      [50, 'red'],
    ]);
    r.unit = 'percent';
    r.thresholds.steps[1].format = '{{value}} over 50% on {{server}}\\nquery {{refId}}';
    const [tile] = buildTiles([frame('B', { server: 'db1' }, [0], [93])], { groupByLabels: ['server'], rules: [r] });
    expect(tile.metrics[0].display).toBe('93%');
    expect(tile.metrics[0].message).toBe('93% over 50% on db1\nquery B');
  });

  it('counts every result as triggering when the trigger is "any"', () => {
    const rules = [
      rule('A', 'instant', [
        [-Infinity, 'green'],
        [10, 'red'],
      ]),
    ];
    const [tile] = buildTiles([frame('A', { instance: 'n' }, [0], [1]), frame('B', { instance: 'n' }, [0], [1])], {
      groupByLabels: ['instance'],
      rules,
    });
    expect(tile.triggeringCount).toBe(2);
  });

  it('only counts results at or above the trigger threshold', () => {
    const r = rule('A', 'instant', [
      [-Infinity, 'green'],
      [50, 'orange'],
      [80, 'red'],
    ]);
    r.trigger = 50;
    const [tile] = buildTiles(
      [
        frame('A', { instance: 'n', disk: 'a' }, [0], [10]),
        frame('A', { instance: 'n', disk: 'b' }, [0], [60]),
        frame('A', { instance: 'n', disk: 'c' }, [0], [90]),
      ],
      { groupByLabels: ['instance'], rules: [r] }
    );
    expect(tile.metrics.map((m) => m.triggering)).toEqual([false, true, true]);
    expect(tile.triggeringCount).toBe(2);
  });

  it('treats a trigger saved as null as "any"', () => {
    const r = rule('A', 'instant', [
      [-Infinity, 'green'],
      [50, 'red'],
    ]);
    r.trigger = null as unknown as number;
    const [tile] = buildTiles([frame('A', { instance: 'n' }, [0], [1])], { groupByLabels: ['instance'], rules: [r] });
    expect(tile.triggeringCount).toBe(1);
  });

  it('sorts by triggering count by default, then severity and label', () => {
    const tiles = buildTiles(
      [
        frame('A', { instance: 'a' }, [0], [1]),
        frame('A', { instance: 'b' }, [0], [1]),
        frame('B', { instance: 'b' }, [0], [1]),
        frame('A', { instance: 'c' }, [0], [1]),
      ],
      { groupByLabels: ['instance'], rules: [] }
    );
    expect(tiles.map((t) => [t.label, t.triggeringCount])).toEqual([
      ['b', 2],
      ['a', 1],
      ['c', 1],
    ]);
  });

  it('expands \\n in display names and tile titles', () => {
    const r = rule('A', 'instant', [[-Infinity, 'red']]);
    r.displayName = 'Disk\\nused';
    const [tile] = buildTiles([frame('A', { instance: 'rack1\\nnode1' }, [0], [1])], {
      groupByLabels: ['instance'],
      rules: [r],
    });
    expect(tile.label).toBe('rack1\nnode1');
    expect(tile.metrics[0].name).toBe('Disk\nused');
  });
});
