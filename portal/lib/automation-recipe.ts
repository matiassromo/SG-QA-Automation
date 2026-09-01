import type { AutomationSettings } from './automation-settings';

export type ActionType='goto'|'click'|'fill'|'select'|'check'|'press';
export type AssertionType='none'|'visible'|'hidden'|'text'|'url';
export type RecipeOperation={id:string;azureStepIndex:number;label:string;action:ActionType;locator:string;valueSource:'literal'|'env';value:string;assertion:AssertionType;assertionLocator:string;expected:string};
export type AutomationRecipe={project:string;planId:number;suiteId:number;testCaseId:number;operations:RecipeOperation[];status:'DRAFT'|'READY';updatedAt:string};

const envName=/^[A-Z][A-Z0-9_]*$/;
const actions=new Set<ActionType>(['goto','click','fill','select','check','press']);
const assertions=new Set<AssertionType>(['none','visible','hidden','text','url']);

export function validateRecipe(operations:RecipeOperation[]){
 const errors:string[]=[];
 if(!operations.length)errors.push('Agrega al menos una acción.');
 operations.forEach((operation,index)=>{
  const position=`Acción ${index+1}`;
  if(!actions.has(operation.action))errors.push(`${position}: acción no soportada.`);
  if(!assertions.has(operation.assertion))errors.push(`${position}: validación no soportada.`);
  if(operation.action!=='goto'&&!operation.locator.trim())errors.push(`${position}: falta locator.`);
  if(['goto','fill','select','press'].includes(operation.action)&&!operation.value.trim())errors.push(`${position}: falta valor.`);
  if(operation.valueSource==='env'&&!envName.test(operation.value))errors.push(`${position}: el valor debe ser un nombre de variable de entorno.`);
  if(operation.assertion!=='none'&&operation.assertion!=='url'&&!(operation.assertionLocator||operation.locator).trim())errors.push(`${position}: falta locator de validación.`);
  if(['text','url'].includes(operation.assertion)&&!operation.expected.trim())errors.push(`${position}: falta resultado esperado.`);
 });
 return errors;
}

const q=(value:string)=>JSON.stringify(value);
const envValue=(operation:RecipeOperation)=>operation.valueSource==='env'?`requiredEnv(${q(operation.value)})`:q(operation.value);
const locator=(value:string)=>`resolveLocator(page, ${q(value)})`;

function renderOperation(operation:RecipeOperation,index:number){
 const target=locator(operation.locator),lines:string[]=[];
 if(operation.action==='goto')lines.push(`await page.goto(${envValue(operation)});`);
 if(operation.action==='click')lines.push(`await ${target}.click();`);
 if(operation.action==='fill')lines.push(`await ${target}.fill(${envValue(operation)});`);
 if(operation.action==='select')lines.push(`await ${target}.selectOption(${envValue(operation)});`);
 if(operation.action==='check')lines.push(`await ${target}.check();`);
 if(operation.action==='press')lines.push(`await ${target}.press(${envValue(operation)});`);
 const assertionTarget=locator(operation.assertionLocator||operation.locator);
 if(operation.assertion==='visible')lines.push(`await expect(${assertionTarget}).toBeVisible();`);
 if(operation.assertion==='hidden')lines.push(`await expect(${assertionTarget}).toBeHidden();`);
 if(operation.assertion==='text')lines.push(`await expect(${assertionTarget}).toContainText(${q(operation.expected)});`);
 if(operation.assertion==='url')lines.push(`await expect(page).toHaveURL(new RegExp(${q(operation.expected)}));`);
 return `  await test.step(${q(`Paso ${operation.azureStepIndex+1}.${index+1}: ${operation.label}`)}, async () => {\n    ${lines.join('\n    ')}\n  });`;
}

export function renderPlaywrightSpec(input:{project:string;planId:number;suiteId:number;testCase:{id:number;title:string};requirementId:number|null;settings:AutomationSettings;operations:RecipeOperation[]}){
 const errors=validateRecipe(input.operations);
 if(errors.length)throw new Error(errors.join(' '));
 const authenticated=input.settings.authenticatedLocator.startsWith('url=')
  ?`await expect(page).toHaveURL(new RegExp(${q(input.settings.authenticatedLocator.slice(4))}));`
  :`await expect(resolveLocator(page, ${q(input.settings.authenticatedLocator)})).toBeVisible();`;
 const authentication=input.settings.authMode==='form'?`test.beforeEach(async ({ page }) => {\n  await page.goto(${q(input.settings.loginPath)});\n  await resolveLocator(page, ${q(input.settings.usernameLocator)}).fill(requiredEnv(${q(input.settings.usernameEnv)}));\n  await resolveLocator(page, ${q(input.settings.passwordLocator)}).fill(requiredEnv(${q(input.settings.passwordEnv)}));\n  await resolveLocator(page, ${q(input.settings.submitLocator)}).click();\n  ${authenticated}\n});\n\n`:'';
 return `import { test, expect, type Page } from '@playwright/test';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(\`Falta la variable de entorno \${name}.\`);
  return value;
}

function resolveLocator(page: Page, descriptor: string) {
  const role = descriptor.match(/^role=([^[]+)\\[name=(.+)\\]$/);
  if (role) {
    const rawName = role[2];
    const regex = rawName.match(/^\\/(.*)\\/([dgimsuvy]*)$/);
    const name = regex ? new RegExp(regex[1], regex[2]) : rawName;
    return page.getByRole(role[1] as Parameters<Page['getByRole']>[0], { name });
  }
  if (descriptor.startsWith('text=')) return page.getByText(descriptor.slice(5), { exact: true });
  return page.locator(descriptor);
}

test.use({ baseURL: ${q(input.settings.baseUrl)} });

test.describe(${q(`Suite ${input.suiteId} · ${input.project}`)}, () => {
${authentication}test(${q(`[ADO:${input.testCase.id}] ${input.testCase.title}`)}, async ({ page }) => {
  test.info().annotations.push(
    { type: 'azure-test-case-id', description: ${q(String(input.testCase.id))} },
    { type: 'azure-test-plan-id', description: ${q(String(input.planId))} },
    { type: 'azure-test-suite-id', description: ${q(String(input.suiteId))} },
    { type: 'requirement-id', description: ${q(String(input.requirementId??''))} }
  );
${input.operations.map(renderOperation).join('\n')}
});
});
`;
}
