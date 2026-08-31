import { test as setup, expect } from '@playwright/test';
import { synergyUsers } from '../../data/synergy/users';

const authFile = 'playwright/.auth/synergy.json';

setup('Autenticación SG_Synergy', async ({ page }) => {
  const user = synergyUsers.default;

  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in' }).click();

  await page
    .getByRole('textbox', { name: 'Username' })
    .fill(user.username);

  await page
    .getByRole('textbox', { name: 'Password' })
    .fill(user.password);

  await page
    .getByRole('button', { name: 'Sign in' })
    .click();

  const invalidCredentials = page.getByRole('alert');
  await Promise.race([
    page.waitForURL(/dashboard/, { timeout: 60_000 }),
    invalidCredentials.waitFor({ state: 'visible', timeout: 60_000 }).then(async () => {
      await page.getByRole('textbox', { name: 'Password' }).fill('');
      throw new Error(
        'El ambiente rechazó el usuario de pruebas configurado. Actualiza las credenciales de Synergy antes de ejecutar la suite.'
      );
    }),
  ]);

  await expect(page).toHaveURL(/dashboard/);

  await page.context().storageState({
    path: authFile,
  });
});
