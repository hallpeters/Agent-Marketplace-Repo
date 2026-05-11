# AI Agent Marketplace — TRATON Case Prototype

A student research prototype exploring a federated, governance-first marketplace for AI agents across multi-brand industrial organizations. Built as part of "Navigating AI: Strategy and Impact" at the Stockholm School of Economics, with TRATON GROUP as the research partner.

**This is not an official TRATON, Scania, MAN, or Volkswagen Truck & Bus product or internal system. It is a prototype for research and feedback purposes only.**

---

## Live demo

**https://agent-marketplace-repo-production.up.railway.app/**

The marketplace renders a registry of mock and real agents. To test the working integration with a live external agent (built in n8n, hosted on n8n cloud), follow the instructions below.

---

## Testing the working Meeting Agent

The prototype includes a working integration with an external AI agent built in n8n. The agent extracts decisions, action items, risks, and a draft follow-up email from meeting notes — with a governance gate before any email is sent.

To test it:

1. Open the live URL above.
2. Click **Add Agent**.
3. Paste this manifest into the modal:

```json
{
  "id": "meeting-agent-001",
  "name": "Meeting Summariser",
  "owner": "hallpeters",
  "description": "Summarises meeting notes into decisions, action items, risks, and drafts a follow-up email.",
  "platform": "n8n",
  "endpoint": "https://hallpetersdev.app.n8n.cloud/webhook/meeting-agent",
  "inputs": [
    { "name": "notes", "type": "textarea", "label": "Meeting notes" },
    { "name": "preset", "type": "select", "label": "Meeting type", "options": ["R&D", "Procurement", "Board"] },
    { "name": "recipients", "type": "text", "label": "Email recipients, comma-separated" }
  ],
  "permissions": ["email:send", "data:read"],
  "data_classification": "internal"
}
```

4. Click **Save**. A new tile appears in the Marketplace tier section.
5. Click **Run Agent** on the new tile.
6. Paste meeting notes, pick a meeting type, enter a recipient email address.
7. Click **Run**. The agent extracts decisions, action items, risks, and flags any sensitive content. An email draft appears with an **Approve & Send** button.
8. Click **Approve & Send**. The email is sent to the address you entered.

---

## Architecture

The marketplace is a thin governance and discovery layer. Agents are not hosted inside the marketplace — they live wherever their builders chose to build them. The marketplace ingests a manifest describing the agent's contract (endpoint, inputs, permissions, data classification) and calls the endpoint over HTTP.

The included Meeting Agent is built in n8n cloud as an example. The same pattern would work for agents built in Microsoft Copilot Studio, AWS Bedrock, a Vercel function, or any HTTP-callable runtime.

---

## The agent itself (n8n workflow)

The full n8n workflow that powers the Meeting Agent is included at:

**`/deliverables/meeting-agent-workflow.json`**

To run this agent on your own infrastructure:

1. Sign in to your own n8n instance (cloud or self-hosted).
2. Create a new workflow → Import from File → select `meeting-agent-workflow.json`.
3. Reconnect your own OpenAI and Gmail credentials.
4. Publish the workflow to activate the production webhook URL.
5. Update the manifest's `endpoint` field to point at your new webhook URL.
6. Paste the updated manifest into the marketplace.

That round trip — export, import, repoint — is the federation pattern in practice.

---

## Governance hooks visible in the demo

- **Sensitive content flagging**: the agent reviews extracted content and flags anything that looks confidential (financials, personnel, IP) in a dedicated Governance panel.
- **Approval gate**: the email is never sent automatically. The user reviews the drafted message inside the marketplace and explicitly approves before send.
- **Data classification metadata**: the manifest declares the data classification level of inputs and outputs, surfaced to the user.

---

## Scope and known v2 extensions

This is a research prototype with deliberate scope limits:

- Manifests are stored client-side in `localStorage`. A real deployment would use a backend with proper agent registration and access controls.
- The agent runner currently assumes a specific response shape (decisions / action_items / risks / email_draft). A v2 would introduce an `outputs` field in the manifest schema for generic output rendering.
- Usage logging is local and ephemeral. A real governance dashboard would query a persistent audit log.
- Identity and permissioning are not modelled. Real deployments would integrate with the organization's IAM.

---

## Team

Developed by the Stockholm School of Economics student team for "Navigating AI: Strategy and Impact", spring 2026.

TRATON GROUP serves as the research partner and case context.