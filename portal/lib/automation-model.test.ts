import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAutomatability, automationScopeKey, capabilityForConfiguration, summarizeAnalyses } from './automation-model.ts';

test('clasifica navegadores web sin afirmar equivalencia Safari real',()=>{
  assert.equal(capabilityForConfiguration({id:1,name:'Chrome'}).state,'SUPPORTED');
  const safari=capabilityForConfiguration({id:2,name:'macOS - Safari'});
  assert.equal(safari.state,'EMULATED'); assert.match(safari.note,/no equivale/i);
});
test('no inventa capacidad móvil cuando Azure no distingue web de app nativa',()=>{
  assert.equal(capabilityForConfiguration({id:3,name:'Android'}).state,'NOT_CONFIGURED');
  assert.equal(capabilityForConfiguration({id:4,name:'iOS'}).state,'NOT_CONFIGURED');
});
test('respeta un mapeo confirmado por el proyecto',()=>{assert.equal(capabilityForConfiguration({id:7,name:'Windows 10'},'chromium').state,'SUPPORTED');assert.equal(capabilityForConfiguration({id:8,name:'Android'},'native-unsupported').state,'NOT_SUPPORTED');});
test('el análisis declara contexto faltante y no inventa selectores ni credenciales',()=>{
  const result=analyzeAutomatability({testCaseId:20,title:'Iniciar sesión',steps:[{action:'Ingresar al portal',expected:'Muestra el inicio'}],configurations:[{id:1,name:'Chrome'}]});
  assert.deepEqual(result.missingContext,['baseUrl','testUser','authContext','navigationContext']);
  assert.equal(JSON.stringify(result).includes('locator'),false);
});
test('el alcance aísla proyecto, plan, suite y caso',()=>{
  assert.notEqual(automationScopeKey('A',1,2,3),automationScopeKey('A',9,2,3));
  assert.notEqual(automationScopeKey('A',1,2,3),automationScopeKey('B',1,2,3));
});
test('resume exclusivamente el conjunto de análisis entregado',()=>{
  const base={automatable:true,confidence:.8,reason:'',requirements:[],missingContext:[],capabilities:[],analyzedAt:''};
  assert.deepEqual(summarizeAnalyses([{...base,testCaseId:1,status:'AUTOMATABLE'},{...base,testCaseId:2,status:'PARTIALLY_AUTOMATABLE'}]),{analyzed:2,automatable:1,partial:1,notAutomatable:0});
});
