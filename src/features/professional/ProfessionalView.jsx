import React, { useState, useEffect, useCallback } from "react";
import { Stethoscope, Dumbbell, Apple, Mail, UserPlus, Check, RefreshCw, X, Inbox } from "lucide-react";
import { ProBadge } from "../../components/ui.jsx";
import {
  fetchProfessionalLinks,
  inviteClient,
  respondProfessionalLink,
  removeProfessionalLink,
  fetchPrescriptions,
  respondPrescription,
  fetchClientAdherence,
} from "../../lib/professionalLinks.js";

const uid = () => Math.random().toString(36).slice(2, 10);

const LINK_TYPE_LABEL = {
  personal: "Personal treinador",
  nutricionista: "Nutricionista",
};

const LINK_TYPE_ICON = {
  personal: Dumbbell,
  nutricionista: Apple,
};

const KIND_LABEL = { workout: "Treino", diet: "Dieta" };

export default function ProfessionalView({ session, profile, setProfile, isPro, onUpgrade, saveWorkoutTemplate }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescriptionsLoading, setPrescriptionsLoading] = useState(true);
  const [prescriptionBusyId, setPrescriptionBusyId] = useState(null);
  const [adherence, setAdherence] = useState({});
  const [email, setEmail] = useState("");
  const [registration, setRegistration] = useState("");

  const roles = profile?.professionalRoles || [];
  const [linkType, setLinkType] = useState(roles[0] || "personal");

  useEffect(() => {
    if (roles.length && !roles.includes(linkType)) setLinkType(roles[0]);
  }, [roles, linkType]);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      setLinks((await fetchProfessionalLinks(session)) || []);
      setNotice(null);
    } catch (e) {
      setNotice({ type: "error", text: "Não foi possível carregar seus vínculos. Verifique se o SQL de Personal/Nutricionista foi executado no Supabase." });
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const studentLinks = links.filter((l) => l.status === "accepted" && l.direction === "as_professional" && l.link_type === "personal");
    if (!studentLinks.length) return;
    let active = true;
    Promise.all(studentLinks.map((l) =>
      fetchClientAdherence(session, l.link_id).then((data) => [l.link_id, data]).catch(() => [l.link_id, null])
    )).then((entries) => {
      if (!active) return;
      setAdherence((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { active = false; };
  }, [links, session]);

  const loadPrescriptions = useCallback(async () => {
    if (!session?.user?.id) return;
    setPrescriptionsLoading(true);
    try { setPrescriptions((await fetchPrescriptions(session)) || []); }
    catch (_) { setPrescriptions([]); }
    finally { setPrescriptionsLoading(false); }
  }, [session]);
  useEffect(() => { loadPrescriptions(); }, [loadPrescriptions]);

  const applyPrescription = async (prescription) => {
    setPrescriptionBusyId(prescription.prescription_id);
    try {
      if (prescription.kind === "workout") {
        const template = prescription.payload || {};
        const saved = saveWorkoutTemplate({
          ...template,
          id: uid(),
          exercises: (template.exercises || []).map((exercise) => ({ ...exercise, id: uid() })),
          receivedAt: new Date().toISOString().slice(0, 10),
        });
        if (saved === false) return;
      } else if (prescription.kind === "diet") {
        const items = Array.isArray(prescription.payload) ? prescription.payload : [prescription.payload];
        setProfile((prev) => ({
          ...prev,
          dietSavedMeals: [
            ...items.filter(Boolean).map((template) => ({ ...template, id: uid() })),
            ...(prev?.dietSavedMeals || []),
          ],
        }));
      }
      await respondPrescription(session, prescription.prescription_id, "applied");
      await loadPrescriptions();
    } finally {
      setPrescriptionBusyId(null);
    }
  };

  const dismissPrescription = async (prescription) => {
    setPrescriptionBusyId(prescription.prescription_id);
    try { await respondPrescription(session, prescription.prescription_id, "dismissed"); await loadPrescriptions(); }
    finally { setPrescriptionBusyId(null); }
  };

  const toggleRole = (role) => {
    const current = new Set(profile?.professionalRoles || []);
    if (current.has(role)) current.delete(role); else current.add(role);
    setProfile((prev) => ({ ...prev, professionalRoles: [...current] }));
  };

  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (!isPro) { onUpgrade("professional"); return; }
    setActionLoading(true);
    setNotice(null);
    try {
      await inviteClient(session, email, linkType, registration);
      setEmail("");
      setRegistration("");
      setNotice({ type: "ok", text: "Convite enviado. Quando a pessoa aceitar, você poderá enviar treinos/dietas para ela." });
      await load();
    } catch (err) {
      const raw = (err.message || "").toLowerCase();
      const text = raw.includes("pro_required")
        ? "É preciso ser PRO para convidar alunos/pacientes."
        : raw.includes("not found")
          ? "Nenhum usuário cadastrado com esse e-mail."
          : raw.includes("yourself")
            ? "Você não pode convidar sua própria conta."
            : raw.includes("already exists")
              ? "Já existe um convite ou vínculo desse tipo com esse usuário."
              : "Não foi possível enviar o convite.";
      setNotice({ type: "error", text });
    } finally {
      setActionLoading(false);
    }
  };

  const respond = async (linkId, accept) => {
    setActionLoading(true);
    try { await respondProfessionalLink(session, linkId, accept); await load(); }
    finally { setActionLoading(false); }
  };

  const remove = async (linkId) => {
    if (!window.confirm("Remover este vínculo?")) return;
    setActionLoading(true);
    try { await removeProfessionalLink(session, linkId); await load(); }
    finally { setActionLoading(false); }
  };

  const pendingPrescriptions = prescriptions.filter((p) => p.status === "sent");

  const receivedInvites = links.filter((l) => l.status === "pending" && l.direction === "as_client");
  const sentInvites = links.filter((l) => l.status === "pending" && l.direction === "as_professional");
  const myClients = links.filter((l) => l.status === "accepted" && l.direction === "as_professional");
  const myProfessionals = links.filter((l) => l.status === "accepted" && l.direction === "as_client");

  const Avatar = ({ r, size = "w-11 h-11" }) =>
    r.avatar_data_url
      ? <img src={r.avatar_data_url} className={`${size} rounded-full object-cover border hairline`} alt="" />
      : <div className={`${size} rounded-full flex items-center justify-center font-display`} style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>{(r.display_name || r.email || "?")[0]?.toUpperCase()}</div>;

  const LinkRow = ({ r, action, meta }) => {
    const Icon = LINK_TYPE_ICON[r.link_type] || Stethoscope;
    return (
      <div className="surface-2 p-3 flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar r={r} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{r.display_name || "Usuário"}</p>
              <p className="text-faint text-xs truncate">{r.email}</p>
            </div>
            <span className="chip flex items-center gap-1"><Icon size={11} />{LINK_TYPE_LABEL[r.link_type] || r.link_type}</span>
          </div>
          {action}
        </div>
        {meta}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Personal & Nutricionista</h2>
          <p className="text-dim text-xs mt-1">Prescreva treinos e dietas para seus alunos e pacientes, ou receba de quem te acompanha.</p>
        </div>
        <Stethoscope size={22} className="text-brass" />
      </div>

      {!prescriptionsLoading && pendingPrescriptions.length > 0 && (
        <div className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Inbox size={15} className="text-brass" />
            <p className="text-xs text-faint uppercase tracking-widest">Prescrições recebidas</p>
            <span className="chip">{pendingPrescriptions.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {pendingPrescriptions.map((p) => (
              <div key={p.prescription_id} className="surface-2 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{KIND_LABEL[p.kind] || p.kind}: {p.payload?.name || "Sem nome"}</p>
                    <p className="text-faint text-xs truncate">Enviado por {p.professional_name || p.professional_email}</p>
                  </div>
                  <span className="chip">{p.kind === "workout" ? <Dumbbell size={11} /> : <Apple size={11} />}</span>
                </div>
                {p.note && <p className="text-dim text-xs surface rounded-lg p-2">"{p.note}"</p>}
                <div className="flex gap-2">
                  <button
                    disabled={prescriptionBusyId === p.prescription_id}
                    className="btn-primary rounded-lg px-3 py-2 text-xs flex-1"
                    onClick={() => applyPrescription(p)}
                  >
                    <Check size={13} className="inline mr-1" />
                    {prescriptionBusyId === p.prescription_id ? "Aplicando…" : "Adicionar à minha conta"}
                  </button>
                  <button
                    disabled={prescriptionBusyId === p.prescription_id}
                    className="btn-ghost rounded-lg px-3 py-2 text-xs"
                    onClick={() => dismissPrescription(p)}
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="surface rounded-2xl p-4 md:p-5">
        <p className="text-xs text-faint uppercase tracking-widest mb-3">Minhas funções</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(LINK_TYPE_LABEL).map(([role, label]) => {
            const Icon = LINK_TYPE_ICON[role];
            const active = roles.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => toggleRole(role)}
                className="rounded-xl px-3 py-2 text-xs flex items-center gap-2"
                style={{
                  border: `1px solid ${active ? "var(--brass)" : "var(--border)"}`,
                  background: active ? "var(--surface-2)" : "transparent",
                  color: active ? "var(--brass)" : "var(--text-dim)",
                }}
              >
                <Icon size={13} /> Sou {label.toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>

      {roles.length > 0 && (
        <form onSubmit={invite} className="surface rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-faint uppercase tracking-widest">Convidar por e-mail</p>
            {!isPro && <ProBadge />}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aluno@email.com" className="w-full pl-9 pr-3 py-3 ring-focus" />
            </div>
            {roles.length > 1 && (
              <select value={linkType} onChange={(e) => setLinkType(e.target.value)} className="p-3 text-sm ring-focus">
                {roles.map((role) => <option key={role} value={role}>{LINK_TYPE_LABEL[role]}</option>)}
              </select>
            )}
            <button disabled={actionLoading} className="btn-primary rounded-xl px-4 py-3 text-sm flex items-center justify-center gap-2">
              <UserPlus size={15} />{actionLoading ? "Aguarde…" : "Enviar convite"}
            </button>
          </div>
          <input
            type="text"
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            placeholder={linkType === "nutricionista" ? "Registro profissional (CRN) · opcional" : "Registro profissional (CREF) · opcional"}
            maxLength={60}
            className="w-full p-2.5 text-xs ring-focus mt-2"
          />
          <p className="text-[9px] text-faint mt-1">
            O Constancce não verifica esse número — ele só fica visível para quem receber o convite, pra conferir por conta própria.
          </p>
          {notice && <p className={`text-xs mt-3 ${notice.type === "error" ? "text-ember" : "text-moss"}`}>{notice.text}</p>}
        </form>
      )}
      {roles.length === 0 && (
        <p className="text-faint text-xs px-1">Marque acima se você é personal treinador e/ou nutricionista para poder convidar alunos e pacientes.</p>
      )}

      {receivedInvites.length > 0 && (
        <div className="surface rounded-2xl p-4 md:p-5">
          <p className="text-xs text-faint uppercase tracking-widest mb-1">Convites recebidos</p>
          <p className="text-faint text-[10px] mb-3">
            O Constancce não verifica credenciais profissionais. Confira o registro informado (quando houver) antes de aceitar.
          </p>
          <div className="flex flex-col gap-2">
            {receivedInvites.map((r) => (
              <LinkRow
                key={r.link_id}
                r={r}
                meta={r.professional_registration && (
                  <p className="text-faint text-[10px]">Registro informado: <span className="font-mono text-dim">{r.professional_registration}</span></p>
                )}
                action={
                  <div className="flex gap-2">
                    <button className="btn-primary rounded-lg px-3 py-2 text-xs flex-1 sm:flex-none" onClick={() => respond(r.link_id, true)}><Check size={13} className="inline mr-1" />Aceitar</button>
                    <button className="btn-ghost rounded-lg px-3 py-2 text-xs flex-1 sm:flex-none" onClick={() => respond(r.link_id, false)}>Recusar</button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}

      {sentInvites.length > 0 && (
        <div className="surface-2 rounded-2xl p-4">
          <p className="text-xs text-faint uppercase tracking-widest mb-2">Convites enviados</p>
          {sentInvites.map((r) => (
            <div key={r.link_id} className="flex items-center gap-2 text-sm py-1">
              <RefreshCw size={13} className="text-brass" />
              <span className="truncate flex-1">{r.display_name || r.email}</span>
              <span className="chip">Pendente</span>
              <button className="btn-ghost rounded-lg p-1.5" onClick={() => remove(r.link_id)}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="surface rounded-2xl p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-faint uppercase tracking-widest">Meus alunos e pacientes</p>
          <span className="chip">{myClients.length}</span>
        </div>
        {loading ? (
          <p className="text-dim text-sm">Carregando…</p>
        ) : myClients.length === 0 ? (
          <p className="text-faint text-xs">Ninguém aceitou seu convite ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {myClients.map((r) => {
              const stats = adherence[r.link_id];
              return (
                <LinkRow
                  key={r.link_id}
                  r={r}
                  action={<button className="btn-ghost rounded-lg px-3 py-2 text-xs text-ember" onClick={() => remove(r.link_id)}>Remover</button>}
                  meta={r.link_type === "personal" && stats && (
                    <p className="text-faint text-[10px]">
                      {stats.workouts_completed_30d || 0} treino{stats.workouts_completed_30d === 1 ? "" : "s"} nos últimos 30 dias
                      {stats.last_workout_date ? ` · último em ${new Date(`${stats.last_workout_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                    </p>
                  )}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="surface rounded-2xl p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-faint uppercase tracking-widest">Meus profissionais</p>
          <span className="chip">{myProfessionals.length}</span>
        </div>
        {loading ? (
          <p className="text-dim text-sm">Carregando…</p>
        ) : myProfessionals.length === 0 ? (
          <p className="text-faint text-xs">Você ainda não tem personal ou nutricionista vinculado.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {myProfessionals.map((r) => (
              <LinkRow
                key={r.link_id}
                r={r}
                meta={r.professional_registration && (
                  <p className="text-faint text-[10px]">Registro informado: <span className="font-mono text-dim">{r.professional_registration}</span></p>
                )}
                action={<button className="btn-ghost rounded-lg px-3 py-2 text-xs text-ember" onClick={() => remove(r.link_id)}>Remover</button>}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
