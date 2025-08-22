/**
 * Task ETA & Risk — Resolvers (Concise documented)
 *
 * What it does:
 * - Stores a per-issue estimate (remainingHours and/or etaISO) in a Jira Issue Property.
 * - Computes per-issue risk: compares ETA/remaining to the issue duedate.
 * - Computes portfolio risk: sums all open assigned issues' estimates vs. time budget to the furthest duedate.
 *
 * Storage:
 * - Issue Property key: com.tasketa.estimate (small JSON, no external DB).
 *
 * Endpoints:
 * - getIssueRisk(issueKey?): { issueKey, summary, duedate, estimate, risk, portfolio }
 * - saveEstimate({ issueKey, remainingHours?, etaISO? }): { ok, estimate, risk } | { error, message }
 * - getPortfolioRisk(): { ok, portfolio } | { error, message }
 */

import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();
/** Issue Property key used to persist user estimate */
const PROPERTY_KEY = 'com.tasketa.estimate';

/* -------------------------- helpers: per-issue -------------------------- */

/**
 * Interpret a date-only duedate (YYYY-MM-DD) as end-of-day UTC ISO string.
 * @param {string} dateStr - Jira date-only string
 * @returns {string} ISO string at 23:59:59.999Z
 */
function endOfDayISO(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

/**
 * Compute per-issue risk from now, duedate, and estimate.
 * Rules:
 * - NO_DUE: no duedate set.
 * - UNKNOWN: no ETA nor remainingHours.
 * - LATE: ETA > due.
 * - AT_RISK: buffer < 24h.
 * - OK: otherwise.
 * @param {string} nowISO
 * @param {string|undefined} duedateISO
 * @param {{etaISO?:string, remainingHours?:number}|undefined} est
 * @returns {{level:'NO_DUE'|'UNKNOWN'|'LATE'|'AT_RISK'|'OK', reason:string}}
 */
function calcRisk(nowISO, duedateISO, est) {
  if (!duedateISO) return { level: 'NO_DUE', reason: 'No due date set' };
  const now = new Date(nowISO).getTime();
  const due = new Date(duedateISO).getTime();

  let eta = NaN;
  if (est?.etaISO) eta = new Date(est.etaISO).getTime();
  else if (typeof est?.remainingHours === 'number' && est.remainingHours > 0) {
    eta = now + est.remainingHours * 3600_000;
  }

  if (Number.isNaN(eta)) return { level: 'UNKNOWN', reason: 'No ETA / remaining hours provided' };
  if (eta > due) return { level: 'LATE', reason: 'ETA exceeds due date' };
  const bufferMs = due - eta;
  if (bufferMs < 86_400_000) return { level: 'AT_RISK', reason: 'Less than one day of buffer' };
  return { level: 'OK', reason: 'ETA comfortably before due date' };
}

/**
 * Read an issue (as the app). Expects Browse permission for the app user.
 * @param {string} issueKey
 */
async function readIssue(issueKey) {
  const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,duedate,status,assignee`
  );
  if (!res.ok) {
    const body = await res.text();
    const msg = `Issue fetch failed: ${res.status}. key="${issueKey}". body=${body}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return await res.json();
}

/**
 * Read the app-owned estimate Issue Property (404 => null).
 * @param {string} issueKey
 */
async function readEstimate(issueKey) {
  const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Property read failed: ${res.status}`);
  const body = await res.json();
  return body?.value ?? null;
}

/**
 * Write the estimate Issue Property.
 * @param {string} issueKey
 * @param {{etaISO?:string, remainingHours?:number, updatedAt:string}} est
 */
async function writeEstimate(issueKey, est) {
  const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(est) }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Property write failed: ${res.status} ${t}`);
  }
}

/* ------------------------ helpers: portfolio rollup --------------------- */

/**
 * JQL search (as current user) with pagination.
 * @param {string} jql
 * @param {string} fields
 * @param {number} cap
 * @returns {Promise<Array>} issues
 */
async function jqlAllAsUser(jql, fields = 'summary,duedate,status', cap = 10000) {
  // Read issues as the current user (admin in your tests) to avoid 404 perms
  const pageSize = 100;
  let startAt = 0;
  const all = [];
  while (all.length < cap) {
    const res = await api.asUser().requestJira(
        route`/rest/api/3/search?jql=${jql}&fields=${fields}&maxResults=${pageSize}&startAt=${startAt}`
    );
    if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    all.push(...(data.issues || []));
    if (startAt + pageSize >= (data.total || 0)) break;
    startAt += pageSize;
  }
  return all;
}

/**
 * Convert an estimate to hours (prefers remainingHours; falls back to etaISO).
 * @param {{remainingHours?:number, etaISO?:string}|null} est
 * @param {number} nowMs
 * @returns {number|null}
 */
function hoursFromEstimate(est, nowMs) {
  if (!est) return null;
  if (typeof est.remainingHours === 'number' && est.remainingHours >= 0) {
    return est.remainingHours;
  }
  if (est.etaISO) {
    const etaMs = new Date(est.etaISO).getTime();
    const diff = (etaMs - nowMs) / 3600_000;
    return diff > 0 ? diff : 0;
  }
  return null; // unknown
}

