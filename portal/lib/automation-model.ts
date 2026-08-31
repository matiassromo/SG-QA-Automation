export type AutomationStatus = 'NOT_ANALYZED'|'ANALYZING'|'AUTOMATABLE'|'PARTIALLY_AUTOMATABLE'|'NOT_AUTOMATABLE'|'AUTOMATION_READY';
export type CapabilityState = 'SUPPORTED'|'EMULATED'|'NOT_SUPPORTED'|'NOT_CONFIGURED';
export type Capability = { configurationId:number; configurationName:string; state:CapabilityState; engine:string; note:string };
export type AutomationAnalysis = { testCaseId:number; status:AutomationStatus; automatable:boolean; confidence:number; reason:string; requirements:string[]; missingContext:string[]; capabilities:Capability[]; analyzedAt:string };
export type Configuration = { id:number; name:string; values?:unknown };
type RunnerMapping='chromium'|'firefox'|'edge'|'webkit'|'mobile-web'|'native-unsupported'|'not-configured';

function serialized(values:unknown){ return JSON.stringify(values??[]).toLocaleLowerCase(); }
export function capabilityForConfiguration(configuration:Configuration,mapping?:RunnerMapping):Capability {
  const name=configuration.name.toLocaleLowerCase(), values=serialized(configuration.values);
  if(mapping){
    if(mapping==='native-unsupported')return {configurationId:configuration.id,configurationName:configuration.name,state:'NOT_SUPPORTED',engine:'Playwright Web no compatible',note:'Esta configuración representa una aplicación nativa o dispositivo real.'};
    if(mapping==='not-configured')return {configurationId:configuration.id,configurationName:configuration.name,state:'NOT_CONFIGURED',engine:'Sin motor configurado',note:'El proyecto aún no define cómo ejecutar esta configuración.'};
    const engines={chromium:'Playwright Chromium',firefox:'Playwright Firefox',edge:'Playwright Chromium/Edge',webkit:'Playwright WebKit','mobile-web':'Playwright device emulation'};
    return {configurationId:configuration.id,configurationName:configuration.name,state:['webkit','mobile-web'].includes(mapping)?'EMULATED':'SUPPORTED',engine:engines[mapping],note:mapping==='webkit'?'WebKit aproxima Safari; no equivale a Safari real sobre macOS.':mapping==='mobile-web'?'Emulación mobile web; no valida una app nativa real.':'Mapeo confirmado en la configuración del proyecto.'};
  }
  if(name.includes('chrome')) return {configurationId:configuration.id,configurationName:configuration.name,state:'SUPPORTED',engine:'Playwright Chromium',note:'Ejecución web directa con Chromium.'};
  if(name.includes('firefox')) return {configurationId:configuration.id,configurationName:configuration.name,state:'SUPPORTED',engine:'Playwright Firefox',note:'Ejecución web directa con Firefox.'};
  if(name.includes('edge')) return {configurationId:configuration.id,configurationName:configuration.name,state:'SUPPORTED',engine:'Playwright Chromium/Edge',note:'Ejecución web con el canal Microsoft Edge.'};
  if(name.includes('safari')||name.includes('macos')) return {configurationId:configuration.id,configurationName:configuration.name,state:'EMULATED',engine:'Playwright WebKit',note:'WebKit aproxima Safari; no equivale a Safari real sobre macOS.'};
  if(name.includes('android')||name.includes('ios')) {
    const web=/browser|chrome|safari|web/.test(values);
    return {configurationId:configuration.id,configurationName:configuration.name,state:web?'EMULATED':'NOT_CONFIGURED',engine:web?'Playwright responsive/WebKit':'Sin motor configurado',note:web?'Emulación de navegador/dispositivo; no valida una app nativa real.':'Azure no indica si es web responsive o app nativa/dispositivo real.'};
  }
  return {configurationId:configuration.id,configurationName:configuration.name,state:'NOT_CONFIGURED',engine:'Sin motor configurado',note:'Se necesita mapear esta configuración a una capacidad real.'};
}

export function analyzeAutomatability(input:{testCaseId:number;title:string;steps:Array<{action:string;expected:string}>;configurations:Configuration[];configurationMappings?:Record<string,RunnerMapping>;context?:Partial<Record<'baseUrl'|'testUser'|'authContext'|'navigationContext',boolean>>}):AutomationAnalysis {
  const text=[input.title,...input.steps.flatMap(step=>[step.action,step.expected])].join(' ').toLocaleLowerCase();
  const capabilities=input.configurations.map(configuration=>capabilityForConfiguration(configuration,input.configurationMappings?.[configuration.name]));
  const requirements=['baseUrl','testUser','authContext','navigationContext'];
  const missingContext=requirements.filter(item=>!input.context?.[item as keyof typeof input.context]);
  const intrinsicallyManual=/firma manuscrita|validaci[oó]n humana|comparaci[oó]n visual manual|captcha/.test(text);
  const deviceDependent=/biometr|c[aá]mara|gps|nfc|app nativa|push notification/.test(text);
  const supported=capabilities.some(item=>item.state==='SUPPORTED'||item.state==='EMULATED');
  let status:AutomationStatus='AUTOMATABLE', confidence=.86, reason='El flujo contiene acciones y resultados verificables que pueden modelarse con automatización web.';
  if(intrinsicallyManual){status='NOT_AUTOMATABLE';confidence=.94;reason='El caso requiere una validación humana o mecanismo que no debe automatizarse como flujo determinista.';}
  else if(deviceDependent||!supported){status='PARTIALLY_AUTOMATABLE';confidence=.78;reason=deviceDependent?'La parte web puede automatizarse, pero la capacidad nativa/dispositivo real requiere infraestructura adicional.':'No existe aún una configuración asociada a un motor de automatización real.';}
  else if(!missingContext.length){status='AUTOMATION_READY';reason='El caso es automatizable y tiene el contexto mínimo necesario para preparar su implementación.';}
  return {testCaseId:input.testCaseId,status,automatable:status!=='NOT_AUTOMATABLE',confidence,reason,requirements,missingContext,capabilities,analyzedAt:new Date().toISOString()};
}

export function summarizeAnalyses(analyses:AutomationAnalysis[]){return {
  analyzed:analyses.length,
  automatable:analyses.filter(item=>['AUTOMATABLE','AUTOMATION_READY'].includes(item.status)).length,
  partial:analyses.filter(item=>item.status==='PARTIALLY_AUTOMATABLE').length,
  notAutomatable:analyses.filter(item=>item.status==='NOT_AUTOMATABLE').length,
};}

export function automationScopeKey(project:string,planId:number,suiteId:number,testCaseId:number){return `${project.trim().toLocaleLowerCase()}::${planId}::${suiteId}::${testCaseId}`;}
