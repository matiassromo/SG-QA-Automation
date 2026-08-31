import { Page, expect } from '@playwright/test';

export class PerfilamientoPage {
  constructor(private readonly page: Page) {}

  async validarAccesoDisponible() {
    await expect(
      this.page.getByRole('link', { name: /Profiling|Perfilamiento/i })
    ).toBeVisible();
  }

  async irAPerfilamiento() {
    await this.page
      .getByRole('link', { name: /Profiling|Perfilamiento/i })
      .click();

    await expect(this.page).toHaveURL(/\/perfilamiento(?:\/|$)/);
    await expect(
      this.page.getByRole('heading', {
        name: /Informed consent|Consentimiento informado/i,
      })
    ).toBeVisible();
  }

  async aceptarInicio() {
    await this.page.getByRole('button', { name: 'Accept' }).click();
  }

  async seleccionarOpcionB() {
    await this.page
      .getByRole('button', { name: 'B. I want to organize my' })
      .click();
  }

  async continuar() {
    await this.page.getByRole('button', { name: 'Next' }).click();
  }

  async validarSolicitudEnviada() {
    await expect(
      this.page.getByText('Request sentAn advisor will')
    ).toBeVisible();
  }

  async aceptarConfirmacionFinal() {
    await this.page.getByRole('button', { name: 'Accept' }).click();
  }

  async validarRetornoDashboard() {
  await expect(this.page).toHaveURL(/dashboard/);
}
}
