import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
    Text, Textfield, Button, SectionMessage, Stack, Strong
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

const toStringVal = (v) =>
    typeof v === 'string'
        ? v
        : (v && typeof v === 'object' && (v.value ?? v.target?.value ?? '')) || '';

const RiskBanner = ({ risk }) => {
    if (!risk || risk.level === 'OK') return null;
    const appearance =
        risk.level === 'LATE' ? 'error' :
            risk.level === 'AT_RISK' ? 'warning' : 'information';
    const title =
        risk.level === 'LATE' ? 'Likely to miss deadline' :
            risk.level === 'AT_RISK' ? 'Potential delay' : 'Info';
    return (
        <SectionMessage title={title} appearance={appearance}>
            <Text>{risk.reason}</Text>
        </SectionMessage>
    );
};

const PortfolioBanner = ({ portfolio }) => {
    if (!portfolio) return null;
    if (portfolio.level === 'OK') return null;

    const appearance =
        portfolio.level === 'OVERBOOKED' ? 'error' :
            portfolio.level === 'TIGHT' ? 'warning' : 'information';

    const fmtH = (n) => (typeof n === 'number' && isFinite(n) ? `${n.toFixed(1)} h` : '—');
    const due = portfolio.furthestDueISO
        ? new Date(portfolio.furthestDueISO).toLocaleString()
        : '—';

    return (
        <SectionMessage title="Workload risk" appearance={appearance}>
            <Stack space="space.100">
                <Text>{portfolio.reason}</Text>
                <Text>
                    <Strong>Total estimate:</Strong> {fmtH(portfolio.totalEstimatedHours)}{'  '}
                    <Strong>Budget:</Strong> {fmtH(portfolio.budgetHours)}{'  '}
                    {typeof portfolio.bufferHours === 'number' && (
                        <><Strong>Buffer:</Strong> {fmtH(portfolio.bufferHours)} </>
                    )}
                </Text>
                <Text>
                    <Strong>Furthest due:</Strong> {due}{'  '}
                    <Strong>Open:</Strong> {portfolio.openCount}{'  '}
                    <Strong>Estimated:</Strong> {portfolio.counted}{'  '}
                    <Strong>Unknown:</Strong> {portfolio.unknown}
                </Text>
            </Stack>
        </SectionMessage>
    );
};

// ✅ New: show success when everything is OK
const OnTrackBanner = ({ issueRisk, portfolio }) => {
    const issueOk = issueRisk?.level === 'OK';
    const portfolioOk = !portfolio || portfolio.level === 'OK';
    if (!(issueOk && portfolioOk)) return null;

    return (
        <SectionMessage appearance="success" title="Everything is on track">
            <Text>Your current issue and overall workload both look good.</Text>
        </SectionMessage>
    );
};

const App = () => {
    const [issue, setIssue] = useState(null);
    const [remaining, setRemaining] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    async function load() {
        setMsg('');
        const ctx = await view.getContext();
        const issueKey =
            ctx?.extension?.issue?.key || ctx?.extension?.issueKey || ctx?.context?.issue?.key;

        let data = await invoke('getIssueRisk', { issueKey });

        if (!data?.portfolio) {
            const pr = await invoke('getPortfolioRisk', {});
            if (pr?.ok) data = { ...data, portfolio: pr.portfolio };
        }

        setIssue(data);
        setRemaining(
            data?.estimate?.remainingHours !== undefined
                ? String(data.estimate.remainingHours)
                : ''
        );
    }

    useEffect(() => {
        load().catch(e => setMsg(String(e?.message || e)));
    }, []);

    async function save() {
        if (!issue || issue.error) return;
        setSaving(true);
        setMsg('');
        try {
            const payload = { issueKey: issue.issueKey };
            if (remaining.trim() !== '') payload.remainingHours = Number(remaining);
            const res = await invoke('saveEstimate', payload);
            if (res?.error) {
                setMsg(res.message || 'Save failed');
            } else {
                // Light refresh pattern to avoid input duplication issues:
                // Update only the risk from the save result, then refresh portfolio.
                setIssue(prev => (prev ? { ...prev, estimate: res.estimate, risk: res.risk } : prev));
                const pr = await invoke('getPortfolioRisk', {});
                if (pr?.ok) setIssue(prev => (prev ? { ...prev, portfolio: pr.portfolio } : prev));
                setMsg('Saved ✓');
            }
        } catch (e) {
            setMsg(`Save failed: ${e?.message || String(e)}`);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Stack space="space.200">
            <Text>Task ETA & Risk</Text>

            {!issue ? (
                <Text>{msg || 'Loading…'}</Text>
            ) : issue.error ? (
                <Stack space="space.100">
                    <SectionMessage title="Unable to load issue" appearance="warning">
                        <Text>{issue.message}</Text>
                    </SectionMessage>
                    <Button onClick={load}>Retry</Button>
                </Stack>
            ) : (
                <Stack space="space.150">
                    {/* Success when everything is OK */}
                    <OnTrackBanner issueRisk={issue.risk} portfolio={issue.portfolio} />

                    {/* Per-issue header */}
                    <Text>
                        <Strong>{issue.issueKey}</Strong>{' — '}{issue.summary || ''}
                    </Text>
                    <Text>Due date: {issue.duedate || '—'}</Text>

                    {/* Per-issue risk (shows if not OK) */}
                    <RiskBanner risk={issue.risk} />

                    {/* Portfolio risk (shows if not OK) */}
                    <PortfolioBanner portfolio={issue.portfolio} />

                    {/* Estimate input for this issue */}
                    <Textfield
                        name="remaining"
                        label="Hours remaining"
                        value={remaining ?? ''}
                        onChange={(v) => setRemaining(toStringVal(v))}
                        placeholder="e.g., 6"
                    />

                    <Stack space="space.100" alignInline="start">
                        <Button appearance="primary" onClick={save} isDisabled={saving}>
                            {saving ? 'Saving…' : 'Save estimate'}
                        </Button>
                        <Button onClick={load}>Refresh</Button>
                    </Stack>

                    {msg ? <Text>{msg}</Text> : null}
                </Stack>
            )}
        </Stack>
    );
};

ForgeReconciler.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
