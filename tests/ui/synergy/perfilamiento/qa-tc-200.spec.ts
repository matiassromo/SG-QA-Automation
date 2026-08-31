import { test } from '@playwright/test';
import { PerfilamientoPage } from '../../../../pages/synergy/PerfilamientoPage';

test(
  'QA - TC-200 Caso 1: Acceso al módulo de Perfilamiento desde pantalla principal después de login',
  {
    annotation: [
      { type: 'azure-test-case-id', description: '4698' },
      { type: 'requirement-id', description: '2129' },
      { type: 'configuration', description: 'Chrome' },
    ],
    tag: ['@smoke', '@perfilamiento', '@qa-tc-200'],
  },
  async ({ page }) => {
    const perfilamiento = new PerfilamientoPage(page);

    await test.step('Abrir el dashboard con una sesión válida', async () => {
      await page.goto('/dashboard');
    });

    await test.step('Validar que el acceso a Perfilamiento está disponible', async () => {
      await perfilamiento.validarAccesoDisponible();
    });

    await test.step('Ingresar al módulo de Perfilamiento sin volver al login', async () => {
      await perfilamiento.irAPerfilamiento();
    });
  }
);
