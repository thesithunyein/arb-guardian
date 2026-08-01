import { durableEnabled, loadDurable } from "./_durable";
import { store } from "./_store";

/** Always refresh memory from Redis before read/write (prevents stale empty wipes). */
export async function hydrateStore() {
  const s = store();
  if (!durableEnabled()) return s;

  const data = await loadDurable();
  if (!data) {
    s.durableHydrated = true;
    return s;
  }

  // Union merge into memory — never shrink Redis-backed lists from an empty instance.
  const emails = new Set(s.waitlist.map((w) => w.email.toLowerCase()));
  for (const row of data.waitlist) {
    if (!emails.has(row.email.toLowerCase())) s.waitlist.push(row);
  }

  const owners = new Map(s.guilds.map((g) => [g.owner.toLowerCase(), g]));
  for (const row of data.guilds) {
    const key = row.owner.toLowerCase();
    const prev = owners.get(key);
    if (!prev) {
      s.guilds.push(row);
      owners.set(key, row);
    } else {
      prev.usageCount = Math.max(prev.usageCount, row.usageCount);
      if (row.lastActiveAt > prev.lastActiveAt) {
        prev.lastActiveAt = row.lastActiveAt;
        prev.name = row.name || prev.name;
        prev.lastEvent = row.lastEvent || prev.lastEvent;
      }
    }
  }

  s.durableHydrated = true;
  return s;
}
