// Legal pages: storefront /terms + /privacy and the admin form (ตั้งค่า › ข้อกำหนดและนโยบาย).
// Text comes from server/legal.mjs as plain-text blocks and is rendered as React text
// nodes only, so nothing an admin types can become HTML.
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { ErrorMessage, Link, useStore } from "./App";
import { t } from "./i18n";
import { shopName } from "./Theme";
import {
  DEFAULT_FIELD_VALUES,
  EXTRA_PLACEHOLDERS,
  LEGAL_DOCS,
  LEGAL_FIELDS,
  LEGAL_KINDS,
  MAX_SECTION_BODY,
  MAX_SECTION_TITLE,
  MAX_SECTIONS,
  fieldValue,
  legalSections,
  renderLegalDocument,
  storedSections,
  type LegalKind,
  type LegalSettings,
  type RenderedLegal,
} from "../server/legal.mjs";
import "./legal.css";

type LegalData = { legal: LegalSettings | null; policy: string };

function useLegalData() {
  const [data, setData] = useState<LegalData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    try {
      setData(await api<LegalData>("/legal"));
      setFailed(false);
    } catch {
      setFailed(true);
      setData((current) => current ?? { legal: null, policy: "" });
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return { data, failed, reload: load };
}

const website = () => (typeof location === "undefined" ? "" : location.host);

function scrollToSection(e: MouseEvent<HTMLAnchorElement>, id: string, updateHash: boolean) {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (updateHash) history.replaceState(history.state, "", "#" + id);
}

/** One rendered document: effective date, table of contents and numbered sections. */
export function LegalDocumentView({
  doc,
  prefix,
  updateHash = false,
}: {
  doc: RenderedLegal;
  prefix: string;
  updateHash?: boolean;
}) {
  return (
    <article className="legal-doc">
      {doc.sections.length > 1 && (
        <nav className="legal-toc" aria-label={t("สารบัญ")}>
          <h2>{t("สารบัญ")}</h2>
          <ol>
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={"#" + prefix + s.id}
                  onClick={(e) => scrollToSection(e, prefix + s.id, updateHash)}
                >
                  <span className="legal-toc-no">{s.number}.</span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {doc.sections.map((s) => (
        <section className="legal-section" id={prefix + s.id} key={s.id}>
          <h2>
            <span className="legal-section-no">{s.number}.</span>
            <span>{s.title}</span>
          </h2>
          {s.blocks.map((block, i) =>
            block.type === "ul" ? (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{block.text}</p>
            ),
          )}
        </section>
      ))}
    </article>
  );
}

/** Storefront /terms and /privacy. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { overview } = useStore();
  const { data } = useLegalData();
  const name = shopName(overview?.shop?.shopName);
  const doc = useMemo(
    () =>
      data
        ? renderLegalDocument(
            kind,
            data.legal,
            { ...overview?.shop, policy: data.policy },
            { website: website() },
          )
        : null,
    [data, kind, overview?.shop],
  );
  // Deep links (/privacy#legal-privacy-cookies) once the text is on the page.
  useEffect(() => {
    if (!doc || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [!!doc]);
  const other: LegalKind = kind === "terms" ? "privacy" : "terms";
  return (
    <main className="container page-main narrow-main reference-info-page legal-page">
      <div className="page-heading">
        <span className="eyebrow">{name}</span>
        <h1>{t(LEGAL_DOCS[kind].title)}</h1>
        <p className="legal-effective">
          {doc?.effectiveDate
            ? t("มีผลบังคับใช้ตั้งแต่") + " " + doc.effectiveDate
            : t("ข้อมูลสำหรับการใช้งานเว็บไซต์")}
        </p>
      </div>
      <div className="panel prose legal-panel">
        {doc ? (
          <LegalDocumentView doc={doc} prefix={"legal-" + kind + "-"} updateHash />
        ) : (
          <div className="loading-row">
            <LoaderCircle className="spin" size={18} />
            {t("กำลังโหลด")}
          </div>
        )}
      </div>
      <p className="legal-other">
        {t("อ่านเพิ่มเติม")}{" "}
        <Link to={LEGAL_DOCS[other].path}>{t(LEGAL_DOCS[other].title)}</Link>
      </p>
    </main>
  );
}

// ------------------------------------------------------------------ admin

type Draft = { key: string; id: string; title: string; body: string; custom: boolean };
type Docs = Record<LegalKind, Draft[]>;
let draftSeq = 0;
const draftKey = () => "d" + ++draftSeq;
const customId = () =>
  "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function draftsFrom(data: LegalData): Docs {
  const docs = {} as Docs;
  for (const kind of LEGAL_KINDS)
    docs[kind] = legalSections(kind, data.legal, data.policy).map((s) => ({
      ...s,
      key: draftKey(),
    }));
  return docs;
}
function fieldsFrom(data: LegalData) {
  return Object.fromEntries(
    LEGAL_FIELDS.map((f) => [f.key, fieldValue(data.legal, f.key)]),
  ) as Record<string, string>;
}
/** What POST /api/admin/settings receives as `legal`. Defaults stay implicit. */
function payload(fields: Record<string, string>, docs: Docs) {
  const legal: LegalSettings = {};
  for (const f of LEGAL_FIELDS) {
    const value = fields[f.key] ?? "";
    if (DEFAULT_FIELD_VALUES[f.key] !== undefined && value === DEFAULT_FIELD_VALUES[f.key]) continue;
    legal[f.key] = value;
  }
  for (const kind of LEGAL_KINDS) legal[kind] = storedSections(kind, docs[kind]);
  return legal;
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const FIELD_HINTS: Record<string, string> = {
  entityName: "ชื่อบุคคลธรรมดาหรือนิติบุคคลที่เป็นเจ้าของร้าน",
  address: "ใช้ในหัวข้อติดต่อและผู้ควบคุมข้อมูลส่วนบุคคล",
  taxId: "ไม่บังคับ เว้นว่างเพื่อซ่อนบรรทัดนี้",
  dpo: "ชื่อหรือตำแหน่งผู้รับเรื่องด้านข้อมูลส่วนบุคคล เช่น ฝ่ายบริการลูกค้า",
  refundPolicy: "ขึ้นบรรทัดด้วย - เพื่อทำเป็นข้อ ๆ",
  warrantyPolicy: "แสดงในหัวข้อการรับประกัน ระยะเวลาประกันของแต่ละตัวเลือกตั้งที่หน้าสินค้า",
  governingLaw: "เช่น ราชอาณาจักรไทย",
};

export function LegalSettings() {
  const { overview, toast } = useStore();
  const shop = overview?.shop;
  const { data, failed, reload } = useLegalData();
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [docs, setDocs] = useState<Docs | null>(null);
  const [kind, setKind] = useState<LegalKind>("terms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedSignature, setSavedSignature] = useState("");
  useEffect(() => {
    if (!data) return;
    const nextFields = fieldsFrom(data);
    const nextDocs = draftsFrom(data);
    setFields(nextFields);
    setDocs(nextDocs);
    setSavedSignature(JSON.stringify(payload(nextFields, nextDocs)));
  }, [data]);
  const signature = fields && docs ? JSON.stringify(payload(fields, docs)) : "";
  const dirty = !!signature && signature !== savedSignature;
  const preview = useMemo(() => {
    if (!fields || !docs) return null;
    return renderLegalDocument(kind, fields, { ...shop, policy: data?.policy }, {
      website: website(),
      sections: docs[kind],
    });
  }, [fields, docs, kind, shop, data?.policy]);

  if (!fields || !docs || !preview)
    return (
      <div className="legal-admin-loading">
        <LoaderCircle className="spin" size={18} />
        กำลังโหลดข้อกำหนดและนโยบาย
      </div>
    );

  const sections = docs[kind];
  const defaults = LEGAL_DOCS[kind].defaults;
  const removed = defaults.filter((d) => !sections.some((s) => s.id === d.id));
  const setField = (key: string, value: string) => setFields({ ...fields, [key]: value });
  const setSections = (next: Draft[]) => setDocs({ ...docs, [kind]: next });
  const update = (key: string, patch: Partial<Draft>) =>
    setSections(sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, by: number) => {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setSections(next);
  };
  async function save() {
    setError("");
    const empty = LEGAL_KINDS.flatMap((k) =>
      docs![k].filter((s) => !s.title.trim() || !s.body.trim()).map(() => k),
    );
    if (empty.length) {
      setKind(empty[0]);
      setError("ทุกหัวข้อต้องมีชื่อหัวข้อและเนื้อหา");
      return;
    }
    setBusy(true);
    try {
      await api("/admin/settings", { legal: payload(fields!, docs!) });
      toast("บันทึกข้อกำหนดและนโยบายแล้ว");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    if (!data) return;
    setFields(fieldsFrom(data));
    setDocs(draftsFrom(data));
    setError("");
  }
  const fallbackOf = (key: string) => {
    const field = LEGAL_FIELDS.find((f) => f.key === key);
    if (!field?.fallback) return "";
    return field.fallback === "shopName"
      ? shopName(shop?.shopName)
      : String(shop?.[field.fallback as "email" | "phone" | "line"] ?? "");
  };

  return (
    <div className="legal-admin">
      <div className="reference-admin-heading">
        <div>
          <h1>ข้อกำหนดและนโยบาย</h1>
          <p>
            กรอกข้อมูลร้านด้านล่าง ระบบจะเติมลงในข้อกำหนดการใช้บริการและนโยบายความเป็นส่วนตัวให้เอง
            แก้ไขแต่ละหัวข้อได้ และดูผลได้ทันทีในตัวอย่าง
          </p>
        </div>
      </div>
      {failed && (
        <ErrorMessage message="โหลดข้อความที่บันทึกไว้ไม่ได้ กำลังแสดงข้อความเริ่มต้น" />
      )}
      <div className="legal-admin-grid">
        <div className="legal-admin-form">
          <section className="reference-admin-card editor-panel">
            <h2>ข้อมูลผู้ประกอบการ</h2>
            <p>ใช้แทนตัวแปร เช่น {"{{entityName}}"} และ {"{{email}}"} ในเนื้อหา ช่องที่เว้นว่างจะใช้ข้อมูลร้านแทน (ถ้ามี)</p>
            <MissingChips missing={preview.missing} />
            <div className="legal-field-grid">
              {LEGAL_FIELDS.map((f) => {
                const value = fields[f.key] ?? "";
                const fallback = fallbackOf(f.key);
                const resetable =
                  DEFAULT_FIELD_VALUES[f.key] !== undefined && value !== DEFAULT_FIELD_VALUES[f.key];
                const wide = f.multiline || f.key === "entityName" || f.key === "dpo";
                return (
                  <label className={"field" + (wide ? " legal-field-wide" : "")} key={f.key}>
                    <span className="legal-field-label">
                      {f.label}
                      {f.optional && <small>ไม่บังคับ</small>}
                      {resetable && (
                        <button
                          type="button"
                          className="legal-link-button"
                          onClick={(e) => {
                            e.preventDefault();
                            setField(f.key, DEFAULT_FIELD_VALUES[f.key]);
                          }}
                        >
                          <RotateCcw size={12} />
                          ใช้ข้อความเริ่มต้น
                        </button>
                      )}
                    </span>
                    {f.multiline ? (
                      <textarea
                        name={f.key}
                        value={value}
                        maxLength={f.max}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    ) : f.key === "effectiveDate" ? (
                      <span className="legal-date-row">
                        <input
                          name={f.key}
                          type="date"
                          value={value}
                          onChange={(e) => setField(f.key, e.target.value)}
                        />
                        <button
                          type="button"
                          className="button secondary"
                          onClick={(e) => {
                            e.preventDefault();
                            setField(f.key, today());
                          }}
                        >
                          วันนี้
                        </button>
                      </span>
                    ) : (
                      <input
                        name={f.key}
                        type={f.key === "email" ? "email" : f.key === "phone" ? "tel" : "text"}
                        value={value}
                        maxLength={f.max}
                        placeholder={fallback ? "ใช้ข้อมูลร้าน: " + fallback : ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    )}
                    {FIELD_HINTS[f.key] && <small className="legal-hint">{FIELD_HINTS[f.key]}</small>}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="reference-admin-card editor-panel">
            <div className="legal-doc-heading">
              <div>
                <h2>เนื้อหาแต่ละหัวข้อ</h2>
                <p>ขึ้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่ ขึ้นต้นบรรทัดด้วย - เพื่อทำเป็นข้อ ๆ</p>
              </div>
              <DocSwitch kind={kind} setKind={setKind} />
            </div>
            <details className="legal-vars">
              <summary>ตัวแปรที่ใช้ในเนื้อหาได้</summary>
              <ul>
                {[...EXTRA_PLACEHOLDERS, ...LEGAL_FIELDS].map((p) => (
                  <li key={p.key}>
                    <code>{"{{" + p.key + "}}"}</code>
                    <span>{p.label}</span>
                  </li>
                ))}
              </ul>
              <p>บรรทัดที่ใช้ตัวแปรซึ่งยังไม่ได้กรอกจะถูกซ่อนจากหน้าร้าน</p>
            </details>
            <ol className="legal-section-list">
              {sections.map((s, i) => {
                const original = defaults.find((d) => d.id === s.id);
                const modified = !!original && (original.title !== s.title || original.body !== s.body);
                return (
                  <li className="legal-section-card" key={s.key}>
                    <div className="legal-section-head">
                      <span className="legal-section-index">{i + 1}</span>
                      <input
                        aria-label={`ชื่อหัวข้อที่ ${i + 1}`}
                        value={s.title}
                        maxLength={MAX_SECTION_TITLE}
                        onChange={(e) => update(s.key, { title: e.target.value })}
                      />
                      {original ? (
                        modified && <span className="legal-badge">แก้ไขแล้ว</span>
                      ) : (
                        <span className="legal-badge custom">เพิ่มเอง</span>
                      )}
                    </div>
                    <textarea
                      aria-label={`เนื้อหาหัวข้อที่ ${i + 1}`}
                      value={s.body}
                      maxLength={MAX_SECTION_BODY}
                      onChange={(e) => update(s.key, { body: e.target.value })}
                    />
                    <div className="legal-section-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`เลื่อนหัวข้อที่ ${i + 1} ขึ้น`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`เลื่อนหัวข้อที่ ${i + 1} ลง`}
                        disabled={i === sections.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      {modified && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => update(s.key, { title: original!.title, body: original!.body })}
                        >
                          <RotateCcw size={14} />
                          คืนค่าเริ่มต้น
                        </button>
                      )}
                      <button
                        type="button"
                        className="button secondary small legal-remove"
                        aria-label={`ลบหัวข้อที่ ${i + 1}`}
                        onClick={() => setSections(sections.filter((x) => x.key !== s.key))}
                      >
                        <Trash2 size={14} />
                        ลบ
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="legal-add-row">
              <button
                type="button"
                className="button secondary"
                disabled={sections.length >= MAX_SECTIONS}
                onClick={() =>
                  setSections([
                    ...sections,
                    { key: draftKey(), id: customId(), title: "หัวข้อใหม่", body: "", custom: true },
                  ])
                }
              >
                <Plus size={16} />
                เพิ่มหัวข้อ
              </button>
              {removed.length > 0 && (
                <label className="legal-restore">
                  <span>นำหัวข้อมาตรฐานกลับมา</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const d = defaults.find((x) => x.id === e.target.value);
                      if (!d) return;
                      // Put it back near its original position.
                      const order = defaults.map((x) => x.id);
                      const at = sections.findIndex(
                        (x) => order.indexOf(x.id) > order.indexOf(d.id),
                      );
                      const next = [...sections];
                      next.splice(at < 0 ? next.length : at, 0, { ...d, key: draftKey(), custom: false });
                      setSections(next);
                    }}
                  >
                    <option value="">เลือกหัวข้อ…</option>
                    {removed.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
          <ErrorMessage message={error} />
          <div className={"editor-save-bar legal-save-bar" + (dirty ? " is-dirty" : "")}>
            <span className={dirty ? "unsaved-dot" : ""}>
              {dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : "ตรงกับหน้าร้าน"}
            </span>
            <button type="button" className="button secondary" disabled={!dirty || busy} onClick={discard}>
              ยกเลิก
            </button>
            <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
              {busy && <LoaderCircle className="spin" size={16} />}
              บันทึกข้อกำหนดและนโยบาย
            </button>
          </div>
        </div>

        <aside className="legal-preview" aria-label="ตัวอย่างหน้าร้าน">
          <div className="legal-preview-bar">
            <strong>ตัวอย่าง</strong>
            <DocSwitch kind={kind} setKind={setKind} />
            <a href={LEGAL_DOCS[kind].path} target="_blank" rel="noreferrer" className="legal-open">
              เปิดหน้าจริง
              <ExternalLink size={13} />
            </a>
          </div>
          <div className="legal-preview-body">
            <h3 className="legal-preview-title">{preview.title}</h3>
            <p className="legal-preview-date">
              {preview.effectiveDate
                ? "มีผลบังคับใช้ตั้งแต่ " + preview.effectiveDate
                : "ยังไม่ได้ระบุวันที่มีผลบังคับใช้"}
            </p>
            <LegalDocumentView doc={preview} prefix="legal-preview-" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function DocSwitch({ kind, setKind }: { kind: LegalKind; setKind: (k: LegalKind) => void }) {
  return (
    <div className="segmented-control" role="group" aria-label="เอกสาร">
      {LEGAL_KINDS.map((k) => (
        <button
          type="button"
          key={k}
          className={kind === k ? "active" : ""}
          aria-pressed={kind === k}
          onClick={() => setKind(k)}
        >
          {LEGAL_DOCS[k].title}
        </button>
      ))}
    </div>
  );
}

function MissingChips({ missing }: { missing: { key: string; label: string }[] }) {
  if (!missing.length)
    return (
      <p className="legal-complete">
        <CheckCircle2 size={15} />
        กรอกข้อมูลที่จำเป็นครบแล้ว
      </p>
    );
  return (
    <div className="legal-missing" role="status">
      <span>
        <AlertTriangle size={15} />
        ยังไม่ได้กรอก
      </span>
      {missing.map((m) => (
        <span className="legal-chip" key={m.key}>
          {m.label}
        </span>
      ))}
      <small>บรรทัดที่ใช้ข้อมูลเหล่านี้จะยังไม่แสดงบนหน้าร้าน</small>
    </div>
  );
}
