// Shared constants

// Every project now carries its own ordered stage list in
// projects.stages. This is only what a NEW project starts with, and
// the fallback for a row read before migration_v6 ran.
export const DEFAULT_STAGES = [
  'Briefing',
  'Schematic Design',
  'Design Development',
  'Construction Docs',
  'Tender',
  'Construction',
  'Handover',
]

/** The stage list to render for a project — never an empty array. */
export function projectStages(project) {
  return project?.stages?.length ? project.stages : DEFAULT_STAGES
}

export const STAGE_COLORS = [
  '#6B5CA5',
  '#0041C2',
  '#0E7C86',
  '#8A6D3B',
  '#B4531F',
  '#A32F3B',
  '#0F7B55',
]

// Suggestions, not a fixed set — the type field is free text, so a
// practice that does something we never listed can just type it.
export const PROJECT_TYPES = [
  'Residential',
  'Commercial',
  'Interior Design',
  'Renovation',
  'Urban Planning',
  'Landscape',
  'Industrial',
  'Educational',
  'Healthcare',
  'Mixed-Use',
]

export const DEFAULT_PROJECT_TYPE = PROJECT_TYPES[0]

/**
 * The list to offer in the type picker: the standard set plus any
 * custom types already in use, so one typed once is a click after that.
 */
export function projectTypeOptions(inUse = []) {
  return [...new Set([...PROJECT_TYPES, ...inUse.filter(Boolean)])]
}

export const PROJECT_STATUSES = ['Planning', 'Active', 'Paused', 'Completed', 'Cancelled']

export const TASK_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done']

export const PRIORITIES = ['Low', 'Medium', 'High']

export const DOC_TYPES = [
  'Drawing', 'Contract', 'Permit', 'Report', 'Specification',
  'Budget', 'Schedule', 'Correspondence', 'Other'
]

export const PROJECT_COLORS = [
  '#1A1A1A', '#0041C2', '#0E7C86', '#6B5CA5',
  '#B4531F', '#A32F3B', '#0F7B55', '#8A6D3B',
  '#2C6FD6', '#4B5563',
]

// ── Access control ──────────────────────────────────────────
// Mirrors supabase/migration_v3_self_signup.sql. The ranks here must
// stay in step with public.role_rank() — the database is the real
// enforcement, this is only so the UI hides what would fail anyway.
export const ACCESS_ROLES = [
  {
    value: 'admin', label: 'Principal Architect', short: 'Admin', rank: 100, color: '#C0281C',
    description: 'Full control, including who gets access.',
  },
  {
    value: 'manager', label: 'Project Lead', short: 'Manager', rank: 70, color: '#B4531F',
    description: 'Creates and edits projects, milestones, tasks and documents.',
  },
  {
    value: 'member', label: 'Architect', short: 'Member', rank: 40, color: '#0041C2',
    description: 'Edits tasks and documents, posts comments.',
  },
  {
    value: 'viewer', label: 'Viewer', short: 'Viewer', rank: 10, color: '#6B7280',
    description: 'Read-only access to everything.',
  },
]

export const ACCESS_STATUSES = {
  pending:   { label: 'Pending',   badge: 'badge-paused' },
  approved:  { label: 'Approved',  badge: 'badge-active' },
  suspended: { label: 'Suspended', badge: 'badge-cancelled' },
  rejected:  { label: 'Rejected',  badge: 'badge-cancelled' },
}

export function roleMeta(role) {
  return ACCESS_ROLES.find(r => r.value === role) || {
    value: role, label: 'No access', short: '—', rank: 0, color: '#9CA3AF',
    description: 'Awaiting approval.',
  }
}

export function roleRank(role) {
  return roleMeta(role).rank
}

// What each rung of the ladder may do. Checked with hasPermission().
export const ROLE_PERMISSIONS = {
  manage_access:    100,
  manage_team:      100,
  manage_settings:  100,
  moderate_comments: 100,
  manage_projects:   70,
  delete_projects:   70,
  manage_milestones: 70,
  manage_tasks:      40,
  manage_documents:  40,
  post_comments:     40,
  view_all:          10,
}

export function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export function getStatusColor(status) {
  const map = {
    'Active': 'badge-active',
    'Planning': 'badge-planning',
    'Paused': 'badge-paused',
    'Completed': 'badge-completed',
    'Cancelled': 'badge-cancelled',
  }
  return map[status] || 'badge-planning'
}
