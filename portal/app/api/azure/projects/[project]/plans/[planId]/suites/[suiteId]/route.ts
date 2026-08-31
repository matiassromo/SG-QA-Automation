import { NextResponse } from 'next/server';
import { getSuiteDetails } from '@/lib/azure-devops';

export async function GET(_request: Request, context: { params: Promise<{ project: string; planId: string; suiteId: string }> }) {
  try { const { project, planId, suiteId } = await context.params; return NextResponse.json(await getSuiteDetails(decodeURIComponent(project), Number(planId), Number(suiteId))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando la suite.' }, { status: 500 }); }
}
