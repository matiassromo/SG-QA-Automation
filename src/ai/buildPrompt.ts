import { QaContext } from '../types/qaContext';

export function buildTestPlanPrompt(
  context: QaContext
): string {
  const availableConfigurations = context.availableConfigurations
    .map(configuration => {
      const values = configuration.values
        .map(value => `${value.name}:${value.value}`)
        .join('; ');

      return `- ${configuration.name}${values ? ` (${values})` : ''}`;
    })
    .join('\n');

  const validConfigurationNames = JSON.stringify(
    context.availableConfigurations.map(
      configuration => configuration.name
    )
  );

  const figmaReferences = context.designReferences.length > 0
    ? context.designReferences
        .map(reference => [
          `- URL: ${reference.url}`,
          `  File key: ${reference.fileKey}`,
          `  Node ID: ${reference.nodeId ?? 'No especificado'}`,
          `  Origen: ${reference.origin}`,
          `  Work Item: ${reference.sourceWorkItemId ?? 'No asociado'}`,
        ].join('\n'))
        .join('\n')
    : 'No se encontraron referencias Figma.';

  const figmaContexts = context.designContexts.length > 0
    ? context.designContexts
        .map(design => JSON.stringify({
          fileName: design.fileName,
          version: design.version,
          lastModified: design.lastModified,
          platform: design.platform,
          reference: design.reference,
          rootNode: design.rootNode,
          screens: design.screens,
          visibleTexts: design.visibleTexts,
          textStyles: design.textStyles,
          controls: design.controls,
          interactions: design.interactions,
          analyzedNodeCount: design.analyzedNodeCount,
          truncated: design.truncated,
        }, null, 2))
        .join('\n\n')
    : 'No se pudo enriquecer ninguna referencia Figma.';

  const stories = context.userStories
    .map(story => {
      const tasks = story.tasks
        .map(
          task =>
            `- ${task.id} | ${task.state} | ${task.title}`
        )
        .join('\n');

      return `
WORK ITEM ${story.id}
Título: ${story.title}
Estado: ${story.state}

Descripción:
${story.description}

Criterios de aceptación:
${story.acceptanceCriteria}

Tasks:
${tasks || 'Sin tasks registradas'}
`;
    })
    .join('\n\n');

  return `
Eres un Senior QA Analyst especializado en diseño de pruebas.

Debes generar una PROPUESTA de Test Plan a partir de información real de Azure DevOps y un RFC funcional.

IMPORTANTE:
- No inventes requisitos.
- Diferencia claramente lo que proviene de Azure DevOps de lo que aparece únicamente en el RFC.
- Si el RFC contiene requisitos o HUs que no están asociados a la Feature analizada, repórtalos en coverageWarnings.
- PROHIBIDO crear Test Cases para requisitos que aparezcan únicamente en el RFC y no tengan una HU/PBI vinculada a esta Feature. Repórtalos solamente en coverageWarnings.
- No coloques casos de una HU ausente (por ejemplo HU-07, HU-08 o HU-09) dentro de la suite de otra HU para compensar la falta de trazabilidad.
- Figma y la validación visual están fuera del alcance de esta generación. Usa designReferences=[] y no generes warnings por ausencia de Figma.
- No asumas que todo lo mencionado en el RFC pertenece al alcance actual.
- Genera casos positivos, negativos, de validación, integración y borde cuando estén respaldados por los requisitos.
- Prioriza trazabilidad con los Work Item IDs.
- Evita duplicar casos equivalentes.
- Los casos deben poder ser ejecutados por un QA humano.
- Marca automationCandidate=true cuando el escenario sea estable, repetible y automatizable.
- Usa priority como número entero: 1 (alta), 2 (media) o 3 (baja).
- Usa type únicamente con uno de estos valores: functional, negative, validation, integration o edge.
- Cada suite debe corresponder a una HU/PBI vinculada a la Feature y usar su ID en sourceWorkItemId.
- Cada suite debe usar suiteType="requirement".
- Cada suite debe seleccionar en defaultConfigurationNames una o más configuraciones de la lista real de Azure DevOps.
- Usa configurationAssignment.mode="inherit-suite" cuando el caso aplique a todas las configuraciones de su suite.
- Usa configurationAssignment.mode="selected" y configurationNames cuando el caso aplique solo a un subconjunto.
- No inventes configuraciones. Usa los nombres exactamente como aparecen en la lista de Azure DevOps.
- Cada caso debe incluir al menos un sourceWorkItemId de Azure DevOps.
- Usa source únicamente como "RFC", "Figma" o "Azure DevOps" según el origen de la inconsistencia.
- Devuelve SOLAMENTE JSON válido.
- No incluyas markdown.
- No incluyas explicaciones fuera del JSON.

FEATURE
ID: ${context.feature.id}
Título: ${context.feature.title}
Estado: ${context.feature.state}
Iteration Path: ${context.feature.iterationPath}

EPIC
ID: ${context.epic.id}
Título: ${context.epic.title}

HISTORIAS DE USUARIO / PBIs DE AZURE DEVOPS

${stories}

RFC
Nombre: ${context.rfc.name}

CONTENIDO DEL RFC:
${context.rfc.text}

REFERENCIAS FIGMA
${figmaReferences}

CONTEXTO FIGMA NORMALIZADO
${figmaContexts}

CONFIGURACIONES DISPONIBLES EN AZURE DEVOPS
${availableConfigurations || 'No hay configuraciones disponibles'}

NOMBRES EXACTOS PERMITIDOS PARA defaultConfigurationNames Y configurationNames
${validConfigurationNames}

IMPORTANTE: copia únicamente el nombre exacto del arreglo anterior. No agregues
entre paréntesis los valores descriptivos de la configuración.

La salida debe seguir exactamente esta estructura:

{
  "testPlanName": "string",
  "objective": "string",
  "featureId": ${context.feature.id},
  "epicId": ${context.epic.id},
  "iterationPath": "${context.feature.iterationPath}",
  "suites": [
    {
      "name": "string",
      "sourceWorkItemId": 123,
      "suiteType": "requirement",
      "objective": "string",
      "defaultConfigurationNames": ["Chrome", "Android"],
      "testCases": [
        {
          "title": "string",
          "priority": 1,
          "type": "functional",
          "preconditions": ["string"],
          "steps": [
            {
              "action": "string",
              "expected": "string"
            }
          ],
          "sourceWorkItemIds": [123],
          "designReferences": [],
          "configurationAssignment": {
            "mode": "inherit-suite"
          },
          "automationCandidate": true
        }
      ]
    }
  ],
  "coverageWarnings": [
    {
      "title": "string",
      "description": "string",
      "source": "RFC"
    }
  ]
}
`.trim();
}
