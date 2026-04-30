// Shared constants
export const STAGES = [
  'Briefing',
  'Schematic Design',
  'Design Development',
  'Construction Docs',
  'Tender',
  'Construction',
  'Handover',
]

export const STAGE_COLORS = [
  '#8B7EC8',
  '#4A90D9',
  '#36B2A0',
  '#C8A96E',
  '#E07B52',
  '#D95A6A',
  '#4CAF7D',
]

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

export const PROJECT_STATUSES = ['Planning', 'Active', 'Paused', 'Completed', 'Cancelled']

export const TASK_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done']

export const PRIORITIES = ['Low', 'Medium', 'High']

export const DOC_TYPES = [
  'Drawing', 'Contract', 'Permit', 'Report', 'Specification',
  'Budget', 'Schedule', 'Correspondence', 'Other'
]

export const PROJECT_COLORS = [
  '#2A2722', '#4A90D9', '#36B2A0', '#8B7EC8',
  '#E07B52', '#D95A6A', '#4CAF7D', '#E0A840',
  '#5B8DB8', '#7B68EE',
]

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
