'use strict';

const express = require('express');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = new DatabaseSync(path.join(__dirname, 'registry.db'));
db.exec('PRAGMA journal_mode = WAL;');

// ─── SCHEMA ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT,
    category         TEXT,
    instructions     TEXT,
    input_schema     TEXT,
    output_schema    TEXT,
    owner_name       TEXT,
    owner_team       TEXT,
    owner_email      TEXT,
    policy_tags      TEXT DEFAULT '[]',
    version          TEXT DEFAULT '1.0.0',
    created_at       INTEGER,
    updated_at       INTEGER,
    last_reviewed_at INTEGER,
    approval_state   TEXT DEFAULT 'draft',
    used_by_agent_ids TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS tools (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    description       TEXT,
    endpoint_url      TEXT,
    auth_type         TEXT,
    owner_team        TEXT,
    policy_tags       TEXT DEFAULT '[]',
    version           TEXT DEFAULT '1.0.0',
    approval_state    TEXT DEFAULT 'draft',
    scope_permissions TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS agents (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    runtime        TEXT,
    owner_name     TEXT,
    owner_team     TEXT,
    skills_used    TEXT DEFAULT '[]',
    tools_used     TEXT DEFAULT '[]',
    policy_tags    TEXT DEFAULT '[]',
    approval_state TEXT DEFAULT 'draft',
    created_at     INTEGER,
    last_run_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT,
    skill_id     TEXT,
    started_at   INTEGER,
    completed_at INTEGER,
    status       TEXT,
    tokens_used  INTEGER,
    tools_called TEXT DEFAULT '[]'
  );
`);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parseJson(obj, fields) {
  const out = { ...obj };
  for (const f of fields) {
    try { out[f] = JSON.parse(out[f]); } catch { out[f] = []; }
  }
  return out;
}

const toIso = (ts) => (ts ? new Date(Math.floor(ts) * 1000).toISOString() : null);

function fmtSkill(s) {
  s = parseJson(s, ['policy_tags', 'used_by_agent_ids', 'input_schema', 'output_schema']);
  s.created_at      = toIso(s.created_at);
  s.updated_at      = toIso(s.updated_at);
  s.last_reviewed_at = toIso(s.last_reviewed_at);
  return s;
}

function fmtTool(t) {
  return parseJson(t, ['policy_tags', 'scope_permissions']);
}

function fmtAgent(a) {
  a = parseJson(a, ['skills_used', 'tools_used', 'policy_tags']);
  a.created_at  = toIso(a.created_at);
  a.last_run_at = toIso(a.last_run_at);
  return a;
}

function fmtRun(r) {
  r = parseJson(r, ['tools_called']);
  r.started_at   = toIso(r.started_at);
  r.completed_at = toIso(r.completed_at);
  return r;
}

// ─── SEED DATA ───────────────────────────────────────────────────────────────

const POLICY_TAGS = [
  { tag: 'contains-pii',    description: 'Processes or outputs personally identifiable information' },
  { tag: 'external-facing', description: 'Output may be shared outside the Group' },
  { tag: 'financial-data',  description: 'Involves financial records, pricing, or cost data' },
  { tag: 'internal-only',   description: 'For internal use only — not for suppliers or customers' },
  { tag: 'gdpr-sensitive',  description: 'Subject to GDPR data handling requirements' },
  { tag: 'safety-critical', description: 'Output may influence vehicle safety decisions' },
  { tag: 'supplier-data',   description: 'Contains or processes supplier confidential data' },
  { tag: 'regulatory',      description: 'Related to regulatory compliance obligations' },
];

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
  if (count > 0) return;

  const now = Math.floor(Date.now() / 1000);
  const ago = (days) => Math.floor(now - days * 86400);

  const skills = [
    {
      id: 'skill-001',
      name: 'Assess Supplier Risk',
      description: 'Evaluates a supplier across financial stability, geopolitical exposure, and delivery track record. Returns a risk score and recommended action.',
      category: 'procurement',
      instructions: `## Assess Supplier Risk

You are a procurement risk analyst for VehicleGroup. Given supplier data, evaluate risk across three dimensions:

1. **Financial Stability** — Flag: >90-day payment term changes, credit downgrades, delayed statutory filings, negative EBITDA trend.
2. **Geopolitical Exposure** — Flag suppliers domiciled in or with >30% revenue from conflict zones or countries subject to EU/US trade restrictions.
3. **Delivery Track Record** — Analyse OTD (on-time delivery) rate for the past 12 months. Flag if <92%.

Return a JSON object with \`risk_score\` (0–100, higher = riskier), \`risk_level\` (low / medium / high / critical), \`flags\` (array of specific issues), and \`recommended_action\`.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          supplier_id:       { type: 'string', description: 'Group supplier master ID' },
          include_financials: { type: 'boolean', description: 'Pull latest financials from Supplier DB' }
        },
        required: ['supplier_id']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          risk_score:         { type: 'number', minimum: 0, maximum: 100 },
          risk_level:         { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          flags:              { type: 'array', items: { type: 'string' } },
          recommended_action: { type: 'string' }
        }
      }),
      owner_name: 'Annika Johansson',
      owner_team: 'Global Procurement',
      owner_email: 'annika.johansson@atlas.com',
      policy_tags: JSON.stringify(['supplier-data', 'financial-data', 'internal-only']),
      version: '2.1.0',
      created_at: ago(120), updated_at: ago(14), last_reviewed_at: ago(14),
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-001', 'agent-003']),
    },
    {
      id: 'skill-002',
      name: 'Screen Supplier for Sanctions',
      description: 'Checks a supplier entity against EU, US OFAC, and UN sanctions lists. Returns match confidence and a blocking recommendation.',
      category: 'compliance',
      instructions: `## Sanctions Screening

Screen the supplier against:
- EU Consolidated Sanctions List
- US OFAC SDN & Consolidated Lists
- UN Security Council Consolidated List

Use fuzzy name matching (Jaro-Winkler). Score ≥85% → **BLOCK**. Score 60–84% → **REVIEW**. Score <60% → **CLEAR**.

Return results for all lists checked, with the highest-confidence match highlighted.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          entity_name:         { type: 'string' },
          country_code:        { type: 'string', description: 'ISO 3166-1 alpha-2' },
          registration_number: { type: 'string' }
        },
        required: ['entity_name']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          status:        { type: 'string', enum: ['clear', 'review', 'block'] },
          matches:       { type: 'array' },
          checked_lists: { type: 'array', items: { type: 'string' } }
        }
      }),
      owner_name: 'Lars Bergström',
      owner_team: 'Group Compliance',
      owner_email: 'lars.bergstrom@vehiclegroup.com',
      policy_tags: JSON.stringify(['regulatory', 'supplier-data', 'internal-only']),
      version: '1.3.0',
      created_at: ago(200), updated_at: ago(30), last_reviewed_at: ago(30),
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-001']),
    },
    {
      id: 'skill-003',
      name: 'Extract Specifications from RFQ Document',
      description: 'Parses a Request for Quotation PDF or Word document and extracts structured technical specifications, delivery requirements, and commercial terms.',
      category: 'procurement',
      instructions: `## RFQ Specification Extraction

You are a technical procurement analyst. Extract the following from the provided RFQ document:

1. **Technical Specs** — Material grades, tolerances, certifications required (ISO, IATF 16949, VDA 6.x)
2. **Delivery Terms** — Incoterms, lead times, call-off flexibility, packaging requirements
3. **Commercial Terms** — Payment terms, warranty period, liability caps, price escalation clauses
4. **Quality Requirements** — Required testing protocols, inspection criteria, PPAP level

Flag any ambiguous or missing requirements for human review.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          document_url:  { type: 'string', description: 'SharePoint URL to the RFQ document' },
          document_type: { type: 'string', enum: ['pdf', 'docx', 'email'] }
        },
        required: ['document_url']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          technical_specs:  { type: 'object' },
          delivery_terms:   { type: 'object' },
          commercial_terms: { type: 'object' },
          ambiguous_items:  { type: 'array', items: { type: 'string' } }
        }
      }),
      owner_name: 'Petra Heinemann',
      owner_team: 'Procurement Operations',
      owner_email: 'petra.heinemann@meridian.eu',
      policy_tags: JSON.stringify(['supplier-data', 'financial-data']),
      version: '1.0.0',
      created_at: ago(60), updated_at: ago(10), last_reviewed_at: null,
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-003']),
    },
    {
      id: 'skill-004',
      name: 'Summarise Warranty Claim Cluster',
      description: 'Groups and summarises a batch of warranty claims by fault type, component, and vehicle series. Identifies patterns for engineering escalation.',
      category: 'customer-ops',
      instructions: `## Warranty Claim Cluster Summarisation

Analyse the provided warranty claims and produce a structured summary:

1. **Cluster by fault code** — Group claims sharing the same primary DTC/fault code
2. **Component attribution** — Map to component families: engine, gearbox, axle, cab, electrical, ADAS
3. **Vehicle series breakdown** — Split by truck series (A-Series, B-Series, C-Series for Atlas; X-Series, S-Series, M-Series for Meridian)
4. **Trend detection** — Flag clusters where claim rate increased >20% vs prior 30-day period
5. **Escalation recommendation** — State whether engineering review is required and why

Output: executive summary paragraph + structured JSON breakdown.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          claim_ids:       { type: 'array', items: { type: 'string' } },
          date_range_days: { type: 'number', description: 'Lookback window for trend analysis' }
        },
        required: ['claim_ids']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          clusters:             { type: 'array' },
          total_claims:         { type: 'number' },
          escalation_required:  { type: 'boolean' },
          executive_summary:    { type: 'string' }
        }
      }),
      owner_name: 'Maria Santos',
      owner_team: 'Customer Quality',
      owner_email: 'maria.santos@atlas.com',
      policy_tags: JSON.stringify(['contains-pii', 'safety-critical', 'internal-only']),
      version: '1.2.0',
      created_at: ago(90), updated_at: ago(5), last_reviewed_at: ago(45),
      approval_state: 'review',
      used_by_agent_ids: JSON.stringify(['agent-002']),
    },
    {
      id: 'skill-005',
      name: 'Classify Customer Complaint Severity',
      description: 'Assigns a severity tier (P1–P4) to an inbound customer complaint based on safety risk, vehicle downtime, and customer contract status.',
      category: 'customer-ops',
      instructions: `## Complaint Severity Classification

**Severity Tiers:**
- **P1 (Critical):** Safety risk, accident involvement, or fleet-wide impact. SLA: 2 hours.
- **P2 (High):** Vehicle breakdown, >24 h downtime, key account. SLA: 4 hours.
- **P3 (Medium):** Performance degradation, scheduled service overdue. SLA: 24 hours.
- **P4 (Low):** Cosmetic issues, documentation queries. SLA: 72 hours.

Key escalation triggers: customer contract value >€500k, vehicle carrying perishable or hazardous cargo, reportable incident involvement.

Return the tier, rationale, and the recommended first-responder team.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          complaint_text: { type: 'string' },
          customer_id:    { type: 'string' },
          vehicle_vin:    { type: 'string' }
        },
        required: ['complaint_text', 'customer_id']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          severity_tier:       { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
          rationale:           { type: 'string' },
          assigned_team:       { type: 'string' },
          escalate_immediately: { type: 'boolean' }
        }
      }),
      owner_name: 'Maria Santos',
      owner_team: 'Customer Quality',
      owner_email: 'maria.santos@atlas.com',
      policy_tags: JSON.stringify(['contains-pii', 'safety-critical']),
      version: '2.0.0',
      created_at: ago(150), updated_at: ago(21), last_reviewed_at: ago(21),
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-002']),
    },
    {
      id: 'skill-006',
      name: 'Draft Recall Notice',
      description: 'Generates a draft recall notice for a specific fault condition, including regulatory language templates for EU and NHTSA markets.',
      category: 'quality',
      instructions: `## Recall Notice Drafting

Draft a vehicle recall notice complying with EU Regulation 2018/858 and, if applicable, NHTSA 49 CFR Part 573.

The notice must include:
1. **Technical fault description** — plain-language and technical explanation of the defect and safety risk
2. **Affected vehicles** — VIN ranges or production date windows
3. **Remedy description** — what the dealer will do and estimated repair time
4. **Owner instructions** — actions to take before the repair is performed
5. **Regulatory notification drafts** — KBA (Germany), DVSA (UK), RDW (Netherlands)

⚠️ **DRAFT ONLY.** All recall notices require sign-off from Legal and Product Safety before publication or regulatory filing.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          fault_code:         { type: 'string' },
          affected_vin_count: { type: 'number' },
          markets:            { type: 'array', items: { type: 'string' } },
          severity:           { type: 'string', enum: ['safety-defect', 'non-compliance', 'advisory'] }
        },
        required: ['fault_code', 'markets']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          draft_notice:        { type: 'string' },
          regulatory_filings:  { type: 'array' },
          customer_letter:     { type: 'string' },
          review_checklist:    { type: 'array', items: { type: 'string' } }
        }
      }),
      owner_name: 'Thomas Müller',
      owner_team: 'Product Safety & Quality',
      owner_email: 'thomas.muller@meridian.eu',
      policy_tags: JSON.stringify(['regulatory', 'external-facing', 'safety-critical']),
      version: '1.1.0',
      created_at: ago(45), updated_at: ago(3), last_reviewed_at: null,
      approval_state: 'review',
      used_by_agent_ids: JSON.stringify(['agent-004']),
    },
    {
      id: 'skill-007',
      name: 'Generate Quality Audit Report',
      description: 'Produces a structured quality audit report from inspection checklists and non-conformance records, formatted to IATF 16949 standards.',
      category: 'quality',
      instructions: `## Quality Audit Report Generation

Generate a supplier quality audit report compliant with IATF 16949:2016.

Sections:
1. **Audit Scope & Objectives**
2. **Non-Conformance Summary** — count by severity (Major / Minor / Observation)
3. **Root Cause Analysis** — for each Major NC, apply the 5-Why method
4. **Corrective Action Plan** — with responsible owner and due date per item
5. **KPI Dashboard** — First Pass Yield, PPM rate, OTD vs targets
6. **Audit Conclusion** — certification recommendation (Recommended / Conditional / Not Recommended)`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          audit_id:       { type: 'string' },
          supplier_id:    { type: 'string' },
          inspection_data: { type: 'object', description: 'Raw checklist results' }
        },
        required: ['audit_id']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          report_markdown:            { type: 'string' },
          nc_count:                   { type: 'object' },
          certification_recommendation: { type: 'string' },
          action_items:               { type: 'array' }
        }
      }),
      owner_name: 'Thomas Müller',
      owner_team: 'Product Safety & Quality',
      owner_email: 'thomas.muller@meridian.eu',
      policy_tags: JSON.stringify(['supplier-data', 'regulatory', 'internal-only']),
      version: '1.0.0',
      created_at: ago(80), updated_at: ago(25), last_reviewed_at: ago(25),
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-004']),
    },
    {
      id: 'skill-008',
      name: 'Validate Engineering BOM Against Specification',
      description: 'Compares a Bill of Materials against the approved design specification and flags component deviations or missing certification references.',
      category: 'engineering',
      instructions: `## BOM Validation Against Specification

Validate the provided BOM against the approved engineering specification.

Checks:
1. **Part number verification** — cross-reference each part number against the approved parts database
2. **Material compliance** — verify material grades meet specification (e.g. EN 10025, AMS 2750)
3. **REACH/RoHS compliance** — flag any restricted substances (SVHC list)
4. **Certification coverage** — confirm every safety-critical component has a valid certification reference
5. **Change detection** — highlight deviations from the previous BOM revision with delta summary

Output: PASS/FAIL per section plus a full deviation report.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          bom_id:          { type: 'string' },
          spec_version:    { type: 'string' },
          vehicle_project: { type: 'string' }
        },
        required: ['bom_id', 'spec_version']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          overall_status:   { type: 'string', enum: ['pass', 'fail', 'conditional'] },
          deviations:       { type: 'array' },
          compliance_flags: { type: 'array' },
          report:           { type: 'string' }
        }
      }),
      owner_name: 'Erik Lindqvist',
      owner_team: 'Vehicle Engineering',
      owner_email: 'erik.lindqvist@atlas.com',
      policy_tags: JSON.stringify(['internal-only', 'regulatory']),
      version: '1.0.0',
      created_at: ago(30), updated_at: ago(30), last_reviewed_at: null,
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify([]),
    },
    {
      id: 'skill-009',
      name: 'Summarise Test Drive Report',
      description: 'Converts raw test driver notes and telemetry data into a structured engineering assessment with pass/fail criteria against homologation targets.',
      category: 'engineering',
      instructions: `## Test Drive Report Summarisation

Process test driver notes and telemetry to produce an engineering assessment report.

Sections:
1. **Test Conditions** — route, payload, weather, driver, odometer start/end
2. **Performance Metrics** — fuel consumption (l/100 km), noise levels (dB @ 80 km/h), 0–80 km/h acceleration
3. **Driver Observations** — categorised by system: powertrain, chassis, cab comfort, ADAS
4. **Anomaly Detection** — flag telemetry readings outside ±5% of spec tolerance
5. **Pass/Fail Assessment** — against homologation test criteria per ECE-R51.03

⚠️ **Draft skill** — telemetry data handling procedure pending sign-off from Data Protection.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          test_session_id: { type: 'string' },
          telemetry_url:   { type: 'string', description: 'SharePoint URL to telemetry export' },
          driver_notes:    { type: 'string' }
        },
        required: ['test_session_id']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          summary:   { type: 'string' },
          metrics:   { type: 'object' },
          anomalies: { type: 'array' },
          pass_fail: { type: 'string', enum: ['pass', 'fail', 'conditional'] }
        }
      }),
      owner_name: 'Erik Lindqvist',
      owner_team: 'Vehicle Engineering',
      owner_email: 'erik.lindqvist@atlas.com',
      policy_tags: JSON.stringify(['internal-only']),
      version: '0.3.0',
      created_at: ago(15), updated_at: ago(2), last_reviewed_at: null,
      approval_state: 'draft',
      used_by_agent_ids: JSON.stringify([]),
    },
    {
      id: 'skill-010',
      name: 'Calculate CO2 Compliance Score',
      description: 'Calculates the fleet-average CO2 compliance position against EU HDV CO2 regulation targets for a given manufacturer and reporting period.',
      category: 'compliance',
      instructions: `## HDV CO2 Compliance Score Calculation

Calculate the manufacturer's CO2 compliance position under EU Regulation 2019/1242 (Heavy Duty Vehicles).

Inputs required:
- Fleet registration data by vehicle sub-group (Groups 4, 5, 9, 10, 16)
- Certified CO2 values from VECTO simulation tool
- Reference CO2 values per sub-group from the Regulation Annex I

Calculations:
1. **Specific emissions** per sub-group (mileage-weighted average)
2. **Specific emissions target** — applying the linear reduction trajectory (-15% by 2025, -30% by 2030)
3. **CO2 deviation** — actual vs target (%)
4. **Emission credits / debits** — cumulative balance from prior periods
5. **Penalty exposure** — projected excess emissions charge at €4,250/g CO2/km × number of registered vehicles

Output: compliance position and a regulatory filing template for the European Environment Agency.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          reporting_year:   { type: 'number' },
          manufacturer_id:  { type: 'string', description: 'OEM identifier as registered with EEA' },
          fleet_data_url:   { type: 'string' }
        },
        required: ['reporting_year', 'manufacturer_id']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          compliance_status:     { type: 'string', enum: ['compliant', 'at-risk', 'non-compliant'] },
          co2_deviation_pct:     { type: 'number' },
          penalty_exposure_eur:  { type: 'number' },
          filing_template:       { type: 'string' }
        }
      }),
      owner_name: 'Lars Bergström',
      owner_team: 'Group Compliance',
      owner_email: 'lars.bergstrom@vehiclegroup.com',
      policy_tags: JSON.stringify(['regulatory', 'financial-data', 'external-facing']),
      version: '1.4.0',
      created_at: ago(180), updated_at: ago(60), last_reviewed_at: ago(60),
      approval_state: 'approved',
      used_by_agent_ids: JSON.stringify(['agent-004']),
    },
    {
      id: 'skill-011',
      name: 'Generate Supplier Onboarding Checklist',
      description: 'Creates a tailored onboarding checklist for a new supplier based on their category, risk tier, and the components they will supply.',
      category: 'procurement',
      instructions: `## Supplier Onboarding Checklist Generation

Generate a tailored onboarding checklist based on the supplier profile.

**Base checklist (all suppliers):**
- [ ] Company registration documents (Certificate of Incorporation)
- [ ] Bank account verification
- [ ] Quality certification (IATF 16949 or equivalent)
- [ ] Signed Group Supplier Code of Conduct
- [ ] GDPR Data Processing Agreement

**Additional items by supply category:**
- Safety-critical components: PPAP Level 3, ISO 26262 functional safety evidence
- Software / Electronics: UN R155 cybersecurity assessment, SBOM disclosure
- Chemicals / Coatings: REACH declaration, Safety Data Sheets per GHS
- High-risk country sourcing: Enhanced due diligence pack, third-party audit

⚠️ **Draft** — Procurement Legal review pending. Do not send to suppliers yet.`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          supplier_name:       { type: 'string' },
          component_category:  { type: 'string' },
          risk_tier:           { type: 'string', enum: ['low', 'medium', 'high'] },
          supply_country:      { type: 'string', description: 'ISO 3166-1 alpha-2' }
        },
        required: ['supplier_name', 'component_category']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          checklist:                 { type: 'array', items: { type: 'string' } },
          estimated_completion_days: { type: 'number' },
          assigned_category:         { type: 'string' }
        }
      }),
      owner_name: 'Annika Johansson',
      owner_team: 'Global Procurement',
      owner_email: 'annika.johansson@atlas.com',
      policy_tags: JSON.stringify(['supplier-data', 'internal-only']),
      version: '0.9.0',
      created_at: ago(20), updated_at: ago(1), last_reviewed_at: null,
      approval_state: 'draft',
      used_by_agent_ids: JSON.stringify(['agent-003']),
    },
    {
      id: 'skill-012',
      name: 'Escalate Critical Complaint to Regional Manager',
      description: 'Drafts an escalation message to the relevant regional service manager for P1 complaints. Deprecated — replaced by the CRM-integrated escalation workflow.',
      category: 'customer-ops',
      instructions: `## DEPRECATED — DO NOT USE

This skill has been retired. Use the **CRM-Integrated Escalation Workflow** instead.
See Confluence: Customer Ops → Escalation Playbook → Section 4.

---

~~Draft an escalation message to the regional service manager including complaint summary, customer risk rating, and recommended SLA.~~`,
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          complaint_id: { type: 'string' },
          region:       { type: 'string' }
        },
        required: ['complaint_id', 'region']
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          message:   { type: 'string' },
          recipient: { type: 'string' }
        }
      }),
      owner_name: 'Maria Santos',
      owner_team: 'Customer Quality',
      owner_email: 'maria.santos@atlas.com',
      policy_tags: JSON.stringify(['contains-pii', 'internal-only']),
      version: '1.0.0',
      created_at: ago(300), updated_at: ago(60), last_reviewed_at: ago(60),
      approval_state: 'deprecated',
      used_by_agent_ids: JSON.stringify([]),
    },
  ];

  const tools = [
    {
      id: 'tool-001',
      name: 'Supplier Database',
      description: 'Read/write access to the Group global supplier master data system. Covers 14,000+ Tier 1 and 2 suppliers with financial, performance, and certification data.',
      endpoint_url: 'https://api.internal.vehiclegroup.com/supplier-db/v2',
      auth_type: 'oauth2',
      owner_team: 'Global Procurement IT',
      policy_tags: JSON.stringify(['supplier-data', 'financial-data', 'internal-only']),
      version: '2.4.1',
      approval_state: 'approved',
      scope_permissions: JSON.stringify(['read:suppliers', 'read:financials', 'write:supplier-notes']),
    },
    {
      id: 'tool-002',
      name: 'Teams Message Poster',
      description: 'Posts messages to Microsoft Teams channels or users via the Microsoft Graph API. Used for automated notifications and escalation alerts.',
      endpoint_url: 'https://graph.microsoft.com/v1.0/teams/{teamId}/channels/{channelId}/messages',
      auth_type: 'oauth2',
      owner_team: 'IT Workplace Services',
      policy_tags: JSON.stringify(['contains-pii', 'internal-only']),
      version: '1.1.0',
      approval_state: 'approved',
      scope_permissions: JSON.stringify(['ChannelMessage.Send', 'Chat.ReadWrite']),
    },
    {
      id: 'tool-003',
      name: 'SharePoint Document Reader',
      description: 'Retrieves and parses documents from Group SharePoint repositories. Supports PDF, Word, and Excel. Read-only access.',
      endpoint_url: 'https://graph.microsoft.com/v1.0/sites/{siteId}/drive/items/{itemId}/content',
      auth_type: 'oauth2',
      owner_team: 'IT Workplace Services',
      policy_tags: JSON.stringify(['internal-only']),
      version: '1.0.0',
      approval_state: 'approved',
      scope_permissions: JSON.stringify(['Sites.Read.All', 'Files.Read.All']),
    },
    {
      id: 'tool-004',
      name: 'CRM Customer Lookup',
      description: 'Queries the Salesforce CRM for customer account data, contract status, vehicle fleet details, and open case history.',
      endpoint_url: 'https://vehiclegroup.my.salesforce.com/services/data/v57.0/sobjects',
      auth_type: 'oauth2',
      owner_team: 'Sales & Customer Ops IT',
      policy_tags: JSON.stringify(['contains-pii', 'financial-data', 'internal-only']),
      version: '3.0.0',
      approval_state: 'approved',
      scope_permissions: JSON.stringify(['read:accounts', 'read:cases', 'read:contracts']),
    },
    {
      id: 'tool-005',
      name: 'Sanctions Check API',
      description: 'Integrates with Dow Jones Risk & Compliance to screen entities against global sanctions, PEP lists, and adverse media databases in real time.',
      endpoint_url: 'https://api.dowjones.com/compliance/v1/screen',
      auth_type: 'api-key',
      owner_team: 'Group Compliance',
      policy_tags: JSON.stringify(['regulatory', 'supplier-data', 'internal-only']),
      version: '1.2.0',
      approval_state: 'approved',
      scope_permissions: JSON.stringify(['screen:entities', 'read:watchlists']),
    },
  ];

  const agents = [
    {
      id: 'agent-001',
      name: 'Supplier Risk Monitor',
      description: 'Runs nightly across all Tier 1 suppliers. Screens for sanctions exposure, flags deteriorating financial health, and posts a summary digest to the Procurement Teams channel.',
      runtime: 'n8n',
      owner_name: 'Annika Johansson',
      owner_team: 'Global Procurement',
      skills_used: JSON.stringify(['skill-001', 'skill-002']),
      tools_used: JSON.stringify(['tool-001', 'tool-005']),
      policy_tags: JSON.stringify(['supplier-data', 'financial-data', 'internal-only']),
      approval_state: 'approved',
      created_at: ago(90),
      last_run_at: ago(0.5),
    },
    {
      id: 'agent-002',
      name: 'Warranty Intelligence Agent',
      description: 'Processes inbound warranty claims from Salesforce, clusters them by fault pattern, classifies severity, and routes P1/P2 cases to the correct regional service team via Teams.',
      runtime: 'copilot-studio',
      owner_name: 'Maria Santos',
      owner_team: 'Customer Quality',
      skills_used: JSON.stringify(['skill-004', 'skill-005']),
      tools_used: JSON.stringify(['tool-004', 'tool-003']),
      policy_tags: JSON.stringify(['contains-pii', 'safety-critical', 'internal-only']),
      approval_state: 'approved',
      created_at: ago(120),
      last_run_at: ago(0.1),
    },
    {
      id: 'agent-003',
      name: 'Procurement Assistant',
      description: 'Assists procurement managers with RFQ analysis, supplier risk checks, and onboarding preparation. Triggered via Teams chat or a SharePoint document upload event.',
      runtime: 'claude-code',
      owner_name: 'Petra Heinemann',
      owner_team: 'Procurement Operations',
      skills_used: JSON.stringify(['skill-003', 'skill-011', 'skill-001']),
      tools_used: JSON.stringify(['tool-001', 'tool-003', 'tool-002']),
      policy_tags: JSON.stringify(['supplier-data', 'financial-data', 'internal-only']),
      approval_state: 'review',
      created_at: ago(30),
      last_run_at: ago(1),
    },
    {
      id: 'agent-004',
      name: 'Quality & Compliance Agent',
      description: 'Supports Product Safety and Compliance teams with recall notice drafting, supplier audit reporting, and HDV CO2 compliance tracking. Runs on Power Automate, triggered by SharePoint document events.',
      runtime: 'power-automate',
      owner_name: 'Thomas Müller',
      owner_team: 'Product Safety & Quality',
      skills_used: JSON.stringify(['skill-006', 'skill-007', 'skill-010']),
      tools_used: JSON.stringify(['tool-003', 'tool-002']),
      policy_tags: JSON.stringify(['regulatory', 'safety-critical', 'external-facing']),
      approval_state: 'approved',
      created_at: ago(60),
      last_run_at: ago(2),
    },
  ];

  // 15 runs spread across the last 7 days
  const runs = [
    // agent-001: nightly batch — runs skill-001 then skill-002 each cycle
    { id: 'run-001', agent_id: 'agent-001', skill_id: 'skill-001', started_at: ago(0.5),        completed_at: ago(0.5) + 178,   status: 'success', tokens_used: 8420,  tools_called: JSON.stringify(['tool-001', 'tool-005']) },
    { id: 'run-002', agent_id: 'agent-001', skill_id: 'skill-002', started_at: ago(0.5) + 200,  completed_at: ago(0.5) + 318,   status: 'success', tokens_used: 3190,  tools_called: JSON.stringify(['tool-005']) },
    { id: 'run-003', agent_id: 'agent-001', skill_id: 'skill-001', started_at: ago(1.5),        completed_at: ago(1.5) + 195,   status: 'success', tokens_used: 7980,  tools_called: JSON.stringify(['tool-001', 'tool-005']) },
    { id: 'run-004', agent_id: 'agent-001', skill_id: 'skill-002', started_at: ago(2.5),        completed_at: ago(2.5) + 412,   status: 'error',   tokens_used: 1240,  tools_called: JSON.stringify(['tool-005']) },
    { id: 'run-005', agent_id: 'agent-001', skill_id: 'skill-001', started_at: ago(3.5),        completed_at: ago(3.5) + 203,   status: 'success', tokens_used: 8110,  tools_called: JSON.stringify(['tool-001', 'tool-005']) },
    // agent-002: on-demand, several times per day
    { id: 'run-006', agent_id: 'agent-002', skill_id: 'skill-005', started_at: ago(0.1),        completed_at: ago(0.1) + 43,    status: 'success', tokens_used: 2080,  tools_called: JSON.stringify(['tool-004']) },
    { id: 'run-007', agent_id: 'agent-002', skill_id: 'skill-004', started_at: ago(0.3),        completed_at: ago(0.3) + 317,   status: 'success', tokens_used: 12440, tools_called: JSON.stringify(['tool-004', 'tool-003']) },
    { id: 'run-008', agent_id: 'agent-002', skill_id: 'skill-005', started_at: ago(1),          completed_at: ago(1) + 39,      status: 'success', tokens_used: 1950,  tools_called: JSON.stringify(['tool-004']) },
    { id: 'run-009', agent_id: 'agent-002', skill_id: 'skill-004', started_at: ago(3),          completed_at: ago(3) + 295,     status: 'success', tokens_used: 11790, tools_called: JSON.stringify(['tool-004', 'tool-003']) },
    { id: 'run-010', agent_id: 'agent-002', skill_id: 'skill-005', started_at: ago(5),          completed_at: ago(5) + 57,      status: 'error',   tokens_used: 810,   tools_called: JSON.stringify(['tool-004']) },
    // agent-003: ad-hoc, triggered by procurement managers
    { id: 'run-011', agent_id: 'agent-003', skill_id: 'skill-003', started_at: ago(1),          completed_at: ago(1) + 284,     status: 'success', tokens_used: 9610,  tools_called: JSON.stringify(['tool-001', 'tool-003']) },
    { id: 'run-012', agent_id: 'agent-003', skill_id: 'skill-001', started_at: ago(1) + 400,    completed_at: ago(1) + 618,     status: 'success', tokens_used: 7230,  tools_called: JSON.stringify(['tool-001', 'tool-005']) },
    // agent-004: event-driven via SharePoint
    { id: 'run-013', agent_id: 'agent-004', skill_id: 'skill-007', started_at: ago(2),          completed_at: ago(2) + 476,     status: 'success', tokens_used: 14180, tools_called: JSON.stringify(['tool-003', 'tool-002']) },
    { id: 'run-014', agent_id: 'agent-004', skill_id: 'skill-010', started_at: ago(4),          completed_at: ago(4) + 391,     status: 'success', tokens_used: 6820,  tools_called: JSON.stringify(['tool-003']) },
    { id: 'run-015', agent_id: 'agent-004', skill_id: 'skill-006', started_at: ago(6),          completed_at: ago(6) + 524,     status: 'success', tokens_used: 18920, tools_called: JSON.stringify(['tool-003', 'tool-002']) },
  ];

  const insSkill = db.prepare(`
    INSERT INTO skills VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insTool = db.prepare(`
    INSERT INTO tools VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const insAgent = db.prepare(`
    INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insRun = db.prepare(`
    INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?)
  `);

  db.exec('BEGIN');
  try {
    for (const s of skills)
      insSkill.run(s.id, s.name, s.description, s.category, s.instructions,
        s.input_schema, s.output_schema, s.owner_name, s.owner_team, s.owner_email,
        s.policy_tags, s.version, s.created_at, s.updated_at, s.last_reviewed_at,
        s.approval_state, s.used_by_agent_ids);

    for (const t of tools)
      insTool.run(t.id, t.name, t.description, t.endpoint_url, t.auth_type,
        t.owner_team, t.policy_tags, t.version, t.approval_state, t.scope_permissions);

    for (const a of agents)
      insAgent.run(a.id, a.name, a.description, a.runtime, a.owner_name, a.owner_team,
        a.skills_used, a.tools_used, a.policy_tags, a.approval_state,
        a.created_at, a.last_run_at);

    for (const r of runs)
      insRun.run(r.id, r.agent_id, r.skill_id, r.started_at, r.completed_at,
        r.status, r.tokens_used, r.tools_called);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log('Seeded database with demo data.');
}

seedIfEmpty();

// ─── ROUTES ──────────────────────────────────────────────────────────────────

app.get('/api/policy-tags', (_req, res) => res.json(POLICY_TAGS));

// Skills
app.get('/api/skills', (req, res) => {
  const { category, approval, search } = req.query;
  let sql = 'SELECT * FROM skills WHERE 1=1';
  const p = [];
  if (category) { sql += ' AND category = ?';                          p.push(category); }
  if (approval)  { sql += ' AND approval_state = ?';                   p.push(approval); }
  if (search)    { sql += ' AND (name LIKE ? OR description LIKE ?)';  p.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY updated_at DESC';
  res.json(db.prepare(sql).all(...p).map(fmtSkill));
});

app.get('/api/skills/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(fmtSkill(row));
});

app.post('/api/skills', (req, res) => {
  const b = req.body;
  const id = `skill-${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO skills
      (id,name,description,category,instructions,input_schema,output_schema,
       owner_name,owner_team,owner_email,policy_tags,version,
       created_at,updated_at,last_reviewed_at,approval_state,used_by_agent_ids)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, b.name, b.description || null, b.category || null, b.instructions || null,
    JSON.stringify(b.input_schema  || {}),
    JSON.stringify(b.output_schema || {}),
    b.owner_name || null, b.owner_team || null, b.owner_email || null,
    JSON.stringify(b.policy_tags || []),
    b.version || '1.0.0',
    now, now, null, 'draft', '[]'
  );
  res.status(201).json(fmtSkill(db.prepare('SELECT * FROM skills WHERE id = ?').get(id)));
});

app.put('/api/skills/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM skills WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE skills SET
      name             = COALESCE(?, name),
      description      = COALESCE(?, description),
      category         = COALESCE(?, category),
      instructions     = COALESCE(?, instructions),
      input_schema     = COALESCE(?, input_schema),
      output_schema    = COALESCE(?, output_schema),
      owner_name       = COALESCE(?, owner_name),
      owner_team       = COALESCE(?, owner_team),
      owner_email      = COALESCE(?, owner_email),
      policy_tags      = COALESCE(?, policy_tags),
      version          = COALESCE(?, version),
      approval_state   = COALESCE(?, approval_state),
      updated_at       = ?
    WHERE id = ?
  `).run(
    b.name        ?? null,
    b.description ?? null,
    b.category    ?? null,
    b.instructions ?? null,
    b.input_schema  != null ? JSON.stringify(b.input_schema)  : null,
    b.output_schema != null ? JSON.stringify(b.output_schema) : null,
    b.owner_name  ?? null,
    b.owner_team  ?? null,
    b.owner_email ?? null,
    b.policy_tags != null ? JSON.stringify(b.policy_tags) : null,
    b.version        ?? null,
    b.approval_state ?? null,
    now,
    req.params.id
  );
  res.json(fmtSkill(db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id)));
});

