import './CoreHome.css';
import React from 'react';
import {
  Search, Bell, ChevronDown, Network,
  Check, Sparkles, ExternalLink, ArrowRight, X,
} from 'lucide-react';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

/* ─────────────────────────────────────────
   Types
───────────────────────────────────────── */
type AppLane = 'field' | 'service' | 'plant' | 'cards';
type EdgeKind = 0 | 1 | 2;
type DecisionCat = 'compliance' | 'equipment' | 'works' | 'people';
type ResolvedHow = 'done' | 'gone-perm';

interface TraceNode {
  id: string;
  label: string;
  app: AppLane;
  x: number;
  y: number;
  risk?: 'warn' | 'err';
  pill: string;
  hub?: boolean;
}

type TraceEdge = [string, string, EdgeKind];

interface TraceData {
  nodes: TraceNode[];
  edges: TraceEdge[];
}

interface Decision {
  id: string;
  cat: DecisionCat;
  urgency: string;
  hot: boolean;
  impact: string;
  impactLbl: string;
  decision: string;
  why: React.ReactNode;
  readout: React.ReactNode;
  trace: TraceData;
  done: string;
}

interface CMNode {
  id: string;
  label: string;
  app: AppLane;
  x: number;
  y: number;
  hub?: boolean;
  risk?: 'warn' | 'err';
  detail: string;
}

interface CMDecision {
  id: string;
  cat: DecisionCat;
  label: string;
  nodes: string[];
  readout: React.ReactNode;
}

