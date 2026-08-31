import * as azdev from 'azure-devops-node-api';
import dotenv from 'dotenv';

dotenv.config();

const organization = process.env.AZURE_DEVOPS_ORG;
const project = process.env.AZURE_DEVOPS_PROJECT;
const pat = process.env.AZURE_DEVOPS_PAT;

if (!organization || !project || !pat) {
  throw new Error(
    'Faltan variables AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT o AZURE_DEVOPS_PAT en .env'
  );
}

const orgUrl = `https://dev.azure.com/${organization}`;

const authHandler = azdev.getPersonalAccessTokenHandler(pat);

export const azureConnection = new azdev.WebApi(
  orgUrl,
  authHandler
);

export const azureProject = project;