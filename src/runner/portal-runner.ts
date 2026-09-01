import "dotenv/config";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { publishTestResult, type AzureTestOutcome, type PublishedTestStep } from "../azure/testResultPublisher";

type RunnerMapping="chromium"|"firefox"|"edge"|"webkit"|"mobile-web";
type Evidence={name:string;path:string;kind:"video"|"screenshot"|"trace"};
type Run={
 id:string;kind:"legacy-suite"|"recipe";pilotId:string;project:string;title:string;
 status:"running"|"passed"|"failed"|"blocked"|"sync_failed";outcome?:AzureTestOutcome;
 startedAt:string;completedAt?:string;azureRunId?:number;azureUrl?:string;journal?:string;
 evidence:Evidence[];output:string;configuration?:string;testCaseId?:number;
 totals?:{points:number;executed:number;passed:number;failed:number;blocked:number};
};
type AutomationTarget={project:string;planId:number;planName:string;manifest:string;playwrightProject:string};
type RecipeRunInput={project:string;planId:number;suiteId:number;testCaseId:number;testCaseTitle:string;configurationName:string;runner:RunnerMapping;source:string;steps:PublishedTestStep[]};

const workspace=process.cwd(),port=Number(process.env.QA_RUNNER_PORT||3101),storePath=path.join(workspace,"generated","portal-runs.json");
const allowedOrigin=process.env.QA_PORTAL_ORIGIN||"http://localhost:3000";
let runs:Run[]=[];

