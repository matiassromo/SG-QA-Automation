import { test } from '@playwright/test';
import { PerfilamientoPage } from '../../../../pages/synergy/PerfilamientoPage';

test('TC-3950 - Flujo completo Opción B de Perfilamiento', async ({ page }) => {
  const perfilamientoPage = new PerfilamientoPage(page);

  await page.goto('/dashboard');

  await perfilamientoPage.irAPerfilamiento();
  await perfilamientoPage.aceptarInicio();
  await perfilamientoPage.seleccionarOpcionB();
  await perfilamientoPage.continuar();

  await perfilamientoPage.validarSolicitudEnviada();

  await perfilamientoPage.aceptarConfirmacionFinal();

  await perfilamientoPage.validarRetornoDashboard();
});