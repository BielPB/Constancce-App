import { rpcRequest } from "./supabaseRpc.js";

export async function fetchProfessionalLinks(session) {
  return rpcRequest(session, "get_constancce_professional_links");
}

export async function inviteClient(session, email, linkType) {
  return rpcRequest(session, "invite_constancce_client", {
    p_email: String(email || "").trim().toLowerCase(),
    p_link_type: linkType,
  });
}

export async function respondProfessionalLink(session, linkId, accept) {
  return rpcRequest(session, "respond_constancce_professional_link", {
    p_link_id: linkId,
    p_accept: accept,
  });
}

export async function removeProfessionalLink(session, linkId) {
  return rpcRequest(session, "remove_constancce_professional_link", {
    p_link_id: linkId,
  });
}

export async function sendPrescription(session, linkId, kind, payload, note) {
  return rpcRequest(session, "send_constancce_prescription", {
    p_link_id: linkId,
    p_kind: kind,
    p_payload: payload,
    p_note: note || null,
  });
}

export async function fetchPrescriptions(session) {
  return rpcRequest(session, "get_constancce_prescriptions");
}

export async function respondPrescription(session, prescriptionId, action) {
  return rpcRequest(session, "respond_constancce_prescription", {
    p_prescription_id: prescriptionId,
    p_action: action,
  });
}

export async function fetchClientAdherence(session, linkId) {
  const rows = await rpcRequest(session, "get_constancce_client_adherence", { p_link_id: linkId });
  return rows?.[0] || null;
}
