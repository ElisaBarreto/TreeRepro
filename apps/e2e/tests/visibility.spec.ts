import { expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

interface CreatedSpecies {
  data: { id: string };
}
interface FetchedSpecies {
  data: { active: boolean };
}

test.describe('RFC-33 species visibility (issue #69)', () => {
  test('an inactive species disappears for a contributor, stays labelled for the admin and the manager', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const adminPage = await admin.newPage();
    const name = `E2E hidden ${Date.now()}`;
    const created = await apiCall<CreatedSpecies>(admin, 'POST', '/api/species', {
      canonicalName: name,
      nameSource: 'wcvp',
    });
    expect(created.status).toBe(201);
    if (!created.json) throw new Error('POST /api/species answered an empty body');
    const speciesId = created.json.data.id;
    const deactivated = await apiCall(admin, 'PATCH', `/api/species/${speciesId}`, {
      active: false,
    });
    expect(deactivated.status).toBe(200);

    const contributor = await inviteAndActivate(browser, admin, { role: 'contributor' });
    const manager = await inviteAndActivate(browser, admin, { role: 'manager' });

    try {
      // Contributor: no dataset.read_inactive — the Status filter (gated on
      // the same permission, RFC-33 R7) does not render, and the species is
      // simply absent from the results.
      await contributor.page.goto('/app/species');
      await expect(contributor.page.getByLabel('Status')).toHaveCount(0);
      await contributor.page.getByLabel('Search species').fill(name);
      await expect(contributor.page.getByText('No species match.')).toBeVisible();

      // Admin: filters explicitly to Inactive and sees the species, labelled.
      await adminPage.goto('/app/species');
      await adminPage.getByLabel('Search species').fill(name);
      await adminPage.getByLabel('Status').selectOption('inactive');
      await expect(adminPage.getByRole('link', { name })).toBeVisible();
      await expect(adminPage.getByText('inactive', { exact: true })).toBeVisible();

      // Manager: also holds dataset.read_inactive — sees the species (and its
      // "inactive" badge) without filtering, and has the Status select the
      // contributor above does not.
      await manager.page.goto('/app/species');
      await expect(manager.page.getByLabel('Status')).toBeVisible();
      await manager.page.getByLabel('Search species').fill(name);
      await expect(manager.page.getByRole('link', { name })).toBeVisible();
      await expect(manager.page.getByText('inactive', { exact: true })).toBeVisible();
    } finally {
      await contributor.context.close();
      await manager.context.close();
      await admin.close();
    }
  });

  test('RFC-33 R2 GET /api/species/:id hides an inactive species from a contributor (404) and shows it to a manager (200, active: false)', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const name = `E2E hidden api ${Date.now()}`;
    const created = await apiCall<CreatedSpecies>(admin, 'POST', '/api/species', {
      canonicalName: name,
      nameSource: 'wcvp',
    });
    expect(created.status).toBe(201);
    if (!created.json) throw new Error('POST /api/species answered an empty body');
    const speciesId = created.json.data.id;
    const deactivated = await apiCall(admin, 'PATCH', `/api/species/${speciesId}`, {
      active: false,
    });
    expect(deactivated.status).toBe(200);

    const contributor = await inviteAndActivate(browser, admin, { role: 'contributor' });
    const manager = await inviteAndActivate(browser, admin, { role: 'manager' });

    try {
      const asContributor = await apiCall(contributor.context, 'GET', `/api/species/${speciesId}`);
      expect(asContributor.status).toBe(404);

      const asManager = await apiCall<FetchedSpecies>(
        manager.context,
        'GET',
        `/api/species/${speciesId}`,
      );
      expect(asManager.status).toBe(200);
      if (!asManager.json) throw new Error('GET /api/species/:id answered an empty body');
      expect(asManager.json.data.active).toBe(false);
    } finally {
      await contributor.context.close();
      await manager.context.close();
      await admin.close();
    }
  });
});
