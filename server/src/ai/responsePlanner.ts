export type ResponsePresentation = 'list' | 'table' | 'paragraph' | 'grouped';
export type PresentationMode = 'summary' | 'list' | 'table';
export type QueryIntent = 'lookup' | 'list' | 'aggregation' | 'ranking' | 'comparison' | 'person_workload' | 'project_overview' | 'relationship_lookup' | 'recent_activity' | 'filtered_collection' | 'count' | 'person_lookup' | 'no_tasks_lookup';
export type FieldType = 'text' | 'number' | 'date' | 'status';
export interface DataField { key: string; label: string; type: FieldType; }
export interface PresentationContract { mode: PresentationMode; columns?: string[]; reason: string; explicit: boolean; }
export interface ResponsePlan {
  intent: QueryIntent | string; entity: string; subject?: string; filters: string[];
  personReference?: string; projectReference?: string;
  resolvedPersonId?: string; resolvedPersonName?: string;
  resolvedProjectId?: string; resolvedProjectName?: string;
  dataContract: { fields: DataField[] }; requestedFields: string[];
  presentation: ResponsePresentation; presentationContract: PresentationContract;
  useTable: boolean; limit?: number; nameFilter?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
}

const ENTITY_TERM = /\b(?:project\s+updates?|activities|activity|updates?|tasks?|assignments?|workload|documents?|files?|events?|meetings?|calendar|projects?|users?|people|members?|team|employees?|owners?|notifications?)\b/i;
const ENTITY_ALIASES: Record<string, string> = {
  activity: 'activities', activities: 'activities', update: 'activities', updates: 'activities',
  task: 'tasks', tasks: 'tasks', assignment: 'tasks', assignments: 'tasks', workload: 'tasks',
  document: 'documents', documents: 'documents', file: 'documents', files: 'documents',
  event: 'calendar events', events: 'calendar events', meeting: 'calendar events', meetings: 'calendar events', calendar: 'calendar events',
  project: 'projects', projects: 'projects', user: 'team members', users: 'team members', person: 'team members', people: 'team members',
  member: 'team members', members: 'team members', team: 'team members', employee: 'team members', employees: 'team members', owner: 'team members', owners: 'team members',
  notification: 'notifications', notifications: 'notifications',
};
function entityIn(text: string): string | undefined {
  const term = text.match(ENTITY_TERM)?.[0].toLowerCase();
  if (!term) return undefined;
  if (term.startsWith('project update')) return 'activities';
  return ENTITY_ALIASES[term];
}

function isBareEntity(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(ENTITY_ALIASES[normalized]) || normalized === 'project updates';
}