// Tools
app.get('/api/tools', (req, res) => {
  const { approval, search } = req.query;
  let sql = 'SELECT * FROM tools WHERE 1=1';
  const p = [];
  if (approval) { sql += ' AND approval_state = ?';                   p.push(approval); }
  if (search)   { sql += ' AND (name LIKE ? OR description LIKE ?)';  p.push(`%${search}%`, `%${search}%`); }
  res.json(db.prepare(sql).all(...p).map(fmtTool));
});

app.get('/api/tools/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(fmtTool(row));
});

// Agents
app.get('/api/agents', (_req, res) => {
  res.json(db.prepare('SELECT * FROM agents ORDER BY last_run_at DESC').all().map(fmtAgent));
});

app.get('/api/agents/:id', (req, res) => {
  const raw = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });

  const agent = fmtAgent(raw);

  const skillIds = agent.skills_used;
  agent.skills = skillIds.length
    ? db.prepare(`SELECT id,name,category,approval_state FROM skills WHERE id IN (${skillIds.map(() => '?').join(',')})`)
        .all(...skillIds)
    : [];

  const toolIds = agent.tools_used;
  agent.tools = toolIds.length
    ? db.prepare(`SELECT id,name,scope_permissions FROM tools WHERE id IN (${toolIds.map(() => '?').join(',')})`)
        .all(...toolIds)
        .map(t => ({ ...t, scope_permissions: JSON.parse(t.scope_permissions || '[]') }))
    : [];

  agent.recent_runs = db.prepare(
    'SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 10'
  ).all(agent.id).map(fmtRun);

  res.json(agent);
});

