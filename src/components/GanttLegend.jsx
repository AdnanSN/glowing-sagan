/**
 * What the marks on a timeline mean.
 *
 * The charts say a lot with a border: red for late, dashed for a task
 * missing one of its dates, an open end for a bar that runs past the
 * window on view. None of that is guessable, and a tooltip only helps
 * somebody who already suspects there is something to hover. So the
 * vocabulary is spelled out under the chart it belongs to.
 *
 * The two timelines do not draw quite the same things — stages and
 * milestones are the project chart's, the clipped and dateless bars are
 * the team chart's — so each gets only the keys it actually uses. A
 * legend entry for a mark that never appears is worse than none.
 */

const TASK_BAR = {
  key: 'bar',
  swatch: <span className="gantt-legend-bar"><span className="gantt-legend-bar-fill" /></span>,
}

const COMMON_TAIL = [
  {
    key: 'today',
    swatch: <span className="gantt-legend-today" />,
    label: 'Today',
  },
  {
    key: 'note',
    swatch: <span className="gantt-legend-note" />,
    label: 'Day has notes',
  },
]

const LATE = [
  {
    key: 'overdue',
    swatch: <span className="gantt-legend-bar overdue"><span className="gantt-legend-bar-fill" /></span>,
    label: 'Red border — past its due date',
  },
  {
    key: 'slip',
    swatch: <span className="gantt-legend-slip" />,
    label: 'Days late, counted to today',
  },
]

const DONE = {
  key: 'done',
  swatch: <span className="gantt-legend-bar done"><span className="gantt-legend-bar-fill" /></span>,
  label: 'Green — finished',
}

const ITEMS = {
  project: [
    { ...TASK_BAR, label: 'Task — stage colour, filled to % done' },
    ...LATE,
    DONE,
    {
      key: 'stage',
      swatch: <span className="gantt-legend-stage"><span className="gantt-legend-stage-fill" /></span>,
      label: 'Stage — its tasks rolled up',
    },
    {
      key: 'milestone',
      swatch: (
        <span className="gantt-legend-pair">
          <span className="gantt-legend-diamond" />
          <span className="gantt-legend-diamond done" />
        </span>
      ),
      label: 'Milestone — open, met',
    },
    ...COMMON_TAIL,
  ],
  team: [
    { ...TASK_BAR, label: 'Task — project colour, filled to % done' },
    ...LATE,
    DONE,
    {
      key: 'dateless',
      swatch: <span className="gantt-legend-bar dateless"><span className="gantt-legend-bar-fill" /></span>,
      label: 'Dashed — only one date set',
    },
    {
      key: 'clipped',
      swatch: <span className="gantt-legend-bar clip"><span className="gantt-legend-bar-fill" /></span>,
      label: 'Open end — runs past this window',
    },
    ...COMMON_TAIL,
  ],
}

export function GanttLegend({ variant = 'project' }) {
  const items = ITEMS[variant] || ITEMS.project
  return (
    <div className="gantt-legend">
      <span className="gantt-legend-title">Legend</span>
      {items.map(item => (
        <span key={item.key} className="gantt-legend-item">
          {item.swatch}
          <span className="gantt-legend-label">{item.label}</span>
        </span>
      ))}
    </div>
  )
}
