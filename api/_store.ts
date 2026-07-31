type Incident = {
  id: string;
  title: string;
  details: string;
  wallet: string;
  severity: string;
  status: string;
  recommendedPlaybook: string;
  evidence: string[];
  createdAt: string;
};

type Audit = {
  incidentId: string;
  action: string;
  actor: string;
  createdAt: string;
};

const g = globalThis as typeof globalThis & {
  __arbGuardianStore?: {
    assessments: number;
    blocked: number;
    critical: number;
    scoreSum: number;
    incidents: Incident[];
    audit: Audit[];
    waitlist: Array<{ email: string; guild: string; createdAt: string }>;
  };
};

export function store() {
  if (!g.__arbGuardianStore) {
    g.__arbGuardianStore = {
      assessments: 0,
      blocked: 0,
      critical: 0,
      scoreSum: 0,
      incidents: [],
      audit: [],
      waitlist: []
    };
  }
  if (!g.__arbGuardianStore.waitlist) g.__arbGuardianStore.waitlist = [];
  return g.__arbGuardianStore;
}

export function cors(res: { setHeader: (k: string, v: string) => void }) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
