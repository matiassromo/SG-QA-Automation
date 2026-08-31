export type ProjectContext = {
  organization: string;
  projectId: string;
  projectName: string;
  areaPath?: string;
  iterationPath?: string;
  team?: string;
  requirementTypes: string[];
};

export function assertProjectContext(context: ProjectContext) {
  if (!context.organization.trim()) throw new Error('ProjectContext sin organización.');
  if (!context.projectId.trim()) throw new Error('ProjectContext sin projectId.');
  if (!context.projectName.trim()) throw new Error('ProjectContext sin projectName.');
  if (!context.requirementTypes.length) {
    throw new Error(`El proyecto ${context.projectName} no tiene tipos de requisito configurados.`);
  }
  return context;
}

export function projectScopeKey(context: ProjectContext) {
  assertProjectContext(context);
  return `${context.organization.toLocaleLowerCase()}::${context.projectId.toLocaleLowerCase()}`;
}

export function assertSameProject(expected: ProjectContext, actual: ProjectContext) {
  if (projectScopeKey(expected) !== projectScopeKey(actual)) {
    throw new Error(
      `Violación de aislamiento: ${actual.projectName} no pertenece al contexto activo ${expected.projectName}.`,
    );
  }
}
