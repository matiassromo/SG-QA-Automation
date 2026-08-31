export type RunnerMapping='chromium'|'firefox'|'edge'|'webkit'|'mobile-web'|'native-unsupported'|'not-configured';
export type AutomationSettings={
  project:string;applicationType:'web'|'mobile-web'|'native';baseUrl:string;usernameEnv:string;passwordEnv:string;
  authMode:'form'|'storage-state'|'none';loginPath:string;usernameLocator:string;passwordLocator:string;submitLocator:string;
  authenticatedLocator:string;navigationLocator:string;configurationMappings:Record<string,RunnerMapping>;updatedAt:string;
};
export const emptyAutomationSettings=(project:string):AutomationSettings=>({project,applicationType:'web',baseUrl:'',usernameEnv:'',passwordEnv:'',authMode:'form',loginPath:'/',usernameLocator:'',passwordLocator:'',submitLocator:'',authenticatedLocator:'',navigationLocator:'',configurationMappings:{},updatedAt:''});
export function settingsContext(settings:AutomationSettings|null){if(!settings)return {baseUrl:false,testUser:false,authContext:false,navigationContext:false};return {
  baseUrl:Boolean(settings.baseUrl.trim()),testUser:settings.authMode==='none'||Boolean(settings.usernameEnv.trim()&&settings.passwordEnv.trim()),
  authContext:settings.authMode==='none'||settings.authMode==='storage-state'||Boolean(settings.usernameLocator.trim()&&settings.passwordLocator.trim()&&settings.submitLocator.trim()&&settings.authenticatedLocator.trim()),
  navigationContext:Boolean(settings.navigationLocator.trim()),
};}
export function validateAutomationSettings(settings:AutomationSettings){const errors:string[]=[];try{const url=new URL(settings.baseUrl);if(!['http:','https:'].includes(url.protocol))errors.push('La Base URL debe usar HTTP o HTTPS.')}catch{errors.push('La Base URL no es válida.');}const env=/^[A-Z][A-Z0-9_]*$/;if(settings.authMode==='form'){if(!env.test(settings.usernameEnv))errors.push('La variable de usuario debe ser un nombre de entorno válido.');if(!env.test(settings.passwordEnv))errors.push('La variable de contraseña debe ser un nombre de entorno válido.');for(const [label,value] of [['usuario',settings.usernameLocator],['contraseña',settings.passwordLocator],['envío',settings.submitLocator],['sesión autenticada',settings.authenticatedLocator]])if(!value.trim())errors.push(`Falta el locator confirmado de ${label}.`);}if(!settings.navigationLocator.trim())errors.push('Falta el locator confirmado de navegación principal.');return errors;}