/* ─────────────────────────────────────────
   Static data — the four EQ decisions
───────────────────────────────────────── */
const DECISIONS: Decision[] = [
  {
    id: 'licence',
    cat: 'compliance',
    urgency: 'In 3 days',
    hot: true,
    impact: '3 days',
    impactLbl: 'until licence lapses',
    decision: 'Arrange cover for Joel at Site 4112 from Wednesday',
    why: (
      <>
        Joel's <b>A-grade licence expires Wed 3 Jun</b>, and he's the only ticketed electrician
        rostered on next week's scheduled works (WO-2240) at Site 4112 — a site that still has
        an <b>open high-priority defect</b>.
      </>
    ),
    readout: (
      <>
        Joel's licence in <i>Field</i> lapses while he's the <b>sole ticketed cover</b> on
        scheduled works in <i>Service</i> — at a site whose SLD-04 defect is still open. The
        roster gap and the compliance gap are the same gap. <b>Pete</b> holds the same ticket
        and is free.
      </>
    ),
    trace: {
      nodes: [
        { id: 'joel',    label: 'Joel',    app: 'field',   x: 64,  y: 56,  risk: 'warn', pill: 'licence 3 Jun' },
        { id: 'WO-2240', label: 'WO-2240', app: 'service', x: 212, y: 40,  pill: 'needs ticket' },
        { id: 'SLD-04',  label: 'SLD-04',  app: 'service', x: 212, y: 118, risk: 'err',  pill: 'open · high' },
        { id: 'pete',    label: 'Pete',    app: 'field',   x: 372, y: 78,  hub: true,   pill: 'ticketed · free' },
      ],
      edges: [
        ['joel',  'WO-2240', 1],
        ['joel',  'SLD-04',  0],
        ['pete',  'WO-2240', 2],
        ['pete',  'SLD-04',  2],
      ],
    },
    done: 'Pete assigned to cover Site 4112 from Wed — Joel flagged for licence renewal.',
  },
  {
    id: 'calibration',
    cat: 'equipment',
    urgency: 'Before Thu',
    hot: true,
    impact: 'Out of cal',
    impactLbl: "Thursday's RCD test",
    decision: 'Calibrate the insulation tester before Thursday’s RCD test',
    why: (
      <>
        The <b>insulation tester (IT-7)</b> is due for calibration <b>2 Jun</b>, and it's the
        instrument rostered for Thursday's RCD trip-time test (WO-2208) at Bondi. An
        out-of-calibration instrument makes the results <b>invalid</b>.
      </>
    ),
    readout: (
      <>
        The calibration date on <i>IT-7</i> in the <i>plant register</i> falls before the RCD
        test in <i>Service</i> that depends on it. Neither record flags the other — the equipment
        and the work order only line up here. Book calibration now, or swap to a unit that's in date.
      </>
    ),
    trace: {
      nodes: [
        { id: 'IT-7',    label: 'IT-7',    app: 'plant',   x: 70,  y: 56,  risk: 'warn', pill: 'cal due 2 Jun' },
        { id: 'WO-2208', label: 'WO-2208', app: 'service', x: 240, y: 56,  risk: 'warn', hub: true, pill: 'RCD test · Thu' },
        { id: 'bondi',   label: 'Bondi',   app: 'service', x: 240, y: 130, pill: 'DB-3' },
      ],
      edges: [
        ['IT-7',    'WO-2208', 1],
        ['WO-2208', 'bondi',   0],
      ],
    },
    done: 'IT-7 booked in for calibration 1 Jun — back in date before the Bondi test.',
  },
  {
    id: 'reassign',
    cat: 'works',
    urgency: 'Overdue',
    hot: true,
    impact: 'Overdue',
    impactLbl: 'compliance test',
    decision: 'Reassign the overdue RCD test at Bondi',
    why: (
      <>
        The quarterly RCD trip-time test <b>(WO-2208)</b> is past due and still sits with{' '}
        <b>Mia</b>, who Field has moved to Crew B at Eastlakes.
      </>
    ),
    readout: (
      <>
        The overdue test in <i>Service</i> is still assigned to <b>Mia</b>, whom <i>Field</i>{' '}
        moved to another crew and site. The work order never noticed its owner left.{' '}
        <b>Sam</b> on Crew C is on the tools and free — reassign to him.
      </>
    ),
    trace: {
      nodes: [
        { id: 'WO-2208', label: 'WO-2208', app: 'service', x: 70,  y: 56,  risk: 'warn', hub: true, pill: 'overdue' },
        { id: 'bondi',   label: 'Bondi',   app: 'service', x: 70,  y: 130, pill: 'DB-3' },
        { id: 'mia',     label: 'Mia',     app: 'field',   x: 240, y: 56,  pill: 'now Crew B' },
        { id: 'sam',     label: 'Sam',     app: 'field',   x: 240, y: 130, pill: 'Crew C · free' },
      ],
      edges: [
        ['WO-2208', 'bondi',   0],
        ['WO-2208', 'mia',     0],
        ['sam',     'WO-2208', 2],
      ],
    },
    done: 'WO-2208 reassigned to Sam (Crew C) — scheduled for Thu 25 Jun.',
  },
  {
    id: 'induction',
    cat: 'people',
    urgency: 'Before Monday',
    hot: false,
    impact: 'Mon',
    impactLbl: 'site access blocked',
    decision: 'Complete Liam’s induction before he starts Monday',
    why: (
      <>
        Liam Doyle starts Monday and is already rostered to Site 4112, but his{' '}
        <b>site induction from onboarding is still pending</b> — without it he can't be
        granted site access.
      </>
    ),
    readout: (
      <>
        The roster in <i>Field</i> has Liam on site Monday; his onboarding record in{' '}
        <i>Cards</i> shows induction <b>not yet complete</b>. The roster assumes he's ready;
        onboarding knows he isn't. Clear the induction and access follows automatically.
      </>
    ),
    trace: {
      nodes: [
        { id: 'liam',   label: 'Liam',      app: 'cards',   x: 70,  y: 56,  risk: 'warn', pill: 'induction pending' },
        { id: 's4112',  label: 'Site 4112', app: 'field',   x: 240, y: 56,  hub: true,   pill: 'rostered Mon' },
        { id: 'access', label: 'Access',    app: 'service', x: 240, y: 130, risk: 'warn', pill: 'blocked' },
      ],
      edges: [
        ['liam',  's4112',  1],
        ['s4112', 'access', 0],
      ],
    },
    done: "Liam's induction completed — site access granted for Monday.",
  },
];

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all',         label: 'All decisions' },
  { id: 'compliance',  label: 'Compliance' },
  { id: 'equipment',   label: 'Equipment' },
  { id: 'people',      label: 'People' },
  { id: 'works',       label: 'Works' },
];

const CAT_LABELS: Record<string, string> = {
  compliance: 'Compliance',
  equipment:  'Equipment',
  people:     'People',
  works:      'Works',
};

const LANES: Array<{ app: AppLane; label: string }> = [
  { app: 'field',   label: 'Field' },
  { app: 'service', label: 'Service' },
  { app: 'plant',   label: 'Equipment' },
  { app: 'cards',   label: 'Cards' },
];

