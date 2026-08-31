import { NextResponse } from 'next/server';
import { createTestPlan, listPlans } from '@/lib/azure-devops';

export async function GET(_request: Request, context: { params: Promise<{ project: string }> }) {
  try { const { project } = await context.params; return NextResponse.json({ plans: await listPlans(decodeURIComponent(project)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando planes.' }, { status: 500 }); }
}

export async function POST(request:Request,context:{params:Promise<{project:string}>}){
 try{const{project}=await context.params,decoded=decodeURIComponent(project),body=await request.json() as {name?:string;iteration?:string;description?:string},name=String(body.name??'').trim(),iteration=String(body.iteration??'').trim(),description=String(body.description??'').trim();if(!name||!iteration)return NextResponse.json({error:'Falta nombre o iteración.'},{status:400});const existing=(await listPlans(decoded)).find(plan=>plan.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase());if(existing)return NextResponse.json({error:'Ya existe un Test Plan con ese nombre.',existingPlan:existing},{status:409});return NextResponse.json({plan:await createTestPlan(decoded,name,iteration,description)},{status:201});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'No fue posible crear el Test Plan.'},{status:500});}
}
