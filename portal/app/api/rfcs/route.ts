import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureSchema, getDb } from '@/db';
import { rfcDocuments } from '@/db/schema';

export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get('project')?.trim();
  if (!project) return NextResponse.json({ error: 'Falta el proyecto.' }, { status: 400 });
  await ensureSchema();
  const rows = await getDb().select({ id:rfcDocuments.id, project:rfcDocuments.project, name:rfcDocuments.name, originalFileName:rfcDocuments.originalFileName, mimeType:rfcDocuments.mimeType, size:rfcDocuments.size, version:rfcDocuments.version, status:rfcDocuments.status, extractedText:rfcDocuments.extractedText, huIds:rfcDocuments.huIds, createdAt:rfcDocuments.createdAt }).from(rfcDocuments).where(eq(rfcDocuments.project, project)).orderBy(desc(rfcDocuments.createdAt));
  return NextResponse.json({ rfcs: rows.map(row => ({ ...row, huIds: JSON.parse(row.huIds) })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const project=String(body.project??'').trim(), name=String(body.name??'').trim(), originalFileName=String(body.originalFileName??'').trim(), mimeType=String(body.mimeType??'').trim(), version=String(body.version??'1.0').trim(), contentBase64=String(body.contentBase64??''), extractedText=String(body.extractedText??'').trim();
  const size=Number(body.size), huIds=Array.isArray(body.huIds)?body.huIds.map(Number).filter(Number.isInteger):[];
  if(!project||!name||!originalFileName||!mimeType||!Number.isFinite(size)||size<=0||size>8_000_000||!extractedText)return NextResponse.json({error:'RFC inválido o superior a 8 MB.'},{status:400});
  await ensureSchema();
  const[created]=await getDb().insert(rfcDocuments).values({project,name,originalFileName,mimeType,size,version,status:'ready',contentBase64,extractedText,huIds:JSON.stringify(huIds),createdAt:new Date().toISOString()}).returning({id:rfcDocuments.id,status:rfcDocuments.status});
  return NextResponse.json(created,{status:201});
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  const url = new URL(request.url), id = Number(url.searchParams.get('id')), project = url.searchParams.get('project')?.trim();
  if (!Number.isInteger(id) || !project) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  await ensureSchema();
  await getDb().delete(rfcDocuments).where(and(eq(rfcDocuments.id, id), eq(rfcDocuments.project, project)));
  return NextResponse.json({ deleted: true });
}
