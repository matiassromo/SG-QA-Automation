# SG-QA-Automation

Genera propuestas de Test Plan desde una Feature de Azure DevOps, descubre sus HUs/PBIs, Tasks y el RFC DOCX adjunto a la Epic, y publica el resultado bajo control humano.

## Configuración reutilizable

Copie `project-profile.example.json` por cada proyecto. El perfil contiene únicamente referencias no secretas:

- organización, proyecto, Area Path y testers predeterminados de Azure;
- convención y secuencia continua de nombres para Test Cases;
- nombres de variables de entorno para URLs y credenciales del aplicativo;
- política de descubrimiento de Feature, HUs y RFC.

Las contraseñas, tokens y PAT permanecen en variables de entorno o `.env`. Nunca se guardan en el perfil ni en los Test Cases.

Validar un perfil:

```powershell
npm run qa:profile:check -- project-profile.example.json
```

## Generación

La Feature es siempre una entrada de ejecución; las HUs/PBIs y el RFC no se configuran como listas estáticas.

```powershell
npm run qa:generate -- --feature 1965
```

## Publicación

Primero ejecute el modo de solo lectura:

```powershell
npm run qa:publish -- generated/test-plans/feature-1965.json --dry-run `
  --profile project-profile.json `
  --iteration "Proyecto\\Sprint 3" `
  --plan-name "QA - SPRINT 03"
```

Para aplicar el mismo preview use el comando dedicado y pase el archivo de destino como segundo argumento. El comando vuelve a validar todo y solicita confirmación `y/N` antes de escribir:

```powershell
npm run qa:publish:apply -- `
  generated/test-plans/feature-1965.json `
  publication-target.json
```

Opciones de destino: `--organization`, `--project`, `--area`, `--iteration`, `--plan-name`, `--plan-id`, `--parent-suite-id`, `--tester-id`, `--target` y `--profile`.

`existingTestCasePolicy` controla las HUs que ya tienen casos enlazados:

- `block` (predeterminado): detiene la publicación y muestra IDs y títulos;
- `reuse`: reutiliza coincidencias por título normalizado y crea solamente los faltantes;
- `append`: conserva los históricos y crea todos los casos del preview.

Las requirement-based suites siempre muestran también los casos históricos enlazados a su HU. Por eso el dry-run distingue casos únicos, vínculos por suite, reutilizados, nuevos y total visible estimado.

Cada publicación conserva un journal sin secretos en `generated/publications/`. Si ocurre un fallo parcial, el journal identifica exactamente qué Plan, suites y Test Cases alcanzaron a crearse.

## Controles de seguridad

- bloquea nombres de Test Plan duplicados al crear uno nuevo;
- valida Feature, HUs/PBIs, configuraciones, Area Path e Iteration Path;
- valida plan y suite padre cuando se publica en un plan existente;
- bloquea suites homónimas para evitar duplicar casos y test points;
- aplica `block`, `reuse` o `append` cuando una HU ya tiene Test Cases enlazados;
- nunca elimina automáticamente artefactos de Azure ante un fallo parcial.

## Plan de automatización

Crear el manifiesto que enlaza el preview con los Test Case IDs publicados:

```powershell
npm run qa:automation:plan -- <PREVIEW_JSON> <PUBLICATION_JOURNAL_JSON>
```

Generar borradores Playwright seguros:

```powershell
npm run qa:automation:scaffold -- <AUTOMATION_MANIFEST_JSON>
```

Los borradores se guardan fuera de `tests/` y contienen `test.fixme`. No se ejecutan hasta descubrir selectores reales, completar Page Objects y promoverlos conscientemente al árbol de pruebas. Android/iOS se clasifican como runner móvil pendiente hasta definir si el producto es mobile web o una aplicación nativa.

## Publicación de resultados automatizados

Después de una ejecución Playwright aprobada, resuelva primero el Test Point sin escribir en Azure:

```powershell
npm run qa:result:publish -- --plan 4716 --suite 4718 --case 4698 `
  --configuration Chrome --outcome Passed `
  --test-name "QA - TC-200 Caso 1"
```

Para crear y completar el Azure Test Run, repita el comando agregando `--apply --attachment <VIDEO_WEBM> --manifest <AUTOMATION_MANIFEST_JSON>`. El video y el manifiesto son obligatorios: este último aporta prioridad, acciones y resultados esperados de cada paso. Cada publicación conserva un journal auditable en `generated/test-results/`.

Playwright usa `video: 'on'`, por lo que conserva video tanto en ejecuciones aprobadas como fallidas. Los videos se generan al cerrarse el contexto del navegador y se guardan bajo `test-results/`.

`--azure-run-mode planned` es el modo predeterminado: conserva en Azure la tabla de pasos, prioridad, ejecutor y video como una ejecución planificada originada por Playwright. Use `--azure-run-mode automated` cuando se prefiera la clasificación automatizada nativa de Azure; Azure no renderiza `iterationDetails/actionResults` en ese modo.

En modo `planned`, el video se adjunta a la iteración `1` para que aparezca dentro del bloque **Test passed/Test failed**, junto a los pasos. En modo `automated`, se conserva como adjunto general del resultado.

## Ejecución por Test Suite

Validar selección, implementaciones y Test Points sin abrir el navegador ni escribir en Azure:

```powershell
npm run qa:run:suite -- --manifest generated/automation/feature-1965-plan-4716.json `
  --suite 4718 --configuration Chrome
```

Ejecutar una sola corrida Playwright y publicar un único Azure Test Run con un resultado y video por cada Test Case implementado:

```powershell
npm run qa:run:suite -- --manifest generated/automation/feature-1965-plan-4716.json `
  --suite 4718 --configuration Chrome --project synergy-chrome --apply
```

Los candidatos todavía no implementados se reportan como pendientes y no se marcan artificialmente como aprobados, fallidos ni bloqueados.
