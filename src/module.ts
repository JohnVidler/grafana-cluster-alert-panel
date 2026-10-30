import { PanelPlugin, SelectFieldConfigSettings } from '@grafana/data';

import { ClusterAlertPanel } from './components/ClusterAlertPanel';
import { MetricRulesEditor } from './components/MetricRulesEditor';
import { ClusterAlertOptions } from './types';

export const plugin = new PanelPlugin<ClusterAlertOptions>(ClusterAlertPanel).setPanelOptions((builder) => {
  return builder
    .addMultiSelect<string, SelectFieldConfigSettings<string>>({
      path: 'groupByLabels',
      name: 'Group by labels',
      description:
        'Results sharing these label values are merged into one tile (e.g. instance, service). Results without them fall back to their series name.',
      // addMultiSelect types the value as a single option, but it stores an array.
      defaultValue: ['instance'] as unknown as string,
      settings: {
        allowCustomValue: true,
        options: [],
        getOptions: async (context) => {
          const names = new Set<string>();
          context.data?.forEach((frame) =>
            frame.fields.forEach((field) => Object.keys(field.labels ?? {}).forEach((name) => names.add(name)))
          );
          return [...names].sort().map((name) => ({ label: name, value: name }));
        },
      },
    })
    .addRadio({
      path: 'sortBy',
      name: 'Sort tiles by',
      description: 'Triggering series: tiles with the most alerting results first.',
      defaultValue: 'count',
      settings: {
        options: [
          { value: 'count', label: 'Triggering series' },
          { value: 'severity', label: 'Severity' },
          { value: 'label', label: 'Label' },
        ],
      },
    })
    .addSliderInput({
      path: 'maxColumns',
      name: 'Max columns',
      description: 'Tiles per row before wrapping onto the next row.',
      defaultValue: 4,
      settings: { min: 1, max: 12, step: 1 },
    })
    .addNumberInput({
      path: 'tileHeight',
      name: 'Tile height',
      description: 'Fixed tile height in pixels. Leave empty to make tiles square to the column width.',
      settings: { min: 20, integer: true, placeholder: 'Auto (square)' },
    })
    .addNumberInput({
      path: 'titleSize',
      name: 'Title size',
      description: 'Font size in pixels for tile titles (and stat names while cycling). Leave empty for the default.',
      settings: { min: 6, integer: true, placeholder: 'Auto' },
    })
    .addNumberInput({
      path: 'textSize',
      name: 'Text size',
      description: 'Font size in pixels for the text under the title and the stats table. Leave empty for the default.',
      settings: { min: 6, integer: true, placeholder: 'Auto' },
    })
    .addNumberInput({
      path: 'cycleSeconds',
      name: 'Cycle interval (seconds)',
      description:
        'Collapsed tiles cycle between their title and each triggering stat. Click a tile to stop and show all stats. 0 disables cycling.',
      defaultValue: 3,
      settings: { min: 0, step: 0.5 },
    })
    .addTextInput({
      path: 'noAlertsText',
      name: 'Text when no alerts',
      description: 'Use \\n for a line break.',
      defaultValue: 'All clear',
    })
    .addCustomEditor({
      id: 'metricRules',
      path: 'metricRules',
      name: 'Query rules',
      description:
        'Unit and thresholds per (query, result type). Results with no matching rule are shown in red without a unit.',
      category: ['Query rules'],
      defaultValue: [],
      editor: MetricRulesEditor,
    });
});
