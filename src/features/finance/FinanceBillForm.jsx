import React, { useState } from "react";
import { Modal, Field } from "../../components/ui.jsx";

// Usado tanto por FinanceView.jsx (aba Finanças) quanto por CalendarView em
// App.jsx (atalho "Nova conta" ao agendar um dia no calendário) — fica em
// arquivo próprio pra não duplicar, já que os dois precisam do componente.
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => fmt(new Date());
const FIN_OUT = ["Alimentação", "Transporte", "Lazer", "Contas", "Compras", "Educação", "Aporte para meta", "Outro"];

export default function FinanceBillForm({ initial, onSave, onClose, defaultDueDate = null }) {
  const [description, setDescription] = useState(initial?.description || "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate || defaultDueDate || today());
  const [category, setCategory] = useState(initial?.category || "Contas");

  return (
    <Modal title={initial ? "Editar conta a pagar" : "Nova conta a pagar"} onClose={onClose}>
      <Field label="Descrição">
        <input className="w-full p-3 ring-focus" placeholder="Ex: Internet, aluguel, cartão..." value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <input type="number" min="0" step="0.01" className="w-full p-3 ring-focus" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Vencimento">
          <input type="date" className="w-full p-3 ring-focus" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Categoria">
        <select className="w-full p-3 ring-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          {FIN_OUT.filter((x) => x !== "Aporte para meta").map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <button
        disabled={!description.trim() || !value || Number(value) <= 0}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => onSave({
          ...initial,
          id: initial?.id || uid(),
          description: description.trim(),
          value: Number(value),
          dueDate,
          category,
          status: initial?.status || "pendente",
          createdAt: initial?.createdAt || today(),
          paidAt: initial?.paidAt || null,
        })}
      >
        {initial ? "Salvar alterações" : "Salvar conta"}
      </button>
    </Modal>
  );
}