function playwrightProjectFor(project:string){const configured=JSON.parse(process.env.QA_PLAYWRIGHT_PROJECTS_JSON||"{}") as Record<string,string>;return configured[project]??`${project.replace(/^SG_/i,"").split(/[_\s-]/)[0].toLowerCase()}-chrome`;}
async function resolveTarget(project:string,planId:number):Promise<AutomationTarget>{const directory=path.join(workspace,"generated","automation");for(const name of await readdir(directory)){if(!name.endsWith(".json"))continue;const relative=path.join("generated","automation",name);try{const manifest=JSON.parse(await readFile(path.join(workspace,relative),"utf8"));if(manifest.project===project&&Number(manifest.planId)===planId)return{project,planId,planName:String(manifest.planName||`Test Plan ${planId}`),manifest:relative,playwrightProject:playwrightProjectFor(project)};}catch{}}throw new Error(`No existe un manifiesto de automatización para ${project}/Plan ${planId}.`);}
async function load(){try{runs=JSON.parse(await readFile(storePath,"utf8"));}catch{runs=[];}}
async function save(){await mkdir(path.dirname(storePath),{recursive:true});await writeFile(storePath,JSON.stringify(runs,null,2)+"\n","utf8");}
function cors(){return{"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};}
function json(res:http.ServerResponse,status:number,value:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",...cors()});res.end(JSON.stringify(value));}
async function body(req:http.IncomingMessage){let text="";for await(const chunk of req){text+=chunk;if(text.length>2_000_000)throw new Error("Solicitud demasiado grande.");}return text?JSON.parse(text):{};}
async function walkFiles(root:string){const found:string[]=[];async function walk(directory:string){try{for(const entry of await readdir(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory())await walk(full);else found.push(full);}}catch{}}await walk(root);return found;}
function evidenceFrom(files:string[]):Evidence[]{return files.flatMap(file=>{const extension=path.extname(file).toLowerCase();const kind=extension===".webm"?"video":extension===".png"?"screenshot":extension===".zip"?"trace":null;return kind?[{name:path.basename(file),path:file,kind}]:[];});}
function spawnAsync(command:string,args:string[],cwd=workspace){return new Promise<{code:number;output:string}>((resolve,reject)=>{const child=spawn(command,args,{cwd,env:{...process.env,DOTENV_CONFIG_QUIET:"true"},windowsHide:true});let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);child.once("error",reject);child.once("close",code=>resolve({code:code??1,output}));});}
function validRecipeSource(source:string){return source.startsWith("import { test, expect, type Page } from '@playwright/test';")&&!/["']node:|child_process|\bspawn\s*\(|\bexec\s*\(/.test(source);}
function recipeConfig(runner:RunnerMapping,evidenceDir:string,reportPath:string){const device=runner==="firefox"?"Desktop Firefox":runner==="webkit"?"Desktop Safari":runner==="mobile-web"?"Pixel 7":"Desktop Chrome";const channel=runner==="edge"?", channel: 'msedge'":"";return `import { defineConfig, devices } from '@playwright/test';\nexport default defineConfig({\n  testDir: '.', outputDir: ${JSON.stringify(evidenceDir)}, workers: 1, retries: 0, timeout: 60_000,\n  reporter: [['json', { outputFile: ${JSON.stringify(reportPath)} }]],\n  use: { ...devices[${JSON.stringify(device)}]${channel}, trace: 'on', screenshot: 'on', video: 'on' },\n});\n`;}

async function executeRecipe(run:Run,input:RecipeRunInput){
 const started=Date.now(),directory=path.join(workspace,"generated","runtime",run.id),evidenceDir=path.join(directory,"evidence"),specPath=path.join(directory,`qa-tc-${input.testCaseId}.spec.ts`),configPath=path.join(directory,"playwright.config.ts"),reportPath=path.join(directory,"report.json");
 try{
  await mkdir(evidenceDir,{recursive:true});
  await writeFile(specPath,input.source,"utf8");
  await writeFile(configPath,recipeConfig(input.runner,evidenceDir,reportPath),"utf8");
  const result=await spawnAsync(process.execPath,[path.join(workspace,"node_modules","@playwright","test","cli.js"),"test",specPath,"--config",configPath]);
  run.output=result.output.slice(-12000);
  run.evidence=evidenceFrom(await walkFiles(evidenceDir));
  const hasVideo=run.evidence.some(item=>item.kind==="video");
  run.outcome=result.code===0&&hasVideo?"Passed":hasVideo?"Failed":"Blocked";
  run.status=run.outcome==="Passed"?"passed":run.outcome==="Failed"?"failed":"blocked";
  const organization=process.env.AZURE_DEVOPS_ORG;
  if(!organization)throw new Error("Falta AZURE_DEVOPS_ORG para publicar el resultado.");
  const published=await publishTestResult({target:{organization,project:input.project},planId:input.planId,suiteId:input.suiteId,testCaseId:input.testCaseId,configurationName:input.configurationName,outcome:run.outcome,automatedTestName:`SGQA.TC.${input.testCaseId}`,steps:input.steps.map(step=>({...step,outcome:run.outcome})),durationMs:Date.now()-started,attachmentPaths:run.evidence.map(item=>item.path),azureRunMode:"planned",apply:true});
  run.azureRunId=published.runId;run.azureUrl=published.webAccessUrl;
 }catch(error){run.output=[run.output,error instanceof Error?error.message:String(error)].filter(Boolean).join("\n").slice(-12000);if(run.outcome)run.status="sync_failed";else{run.outcome="Blocked";run.status="blocked";}}
 run.completedAt=new Date().toISOString();await save();
}

function executeLegacy(run:Run,target:AutomationTarget,suiteId:number){const child=spawn(process.execPath,[path.join(workspace,"node_modules","tsx","dist","cli.mjs"),"src/cli/run-test-plan.ts","--manifest",target.manifest,"--project",target.playwrightProject,"--suite",String(suiteId),"--apply"],{cwd:workspace,env:{...process.env,DOTENV_CONFIG_QUIET:"true"},windowsHide:true});let output="";child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>output+=x);child.on("close",async code=>{run.output=output.slice(-12000);run.completedAt=new Date().toISOString();run.status=code===0?"passed":"failed";run.outcome=code===0?"Passed":"Failed";run.azureRunId=Number([...output.matchAll(/Azure Test Run:\s*(\d+)/g)].at(-1)?.[1])||undefined;run.azureUrl=[...output.matchAll(/URL:\s*(https?:\/\/\S+)/g)].at(-1)?.[1];run.journal=output.match(/Journal:\s*(.+)/)?.[1]?.trim();const totals=output.match(/Total Test Points:\s*(\d+)[\s\S]*?Ejecutados:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)\s*\|\s*Blocked:\s*(\d+)/);if(totals)run.totals={points:Number(totals[1]),executed:Number(totals[2]),passed:Number(totals[3]),failed:Number(totals[4]),blocked:Number(totals[5])};run.evidence=evidenceFrom(await walkFiles(path.join(workspace,"test-results")));await save();});}

async function main(){await load();const server=http.createServer(async(req,res)=>{try{const requestOrigin=req.headers.origin;if(requestOrigin&&requestOrigin!==allowedOrigin)return json(res,403,{error:"Origen no permitido."});if(req.method==="OPTIONS"){res.writeHead(204,cors());return res.end();}const url=new URL(req.url||"/",`http://127.0.0.1:${port}`);if(req.method==="GET"&&url.pathname==="/health")return json(res,200,{ok:true,running:runs.filter(item=>item.status==="running").length});if(req.method==="GET"&&url.pathname==="/runs")return json(res,200,{runs:runs.slice().reverse()});
 if(req.method==="POST"&&url.pathname==="/recipe-runs"){const input=await body(req) as RecipeRunInput;if(!input.project||![input.planId,input.suiteId,input.testCaseId].every(value=>Number.isInteger(value)&&value>0)||!input.configurationName||!(["chromium","firefox","edge","webkit","mobile-web"] as string[]).includes(input.runner)||!validRecipeSource(input.source)||!Array.isArray(input.steps))return json(res,400,{error:"Solicitud de ejecución inválida."});if(runs.some(item=>item.status==="running"))return json(res,409,{error:"Ya existe una ejecución en curso."});const run:Run={id:randomUUID(),kind:"recipe",pilotId:`${input.project}:${input.planId}:${input.suiteId}:${input.testCaseId}`,project:input.project,title:`TC ${input.testCaseId} · ${input.configurationName}`,status:"running",startedAt:new Date().toISOString(),configuration:input.configurationName,testCaseId:input.testCaseId,evidence:[],output:""};runs.push(run);await save();void executeRecipe(run,input);return json(res,202,{run});}
 if(req.method==="POST"&&url.pathname==="/runs"){const input=await body(req),project=String(input.project??"").trim(),planId=Number(input.planId),suiteId=Number(input.suiteId);if(!project||![planId,suiteId].every(value=>Number.isInteger(value)&&value>0))return json(res,400,{error:"Proyecto, Test Plan o Test Suite inválido."});const target=await resolveTarget(project,planId);if(runs.some(item=>item.status==="running"))return json(res,409,{error:"Ya existe una ejecución en curso."});const run:Run={id:randomUUID(),kind:"legacy-suite",pilotId:`${target.project}:${target.planId}`,project:target.project,title:`${target.planName} · Suite ${suiteId}`,status:"running",startedAt:new Date().toISOString(),evidence:[],output:""};runs.push(run);await save();executeLegacy(run,target,suiteId);return json(res,202,{run});}
 const evidenceMatch=url.pathname.match(/^\/runs\/([^/]+)\/evidence\/(\d+)$/);if(req.method==="GET"&&evidenceMatch){const run=runs.find(item=>item.id===evidenceMatch[1]),evidence=run?.evidence[Number(evidenceMatch[2])];if(!evidence)return json(res,404,{error:"Evidencia no disponible."});const mime=evidence.kind==="video"?"video/webm":evidence.kind==="screenshot"?"image/png":"application/zip";res.writeHead(200,{"Content-Type":mime,"Content-Disposition":`inline; filename="${evidence.name}"`,...cors()});return createReadStream(evidence.path).pipe(res);}return json(res,404,{error:"Ruta no encontrada."});}catch(error){return json(res,500,{error:error instanceof Error?error.message:"Error del runner."});}});server.listen(port,"127.0.0.1",()=>console.log(`QA runner listo en http://127.0.0.1:${port}`));}

main().catch(error=>{console.error(error);process.exitCode=1;});
