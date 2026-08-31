import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ensureSchema, getDb } from '@/db';
import { automationAnalyses } from '@/db/schema';
import { getSuiteDetails } from '@/lib/azure-devops';
import { analyzeAutomatability } from '@/lib/automation-model';

const decode=(row:typeof automationAnalyses.$inferSelect)=>({...row,requirements:JSON.parse(row.requirements),missingContext:JSON.parse(row.missingContext),capabilities:JSON.parse(row.capabilities)});
function identifiers(input:URL|Record<string,unknown>){
  const read=(key:string)=>input instanceof URL?input.searchParams.get(key):input[key];
  return {project:String(read('project')??'').trim(),planId:Number(read('planId')),suiteId:Number(read('suiteId'))};
}
function valid(scope:{project:string;planId:number;suiteId:number}){return scope.project&&Number.isInteger(scope.planId)&&scope.planId>0&&Number.isInteger(scope.suiteId)&&scope.suiteId>0;}

export async function GET(request:Request){
  const scope=identifiers(new URL(request.url));
  if(!valid(scope)) return NextResponse.json({error:'Falta Proyecto, Test Plan o Test Suite.'},{status:400});
  await ensureSchema();
  const rows=await getDb().select().from(automationAnalyses).where(and(eq(automationAnalyses.project,scope.project),eq(automationAnalyses.planId,scope.planId),eq(automationAnalyses.suiteId,scope.suiteId))).orderBy(asc(automationAnalyses.testCaseId));
  return NextResponse.json({analyses:rows.map(decode)});
}

export async function POST(request:Request){
  const body=await request.json() as Record<string,unknown>;
  const scope=identifiers(body);
  if(!valid(scope)) return NextResponse.json({error:'Falta Proyecto, Test Plan o Test Suite.'},{status:400});
  const requested=Array.isArray(body.testCaseIds)?new Set(body.testCaseIds.map(Number)):null;
  const details=await getSuiteDetails(scope.project,scope.planId,scope.suiteId);
  const activeCases=details.testCases.filter(item=>item.active&&(!requested||requested.has(item.id)));
  if(!activeCases.length) return NextResponse.json({error:'La Test Suite no tiene Test Cases activos para analizar.'},{status:409});
  const configurationById=new Map(details.configurations.map(item=>[item.id,item]));
  const context={
    baseUrl:Boolean(process.env.QA_BASE_URL), testUser:Boolean(process.env.QA_TEST_USER),
    authContext:Boolean(process.env.QA_AUTH_CONTEXT), navigationContext:Boolean(process.env.QA_NAVIGATION_CONTEXT),
  };
  const analyses=activeCases.map(testCase=>analyzeAutomatability({
    testCaseId:testCase.id,title:testCase.title,steps:testCase.steps,context,
    configurations:[...new Map(testCase.points.map(point=>[point.configurationId,configurationById.get(point.configurationId)??{id:point.configurationId,name:point.configurationName,values:[]}])).values()],
  }));
  await ensureSchema();
  for(const analysis of analyses){
    const values={...scope,testCaseId:analysis.testCaseId,status:analysis.status,automatable:analysis.automatable,confidence:analysis.confidence,reason:analysis.reason,requirements:JSON.stringify(analysis.requirements),missingContext:JSON.stringify(analysis.missingContext),capabilities:JSON.stringify(analysis.capabilities),analyzedAt:analysis.analyzedAt,updatedAt:analysis.analyzedAt};
    await getDb().insert(automationAnalyses).values(values).onConflictDoUpdate({target:[automationAnalyses.project,automationAnalyses.planId,automationAnalyses.suiteId,automationAnalyses.testCaseId],set:values});
  }
  return NextResponse.json({analyses});
}