/* ─────────────────────────────────────────
   Canonical map data
───────────────────────────────────────── */
const CM_NODES: CMNode[] = [
  { id: 'daniel',   label: 'Daniel',   app: 'field',   x: 130, y: 80,  detail: 'Daniel Marek · Operations Manager' },
  { id: 'joel',     label: 'Joel',     app: 'field',   x: 130, y: 196, risk: 'warn', detail: 'Joel Thompson · Electrician · A-grade licence expires Wed 3 Jun' },
  { id: 'pete',     label: 'Pete',     app: 'field',   x: 130, y: 308, detail: 'Pete Andrews · Lead electrician · same ticket, free to cover' },
  { id: 'mia',      label: 'Mia',      app: 'field',   x: 130, y: 420, detail: 'Mia Reyes · Supervisor · moved to Crew B at Eastlakes' },
  { id: 'sam',      label: 'Sam',      app: 'field',   x: 130, y: 524, detail: 'Sam Kowalski · Technician · Crew C, on the tools' },
  { id: 's4112',    label: 'Site 4112',app: 'service', x: 430, y: 150, hub: true,   detail: 'Site 4112 · 14 Kent St · commercial — live job' },
  { id: 'bondi',    label: 'Bondi',    app: 'service', x: 430, y: 340, detail: 'Bondi Junction · retail fit-out, Oxford St' },
  { id: 'eastlakes',label: 'Eastlakes',app: 'service', x: 430, y: 506, detail: 'Eastlakes Hospital · maintenance' },
  { id: 'SLD-04',   label: 'SLD-04',   app: 'service', x: 660, y: 92,  risk: 'err', detail: 'SLD-04 · main switchboard Phase B trip · open, high priority' },
  { id: 'WO-2231',  label: 'WO-2231',  app: 'service', x: 660, y: 196, detail: 'WO-2231 · rectify SLD-04 · in progress (3 of 5)' },
  { id: 'WO-2240',  label: 'WO-2240',  app: 'service', x: 660, y: 300, detail: 'WO-2240 · scheduled maintenance, Site 4112 · needs an A-grade ticket' },
  { id: 'WO-2208',  label: 'WO-2208',  app: 'service', x: 660, y: 430, hub: true, risk: 'warn', detail: 'WO-2208 · quarterly RCD trip-time test, Bondi · overdue' },
  { id: 'EWP-2',    label: 'EWP-2',    app: 'plant',   x: 880, y: 196, detail: 'EWP-2 · scissor lift · on Site 4112 · service due 18 Jun' },
  { id: 'IT-7',     label: 'IT-7',     app: 'plant',   x: 880, y: 424, risk: 'warn', detail: 'IT-7 · insulation tester · calibration due 2 Jun' },
  { id: 'GEN-1',    label: 'GEN-1',    app: 'plant',   x: 880, y: 540, detail: 'GEN-1 · 5.5 kVA generator · at Bondi' },
  { id: 'liam',     label: 'Liam',     app: 'cards',   x: 930, y: 74,  risk: 'warn', detail: 'Liam Doyle · apprentice · onboarding via Cards · induction pending, starts Mon' },
];

type CMEdge = [string, string, EdgeKind];

const CM_EDGES: CMEdge[] = [
  ['SLD-04',  'WO-2231', 0], ['WO-2231', 's4112',  0], ['WO-2240', 's4112',  0],
  ['WO-2208', 'bondi',   0], ['SLD-04',  's4112',  0],
  ['daniel',  'joel',    0], ['joel',    'pete',   0],
  ['joel',    'WO-2240', 1], ['IT-7',    'WO-2208',1], ['liam',   's4112',  1],
  ['EWP-2',   's4112',   1], ['GEN-1',   'bondi',  1], ['mia',    'WO-2208',1],
  ['pete',    'WO-2240', 2], ['sam',     'WO-2208',2],
];

