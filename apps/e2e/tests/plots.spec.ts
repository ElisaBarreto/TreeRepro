import { expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

interface CreatedSpecies {
  data: { id: string };
}

test.describe('RFC-67 / RFC-33 field plots and species scope (plan 08b)', () => {
  test('admin manages plots, assigns restricted contributor, contributor sees plot species only then toggles scope when unrestricted', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const adminPage = await admin.newPage();

    const timestamp = Date.now();
    const speciesInPlotName = `E2E InPlot ${timestamp}`;
    const speciesOutsidePlotName = `E2E OutsidePlot ${timestamp}`;

    // Create two species via API
    const sp1 = await apiCall<CreatedSpecies>(admin, 'POST', '/api/species', {
      canonicalName: speciesInPlotName,
      nameSource: 'wcvp',
    });
    expect(sp1.status).toBe(201);
    if (!sp1.json) throw new Error('POST /api/species failed');

    const sp2 = await apiCall<CreatedSpecies>(admin, 'POST', '/api/species', {
      canonicalName: speciesOutsidePlotName,
      nameSource: 'wcvp',
    });
    expect(sp2.status).toBe(201);
    if (!sp2.json) throw new Error('POST /api/species failed');

    const plotCode = `PLT-${timestamp.toString().slice(-6)}`;
    const plotName = `E2E Plot ${timestamp}`;

    // Admin creates plot through the UI
    await adminPage.goto('/app/admin/plots');
    await adminPage.getByRole('button', { name: 'New plot' }).click();

    await adminPage.getByLabel('Code').fill(plotCode);
    await adminPage.getByLabel('Name').fill(plotName);
    await adminPage.getByLabel('Biome').fill('Cerrado');
    await adminPage.getByRole('button', { name: 'Create plot' }).click();

    // Verify plot is visible and navigate to its detail page
    const plotLink = adminPage.getByRole('link', { name: plotCode });
    await expect(plotLink).toBeVisible();
    await plotLink.click();
    await expect(
      adminPage.getByRole('heading', { name: `${plotCode} — ${plotName}` }),
    ).toBeVisible();

    // Admin adds species to plot using the UI combobox
    const combobox = adminPage.getByRole('combobox', { name: 'Add species to plot' });
    await combobox.fill(speciesInPlotName);
    // Wait for dropdown option and click it
    const candidateOption = adminPage.getByRole('option', { name: speciesInPlotName });
    await expect(candidateOption).toBeVisible();
    await candidateOption.click();

    // Verify species appears in the plot's species list
    await expect(adminPage.getByRole('link', { name: speciesInPlotName })).toBeVisible();

    // Invite contributor
    const contributor = await inviteAndActivate(browser, admin, { role: 'contributor' });

    try {
      // Admin assigns contributor to plot restricted
      await adminPage.goto(`/app/admin/users/${contributor.userId}`);
      await expect(adminPage.getByRole('heading', { name: 'Plots' })).toBeVisible();

      // Check the plot checkbox
      const plotCheckbox = adminPage
        .locator('label', { hasText: plotCode })
        .locator('input[type="checkbox"]');
      await plotCheckbox.check();

      // Check the restriction checkbox
      const restrictCheckbox = adminPage.getByLabel(
        'Restrict to assigned plots (the user never sees species outside them)',
      );
      await expect(restrictCheckbox).toBeEnabled();
      await restrictCheckbox.check();

      // Save plot assignments
      await adminPage.getByRole('button', { name: 'Save plots' }).click();
      await expect(adminPage.getByText('Plots saved.')).toBeVisible();

      // Contributor visits species page
      await contributor.page.goto('/app/species');

      // The "Show species outside my plots" checkbox must NOT render because user is restricted
      await expect(contributor.page.getByLabel('Show species outside my plots')).toHaveCount(0);

      // Search for the species inside the plot -> visible
      await contributor.page.getByLabel('Search species').fill(speciesInPlotName);
      await expect(contributor.page.getByRole('link', { name: speciesInPlotName })).toBeVisible();

      // Search for the species outside the plot -> not visible (No species match)
      await contributor.page.getByLabel('Search species').fill(speciesOutsidePlotName);
      await expect(
        contributor.page.getByText(`No species matches “${speciesOutsidePlotName}”.`),
      ).toBeVisible();

      // Admin unticks the restriction
      await adminPage.goto(`/app/admin/users/${contributor.userId}`);
      const restrictCheckboxAdmin = adminPage.getByLabel(
        'Restrict to assigned plots (the user never sees species outside them)',
      );
      await restrictCheckboxAdmin.uncheck();
      await adminPage.getByRole('button', { name: 'Save plots' }).click();
      await expect(adminPage.getByText('Plots saved.')).toBeVisible();

      // Contributor reloads species page
      await contributor.page.goto('/app/species');

      // Now contributor sees the checkbox
      const outsideCheckbox = contributor.page.getByLabel('Show species outside my plots');
      await expect(outsideCheckbox).toBeVisible();
      await expect(outsideCheckbox).not.toBeChecked();

      // Without ticking, default scope is 'plots' -> outside species is still not visible
      await contributor.page.getByLabel('Search species').fill(speciesOutsidePlotName);
      await expect(
        contributor.page.getByText(`No species matches “${speciesOutsidePlotName}”.`),
      ).toBeVisible();

      // Contributor ticks "Show species outside my plots"
      await outsideCheckbox.check();

      // Now the outside species IS visible!
      await expect(
        contributor.page.getByRole('link', { name: speciesOutsidePlotName }),
      ).toBeVisible();
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});
