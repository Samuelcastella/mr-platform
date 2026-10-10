export type IntegrationStatus = "pending" | "implemented" | "verified" | "blocked";
export type Priority = "high" | "medium" | "evolutionary";
export interface IntegrationEvaluation {
  id: string;
  phase: number;
  component: string;
  priority: Priority;
  ownership: "internal" | "hybrid" | "external";
  api: IntegrationStatus;
  webhooks: IntegrationStatus;
  authentication: IntegrationStatus;
  inventorySync: IntegrationStatus;
  fiscalCompliance: IntegrationStatus;
  production: IntegrationStatus;
  evidenceUrl?: string;
  verifiedAt?: string;
}
export const integrationBaseline: readonly IntegrationEvaluation[] = [
  {id:"catalog",phase:1,component:"Catálogo y variantes",priority:"high",ownership:"internal",api:"implemented",webhooks:"pending",authentication:"implemented",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"inventory",phase:1,component:"Inventario y Kardex",priority:"high",ownership:"internal",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"orders",phase:2,component:"Pedidos y reservas",priority:"high",ownership:"internal",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"payments",phase:2,component:"Pagos electrónicos",priority:"high",ownership:"hybrid",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"fiscal",phase:3,component:"Facturación SAR/CAI e ISV",priority:"high",ownership:"hybrid",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"blocked",production:"blocked"},
  {id:"reconciliation",phase:3,component:"Conciliación",priority:"high",ownership:"hybrid",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"logistics",phase:4,component:"Envíos y devoluciones",priority:"medium",ownership:"hybrid",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"notifications",phase:4,component:"Notificaciones",priority:"medium",ownership:"hybrid",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"credit",phase:5,component:"Crédito digital",priority:"medium",ownership:"external",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"loyalty",phase:5,component:"Fidelización",priority:"medium",ownership:"internal",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"},
  {id:"outfits",phase:6,component:"Outfits inteligentes",priority:"evolutionary",ownership:"internal",api:"pending",webhooks:"pending",authentication:"pending",inventorySync:"pending",fiscalCompliance:"pending",production:"pending"}
];
