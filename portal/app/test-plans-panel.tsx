"use client";

import { FormEvent, useMemo, useState } from "react";

type Plan = { id:number; name:string; state:string; areaPath:string; iteration:string; startDate:string; endDate:string; rootSuiteId:number|null };
type Suite = { id:number; name:string; suiteType:string; requirementId:number|null; parentSuiteId:number|null };
type Requirement = { id:number; title:string; type:string; iteration:string; area:string };
type Point = { id:number; configurationId:number; configurationName:string; outcome:string };
type Details = { testCases:Array<{id:number;title:string;order:number;points:Point[]}>; points:Point[] };

type Props = {
  project:string; plans:Plan[]; suites:Suite[]; details:Details|null; requirements:Requirement[];
  classification:{areas:string[];iterations:string[]};
  selectedRequirementIds:number[]; planId:number|null; suiteId:number|null;
  setPlanId:(id:number)=>void; setSuiteId:(id:number)=>void;
  onPlanCreated:(plan:Plan)=>void; onPlanUpdated:(plan:Plan)=>void; onPlanDeleted:(id:number)=>void;
  onSuitesPrepared:(suites:Suite[])=>void;
};

async function api<T>(url:string, init?:RequestInit) {
  const response = await fetch(url, { ...init, headers:{ "Content-Type":"application/json", ...(init?.headers ?? {}) } });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as T & { error?:string };
  if (!response.ok) throw Object.assign(new Error(data.error ?? "No fue posible completar la operación."), { status:response.status, data });
  return data;
}

