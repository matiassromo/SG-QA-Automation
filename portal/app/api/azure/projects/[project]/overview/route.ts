import { NextResponse } from 'next/server';
import { getProjectOverview } from '@/lib/azure-devops';

export async function GET(_request: Request, context: { params: Promise<{ project: string }> }) {
  try { const { project } = await context.params; return NextResponse.json(await getProjectOverview(decodeURIComponent(project))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando el proyecto.' }, { status: 500 }); }
}
