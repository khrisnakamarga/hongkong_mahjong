import { expect, test } from '@playwright/test';

test('renders the playable Mahjong table shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Hong Kong Mahjong' })).toBeVisible();
  await expect(page.getByText('Eligible actions')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Waiting for table|Your prompt/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hong Kong Fan defaults' })).toBeVisible();
  await expect(page.getByText('Wall')).toBeVisible();
  await expect(page.getByText('Table ledger')).toBeVisible();
});

test('supports local demo seat takeover and action prompt flow', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Use local demo/i }).click();
  await page.locator('.seat-card').filter({ hasText: 'East' }).click();

  await expect(page.getByText(/Viewing Player|Viewing You/)).toBeVisible();
  await expect(page.getByText('Your prompt')).toBeVisible();

  const drawButton = page.getByRole('button', { name: /Draw tile|Pass|Declare|Chow|Pong|Kong/i }).first();
  if (await drawButton.isVisible()) {
    await drawButton.click();
  } else {
    await page.locator('button.tile:not(:disabled)').first().click();
  }

  await expect(page.getByText(/You chose|AI|No AI claimed/).first()).toBeVisible();
});

test('keeps table information visible while hiding non-viewer concealed hands', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Use local demo/i }).click();
  await page.locator('.seat-card').filter({ hasText: 'East' }).click();

  await expect(page.getByLabel('API base')).toBeVisible();
  await expect(page.getByLabel('WebSocket URL')).toBeVisible();
  await expect(page.getByText('Round wind', { exact: true })).toBeVisible();
  await expect(page.getByText('Current turn', { exact: true })).toBeVisible();
  await expect(page.getByText('Last discard', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your hand' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Concealed hand' })).toHaveCount(3);
  await expect(page.locator('.viewer-player .tile:not(.tile-back)').first()).toBeVisible();
  await expect(page.locator('.player-panel:not(.viewer-player) .tile-back').first()).toBeVisible();
  await expect(page.getByText(/Minimum Fan/)).toBeVisible();
  await expect(page.getByText(/3\+ Fan/)).toBeVisible();
});

test('has a discreet reveal-all control for local tile inspection', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Use local demo/i }).click();
  await page.locator('.seat-card').filter({ hasText: 'East' }).click();

  await expect(page.getByRole('heading', { name: 'Concealed hand' })).toHaveCount(3);
  await expect(page.locator('.player-panel:not(.viewer-player) .tile-back').first()).toBeVisible();

  await page.getByRole('button', { name: /Reveal all tiles/i }).click();

  await expect(page.getByRole('heading', { name: 'Revealed hand' })).toHaveCount(3);
  await expect(page.locator('.player-panel:not(.viewer-player) .tile:not(.tile-back)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide all tiles/i })).toBeVisible();
});

test('keeps a newly drawn tile highlighted at the right edge of the viewer hand', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Use local demo/i }).click();
  await page.locator('.seat-card').filter({ hasText: 'East' }).click();
  await page.locator('.viewer-player button.tile:not(:disabled)').first().click();
  let drewTile = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const drawButton = page.getByRole('button', { name: /Draw tile/i });
    if (await drawButton.isVisible({ timeout: 500 })) {
      await drawButton.click();
      drewTile = true;
      break;
    }
    const passButton = page.getByRole('button', { name: /^Pass$/i });
    if (await passButton.isVisible({ timeout: 500 })) {
      await passButton.click();
    } else {
      await page.getByRole('button', { name: /Auto-play to prompt/i }).click();
    }
  }

  expect(drewTile).toBe(true);
  const visibleHandTiles = page.locator('.viewer-player .hand-row .tile:not(.tile-back)');
  await expect(visibleHandTiles.last()).toHaveClass(/tile-drawn/);
  await expect(page.locator('.viewer-player .hand-row .tile-drawn')).toHaveCount(1);
});

test('supports watching four AI players advance without claiming a seat', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Watch 4 AIs/i }).click();

  await expect(page.getByText(/Four-AI spectator mode is active/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spectator' })).toBeVisible();
  await expect(page.getByText(/Started four-AI spectator game/i)).toBeVisible();
  await expect(page.getByText(/AI East chose|AI South chose|AI West chose|AI North chose/i).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /Pause 4 AIs/i })).toBeVisible();

  await page.getByRole('button', { name: /Pause 4 AIs/i }).click();
  await expect(page.getByRole('button', { name: /Resume 4 AIs/i })).toBeVisible();
});