function referenceText(match: RegExpMatchArray | null): string | undefined {
  const value = match?.[1]?.trim().replace(/^(?:show|list|give me)\s+/i, '').replace(/^(?:the|a|an)\s+/i, '').replace(/[?.!,]+$/, '').replace(/\s+is$/i, '').trim();
  return value && !isBareEntity(value) ? value.replace(/\s+is$/i, '') : undefined;
}
function personReference(text: string, entity: string): string | undefined {
  if (entity === 'tasks') {
    const assigned = text.match(/\bassigned\s+to\s+(.+?)(?:[?.!,]|$)/i);
    const taskFor = text.match(/\btasks?\s+(?:for|of)\s+(.+?)(?:[?.!,]|$)/i);
    const working = text.match(/\bwhat\s+(?:is\s+)?(.+?)\s+working\s+on\b/i);
    const possessive = text.match(/\b([\w.'-]+(?:\s+[\w.'-]+){0,2})\s*['’]s\s+(?:tasks?|work|workload|assignments?)\b/i);
    return referenceText(assigned ?? taskFor ?? working ?? possessive);
  }
  if (entity === 'activities') {
    return referenceText(text.match(/\b([\w.'-]+(?:\s+[\w.'-]+){0,2})\s*['’]s\s+(?:activit(?:y|ies)|updates?)\b/i));
  }
  if (entity === 'team members') {
    return referenceText(text.match(/\b(?:user|member|person)\s+([\w.'-]+(?:\s+[\w.'-]+){0,2})\b/i));
  }
  return undefined;
}
function projectReference(text: string, entity: string): string | undefined {
  if (!['documents', 'tasks', 'team members', 'activities', 'projects'].includes(entity)) return undefined;
  const allowFor = entity === 'documents' || entity === 'team members';
  const relation = text.match(allowFor
    ? /\b(?:in|within|for|with)\s+(?:(?:the\s+)?project\s+)?(.+?)[?.!,]*$/i
    : /\b(?:in|within)\s+(?:(?:the\s+)?project\s+)?(.+?)[?.!,]*$|\bfor\s+(?:the\s+)?project\s+(.+?)[?.!,]*$/i);
  const explicit = text.match(/(?:^|\bthe\s+)([\w.'-]+(?:\s+[\w.'-]+){0,4})\s+project\s*[?.!,]*$/i);
  const match = relation ?? explicit;
  const raw = match?.[1] ?? match?.[2];
  const candidate = raw?.trim().replace(/\s+project$/i, '').replace(/^(?:the\s+)?project\s+/i, '').replace(/^(?:the|a|an)\s+/i, '').replace(/[?.!,]+$/, '').trim();
  if (!candidate || isBareEntity(candidate) || candidate.toLowerCase() === 'each') return undefined;
  // Fix 2: "in total" is an aggregate idiom, not a project reference. Only the
  // bare idiom is rejected — and only when the match contains no explicit
  // "project" word, so genuine references like "in the project Total" or
  // "the Total project" still resolve.
  if (candidate.toLowerCase() === 'total' && !/\bproject\b/i.test(match?.[0] ?? '')) return undefined;
  return candidate;
}

function field(key: string, label: string, type: FieldType = 'text'): DataField { return { key, label, type }; }
function baseField(entity: string): DataField {
  if (entity === 'tasks') return field('title', 'Task');
  if (entity === 'team members') return field('name', 'Name');
  if (entity === 'project members') return field('name', 'Member');
  if (entity === 'activities') return field('action', 'Activity');
  if (entity === 'calendar events') return field('title', 'Event');
  if (entity === 'documents') return field('name', 'Document');
  return field('name', 'Project');
}
function uniqueFields(fields: DataField[]): DataField[] {
  return fields.filter((item, index) => fields.findIndex((candidate) => candidate.key === item.key) === index);
}

export function planDatabaseResponse(question: string): ResponsePlan {
  const text = question.trim();
  let entity = entityIn(text) ?? (/\bworking\s+on\b/i.test(text) ? 'tasks' : 'workspace records');
  const person = personReference(text, entity);
  const project = projectReference(text, entity);
  if (project && entity === 'team members') entity = 'project members';

  const metricCount = /\b(?:task\s+count|count\s+of\s+tasks?|number\s+of\s+tasks?)\b/i.test(text);
  const count = metricCount || /\b(?:count|number|how many|average|sum)\b/i.test(text);
  const grouped = /\b(?:each|every|per|for each|by|group(?:ed)? by)\b/i.test(text);
  const ranking = /\b(?:top\s+\d+|most|fewest|least|highest|lowest|rank(?:ing)?)\b/i.test(text);
  const recency = /\b(?:latest|recent|last)\b/i.test(text);
  const limitValue = text.match(/\btop\s+(\d+)\b/i)?.[1];
  const limit = limitValue ? Number(limitValue) : undefined;

  let sortField: string | undefined;
  if (/\bpriority\b/i.test(text)) sortField = 'priority';
  else if (metricCount || /\b(?:most|fewest|least)\s+tasks?\b/i.test(text)) sortField = 'task_count';
  else if (recency) sortField = 'created_at';
  const sort = sortField ? { field: sortField, direction: /\b(?:lowest|fewest|least)\b/i.test(text) ? 'asc' as const : 'desc' as const } : undefined;

  const aggregate = count && (grouped || entity === 'projects' && metricCount);
  const scalarCount = count && !grouped && !aggregate;
  const noTasks = /\b(?:without|no|missing)\s+tasks?\b|\b(?:has|have)\s+no\s+tasks?\b/i.test(text);
  if (grouped && count && /\bprojects?\b/i.test(text)) entity = 'projects';

  const fields: DataField[] = [];
  if (scalarCount) fields.push(field('count', 'Count', 'number'));
  else if (aggregate && entity === 'projects') {
    fields.push(field('project_name', 'Project'));
    if (/\bcompleted\b/i.test(text)) fields.push(field('completed_count', 'Completed', 'number'));
    if (/\bpending\b|\bopen\b/i.test(text)) fields.push(field('pending_count', 'Pending', 'number'));
    if (!/\bcompleted\b|\bpending\b|\bopen\b/i.test(text) || /\btasks?\s+count\b/i.test(text)) fields.push(field('task_count', 'Task Count', 'number'));
  } else if (entity !== 'workspace records') {
    fields.push(baseField(entity));
    if (entity === 'activities') {
      fields.push(field('user_name', 'User'), field('entity_type', 'Entity'), field('subject', 'Subject'), field('created_at', 'Date', 'date'));
      if (/\bprojects?\b/i.test(text)) fields.push(field('project_name', 'Project'));
    }
    if (entity === 'team members' && /\bdetails?\b|\binformation\b/i.test(text)) fields.push(field('role', 'Role'), field('department', 'Department'), field('status', 'Status', 'status'));
    if (sortField === 'priority') fields.push(field('priority', 'Priority'));
    if (/\bprojects?\b/i.test(text) && entity === 'tasks') fields.push(field('project_name', 'Project'));
    if (/\b(?:assignee|assigned to|working on|workload)\b/i.test(text) && entity === 'tasks') fields.push(field('status', 'Status', 'status'));
    if (/\bowner\b/i.test(text) && entity === 'projects') fields.push(field('owner', 'Owner'));
    if (/\bstatus\b/i.test(text) && entity === 'projects') fields.push(field('status', 'Status', 'status'));
    if (entity === 'project members' && /\brole\b/i.test(text)) fields.push(field('role', 'Role'));
    if (entity === 'tasks' && /\bassignee\b/i.test(text)) fields.push(field('assignee', 'Assignee'));
    if (entity === 'documents' && /\bfolder\b/i.test(text)) fields.push(field('folder', 'Folder'));
    if (sortField === 'task_count') fields.push(field('task_count', 'Task Count', 'number'));
  }

  const intent: QueryIntent = scalarCount ? 'count' : ranking ? 'ranking' : aggregate ? 'aggregation'
    : person && entity === 'tasks' ? 'person_workload' : noTasks ? 'no_tasks_lookup'
    : recency || entity === 'activities' ? 'recent_activity'
    : project || person ? 'relationship_lookup'
    : entity === 'tasks' || entity === 'projects' || entity === 'documents' || entity === 'team members' ? 'list'
    : 'lookup';
  if (/\bwho\b/i.test(text) && entity === 'tasks') fields.length = 0;
  const fieldsUnique = uniqueFields(fields);
  const requestedFields = fieldsUnique.map((item) => item.key);
  const explicitTable = /\b(?:table|tabular|columns|compare|comparison)\b/i.test(text);
  const multipleRequestedFields = fieldsUnique.length > 1 && /\b(?:with|and|project|assignee|owner|status|priority|role|department|date)\b/i.test(text);
  const explicitList = /^\s*list\b/i.test(text) && !explicitTable && !multipleRequestedFields;
  let mode: PresentationMode = 'list';
  let reason = 'entity result';
  if (scalarCount) { mode = 'summary'; reason = 'scalar count'; }
  else if (explicitTable || aggregate || ranking || project && entity === 'project members' || multipleRequestedFields) { mode = 'table'; reason = explicitTable ? 'explicit table request' : 'structured result'; }
  else if (explicitList) { mode = 'list'; reason = 'explicit list request'; }
  const presentation: ResponsePresentation = mode === 'summary' ? 'paragraph' : mode;
  const filters: string[] = [];
  const status = text.match(/\b(active|completed|planned|on hold|archived|todo|in progress|cancelled)\b/i)?.[1]?.toUpperCase();
  if (status && !aggregate) filters.push('status = ' + status.replace(' ', '_'));
  if (/\bpending\b|\bopen\s+work\b/i.test(text) && entity === 'tasks') filters.push("status IN ('TODO','IN_PROGRESS')");
  if (/\boverdue\b/i.test(text)) filters.push('due_date < current time and status != COMPLETED');
  if (recency) filters.push('ordered by created_at descending');
  if (person) filters.push((entity === 'activities' ? 'user_name = ' : entity === 'tasks' ? 'assigned_to = ' : 'user_id = ') + person);
  if (project) filters.push('project reference = ' + project);
  if (noTasks) filters.push('has no related tasks');
  if (aggregate) filters.push('group by project and count related tasks');

  return {
    intent, entity, ...(person ? { subject: person, personReference: person } : {}),
    ...(project ? { projectReference: project, nameFilter: project } : {}),
    filters, dataContract: { fields: fieldsUnique }, requestedFields,
    presentation, presentationContract: { mode, reason, explicit: explicitTable || explicitList },
    useTable: mode === 'table', ...(limit ? { limit } : {}), ...(sort ? { sort } : {}),
  };
}
