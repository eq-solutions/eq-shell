/**
 * Starter Maintenance Plan templates.
 *
 * Five generic, tenant-agnostic plans the SetupChecklist offers as a one-click
 * seed. Each plan has a unique starter `code` (prefixed `STARTER-`) so the
 * seed action can detect re-runs and skip plans the tenant already has.
 *
 * Lifecycle: once created, these plans are owned by the tenant and edited /
 * deleted / extended like any other plan. The starter is a head-start, not a
 * managed-by-the-platform fleet.
 *
 * Sourced from the most common SKS engagements (Equinix, Jemena) plus the
 * one-off thermographic + lighting jobs every electrical contractor does.
 * Frequencies match real cadences so techs can use them directly.
 *
 * UX audit PR #149 §A.4 / §3.3 — "Set up a maintenance plan" was the hardest
 * checklist step for new admins. Pre-seeding 5 sensible plans gets them
 * through the gate in one click; they tune from there.
 */

export interface StarterPlanItem {
  description: string
  sort_order: number
  is_required: boolean
  // Per-item frequency flags drive which items appear on which scheduled
  // check (e.g. an annual-only item on a biannual plan is skipped at the
  // semi_annual visit). Default no-flag = always-on.
  freq_annual?: boolean
  freq_semi_annual?: boolean
  freq_quarterly?: boolean
  freq_monthly?: boolean
}

export interface StarterPlan {
  code: string
  name: string
  type: string | null
  description: string
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'ad_hoc'
  items: StarterPlanItem[]
}

export const STARTER_JOB_PLANS: StarterPlan[] = [
  {
    code: 'STARTER-SWB-ANNUAL',
    name: 'Annual Switchboard PPM',
    type: 'Switchboard preventive maintenance',
    description:
      'Annual visit on a distribution / main switchboard. Visual inspection, thermographic check, terminations, functional test, sign-off.',
    frequency: 'annual',
    items: [
      { description: 'Visual inspection — enclosure, doors, labelling, IP rating', sort_order: 10, is_required: true },
      { description: 'Thermographic / IR survey — capture hotspots, log readings', sort_order: 20, is_required: true },
      { description: 'Torque check on all accessible terminations (record sample readings)', sort_order: 30, is_required: true },
      { description: 'Clean dust + debris from inside the panel', sort_order: 40, is_required: false },
      { description: 'Functional test — operate breakers, check indications', sort_order: 50, is_required: true },
      { description: 'Customer sign-off and site rep contact captured', sort_order: 60, is_required: true },
    ],
  },
  {
    code: 'STARTER-RCD-BIANNUAL',
    name: 'RCD Time-Trip Test',
    type: 'Residual current device testing per AS/NZS 3760',
    description:
      'Biannual RCD test cycle. Push-button test every 6 months; full time-trip + button test annually. Item-level frequency flags mean the semi-annual visit only renders push-button.',
    frequency: 'biannual',
    items: [
      // Annual-only — full time-trip + button. Doesn't render on semi visits.
      { description: 'RCD time-trip test — record X1 / X5 trip times on all circuits', sort_order: 10, is_required: true, freq_annual: true },
      // Both visits — push-button.
      { description: 'RCD push-button test on every device', sort_order: 20, is_required: true, freq_annual: true, freq_semi_annual: true },
      // Both visits — log + sign.
      { description: 'Log results against circuit register', sort_order: 30, is_required: true, freq_annual: true, freq_semi_annual: true },
      { description: 'Customer sign-off', sort_order: 40, is_required: true, freq_annual: true, freq_semi_annual: true },
    ],
  },
  {
    code: 'STARTER-GEN-BIANNUAL',
    name: 'Generator Run + Start Test',
    type: 'Standby generator preventive maintenance',
    description:
      'Six-monthly minor on a standby generator. Visual + fluids + battery + hoses + a brief no-load standby run. Annual visit adds a 15-minute under-load run.',
    frequency: 'biannual',
    items: [
      { description: 'Visual inspection — leaks, corrosion, mounts, exhaust', sort_order: 10, is_required: true, freq_annual: true, freq_semi_annual: true },
      { description: 'Coolant + oil + fuel level + filter condition', sort_order: 20, is_required: true, freq_annual: true, freq_semi_annual: true },
      { description: 'Battery: voltage, terminals, electrolyte (if applicable)', sort_order: 30, is_required: true, freq_annual: true, freq_semi_annual: true },
      { description: 'Hoses + belts inspection', sort_order: 40, is_required: true, freq_annual: true, freq_semi_annual: true },
      { description: 'Hour-meter reading + standby mode no-load run', sort_order: 50, is_required: true, freq_annual: true, freq_semi_annual: true },
      // Annual major-only.
      { description: '15-minute under-load run (annual major)', sort_order: 60, is_required: true, freq_annual: true },
      { description: 'Customer sign-off', sort_order: 70, is_required: true, freq_annual: true, freq_semi_annual: true },
    ],
  },
  {
    code: 'STARTER-LIGHTING-QUARTERLY',
    name: 'Lighting Walk',
    type: 'Building lighting inspection walk-through',
    description:
      'Quarterly walk of building lighting — record outages, emergency/exit fittings, capture defect notes for follow-up quotes.',
    frequency: 'quarterly',
    items: [
      { description: 'Walk every level — record lighting outages by location', sort_order: 10, is_required: true },
      { description: 'Test emergency + exit fittings (push-button where fitted)', sort_order: 20, is_required: true },
      { description: 'Defect notes captured — describe + photograph', sort_order: 30, is_required: false },
      { description: 'Technician sign-off', sort_order: 40, is_required: true },
    ],
  },
  {
    code: 'STARTER-THERMO-ANNUAL',
    name: 'Thermographic Survey',
    type: 'FLIR / IR thermal survey of board terminations',
    description:
      'Annual standalone IR survey across nominated boards. Captures hot-spot evidence for the customer report; defects flow into the action item register.',
    frequency: 'annual',
    items: [
      { description: 'FLIR / IR survey of all live boards listed in scope', sort_order: 10, is_required: true },
      { description: 'Hotspot register — capture board, location, ΔT', sort_order: 20, is_required: true },
      { description: 'Action items list — recommended remedials with priority', sort_order: 30, is_required: false },
      { description: 'Customer sign-off', sort_order: 40, is_required: true },
    ],
  },
]