const CM_DECISIONS: CMDecision[] = [
  {
    id: 'licence', cat: 'compliance', label: 'Joel’s licence',
    nodes: ['joel', 'WO-2240', 'SLD-04', 'pete'],
    readout: <>Joel's licence in <i>Field</i> lapses while he's the only ticketed cover on <i>WO-2240</i> in Service — <b>Pete</b> holds the same ticket and is free.</>,
  },
  {
    id: 'calibration', cat: 'equipment', label: 'Tester calibration',
    nodes: ['IT-7', 'WO-2208', 'bondi'],
    readout: <><i>IT-7</i>'s calibration in the plant register lapses before the RCD test in <i>Service</i> that depends on it — book it in, or swap to a unit in date.</>,
  },
  {
    id: 'reassign', cat: 'works', label: 'Reassign RCD test',
    nodes: ['WO-2208', 'bondi', 'mia', 'sam'],
    readout: <><i>WO-2208</i> is overdue and still owned by <b>Mia</b>, whom <i>Field</i> moved to another crew — reassign to <b>Sam</b> on Crew C.</>,
  },
  {
    id: 'induction', cat: 'people', label: 'Liam’s induction',
    nodes: ['liam', 's4112'],
    readout: <>The roster in <i>Field</i> has Liam on site Monday; his onboarding in <i>Cards</i> shows induction not done — clear it and site access follows.</>,
  },
];

const CM_DEFAULT: React.ReactNode = (
  <>Every record EQ owns, and the joins between them. The <b>lit, flowing links</b> are cross-app joins — the connections no single app sees on its own. Hover a record, or a decision below.</>
);

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function formatDate(): { date: string; time: string } {
  const now = new Date();
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    date: `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`,
    time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
  };
}

const SIDEBAR_RECORDS = defaultSidebarRecords();

/* Custom icon — trace glyph (3 nodes + connecting paths) */
function TraceIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <circle cx="5.5" cy="5.5" r="2.5" />
      <circle cx="18.5" cy="9"   r="2.5" />
      <circle cx="9"    cy="18"  r="2.5" />
      <line x1="7.6"  y1="7.1"  x2="16.2" y2="8.4" />
      <line x1="7.2"  y1="8.2"  x2="9.6"  y2="15.7" />
    </svg>
  );
}