export function TestPlansPanel(props:Props) {
  const { project, plans, suites, details, requirements, classification, selectedRequirementIds, planId, suiteId } = props;
  const selectedPlan = plans.find(item=>item.id===planId) ?? null;
  const selectedRequirements = requirements.filter(item=>selectedRequirementIds.includes(item.id));
  const iterations = useMemo(()=>[...new Set([...classification.iterations,...requirements.map(item=>item.iteration)].filter(Boolean))].sort(),[classification.iterations,requirements]);
  const suitesByRequirement = new Map(suites.filter(item=>item.requirementId).map(item=>[item.requirementId,item]));
  const missing = selectedRequirements.filter(item=>!suitesByRequirement.has(item.id));
  const [creating,setCreating]=useState(false),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(""),[failure,setFailure]=useState("");
  const [duplicate,setDuplicate]=useState<Plan|null>(null);

  const endpoint=`/api/azure/projects/${encodeURIComponent(project)}/plans`;
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setFailure("");setMessage("");setDuplicate(null);
    const form=new FormData(event.currentTarget),name=String(form.get("name")??"").trim(),iteration=String(form.get("iteration")??"").trim(),description=String(form.get("description")??"").trim();
    try{const data=await api<{plan:Plan;existingPlan?:Plan}>(endpoint,{method:"POST",body:JSON.stringify({name,iteration,description})});props.onPlanCreated(data.plan);setCreating(false);setMessage(`Test Plan ${data.plan.name} creado en Azure DevOps.`);}
    catch(error){const value=error as Error&{status?:number;data?:{existingPlan?:Plan}};if(value.status===409&&value.data?.existingPlan){setDuplicate(value.data.existingPlan);setFailure("Ese Test Plan ya existe. Puedes usarlo sin duplicarlo.");}else setFailure(value.message);}
    finally{setBusy(false);}
  }
  async function update(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!selectedPlan)return;setBusy(true);setFailure("");
    const form=new FormData(event.currentTarget),name=String(form.get("name")??"").trim(),iteration=String(form.get("iteration")??"").trim();
    const duplicateName=plans.find(item=>item.id!==selectedPlan.id&&item.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase());
    if(duplicateName){setFailure(`Ya existe el plan ${duplicateName.id} · ${duplicateName.name}.`);setDuplicate(duplicateName);setBusy(false);return;}
    try{const data=await api<{plan:Plan}>(`${endpoint}/${selectedPlan.id}`,{method:"PATCH",body:JSON.stringify({name,iteration})});props.onPlanUpdated(data.plan);setEditing(false);setMessage("Test Plan actualizado en Azure DevOps.");}
    catch(error){setFailure((error as Error).message);}finally{setBusy(false);}
  }
  async function remove(){
    if(!selectedPlan||!window.confirm(`¿Eliminar definitivamente el Test Plan ${selectedPlan.id} · ${selectedPlan.name}?`))return;
    setBusy(true);setFailure("");try{await api(`${endpoint}/${selectedPlan.id}`,{method:"DELETE"});props.onPlanDeleted(selectedPlan.id);setMessage("Test Plan eliminado de Azure DevOps.");}
    catch(error){setFailure((error as Error).message);}finally{setBusy(false);}
  }
  async function prepareSuites(items=selectedRequirements){
    if(!selectedPlan?.rootSuiteId||!items.length)return;setBusy(true);setFailure("");setMessage("");
    try{const data=await api<{suites:Suite[];createdIds:number[];existingIds:number[]}>(`${endpoint}/${selectedPlan.id}/suites`,{method:"POST",body:JSON.stringify({parentSuiteId:selectedPlan.rootSuiteId,requirements:items.map(({id,title})=>({id,title}))})});props.onSuitesPrepared(data.suites);setMessage(data.createdIds.length?`${data.createdIds.length} Requirement Based Suite creadas; ${data.existingIds.length} ya existían.`:"Todas las HUs seleccionadas ya tienen su suite. No se creó ningún duplicado.");}
    catch(error){setFailure((error as Error).message);}finally{setBusy(false);}
  }

  return <div className="plans-workspace">
    <section className="plan-toolbar">
      <label><span>Test Plan destino</span><select value={planId??""} onChange={event=>props.setPlanId(Number(event.target.value))}><option value="" disabled>Seleccionar Test Plan…</option>{plans.map(item=><option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>
      <div className="plan-actions"><button onClick={()=>{setCreating(true);setEditing(false)}}>＋ Nuevo Test Plan</button><button className="secondary" disabled={!selectedPlan} onClick={()=>{setEditing(true);setCreating(false)}}>Editar</button><button className="danger" disabled={!selectedPlan||busy} onClick={remove}>Eliminar</button></div>
    </section>

    {(creating||editing)&&<section className="plan-editor"><div><small>{creating?"NUEVO EN AZURE DEVOPS":"EDITAR TEST PLAN"}</small><h3>{creating?"Crear Test Plan":`${selectedPlan?.id} · ${selectedPlan?.name}`}</h3><p>El área se asignará automáticamente a {project}\\QA.</p></div><form onSubmit={creating?create:update}><label>Nombre<input name="name" required defaultValue={editing?selectedPlan?.name:""} placeholder="QA - SPRINT 01"/></label><label>Iteración<select name="iteration" required defaultValue={editing?selectedPlan?.iteration:""}><option value="" disabled>Seleccionar iteración de Azure…</option>{editing&&selectedPlan?.iteration&&!iterations.includes(selectedPlan.iteration)&&<option value={selectedPlan.iteration}>{selectedPlan.iteration}</option>}{iterations.map(item=><option key={item} value={item}>{item}</option>)}</select></label>{creating&&<label>Descripción (opcional)<input name="description" placeholder="Pruebas funcionales del sprint"/></label>}<div><button type="button" className="secondary" onClick={()=>{setCreating(false);setEditing(false)}}>Cancelar</button><button disabled={busy||!iterations.length}>{busy?"Guardando…":"Guardar en Azure"}</button></div></form></section>}
    {failure&&<div className="plan-notice error">{failure}{duplicate&&<button onClick={()=>{props.setPlanId(duplicate.id);setDuplicate(null);setFailure("")}}>Usar {duplicate.id} · {duplicate.name}</button>}</div>}
    {message&&<div className="plan-notice success">✓ {message}</div>}

    <section className="suite-mapping">
      <header><div><small>HU → REQUIREMENT BASED SUITE</small><h3>Preparar estructura del sprint</h3><p>SGQA crea una suite por HU dentro del Test Plan seleccionado y reutiliza las existentes.</p></div><button disabled={!selectedPlan||!missing.length||busy} onClick={()=>prepareSuites(missing)}>{busy?"Procesando…":`Generar suites faltantes (${missing.length})`}</button></header>
      {!selectedPlan?<div className="plans-empty">Crea o selecciona el Test Plan destino.</div>:!selectedRequirements.length?<div className="plans-empty"><b>No hay HUs seleccionadas</b><span>Entra a Requisitos, selecciona las historias del sprint y vuelve a Test Plans.</span></div>:<div className="suite-map-list">{selectedRequirements.map(requirement=>{const suite=suitesByRequirement.get(requirement.id);return <article key={requirement.id}><div><b>HU #{requirement.id} · {requirement.title}</b><span>{requirement.iteration||"Sin iteración"}</span></div>{suite?<button className="suite-ready" onClick={()=>props.setSuiteId(suite.id)}>✓ Suite {suite.id} existente</button>:<button disabled={busy} onClick={()=>prepareSuites([requirement])}>＋ Generar suite</button>}</article>})}</div>}
    </section>

    {selectedPlan&&suites.length>0&&<section className="selectors compact"><label>Explorar Test Suite<select value={suiteId??""} onChange={event=>props.setSuiteId(Number(event.target.value))}>{suites.map(item=><option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label><button disabled={!details}>▶ Ejecutar suite</button></section>}
    {details&&<section className="data-panel plan-cases"><div className="panel-title"><div><small>COBERTURA</small><h3>Casos y configuraciones</h3></div><span>{details.points.length} Test Points</span></div><div className="table-wrap"><table><thead><tr><th>Orden</th><th>Test Case</th><th>Configuraciones</th><th>Estado</th></tr></thead><tbody>{details.testCases.map(item=><tr key={item.id}><td>{item.order||"—"}</td><td><b>QA-TC · {item.id}</b><span>{item.title}</span></td><td><div className="chips">{item.points.map(point=><span key={point.id}>{point.configurationName||`Config ${point.configurationId}`}</span>)}</div></td><td><em className="state active">{item.points[0]?.outcome||"Active"}</em></td></tr>)}</tbody></table></div></section>}
  </div>;
}
