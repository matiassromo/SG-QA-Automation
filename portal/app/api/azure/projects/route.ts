import { NextResponse } from 'next/server';
import { listProjects } from '@/lib/azure-devops';

export async function GET() {
  try { return NextResponse.json({ projects: await listProjects() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando Azure DevOps.' }, { status: 500 }); }
}
