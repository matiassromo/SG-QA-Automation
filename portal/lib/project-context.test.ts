import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSameProject, projectScopeKey, type ProjectContext } from './project-context.ts';

const projectA: ProjectContext = {
  organization: 'SGAplicaciones', projectId: 'project-a-id', projectName: 'Project A',
  areaPath: 'Project A', requirementTypes: ['User Story'],
};
const projectB: ProjectContext = {
  organization: 'SGAplicaciones', projectId: 'project-b-id', projectName: 'Project B',
  areaPath: 'Project B', requirementTypes: ['Product Backlog Item'],
};

test('la clave de aislamiento usa organización e ID, no IDs de Work Items', () => {
  assert.equal(projectScopeKey(projectA), 'sgaplicaciones::project-a-id');
  assert.notEqual(projectScopeKey(projectA), projectScopeKey(projectB));
});

test('rechaza mezclar operaciones de dos proyectos', () => {
  assert.throws(() => assertSameProject(projectA, projectB), /Violación de aislamiento/);
});

test('acepta dos instancias del mismo contexto', () => {
  assert.doesNotThrow(() => assertSameProject(projectA, { ...projectA }));
});
