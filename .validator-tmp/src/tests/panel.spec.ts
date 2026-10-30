import { test, expect } from '@grafana/plugin-e2e';

test('should display the no-alerts text when the queries return nothing', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(page.getByTestId('cluster-alert-empty')).toHaveText('All clear');
});

test('should group results into one tile per instance and expand on click', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });

  // Series A covers node0-5, instant B covers node1-2: six tiles in total.
  const tiles = page.getByTestId('cluster-alert-tile');
  await expect(tiles).toHaveCount(6);

  const node1 = tiles.filter({ hasText: 'node1' });
  await node1.click();
  await expect(node1).toHaveAttribute('aria-expanded', 'true');
  await expect(node1).toContainText('Disk used');
  // The red threshold's message template, with its \n rendered as a line break.
  await expect(node1).toContainText('93% over 90% on node1\nfree space now!', { useInnerText: true });
  await expect(node1.getByTestId('cluster-alert-frame')).toHaveCount(0);
});

test('should cycle collapsed tiles between title and triggering stats', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });

  // node1's disk usage (93%) is always above the red threshold, so it has a stat frame to cycle to.
  const frame = page.getByRole('button', { name: /^node1:/ }).getByTestId('cluster-alert-frame');
  await expect(frame).toContainText('node1');
  await expect(frame).not.toContainText('triggering', { timeout: 10_000 });
});

test('should make tiles square when no tile height is set', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });

  const box = await page.getByTestId('cluster-alert-tile').first().boundingBox();
  expect(box).not.toBeNull();
  // Allow for a scrollbar narrowing the tiles slightly after the height was computed.
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(20);
});

test('should apply the title and text size options', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const options = panelEditPage.getCustomOptions('Cluster Alert');

  await options.getNumberInput('Title size').fill('30');
  await options.getNumberInput('Text size').fill('9');
  await options.getNumberInput('Text size').blur();

  const frame = page.getByTestId('cluster-alert-frame').first();
  await expect(frame.locator('div').first()).toHaveCSS('font-size', '30px');
  await expect(frame.locator('div').nth(1)).toHaveCSS('font-size', '9px');
});
