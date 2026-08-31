import { loadProjectProfile, validateProfileEnvironment } from '../config/projectProfile';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Uso: npm run qa:profile:check -- <PROFILE_JSON>');
  }
  const profile = await loadProjectProfile(filePath);
  const missing = validateProfileEnvironment(profile);
  console.log(`Perfil válido: ${profile.profileName}`);
  console.log(`Azure: ${profile.azure.organization} / ${profile.azure.project}`);
  console.log(`Aplicaciones: ${Object.keys(profile.applications).join(', ') || '(ninguna)'}`);
  if (missing.length > 0) {
    console.log(`Variables pendientes: ${missing.join(', ')}`);
    process.exitCode = 2;
  } else {
    console.log('Variables de entorno requeridas: completas.');
  }
}

main().catch(error => {
  console.error('Perfil inválido:', error);
  process.exit(1);
});