// Agent runs
app.get('/api/agent-runs', (req, res) => {
  const { agent_id, skill_id, limit = '50' } = req.query;
  let sql = 'SELECT * FROM agent_runs WHERE 1=1';
  const p = [];
  if (agent_id) { sql += ' AND agent_id = ?'; p.push(agent_id); }
  if (skill_id) { sql += ' AND skill_id = ?'; p.push(skill_id); }
  sql += ' ORDER BY started_at DESC LIMIT ?';
  p.push(parseInt(limit, 10));
  res.json(db.prepare(sql).all(...p).map(fmtRun));
});

app.post('/api/agent-runs', (req, res) => {
  const b = req.body;
  const id  = `run-${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO agent_runs (id,agent_id,skill_id,started_at,completed_at,status,tokens_used,tools_called)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    id,
    b.agent_id  || null,
    b.skill_id  || null,
    b.started_at   ? Math.floor(new Date(b.started_at).getTime() / 1000)   : now,
    b.completed_at ? Math.floor(new Date(b.completed_at).getTime() / 1000) : null,
    b.status       || 'running',
    b.tokens_used  || 0,
    JSON.stringify(b.tools_called || [])
  );
  res.status(201).json(fmtRun(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id)));
});

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`AI Agent Registry  →  http://localhost:${PORT}`);
  console.log(`Endpoints: /api/skills  /api/tools  /api/agents  /api/agent-runs  /api/policy-tags`);
});