/* ─────────────────────────────────────────
   Trace graph (dark bounded mini-graph)
───────────────────────────────────────── */
function TraceGraph({ trace }: { trace: TraceData }) {
  const [hover, setHover] = React.useState<string | null>(null);

  const pos = React.useMemo(
    () => new Map(trace.nodes.map((n) => [n.id, n])),
    [trace],
  );

  return (
    <div className="tr-canvas">
      <svg className="tr-svg" viewBox="0 0 440 160" preserveAspectRatio="xMidYMid meet">
        {/* edges first */}
        {trace.edges.map(([a, b, kind], i) => {
          const pa = pos.get(a)!;
          const pb = pos.get(b)!;
          const lit = hover !== null && (hover === a || hover === b);
          const cls = [
            'tr-edge',
            kind === 1 ? 'spine' : kind === 2 ? 'proposed' : '',
            lit ? 'lit' : '',
          ].filter(Boolean).join(' ');
          return <line key={`e${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={cls} />;
        })}
        {/* animated flow on cross-app joins (kind 1) */}
        {trace.edges.filter(([,, k]) => k === 1).map(([a, b], i) => {
          const pa = pos.get(a)!;
          const pb = pos.get(b)!;
          return <line key={`f${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="tr-flow" />;
        })}
        {/* nodes */}
        {trace.nodes.map((n) => (
          <g
            key={n.id}
            className={['tr-node', n.hub ? 'hub' : ''].filter(Boolean).join(' ')}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
          >
            {n.risk && (
              <>
                <circle className={`tr-ring r1 ${n.risk}`} cx={n.x} cy={n.y} r={n.hub ? 11 : 9} />
                <circle className={`tr-ring r2 ${n.risk}`} cx={n.x} cy={n.y} r={n.hub ? 11 : 9} />
              </>
            )}
            <circle className={`tr-dot nd-${n.app}`} cx={n.x} cy={n.y} r={n.hub ? 11 : 9} />
            <text className="tr-lbl"      x={n.x} y={n.y - (n.hub ? 17 : 15)}>{n.label}</text>
            <text className="tr-pill-txt" x={n.x} y={n.y + (n.hub ? 24 : 21)}>{n.pill}</text>
          </g>
        ))}
      </svg>
      <div className="tr-legend">
        {LANES.filter((l) => trace.nodes.some((n) => n.app === l.app)).map((l) => (
          <span className="tr-leg" key={l.app}>
            <span className={`d ${l.app}`} />{l.label}
          </span>
        ))}
        <span className="tr-leg flow">
          <span className="dash" />the join no app sees alone
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Decision card
───────────────────────────────────────── */
type CardState = 'open' | 'going' | 'done' | 'gone-perm';

function DecisionCard({ d, onResolve }: { d: Decision; onResolve: (id: string, how: ResolvedHow) => void }) {
  const [state, setState] = React.useState<CardState>('open');
  const [traceOpen, setTraceOpen] = React.useState(false);

  if (state === 'done') {
    return (
      <div className="dq-done">
        <span className="dq-done-mark"><Check /></span>
        <span className="dq-done-txt">{d.done}</span>
      </div>
    );
  }

  const act = (how: ResolvedHow) => {
    setState('going');
    setTimeout(() => {
      setState(how);
      onResolve(d.id, how);
    }, 430);
  };

  return (
    <div className={['dq-card', state === 'going' ? 'gone' : ''].filter(Boolean).join(' ')}>
      <div className="dq-card-top">
        <div className="dq-card-left">
          <span className={`dq-chip ${d.cat}`}>
            <span className="dq-chip-dot" />{CAT_LABELS[d.cat]}
          </span>
          <span className={`dq-urg${d.hot ? ' hot' : ''}`}>{d.urgency}</span>
        </div>
        <div className="dq-impact">
          <div className="dq-impact-v">{d.impact}</div>
          <div className="dq-impact-lbl">{d.impactLbl}</div>
        </div>
      </div>

      <h3 className="dq-decision">{d.decision}</h3>
      <p className="dq-why">{d.why}</p>

      <button
        className={`tr-toggle${traceOpen ? ' on' : ''}`}
        onClick={() => setTraceOpen((o) => !o)}
      >
        <TraceIcon size={14} />
        {traceOpen ? 'Hide the trace' : 'Trace it'}
        <span className="tr-chevron"><ChevronDown size={14} /></span>
      </button>

      {traceOpen && (
        <div className="tr-panel">
          <TraceGraph trace={d.trace} />
          <p className="tr-readout">{d.readout}</p>
        </div>
      )}

      <div className="dq-acts">
        <button className="dq-approve" onClick={() => act('done')}>
          <Check size={16} />Approve
        </button>
        <button className="dq-open-btn">
          <ExternalLink size={14} />Open record
        </button>
        <button className="dq-dismiss" onClick={() => act('gone-perm')}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Canonical map overlay
───────────────────────────────────────── */
interface HighlightState {
  nodes: Set<string>;
  text: React.ReactNode;
}

function CanonMap({ onClose }: { onClose: () => void }) {
  const [hi, setHi] = React.useState<HighlightState | null>(null);

  const pos = React.useMemo(
    () => new Map(CM_NODES.map((n) => [n.id, n])),
    [],
  );

  const nodeHover = (n: CMNode) => {
    const nb = new Set<string>([n.id]);
    CM_EDGES.forEach(([a, b]) => {
      if (a === n.id) nb.add(b);
      if (b === n.id) nb.add(a);
    });
    setHi({ nodes: nb, text: <span className="cm-detail">{n.detail}</span> });
  };

  const decHover = (d: CMDecision) => setHi({ nodes: new Set(d.nodes), text: d.readout });
  const clear = () => setHi(null);

  const active = hi?.nodes ?? null;
  const isDim    = (id: string) => active !== null && !active.has(id);
  const edgeLit  = (a: string, b: string) => active !== null && active.has(a) && active.has(b);

  return (
    <div className="cm-overlay" onMouseLeave={clear}>
      {/* Header */}
      <div className="cm-top">
        <div>
          <div className="cm-eyebrow"><Sparkles size={14} />EQ · The canonical layer</div>
          <h3 className="cm-title">Every record, and the joins between them</h3>
        </div>
        <div className="cm-top-r">
          <span className="cm-legend">
            {(['field','service','plant','cards'] as AppLane[]).map((app) => (
              <span className="cm-leg" key={app}>
                <span className={`d ${app}`} />
                {app === 'plant' ? 'Equipment' : app.charAt(0).toUpperCase() + app.slice(1)}
              </span>
            ))}
          </span>
          <span className="cm-live"><span className="livedot" />Live</span>
          <button className="cm-close" onClick={onClose} title="Back to decisions">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Graph stage */}
      <div className="cm-stage">
        <svg className="cm-svg" viewBox="0 0 1040 600" preserveAspectRatio="xMidYMid meet">
          {/* band guides */}
          <line className="cm-band" x1="290" y1="20" x2="290" y2="580" />
          <line className="cm-band" x1="775" y1="20" x2="775" y2="580" />

          {/* edges */}
          {CM_EDGES.map(([a, b, kind], i) => {
            const pa = pos.get(a)!;
            const pb = pos.get(b)!;
            const lit = edgeLit(a, b);
            const dim = active !== null && !lit;
            const cls = [
              'cm-edge',
              kind === 1 ? 'cross' : kind === 2 ? 'proposed' : '',
              lit ? 'lit' : '',
              dim ? 'dim' : '',
            ].filter(Boolean).join(' ');
            return <line key={`e${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={cls} />;
          })}
          {/* flow animation on cross-app edges */}
          {CM_EDGES.filter(([,, k]) => k === 1).map(([a, b], i) => {
            const pa = pos.get(a)!;
            const pb = pos.get(b)!;
            const dim = active !== null && !edgeLit(a, b);
            return (
              <line key={`f${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                    className={`cm-flow${dim ? ' dim' : ''}`} />
            );
          })}
          {/* nodes */}
          {CM_NODES.map((n) => (
            <g
              key={n.id}
              className={['cm-node', n.hub ? 'hub' : '', isDim(n.id) ? 'dim' : ''].filter(Boolean).join(' ')}
              onMouseEnter={() => nodeHover(n)}
            >
              {n.risk && (
                <>
                  <circle className={`cm-ring r1 ${n.risk}`} cx={n.x} cy={n.y} r={n.hub ? 13 : 11} />
                  <circle className={`cm-ring r2 ${n.risk}`} cx={n.x} cy={n.y} r={n.hub ? 13 : 11} />
                </>
              )}
              <circle className={`cm-dot nd-${n.app}`} cx={n.x} cy={n.y} r={n.hub ? 13 : 11} />
              <text className="cm-lbl" x={n.x} y={n.y - (n.hub ? 22 : 19)}>{n.label}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Footer */}
      <div className="cm-foot">
        <p className="cm-caption">{hi ? hi.text : CM_DEFAULT}</p>
        <div className="cm-decks">
          <span className="cm-decks-lbl">Today’s decisions</span>
          {CM_DECISIONS.map((d) => (
            <button key={d.id} className={`cm-deck ${d.cat}`}
                    onMouseEnter={() => decHover(d)} onFocus={() => decHover(d)}>
              <span className="d" />{d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   CoreHome — main export
───────────────────────────────────────── */
export default function CoreHome() {
  const { session } = useSession();

  const [filter,   setFilter]   = React.useState<string>('all');
  const [resolved, setResolved] = React.useState<Record<string, ResolvedHow>>({});
  const [showMap,  setShowMap]  = React.useState(false);
  const [dateInfo] = React.useState(formatDate);

  React.useEffect(() => {
    if (!showMap) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMap(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMap]);

  const onResolve = React.useCallback((id: string, how: ResolvedHow) => {
    setResolved((prev) => ({ ...prev, [id]: how }));
  }, []);

  const counts = React.useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = { all: 0 };
    DECISIONS.forEach((d) => {
      if (!resolved[d.id]) {
        c.all = (c.all ?? 0) + 1;
        c[d.cat] = (c[d.cat] ?? 0) + 1;
      } else {
        if (c[d.cat] === undefined) c[d.cat] = 0;
      }
    });
    FILTERS.forEach((f) => { if (c[f.id] === undefined) c[f.id] = 0; });
    return c;
  }, [resolved]);

  const clearedToday = 2 + Object.keys(resolved).length;
  const hotOpen = DECISIONS.filter((d) => d.hot && !resolved[d.id]).length;

  const visible = DECISIONS.filter(
    (d) => (filter === 'all' || d.cat === filter) && resolved[d.id] !== 'gone-perm',
  );
  const allClear = counts.all === 0;

  const firstName  = session?.user?.name?.split(' ')[0] || 'there';
  const tenantName = session?.tenant?.name ?? 'EQ';

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      {/*
        .eq-home provides the CSS token bridge + selector scope for every
        .dq-* / .tr-* / .cm-* rule in CoreHome.css.
        Inline style overrides the full-page layout properties from the
        original standalone version (height: 100vh → 100%, display: flex
        row → column so topbar + main stack vertically).
        CanonMap uses position:fixed + inset:0 and must be inside this div
        so the .eq-home .cm-overlay CSS selector resolves.
      */}
      <div
        className="eq-home"
        style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Thin topbar with tenant name, date, and canonical layer trigger */}
        <header className="eq-home-top">
          <div className="eq-home-top-l">
            <button className="eq-home-tenant">
              <span className="eq-home-tenant-dot" />
              <span className="eq-home-tenant-name">{tenantName}</span>
              <ChevronDown size={14} />
            </button>
            <span className="eq-home-when">
              <b>{dateInfo.date}</b> · {dateInfo.time}
            </span>
          </div>
          <div className="eq-home-top-r">
            <button className="eq-home-canon-btn" onClick={() => setShowMap(true)}>
              <Network size={16} />Canonical layer
            </button>
            <button className="eq-home-icon-btn"><Search size={17} /></button>
            <button className="eq-home-icon-btn">
              <Bell size={17} />
              <span className="eq-home-notif-dot" />
            </button>
          </div>
        </header>

        {/* Decision queue */}
        <main className="eq-home-main">
          <div className="eq-home-content">

            <div className="dq-head">
              <span className="dq-eyebrow">
                <span className="dq-eyebrow-spark"><Sparkles size={14} /></span>
                EQ Intelligence · overnight
              </span>
              <h2 className="dq-greet">
                Good morning, {firstName} —{' '}
                <b>{counts.all} decision{counts.all === 1 ? '' : 's'} need you</b>
              </h2>
              <div className="dq-sub">
                <span><b>{counts.all}</b> open</span>
                <span className="dq-sub-sep">·</span>
                <span><b>{hotOpen}</b> to handle today</span>
                <span className="dq-sub-sep">·</span>
                <span>EQ cleared <b>2</b> routine items overnight — Pete's 5-year note and Mia's training reminder</span>
              </div>
            </div>

            <div className="dq-wrap">

              <div className="dq-rail">
                <div className="dq-rail-hd">Queue</div>

                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={`dq-fil${filter === f.id ? ' on' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    <span className="dq-fil-l">
                      <span className={`fdot ${f.id}`} />{f.label}
                    </span>
                    <span className="dq-fil-n">{counts[f.id] ?? 0}</span>
                  </button>
                ))}

                <div className="dq-rail-div" />

                <div className="dq-cleared">
                  <Check size={15} />
                  <span><b>{clearedToday}</b> cleared today</span>
                </div>

                <button className="dq-canon-cta" onClick={() => setShowMap(true)}>
                  <Network size={14} />
                  <span className="dq-canon-cta-lbl">See the canonical layer</span>
                  <ArrowRight size={13} />
                </button>

                <div className="dq-rail-foot">
                  <span className="dq-rail-live"><span className="livedot" />How this works</span>
                  <span>
                    Every decision is built live from the shared record.{' '}
                    <b>Trace it</b> on any card to see the exact handful of records
                    behind it — and the join no single app could make.
                  </span>
                </div>
              </div>

              <div className="dq-stack">
                {allClear ? (
                  <div className="dq-empty">
                    <span className="dq-empty-mark"><Check size={26} /></span>
                    <h4 className="dq-empty-h">You're clear.</h4>
                    <p className="dq-empty-p">
                      Every decision is handled. EQ keeps watching the shared record and will
                      surface the next one the moment it appears.
                    </p>
                  </div>
                ) : visible.length === 0 ? (
                  <div className="dq-empty">
                    <span className="dq-empty-mark"><Check size={26} /></span>
                    <h4 className="dq-empty-h">Nothing in {CAT_LABELS[filter] ?? filter}.</h4>
                    <p className="dq-empty-p">No open decisions in this category right now.</p>
                  </div>
                ) : (
                  visible.map((d) =>
                    resolved[d.id] === 'gone-perm' ? null : (
                      <DecisionCard key={d.id} d={d} onResolve={onResolve} />
                    ),
                  )
                )}
              </div>

            </div>
          </div>
        </main>

        {/* position:fixed + inset:0 — renders over entire viewport */}
        {showMap && <CanonMap onClose={() => setShowMap(false)} />}
      </div>
    </HubLayout>
  );
}
