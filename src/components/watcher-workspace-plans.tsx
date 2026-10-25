import { useMemo, useRef, useState } from "react";
import { Download, Upload, Plus, Trash2 } from "lucide-react";
import { calculateTradePlan, parseWorkspaceSaved, workspaceSymbol, type TradePlan, type WorkspaceSaved } from "@/lib/watcher-workspace";

const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export function WatcherWorkspacePlans({ symbol, sourceAsOf, saved, updateSaved }: { symbol: string; sourceAsOf: string | null; saved: WorkspaceSaved; updateSaved: (value: WorkspaceSaved, replaceCorrupt?: boolean) => void }) {
  const [draft, setDraft] = useState({ symbol, direction: "long" as "long" | "short", entry: "", stop: "", target: "", risk: "", thesis: "", invalidation: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<WorkspaceSaved | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const result = useMemo(() => {
    try { return { data: calculateTradePlan({ direction: draft.direction, entry: Number(draft.entry), stop: Number(draft.stop), target: draft.target.trim() ? Number(draft.target) : null, riskBudget: Number(draft.risk) }), error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [draft]);
  const field = (name: keyof typeof draft, value: string) => { setDraft(current => ({ ...current, [name]: value })); setNotice(null); };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (!result.data) throw new Error(result.error || "Complete the plan first.");
      const previous = saved.plans.find(plan => plan.id === editing);
      const ticker = workspaceSymbol(draft.symbol);
      const plan: TradePlan = { id: editing || crypto.randomUUID(), symbol: ticker, direction: draft.direction, entry: Number(draft.entry), stop: Number(draft.stop), target: draft.target.trim() ? Number(draft.target) : null, riskBudget: Number(draft.risk), thesis: draft.thesis, invalidation: draft.invalidation, status: previous?.status || "Watching", createdAt: previous?.createdAt || new Date().toISOString(), sourceAsOf: ticker === symbol && sourceAsOf ? sourceAsOf : previous?.symbol === ticker ? previous.sourceAsOf : null };
      updateSaved({ ...saved, plans: [plan, ...saved.plans.filter(row => row.id !== editing)] });
      setEditing(null); setNotice(`${plan.symbol} plan saved in this workspace.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const exportSaved = () => {
    const href = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = href; a.download = "watcher-workspace.json"; a.click(); URL.revokeObjectURL(href);
  };
  return <div className="ww-plans">
    <div className="ww-section-heading"><div><span className="ww-kicker">DEFINE THE RISK FIRST</span><h1>Trade plans</h1><p>Your levels. Your thesis. Saved on this browser.</p></div><div className="ww-actions"><button onClick={exportSaved}><Download size={15} /> Export</button><button onClick={() => file.current?.click()}><Upload size={15} /> Import</button><input type="file" accept="application/json,.json" hidden ref={file} onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (!selected) return;
      try { if (selected.size > 1_000_000) throw new Error("Import must be under 1 MB."); setPendingImport(parseWorkspaceSaved(JSON.parse(await selected.text()))); }
      catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    }} /></div></div>
    {pendingImport && <div className="ww-notice" role="alert"><p>Import {pendingImport.plans.length} plans and {pendingImport.customSymbols.length} custom tickers? This replaces the workspace on this browser. Export first to keep a copy.</p><button className="ww-primary" onClick={() => { updateSaved(pendingImport, true); setPendingImport(null); setNotice("Workspace imported."); }}>Replace workspace</button><button onClick={() => setPendingImport(null)}>Cancel</button></div>}
    {notice && <p className="ww-notice" role="status">{notice}</p>}
    <div className="ww-plan-layout"><form className="ww-card ww-plan-form" onSubmit={save}>
      <div className="ww-card-heading"><h2>{editing ? "Edit plan" : "Build a scenario"}</h2><button type="button" onClick={() => { setEditing(null); setDraft({ symbol, direction: "long", entry: "", stop: "", target: "", risk: "", thesis: "", invalidation: "" }); }}><Plus size={14} /> New</button></div>
      <div className="ww-form-grid"><label>Ticker<input value={draft.symbol} maxLength={12} onChange={e => field("symbol", e.target.value.toUpperCase())} required /></label><label>Direction<select value={draft.direction} onChange={e => field("direction", e.target.value)}><option value="long">Long</option><option value="short">Short</option></select></label>
        {([ ["entry", "Entry · USD"], ["stop", "Stop · USD"], ["target", "Target · optional"], ["risk", "Risk budget · USD"] ] as const).map(([key, label]) => <label key={key}>{label}<input inputMode="decimal" type="number" min="0.000001" step="any" value={draft[key]} onChange={e => field(key, e.target.value)} required={key !== "target"} /></label>)}
      </div><label>Thesis<textarea maxLength={2000} value={draft.thesis} onChange={e => field("thesis", e.target.value)} placeholder="What evidence supports this scenario?" /></label><label>Invalidation<textarea maxLength={2000} value={draft.invalidation} onChange={e => field("invalidation", e.target.value)} placeholder="What would make you change your mind?" /></label>
      <div className="ww-plan-results" aria-live="polite">{result.data ? <><div><span>Whole shares</span><strong>{result.data.shares}</strong></div><div><span>Scenario risk</span><strong>{dollars(result.data.actualRisk)}</strong></div><div><span>Position value</span><strong>{dollars(result.data.position)}</strong></div><div><span>Reward / risk</span><strong>{result.data.rewardRisk === null ? "No target" : `${result.data.rewardRisk.toFixed(2)} : 1`}</strong></div></> : <p>{result.error}</p>}</div>
      <p className="ww-footnote">Whole shares = floor(risk budget ÷ entry-to-stop distance). Gaps, slippage, fees and short borrowing can increase losses. No order is sent.</p><button className="ww-primary" type="submit">{editing ? "Update plan" : "Save plan"}</button>
    </form><section className="ww-card"><div className="ww-card-heading"><h2>Saved scenarios</h2><span className="ww-badge">{saved.plans.length} / 200</span></div>
      {!saved.plans.length && <div className="ww-empty"><h3>Put your next decision in writing.</h3><p>Set an entry, a stop and a risk budget. A target is optional.</p></div>}
      {saved.plans.map(plan => <article className="ww-saved-plan" key={plan.id}><div className="ww-row"><strong>{plan.symbol}</strong><span className="ww-badge">{plan.direction}</span><select aria-label={`${plan.symbol} plan status`} value={plan.status} onChange={e => updateSaved({ ...saved, plans: saved.plans.map(row => row.id === plan.id ? { ...row, status: e.target.value as TradePlan["status"] } : row) })}>{["Watching", "Ready", "Active", "Closed"].map(status => <option key={status}>{status}</option>)}</select></div><p>Entry {dollars(plan.entry)} · Stop {dollars(plan.stop)} · {calculateTradePlan(plan).shares} shares</p><p>{plan.thesis || "No thesis recorded."}</p><p className="ww-muted">Invalidation: {plan.invalidation || "Not recorded"}</p><small>Quote reference: {plan.sourceAsOf || "Not attached"}</small><div className="ww-actions"><button onClick={() => { setEditing(plan.id); setDraft({ symbol: plan.symbol, direction: plan.direction, entry: String(plan.entry), stop: String(plan.stop), target: plan.target === null ? "" : String(plan.target), risk: String(plan.riskBudget), thesis: plan.thesis, invalidation: plan.invalidation }); }}>Edit</button><button aria-label={`Delete ${plan.symbol} plan`} onClick={() => setConfirmDelete(plan.id)}><Trash2 size={14} /></button></div>{confirmDelete === plan.id && <div className="ww-notice"><p>Delete this saved plan?</p><button onClick={() => { updateSaved({ ...saved, plans: saved.plans.filter(row => row.id !== plan.id) }); setConfirmDelete(null); }}>Delete plan</button><button onClick={() => setConfirmDelete(null)}>Keep plan</button></div>}</article>)}
    </section></div>
  </div>;
}