/**
 * Compute portfolio risk for current user:
 * - Budget = (furthest duedate across open assigned issues) - now
 * - Total  = sum of estimated hours (remainingHours or hours from ETA)
 * Levels: OVERBOOKED (total > budget), TIGHT (buffer < 8h), OK,
 *         NO_DUE (no open issues have a duedate)
 */
async function computePortfolioRisk() {
  // Open issues assigned to current user
  const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC';
  const items = await jqlAllAsUser(jql, 'summary,duedate,status');

  const now = new Date();
  const nowMs = now.getTime();

  let furthestDueISO = undefined;
  let totalEstimatedHours = 0;
  let counted = 0; // issues with hours
  let unknown = 0; // issues without usable estimate

  for (const it of items) {
    const key = it.key;
    const dueISO = it?.fields?.duedate ? endOfDayISO(it.fields.duedate) : undefined;
    if (dueISO) {
      if (!furthestDueISO || new Date(dueISO).getTime() > new Date(furthestDueISO).getTime()) {
        furthestDueISO = dueISO;
      }
    }
    const est = await readEstimate(key); // asApp
    const hrs = hoursFromEstimate(est, nowMs);
    if (hrs === null) unknown += 1;
    else {
      totalEstimatedHours += hrs;
      counted += 1;
    }
  }

  if (!furthestDueISO) {
    return {
      level: 'NO_DUE',
      reason: 'No open issues have a due date.',
      furthestDueISO: null,
      budgetHours: null,
      totalEstimatedHours,
      counted,
      unknown,
      openCount: items.length
    };
  }

  const budgetHours = (new Date(furthestDueISO).getTime() - nowMs) / 3600_000;
  let level = 'OK';
  let reason = 'Total estimate fits within the time budget.';
  const bufferHours = budgetHours - totalEstimatedHours;

  if (totalEstimatedHours > budgetHours) {
    level = 'OVERBOOKED';
    reason = 'Total estimated hours exceed the time budget until the furthest due date.';
  } else if (bufferHours < 8) {
    level = 'TIGHT';
    reason = 'Less than one workday of buffer across all open issues.';
  }

  return {
    level,
    reason,
    furthestDueISO,
    budgetHours,
    totalEstimatedHours,
    bufferHours,
    counted,
    unknown,
    openCount: items.length
  };
}

/* ------------------------------- endpoints ------------------------------ */

/**
 * Get per-issue data + portfolio rollup.
 * @returns {Object} issueKey, summary, duedate, estimate, risk, portfolio | {error, message}
 */
resolver.define('getIssueRisk', async (req) => {
  const issueKey = req.payload?.issueKey || req.context?.issue?.key;
  console.log('getIssueRisk keys:', { payload: req.payload, contextIssue: req.context?.issue, picked: issueKey });

  if (!issueKey) {
    return { error: 'NO_KEY', message: 'Open this panel on an issue or pass { issueKey }' };
  }

  try {
    const issue = await readIssue(issueKey);
    const est = await readEstimate(issueKey);
    const nowISO = new Date().toISOString();
    const dueISO = issue?.fields?.duedate ? endOfDayISO(issue.fields.duedate) : undefined;
    const risk = calcRisk(nowISO, dueISO, est || undefined);

    // Portfolio rollup across the user’s open assigned issues
    const portfolio = await computePortfolioRisk();

    return {
      issueKey,
      summary: issue?.fields?.summary || '',
      duedate: issue?.fields?.duedate || null,
      estimate: est,
      risk,
      portfolio
    };
  } catch (e) {
    const status = e?.status || 500;
    return {
      error: status === 404 ? 'NOT_VISIBLE' : 'SERVER_ERROR',
      message:
          status === 404
              ? `Issue ${issueKey} is not accessible to the app user (Browse permission) or the key is invalid.`
              : String(e?.message || e),
      issueKey
    };
  }
});

/**
 * Save the estimate for an issue and return updated per-issue risk.
 * Body: { issueKey, remainingHours?, etaISO? }
 */
resolver.define('saveEstimate', async (req) => {
  const key = req.payload?.issueKey || req.context?.issue?.key;
  if (!key) return { error: 'NO_KEY', message: 'No issue key' };

  try {
    const est = {
      updatedAt: new Date().toISOString(),
      ...(req.payload?.etaISO ? { etaISO: req.payload.etaISO } : {}),
      ...(typeof req.payload?.remainingHours === 'number' ? { remainingHours: req.payload.remainingHours } : {}),
    };
    await writeEstimate(key, est);

    const issue = await readIssue(key);
    const dueISO = issue?.fields?.duedate ? endOfDayISO(issue.fields.duedate) : undefined;
    const risk = calcRisk(new Date().toISOString(), dueISO, est);
    return { ok: true, estimate: est, risk };
  } catch (e) {
    return { error: 'SAVE_FAILED', message: String(e?.message || e) };
  }
});

/**
 * Get only the portfolio rollup (for standalone views).
 */
resolver.define('getPortfolioRisk', async () => {
  try {
    const portfolio = await computePortfolioRisk();
    return { ok: true, portfolio };
  } catch (e) {
    return { error: 'PORTFOLIO_FAILED', message: String(e?.message || e) };
  }
});

export const handler = resolver.getDefinitions();
