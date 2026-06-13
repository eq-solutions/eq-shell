import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureRpcError } from "./quoteTelemetry";

// EQ Ops — Setup / admin. Lets the business manage outlet pricing and quote
// snippet templates without touching SQL. All writes go through the tenant-scoped
// admin RPCs in tenant-migration 0081 (pricing) and 0075 (templates).

interface QuotesSetupProps {
  supabase: SupabaseClient | null;
}

type SetupTab = "config" | "materials" | "products" | "bands" | "templates";

const num = (s: string): number => {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

const DEFAULT_CONFIG = {
  material_markup: "1.15",
  labour_normal_rate: "115.00",
  labour_supervisor_rate: "135.00",
  removal_base: "455.00",
  removal_increment: "170.00",
  removal_markup: "1.25",
};

interface MaterialDraft {
  material_id: string | null;
  part_no: string;
  description: string;
  unit: string;
  unit_cost: string;
  sort_order: number;
  saving?: boolean;
}

interface ProductDraft {
  product_id: string | null;
  name: string;
  brand: string;
  phase: string;
  plug_type: string;
  cable_material_id: string;
  cable_qty: string;
  outlet_material_id: string;
  outlet_qty: string;
  breaker_material_id: string;
  breaker_qty: string;
  install_hours: string;
  mgmt_hours: string;
  sort_order: number;
  saving?: boolean;
}

interface BandDraft {
  min_qty: string;
  max_qty: string;
  factor: string;
}

interface TemplateDraft {
  template_id: string | null;
  template_type: "scope" | "clarification";
  name: string;
  body: string;
  sort_order: number;
  saving?: boolean;
}

export function QuotesSetup({ supabase }: QuotesSetupProps): React.JSX.Element {
  const [tab, setTab] = useState<SetupTab>("config");
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<typeof DEFAULT_CONFIG>(DEFAULT_CONFIG);
  const [configSaving, setConfigSaving] = useState(false);

  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [bands, setBands] = useState<BandDraft[]>([]);
  const [bandsSaving, setBandsSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateDraft[]>([]);

  const flash = (msg: string) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 2500);
  };

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.rpc("eq_get_pricing_config");
    if (e) { setError(e.message); return; }
    setError(null);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (row) {
      setConfig({
        material_markup: String(row.material_markup ?? DEFAULT_CONFIG.material_markup),
        labour_normal_rate: String(row.labour_normal_rate ?? DEFAULT_CONFIG.labour_normal_rate),
        labour_supervisor_rate: String(row.labour_supervisor_rate ?? DEFAULT_CONFIG.labour_supervisor_rate),
        removal_base: String(row.removal_base ?? DEFAULT_CONFIG.removal_base),
        removal_increment: String(row.removal_increment ?? DEFAULT_CONFIG.removal_increment),
        removal_markup: String(row.removal_markup ?? DEFAULT_CONFIG.removal_markup),
      });
    }
  }, [supabase]);

  const loadMaterials = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.rpc("eq_list_pricing_materials", { p_include_archived: false });
    if (e) { setError(e.message); return; }
    setError(null);
    setMaterials(((data as Record<string, unknown>[]) ?? []).map((m) => ({
      material_id: String(m.material_id),
      part_no: String(m.part_no ?? ""),
      description: String(m.description ?? ""),
      unit: m.unit ? String(m.unit) : "",
      unit_cost: String(m.unit_cost ?? "0"),
      sort_order: Number(m.sort_order ?? 0),
    })));
  }, [supabase]);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.rpc("eq_list_pricing_products_full", { p_include_archived: false });
    if (e) { setError(e.message); return; }
    setError(null);
    setProducts(((data as Record<string, unknown>[]) ?? []).map((p) => ({
      product_id: String(p.product_id),
      name: String(p.name ?? ""),
      brand: p.brand ? String(p.brand) : "",
      phase: p.phase ? String(p.phase) : "",
      plug_type: p.plug_type ? String(p.plug_type) : "",
      cable_material_id: p.cable_material_id ? String(p.cable_material_id) : "",
      cable_qty: String(p.cable_qty ?? "0"),
      outlet_material_id: p.outlet_material_id ? String(p.outlet_material_id) : "",
      outlet_qty: String(p.outlet_qty ?? "0"),
      breaker_material_id: p.breaker_material_id ? String(p.breaker_material_id) : "",
      breaker_qty: String(p.breaker_qty ?? "0"),
      install_hours: String(p.install_hours ?? "0"),
      mgmt_hours: String(p.mgmt_hours ?? "0"),
      sort_order: Number(p.sort_order ?? 0),
    })));
  }, [supabase]);

  const loadBands = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.rpc("eq_list_pricing_bands", { p_category: "outlets" });
    if (e) { setError(e.message); return; }
    setError(null);
    setBands(((data as Record<string, unknown>[]) ?? []).map((b) => ({
      min_qty: String(b.min_qty ?? ""),
      max_qty: b.max_qty == null ? "" : String(b.max_qty),
      factor: String(b.factor ?? "1"),
    })));
  }, [supabase]);

  const loadTemplates = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.rpc("eq_list_quote_templates", { p_type: null });
    if (e) { setError(e.message); return; }
    setError(null);
    setTemplates(((data as Record<string, unknown>[]) ?? []).map((t) => ({
      template_id: String(t.template_id),
      template_type: (String(t.template_type) === "clarification" ? "clarification" : "scope"),
      name: String(t.name ?? ""),
      body: String(t.body ?? ""),
      sort_order: Number(t.sort_order ?? 0),
    })));
  }, [supabase]);

  // Fetch the active tab's data. The loaders only setState after an await, so the
  // synchronous cascading-render case this rule guards against doesn't apply here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (tab === "config") void loadConfig();
    else if (tab === "materials") void loadMaterials();
    else if (tab === "products") { void loadMaterials(); void loadProducts(); }
    else if (tab === "bands") void loadBands();
    else if (tab === "templates") void loadTemplates();
  }, [tab, loadConfig, loadMaterials, loadProducts, loadBands, loadTemplates]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Config ──────────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    if (!supabase) return;
    setConfigSaving(true);
    setError(null);
    const { error: e } = await supabase.rpc("eq_upsert_pricing_config", {
      p_material_markup: num(config.material_markup),
      p_labour_normal_rate: num(config.labour_normal_rate),
      p_labour_supervisor_rate: num(config.labour_supervisor_rate),
      p_removal_base: num(config.removal_base),
      p_removal_increment: num(config.removal_increment),
      p_removal_markup: num(config.removal_markup),
    });
    setConfigSaving(false);
    if (e) { captureRpcError("eq_upsert_pricing_config", e); setError(e.message); return; }
    flash("Pricing settings saved.");
  };

  // ── Materials ────────────────────────────────────────────────────────────────
  const updMaterial = (i: number, field: keyof MaterialDraft, value: string) =>
    setMaterials((prev) => prev.map((m, j) => (j === i ? { ...m, [field]: value } : m)));

  const addMaterial = () =>
    setMaterials((prev) => [...prev, {
      material_id: null, part_no: "", description: "", unit: "", unit_cost: "",
      sort_order: (prev.length + 1) * 10,
    }]);

  const saveMaterial = async (i: number) => {
    if (!supabase) return;
    const m = materials[i];
    if (!m.part_no.trim() || !m.description.trim()) { setError("Material needs a part no. and description."); return; }
    setError(null);
    const { error: e } = await supabase.rpc("eq_upsert_pricing_material", {
      p_material_id: m.material_id,
      p_part_no: m.part_no.trim(),
      p_description: m.description.trim(),
      p_unit: m.unit.trim() || null,
      p_unit_cost: num(m.unit_cost),
      p_sort_order: m.sort_order,
    });
    if (e) { captureRpcError("eq_upsert_pricing_material", e); setError(e.message); return; }
    await loadMaterials();
    flash("Material saved.");
  };

  const archiveMaterial = async (i: number) => {
    if (!supabase) return;
    const m = materials[i];
    if (!m.material_id) { setMaterials((prev) => prev.filter((_, j) => j !== i)); return; }
    const { error: e } = await supabase.rpc("eq_archive_pricing_material", { p_material_id: m.material_id, p_archived: true });
    if (e) { captureRpcError("eq_archive_pricing_material", e); setError(e.message); return; }
    await loadMaterials();
    flash("Material archived.");
  };

  // ── Products ─────────────────────────────────────────────────────────────────
  const updProduct = (i: number, field: keyof ProductDraft, value: string) =>
    setProducts((prev) => prev.map((p, j) => (j === i ? { ...p, [field]: value } : p)));

  const addProduct = () =>
    setProducts((prev) => [...prev, {
      product_id: null, name: "", brand: "", phase: "", plug_type: "",
      cable_material_id: "", cable_qty: "0", outlet_material_id: "", outlet_qty: "0",
      breaker_material_id: "", breaker_qty: "0", install_hours: "0", mgmt_hours: "0",
      sort_order: (prev.length + 1) * 10,
    }]);

  const saveProduct = async (i: number) => {
    if (!supabase) return;
    const p = products[i];
    if (!p.name.trim()) { setError("Product needs a name."); return; }
    setError(null);
    const { error: e } = await supabase.rpc("eq_upsert_pricing_product", {
      p_product_id: p.product_id,
      p_name: p.name.trim(),
      p_brand: p.brand.trim() || null,
      p_phase: p.phase.trim() || null,
      p_plug_type: p.plug_type.trim() || null,
      p_cable_material_id: p.cable_material_id || null,
      p_cable_qty: num(p.cable_qty),
      p_outlet_material_id: p.outlet_material_id || null,
      p_outlet_qty: num(p.outlet_qty),
      p_breaker_material_id: p.breaker_material_id || null,
      p_breaker_qty: num(p.breaker_qty),
      p_install_hours: num(p.install_hours),
      p_mgmt_hours: num(p.mgmt_hours),
      p_sort_order: p.sort_order,
    });
    if (e) { captureRpcError("eq_upsert_pricing_product", e); setError(e.message); return; }
    await loadProducts();
    flash("Product saved.");
  };

  const archiveProduct = async (i: number) => {
    if (!supabase) return;
    const p = products[i];
    if (!p.product_id) { setProducts((prev) => prev.filter((_, j) => j !== i)); return; }
    const { error: e } = await supabase.rpc("eq_archive_pricing_product", { p_product_id: p.product_id, p_archived: true });
    if (e) { captureRpcError("eq_archive_pricing_product", e); setError(e.message); return; }
    await loadProducts();
    flash("Product archived.");
  };

  // ── Bands ────────────────────────────────────────────────────────────────────
  const updBand = (i: number, field: keyof BandDraft, value: string) =>
    setBands((prev) => prev.map((b, j) => (j === i ? { ...b, [field]: value } : b)));
  const addBand = () => setBands((prev) => [...prev, { min_qty: "", max_qty: "", factor: "1.00" }]);
  const removeBand = (i: number) => setBands((prev) => prev.filter((_, j) => j !== i));

  const saveBands = async () => {
    if (!supabase) return;
    setBandsSaving(true);
    setError(null);
    const payload = bands
      .filter((b) => b.min_qty.trim() !== "")
      .map((b, idx) => ({
        min_qty: parseInt(b.min_qty, 10) || 0,
        max_qty: b.max_qty.trim() === "" ? null : parseInt(b.max_qty, 10),
        factor: num(b.factor),
        sort_order: (idx + 1) * 10,
      }));
    const { error: e } = await supabase.rpc("eq_replace_pricing_bands", { p_category: "outlets", p_bands: payload });
    setBandsSaving(false);
    if (e) { captureRpcError("eq_replace_pricing_bands", e); setError(e.message); return; }
    await loadBands();
    flash("Volume bands saved.");
  };

  // ── Templates ────────────────────────────────────────────────────────────────
  const updTemplate = (i: number, field: keyof TemplateDraft, value: string) =>
    setTemplates((prev) => prev.map((t, j) => (j === i ? { ...t, [field]: value } : t)));

  const addTemplate = (type: "scope" | "clarification") =>
    setTemplates((prev) => [...prev, {
      template_id: null, template_type: type, name: "", body: "", sort_order: (prev.length + 1) * 10,
    }]);

  const saveTemplate = async (i: number) => {
    if (!supabase) return;
    const t = templates[i];
    if (!t.name.trim() || !t.body.trim()) { setError("Template needs a name and body."); return; }
    setError(null);
    const { error: e } = await supabase.rpc("eq_upsert_quote_template", {
      p_template_id: t.template_id,
      p_template_type: t.template_type,
      p_name: t.name.trim(),
      p_body: t.body.trim(),
      p_sort_order: t.sort_order,
    });
    if (e) { captureRpcError("eq_upsert_quote_template", e); setError(e.message); return; }
    await loadTemplates();
    flash("Template saved.");
  };

  const archiveTemplate = async (i: number) => {
    if (!supabase) return;
    const t = templates[i];
    if (!t.template_id) { setTemplates((prev) => prev.filter((_, j) => j !== i)); return; }
    const { error: e } = await supabase.rpc("eq_archive_quote_template", { p_template_id: t.template_id, p_archived: true });
    if (e) { captureRpcError("eq_archive_quote_template", e); setError(e.message); return; }
    await loadTemplates();
    flash("Template archived.");
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const TABS: { key: SetupTab; label: string }[] = [
    { key: "config", label: "Pricing" },
    { key: "materials", label: "Materials" },
    { key: "products", label: "Products" },
    { key: "bands", label: "Volume bands" },
    { key: "templates", label: "Templates" },
  ];

  return (
    <div className="eq-quotes__setup">
      <div className="eq-quotes__view-tabs" style={{ marginBottom: "1rem" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`eq-quotes__view-tab${tab === t.key ? " eq-quotes__view-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="eq-quotes__error-banner">{error}</div>}
      {savedMsg && <div className="eq-quotes__info-val" style={{ color: "var(--eq-sky, #2986B4)", marginBottom: "0.5rem" }}>{savedMsg}</div>}

      {/* Pricing config */}
      {tab === "config" && (
        <div className="eq-quotes__detail-card">
          <div className="eq-quotes__section-title">Outlet pricing settings</div>
          <div className="eq-quotes__info-grid">
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Material markup (×)</label>
              <input className="eq-quotes__input" value={config.material_markup}
                onChange={(e) => setConfig({ ...config, material_markup: e.target.value })} />
            </div>
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Labour rate — normal ($/hr)</label>
              <input className="eq-quotes__input" value={config.labour_normal_rate}
                onChange={(e) => setConfig({ ...config, labour_normal_rate: e.target.value })} />
            </div>
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Labour rate — supervisor ($/hr)</label>
              <input className="eq-quotes__input" value={config.labour_supervisor_rate}
                onChange={(e) => setConfig({ ...config, labour_supervisor_rate: e.target.value })} />
            </div>
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Removal — base ($)</label>
              <input className="eq-quotes__input" value={config.removal_base}
                onChange={(e) => setConfig({ ...config, removal_base: e.target.value })} />
            </div>
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Removal — per extra pair ($)</label>
              <input className="eq-quotes__input" value={config.removal_increment}
                onChange={(e) => setConfig({ ...config, removal_increment: e.target.value })} />
            </div>
            <div className="eq-quotes__info-item">
              <label className="eq-quotes__info-label">Removal markup (×)</label>
              <input className="eq-quotes__input" value={config.removal_markup}
                onChange={(e) => setConfig({ ...config, removal_markup: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" disabled={configSaving} onClick={() => void saveConfig()}>
              {configSaving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}

      {/* Materials */}
      {tab === "materials" && (
        <div className="eq-quotes__detail-card">
          <div className="eq-quotes__section-title">Materials</div>
          <div className="eq-quotes__table-wrap">
            <table className="eq-quotes__table">
              <thead>
                <tr>
                  <th>Part no.</th><th>Description</th><th>Unit</th>
                  <th className="eq-quotes__th--right">Unit cost ($)</th><th></th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr className="eq-quotes__row" key={m.material_id ?? `new-${i}`}>
                    <td><input className="eq-quotes__input" value={m.part_no} onChange={(e) => updMaterial(i, "part_no", e.target.value)} /></td>
                    <td><input className="eq-quotes__input" value={m.description} onChange={(e) => updMaterial(i, "description", e.target.value)} /></td>
                    <td><input className="eq-quotes__input eq-quotes__input--sm" value={m.unit} onChange={(e) => updMaterial(i, "unit", e.target.value)} /></td>
                    <td className="eq-quotes__td--right"><input className="eq-quotes__input eq-quotes__input--sm" value={m.unit_cost} onChange={(e) => updMaterial(i, "unit_cost", e.target.value)} /></td>
                    <td className="eq-quotes__td--right">
                      <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" onClick={() => void saveMaterial(i)}>Save</button>{" "}
                      <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => void archiveMaterial(i)}>{m.material_id ? "Archive" : "Remove"}</button>
                    </td>
                  </tr>
                ))}
                {materials.length === 0 && <tr><td colSpan={5} className="eq-quotes__muted">No materials yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={addMaterial}>+ Add material</button>
          </div>
        </div>
      )}

      {/* Products */}
      {tab === "products" && (
        <div className="eq-quotes__detail-card">
          <div className="eq-quotes__section-title">Outlet products</div>
          {products.map((p, i) => (
            <div className="eq-quotes__detail-card" key={p.product_id ?? `new-${i}`} style={{ marginBottom: "0.75rem" }}>
              <div className="eq-quotes__info-grid">
                <div className="eq-quotes__info-item eq-quotes__info-item--full">
                  <label className="eq-quotes__info-label">Name</label>
                  <input className="eq-quotes__input" value={p.name} onChange={(e) => updProduct(i, "name", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Brand</label>
                  <input className="eq-quotes__input" value={p.brand} onChange={(e) => updProduct(i, "brand", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Phase</label>
                  <input className="eq-quotes__input" value={p.phase} onChange={(e) => updProduct(i, "phase", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Plug type</label>
                  <input className="eq-quotes__input" value={p.plug_type} onChange={(e) => updProduct(i, "plug_type", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Cable material</label>
                  <select className="eq-quotes__select" value={p.cable_material_id} onChange={(e) => updProduct(i, "cable_material_id", e.target.value)}>
                    <option value="">—</option>
                    {materials.map((m) => <option key={m.material_id} value={m.material_id ?? ""}>{m.part_no} — {m.description}</option>)}
                  </select>
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Cable qty</label>
                  <input className="eq-quotes__input eq-quotes__input--sm" value={p.cable_qty} onChange={(e) => updProduct(i, "cable_qty", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Outlet material</label>
                  <select className="eq-quotes__select" value={p.outlet_material_id} onChange={(e) => updProduct(i, "outlet_material_id", e.target.value)}>
                    <option value="">—</option>
                    {materials.map((m) => <option key={m.material_id} value={m.material_id ?? ""}>{m.part_no} — {m.description}</option>)}
                  </select>
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Outlet qty</label>
                  <input className="eq-quotes__input eq-quotes__input--sm" value={p.outlet_qty} onChange={(e) => updProduct(i, "outlet_qty", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Breaker material</label>
                  <select className="eq-quotes__select" value={p.breaker_material_id} onChange={(e) => updProduct(i, "breaker_material_id", e.target.value)}>
                    <option value="">—</option>
                    {materials.map((m) => <option key={m.material_id} value={m.material_id ?? ""}>{m.part_no} — {m.description}</option>)}
                  </select>
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Breaker qty</label>
                  <input className="eq-quotes__input eq-quotes__input--sm" value={p.breaker_qty} onChange={(e) => updProduct(i, "breaker_qty", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Install hours</label>
                  <input className="eq-quotes__input eq-quotes__input--sm" value={p.install_hours} onChange={(e) => updProduct(i, "install_hours", e.target.value)} />
                </div>
                <div className="eq-quotes__info-item">
                  <label className="eq-quotes__info-label">Mgmt hours</label>
                  <input className="eq-quotes__input eq-quotes__input--sm" value={p.mgmt_hours} onChange={(e) => updProduct(i, "mgmt_hours", e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" onClick={() => void saveProduct(i)}>Save</button>{" "}
                <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => void archiveProduct(i)}>{p.product_id ? "Archive" : "Remove"}</button>
              </div>
            </div>
          ))}
          {products.length === 0 && <p className="eq-quotes__muted">No products yet.</p>}
          <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={addProduct}>+ Add product</button>
        </div>
      )}

      {/* Volume bands */}
      {tab === "bands" && (
        <div className="eq-quotes__detail-card">
          <div className="eq-quotes__section-title">Volume discount bands (outlets)</div>
          <p className="eq-quotes__muted">Factor 1.00 = full price, 0.90 = 10% off. Leave the top band&apos;s &ldquo;to&rdquo; blank for &ldquo;and up&rdquo;.</p>
          <div className="eq-quotes__table-wrap">
            <table className="eq-quotes__table">
              <thead>
                <tr><th>From (pairs)</th><th>To (pairs)</th><th className="eq-quotes__th--right">Factor (×)</th><th></th></tr>
              </thead>
              <tbody>
                {bands.map((b, i) => (
                  <tr className="eq-quotes__row" key={i}>
                    <td><input className="eq-quotes__input eq-quotes__input--sm" value={b.min_qty} onChange={(e) => updBand(i, "min_qty", e.target.value)} /></td>
                    <td><input className="eq-quotes__input eq-quotes__input--sm" value={b.max_qty} placeholder="and up" onChange={(e) => updBand(i, "max_qty", e.target.value)} /></td>
                    <td className="eq-quotes__td--right"><input className="eq-quotes__input eq-quotes__input--sm" value={b.factor} onChange={(e) => updBand(i, "factor", e.target.value)} /></td>
                    <td className="eq-quotes__td--right"><button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => removeBand(i)}>Remove</button></td>
                  </tr>
                ))}
                {bands.length === 0 && <tr><td colSpan={4} className="eq-quotes__muted">No bands.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={addBand}>+ Add band</button>{" "}
            <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" disabled={bandsSaving} onClick={() => void saveBands()}>{bandsSaving ? "Saving…" : "Save bands"}</button>
          </div>
        </div>
      )}

      {/* Templates */}
      {tab === "templates" && (
        <div className="eq-quotes__detail-card">
          <div className="eq-quotes__section-title">Scope &amp; clarification templates</div>
          {templates.map((t, i) => (
            <div className="eq-quotes__detail-card" key={t.template_id ?? `new-${i}`} style={{ marginBottom: "0.75rem" }}>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <label className="eq-quotes__info-label">{t.template_type === "scope" ? "Scope of works" : "Clarification"} — name</label>
                <input className="eq-quotes__input" value={t.name} onChange={(e) => updTemplate(i, "name", e.target.value)} />
              </div>
              <div className="eq-quotes__info-item eq-quotes__info-item--full">
                <label className="eq-quotes__info-label">Body</label>
                <textarea className="eq-quotes__textarea" rows={3} value={t.body} onChange={(e) => updTemplate(i, "body", e.target.value)} />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <button type="button" className="eq-quotes__btn eq-quotes__btn--primary" onClick={() => void saveTemplate(i)}>Save</button>{" "}
                <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => void archiveTemplate(i)}>{t.template_id ? "Archive" : "Remove"}</button>
              </div>
            </div>
          ))}
          {templates.length === 0 && <p className="eq-quotes__muted">No templates yet.</p>}
          <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => addTemplate("scope")}>+ Add scope</button>{" "}
          <button type="button" className="eq-quotes__btn eq-quotes__btn--outline" onClick={() => addTemplate("clarification")}>+ Add clarification</button>
        </div>
      )}
    </div>
  );
}
