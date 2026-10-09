import type { ResponsePlan } from './responsePlanner.js';
type DatabaseRow=Record<string,unknown>; export interface DatabaseTable{columns:string[];rows:unknown[][];}
function asRecord(row:unknown):DatabaseRow{return row&&typeof row==='object'&&!Array.isArray(row)?row as DatabaseRow:{value:row};}
export interface ColumnMeta { key: string; label: string; type: string; }
function label(k:string):string{return k.replaceAll('_',' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/\b\w/g,x=>x.toUpperCase());}
function value(v:unknown):string{if(v==null)return '—';if(v instanceof Date)return v.toISOString();if(typeof v==='object')return JSON.stringify(v);return String(v);}
const INTERNAL=/^(id|.*_id|created_at|updated_at|completed_at|.*_at|.*metadata.*|file_path|file_name|file_type|file_size|email|folder)$/i;
function dedupe(cols:string[]):string[]{const seen=new Set<string>();const out:string[]=[];for(const c of cols){const base=c.toLowerCase().replace(/_/g,'');const key=base.endsWith('projectname')?'projectname':base.endsWith('projectid')?'projectid':base;if(seen.has(key))continue;seen.add(key);out.push(c);}return out;}
function colType(key: string, sample: unknown): string {
  if (typeof sample === 'number') return 'number';
  if (sample instanceof Date) return 'date';
  if (/date|_at|time/i.test(key)) return 'date';
  if (/count|total|_count/i.test(key)) return 'number';
  if (/status/i.test(key)) return 'status';
  return 'text';
}
export function columnMetadata(rows: unknown[], plan: ResponsePlan): ColumnMeta[] {
  const rec = rows.map(asRecord);
  const first = rec[0] ?? {};
  return visibleColumns(first, plan).map((k) => {
    const contract = contractForColumn(k, plan);
    return { key: k, label: contract?.label ?? label(k), type: contract?.type ?? colType(k, first[k]) };
  });
}
function canonicalKey(key: string): string { return key.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function contractMatches(column: string, field: string, plan: ResponsePlan): boolean {
  const col = canonicalKey(column), key = canonicalKey(field);
  if (col === key) return true;
  if (field === 'project_name') return ['project', 'projectname'].includes(col) || plan.entity === 'projects' && col === 'name';
  if (field === 'action' && plan.entity === 'activities') return col === 'activity';
  if (field === 'entity_type' && plan.entity === 'activities') return ['entity', 'type'].includes(col);
  if (field === 'name' && plan.entity === 'projects') return col === 'projectname';
  if (field === 'title' && plan.entity === 'tasks') return col === 'tasktitle';
  if (field === 'subject' && plan.entity === 'activities') return col === 'activitysubject';
  if (field === 'user_name' && plan.entity === 'activities') return ['user', 'actor', 'performedbyname'].includes(col);
  if (field === 'assignee') return ['assignee', 'assigneename', 'assignedtoname', 'username'].includes(col);
  if (field === 'owner') return ['ownername', 'createdbyname'].includes(col);
  if (field === 'due_date') return col === 'duedate';
  if (field === 'task_count') return ['count', 'totaltasks', 'taskscount', 'assignedtaskscount', 'taskcount'].includes(col);
  if (field === 'completed_count') return ['completedtasks', 'completedtaskcount'].includes(col);
  if (field === 'pending_count') return ['pendingtasks', 'pendingtaskcount'].includes(col);
  return false;
}
function contractForColumn(column: string, plan: ResponsePlan) {
  return (plan.dataContract?.fields ?? []).find(field => contractMatches(column, field.key, plan));
}
function applyContractFilter(cols: string[], _row: DatabaseRow, plan: ResponsePlan): string[] {
  const fields = plan.dataContract?.fields ?? [];
  const raw = cols.filter(column => !INTERNAL.test(column) || fields.some(field => contractMatches(column, field.key, plan)));
  const seen = new Set<string>();
  const base = raw.filter(column => {
    const field = contractForColumn(column, plan);
    if (!field) return true;
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
  if (plan.requestedFields.includes('description') || !plan.requestedFields.length || !fields.length) return dedupe(base);
  const contractColumns = base.filter(column => contractForColumn(column, plan));
  if (!contractColumns.length) return dedupe(base);
  const matched = new Set<string>();
  return base.filter(column => {
    const field = contractForColumn(column, plan);
    if (!field) return false;
    if (matched.has(field.key)) return false;
    matched.add(field.key);
    return true;
  });
}
function visibleColumns(row:DatabaseRow,plan:ResponsePlan):string[]{ return applyContractFilter(Object.keys(row), row, plan); }
export function validateContractCoverage(rows: unknown[], plan: ResponsePlan): string[] {
  if (!rows.length || !plan.dataContract?.fields?.length) return [];
  const first = asRecord(rows[0]);
  if (plan.intent === 'count' && Object.keys(first).length === 1) return [];
  if (plan.entity === 'activities') return [];
  const keys = new Set(Object.keys(first));
  return plan.dataContract.fields.filter((field) => ![...keys].some((key) => contractMatches(key, field.key, plan))).map((field) => field.key);
}function emptyAnswer(q:string,p:ResponsePlan):string{const who=p.subject||q.match(/\bassigned\s+to\s+(.+?)(?:[?.!,]|$)/i)?.[1]?.trim();if(who&&p.entity==='tasks')return 'No tasks are currently assigned to '+who+'.';if(/\bactive\b/i.test(q)&&p.entity==='projects')return 'There are no active projects.';return 'No '+p.entity+' matched your request.';}
export function resolvePresentation(rows:unknown[],plan:ResponsePlan):import('./responsePlanner.js').PresentationMode{
  const rec=rows.map(asRecord);
  if(!rec.length) return 'summary';
  const cols=visibleColumns(rec[0]??{},plan);
  const pc = plan.presentationContract;
  if (pc?.explicit) return pc.mode;
  if (plan.intent==='aggregation'||plan.intent==='ranking'||plan.intent==='relationship_lookup') return 'table';
  if (rec.length===1&&cols.length===1) return 'summary';
  if (rec.length===1) return 'summary';
  if (cols.length>=2) {
    const types = new Set(cols.map((c,i)=>colType(c, rec[0]?.[c])));
    if (plan.intent==='aggregation'||plan.intent==='ranking'||plan.intent==='relationship_lookup') return 'table';
    if (types.size>=2 || cols.some(c=>/count|total|status|date|assignee|project_name|user_name/i.test(c))) return 'table';
    return 'table';
  }
  return 'list';
}
function renderTable(t: DatabaseTable): string {
  const head = '| ' + t.columns.join(' | ') + ' |';
  const align = '| ' + t.columns.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ') + ' |';
  const body = t.rows.slice(0, 20).map((r) => '| ' + r.map((v) => value(v)).join(' | ') + ' |');
  return [head, align, ...body].join('\n');
}
export function buildResultTable(rows:unknown[],plan?:ResponsePlan):DatabaseTable|undefined{
  if(!rows.length) return undefined;
  const rec=rows.map(asRecord);
  const p=plan??{requestedFields:[],entity:'',intent:'',filters:[],dataContract:{fields:[]},presentation:'table',presentationContract:{mode:'table',reason:'fallback',explicit:false},useTable:true} as ResponsePlan;
  const cols=visibleColumns(rec[0]??{},p);
  if(cols.length<2) return undefined;
  const metas = columnMetadata(rows, p);
  const seen=new Set<string>(); const outRows:unknown[][]=[];
  for (const r of rec) {
    const vals = cols.map(c=>r[c]??null);
    const sig = JSON.stringify(vals);
    if (seen.has(sig)) continue;
    seen.add(sig);
    outRows.push(vals);
  }
  return { columns: metas.map(m=>m.label), rows: outRows };
}
export function formatDatabaseAnswer(question:string,sql:string,rows:unknown[],plan?:ResponsePlan):string{
  const p=plan??{intent:'lookup',entity:'records',filters:[],requestedFields:[],dataContract:{fields:[]},presentation:'paragraph',presentationContract:{mode:'list',reason:'fallback',explicit:false},useTable:false} as ResponsePlan;
  if(!rows.length) return emptyAnswer(question,p);

  const mode = resolvePresentation(rows, p);
  const rec=rows.map(asRecord),cols=visibleColumns(rec[0]??{},p);
  const table = mode==='table' ? buildResultTable(rows, p) : undefined;
  const singleCol = cols.length===1;
  if(mode==='summary'||singleCol&&rec.length===1){
    if(/count/i.test(cols[0]??'')||/\bcount\s*\(/i.test(sql)||p.intent==='count'){const n=value(rec[0]![cols[0]!]);return 'There '+(Number(n)===1?'is ':'are ')+n+' '+p.entity+'.';}
    if(rec.length===1) return cols.map(c=>label(c)+': '+value(rec[0]![c])).join('; ')+'.';
  }
  if(mode==='table'&&table){ return renderTable(table); }
  return rec.slice(0,30).map(r=>{const main=cols.find(c=>/^(title|name|project_name)$/i.test(c))??cols[0]!;const rest=dedupe(cols.filter(c=>c!==main)).filter(c=>value(r[c])!==value(r[main]));return '- '+value(r[main])+(rest.length&&cols.length<2?' — '+rest.map(c=>value(r[c])).join(' · '):'');}).join('\n');}
