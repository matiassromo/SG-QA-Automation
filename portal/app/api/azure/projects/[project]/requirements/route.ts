import { NextResponse } from 'next/server';
import { getProjectRequirements, resolveProjectContext } from '@/lib/azure-devops';

export async function GET(_request: Request, context: { params: Promise<{ project: string }> }) {
  try { const { project } = await context.params; const projectContext = await resolveProjectContext(decodeURIComponent(project)); return NextResponse.json({ ...(await getProjectRequirements(projectContext)), projectContext }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando requisitos.' }, { status: 500 }); }
}
